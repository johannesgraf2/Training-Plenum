"""Bridge tests against a fake strap: no Bluetooth, no bleak, no network."""
import asyncio
import gzip
import json
import struct
import tempfile
import unittest
from pathlib import Path

import bridge
from bridge import Outbox, Status, StrapSession, TPError, upload_once, upload_payload, wp


def record(ts, hr=55):
    data = bytearray(84)
    struct.pack_into('<I', data, 11, ts)
    data[21] = hr
    return wp.build_frame(wp.HISTORY, 24, data[6], data[7:])


def metadata(kind, cursor=0):
    body = bytearray(14)
    struct.pack_into('<I', body, 10, cursor)
    return wp.build_frame(wp.METADATA, 0, kind, body)


class FakeStrap:
    """Answers commands like a WHOOP 4.0 and serves history chunks one ACK at a time."""

    def __init__(self, chunks=(), accept_short_clock=True, battery_reply=True, silent_after_start=False):
        self.session = None
        self.commands = []
        self.chunks = list(chunks)
        self.accept_short_clock = accept_short_clock
        self.battery_reply = battery_reply
        self.silent_after_start = silent_after_start
        self.clock = 0
        self.seq = 0
        self.ends = []
        self.outbox_at_ack = []

    def notify(self, raw):
        # Fragment like a small MTU to exercise the reassembler.
        for start in range(0, len(raw), 20):
            asyncio.get_running_loop().call_soon(self.session.on_data, raw[start:start + 20])

    def reply(self, cmd, request_seq, body=b'', result=1):
        self.seq = (self.seq + 1) & 0xFF
        self.notify(wp.build_frame(wp.RESPONSE, self.seq, cmd, bytes((request_seq, result)) + body))

    def next_chunk(self):
        if not self.chunks:
            self.notify(metadata(wp.HISTORY_COMPLETE))
            return
        records, cursor = self.chunks.pop(0)
        for raw in records:
            self.notify(raw)
        end = metadata(wp.HISTORY_END, cursor)
        self.ends.append(end)
        self.notify(end)

    async def write(self, raw):
        frame = wp.parse_frame(raw)
        cmd, body = frame.cmd, frame.data[7:]
        self.commands.append((cmd, bytes(body)))
        if cmd == wp.GET_BATTERY and self.battery_reply:
            self.reply(cmd, frame.seq, struct.pack('<H', 873))
        elif cmd == wp.GET_HELLO:
            self.reply(cmd, frame.seq, bytes(14) + b'4C0123456\x00' + bytes(107))
        elif cmd == wp.REPORT_VERSION:
            self.reply(cmd, frame.seq, bytes([1]) + struct.pack('<4I', 41, 17, 6, 0) + struct.pack('<4I', 17, 2, 2, 0) + bytes(35))
        elif cmd == wp.SET_CLOCK:
            if len(body) == 9 or self.accept_short_clock:
                self.clock = struct.unpack_from('<I', body)[0]
            self.reply(cmd, frame.seq)
        elif cmd == wp.GET_CLOCK:
            self.reply(cmd, frame.seq, struct.pack('<I', self.clock))
        elif cmd == wp.SEND_HISTORY:
            self.reply(cmd, frame.seq, result=2)  # pending first, then ok
            self.reply(cmd, frame.seq)
            self.notify(metadata(wp.HISTORY_START))
            if self.silent_after_start:
                self.notify(record(1760400000))
            else:
                self.next_chunk()
        elif cmd == wp.HISTORY_RESULT:
            self.outbox_at_ack.append(self.session.outbox.count())
            self.next_chunk()
        elif cmd in (wp.REALTIME_RAW_STREAM, wp.GET_DATA_RANGE):
            self.reply(cmd, frame.seq)


class BridgeTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.outbox = Outbox(Path(self.temp.name) / 'outbox.db')
        self.status = Status()

    def tearDown(self):
        self.temp.cleanup()

    def session(self, strap, **options):
        options = {'response_timeout': 0.3, 'watchdog': 1.0, 'settle': 0, **options}
        session = StrapSession(strap.write, self.outbox, self.status, **options)
        strap.session = session
        return session


class HandshakeTests(BridgeTestCase):
    def test_sequence_and_strap_details(self):
        strap = FakeStrap()

        async def scenario():
            session = self.session(strap)
            await session.handshake()
            with self.assertRaises(RuntimeError):
                await session.handshake()

        asyncio.run(scenario())
        self.assertEqual([cmd for cmd, _ in strap.commands], [26, 35, 7, 10, 11, 63, 34])
        self.assertEqual(strap.commands[5], (63, b'\x00'))
        values = self.status.snapshot()
        self.assertEqual(values['battery']['percent'], 87.3)
        self.assertEqual(values['firmware'], {'harvard': '41.17.6.0', 'boylston': '17.2.2.0'})
        self.assertEqual(len(values['serialHash']), 12)
        self.assertNotIn('4C0123456', json.dumps(values))
        self.assertTrue(values['clockOk'])

    def test_clock_falls_back_to_nine_byte_form_and_battery_may_stay_silent(self):
        strap = FakeStrap(accept_short_clock=False, battery_reply=False)

        async def scenario():
            await self.session(strap).handshake()

        asyncio.run(scenario())
        clock_writes = [body for cmd, body in strap.commands if cmd == wp.SET_CLOCK]
        self.assertEqual([len(body) for body in clock_writes], [8, 9])
        self.assertTrue(self.status.snapshot()['clockOk'])
        self.assertNotIn('battery', self.status.snapshot())


class OffloadTests(BridgeTestCase):
    def test_each_chunk_is_stored_before_its_ack(self):
        chunks = [([record(1760400000 + i) for i in range(3)], 1), ([], 2), ([record(1760400100)], 3)]
        strap = FakeStrap(chunks=chunks)

        async def scenario():
            return await self.session(strap).offload()

        result = asyncio.run(scenario())
        acks = [body for cmd, body in strap.commands if cmd == wp.HISTORY_RESULT]
        self.assertEqual(acks, [b'\x01' + end[17:25] for end in strap.ends])
        # 3 records + END, then the empty chunk's END, then 1 record + END.
        self.assertEqual(strap.outbox_at_ack, [4, 5, 7])
        self.assertEqual((result['records'], result['chunks'], result['aborted']), (4, 3, False))
        self.assertNotIn(wp.ABORT_HISTORY, [cmd for cmd, _ in strap.commands])
        self.assertIn('lastSyncAt', self.status.snapshot())

    def test_failed_commit_aborts_without_ack(self):
        strap = FakeStrap(chunks=[([record(1760400000)], 1)])

        def broken(rows):
            raise OSError('Datenträger voll')

        self.outbox.add = broken

        async def scenario():
            return await self.session(strap).offload()

        result = asyncio.run(scenario())
        commands = [cmd for cmd, _ in strap.commands]
        self.assertNotIn(wp.HISTORY_RESULT, commands)
        self.assertIn(wp.ABORT_HISTORY, commands)
        self.assertTrue(result['aborted'])
        self.assertNotIn('lastSyncAt', self.status.snapshot())

    def test_watchdog_aborts_silent_offload(self):
        strap = FakeStrap(silent_after_start=True)

        async def scenario():
            return await self.session(strap, watchdog=0.2).offload()

        result = asyncio.run(scenario())
        self.assertEqual([cmd for cmd, _ in strap.commands], [wp.SEND_HISTORY, wp.ABORT_HISTORY])
        self.assertTrue(result['aborted'])
        self.assertEqual(self.outbox.count(), 0)  # The unacknowledged record is replayed later.

    def test_disconnect_ends_offload_immediately(self):
        strap = FakeStrap(silent_after_start=True)

        async def scenario():
            session = self.session(strap, watchdog=30)
            asyncio.get_running_loop().call_later(0.1, session.on_disconnect)
            return await asyncio.wait_for(session.offload(), 5)

        self.assertTrue(asyncio.run(scenario())['aborted'])

    def test_events_and_realtime_heart_rate_are_kept(self):
        strap = FakeStrap()
        event = bytearray(27)
        event[6] = wp.EVENT_BATTERY
        struct.pack_into('<H', event, 17, 512)
        frame = wp.build_frame(wp.EVENT, 1, event[6], event[7:])

        async def scenario():
            session = self.session(strap)
            session.on_data(frame)
            session.on_heart_rate(bytes((0x10, 61)) + struct.pack('<H', 1024))
            return session.take_realtime()

        rows = asyncio.run(scenario())
        self.assertEqual([source for source, _, _ in rows], ['whoop', 'hrm'])
        self.assertEqual(self.status.snapshot()['battery']['percent'], 51.2)
        self.assertEqual(self.status.snapshot()['realtimeHr']['bpm'], 61)


class UploadTests(BridgeTestCase):
    class Client:
        def __init__(self, error=None):
            self.error = error
            self.posts = []

        def post(self, path, payload, compress=False):
            self.posts.append((path, payload, compress))
            if self.error:
                raise self.error
            return {'accepted': len(payload['frames'])}

    def test_frames_leave_the_outbox_only_after_success(self):
        self.outbox.add([('whoop', 1.0, record(1760400000)), ('hrm', 2.0, b'\x00\x3c')])
        failing = self.Client(TPError('HTTP 503', 503))
        with self.assertRaises(TPError):
            upload_once(self.outbox, failing, 'abc')
        self.assertEqual(self.outbox.count(), 2)
        client = self.Client()
        self.assertEqual(upload_once(self.outbox, client, 'abc', limit=1), 1)
        self.assertEqual(upload_once(self.outbox, client, 'abc', limit=1), 1)
        self.assertEqual(upload_once(self.outbox, client, 'abc'), 0)
        self.assertEqual(self.outbox.count(), 0)
        path, payload, compress = client.posts[0]
        self.assertEqual((path, compress), ('/api/whoop/bridge/frames', True))
        self.assertEqual(payload['frames'][0][0], 'whoop')

    def test_batch_id_is_stable_for_the_same_frames(self):
        self.outbox.add([('whoop', 1.0, record(1760400000))])
        rows = self.outbox.batch()
        self.assertEqual(upload_payload('abc', rows)['batchId'], upload_payload('abc', rows)['batchId'])
        self.assertTrue(upload_payload('abc', rows)['batchId'].startswith('abc-1-1-'))

    def test_client_compresses_deterministically(self):
        payload = {'batchId': 'x', 'frames': []}
        body = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(gzip.compress(body, mtime=0), gzip.compress(body, mtime=0))
        self.assertEqual(bridge.TPClient('http://localhost:5000/', 't').url, 'http://localhost:5000')


if __name__ == '__main__':
    unittest.main()
