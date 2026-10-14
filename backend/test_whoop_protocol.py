import struct
import unittest

import whoop_protocol as wp


def hexbytes(text):
    return bytes.fromhex(text.replace(' ', ''))


EVENT_68 = hexbytes('aa 14 00 03 30 fc 44 00 3c ee 63 6a 80 7e 04 00 01 01 ff 00 58 2e c2 81')
EVENT_102 = hexbytes('aa 14 00 03 30 0a 66 00 9e ee 63 6a 60 48 04 00 01 01 00 00 34 0e 63 88')


def v24_record(ts=1760400000, hr=58, rr=(1030, 0, 1012), gravity=(0.01, -0.02, 0.99), contact=1, skin=1234, resp=4321):
    data = bytearray(84)
    struct.pack_into('<I', data, 11, ts)
    data[21] = hr
    data[22] = len(rr)
    for index, value in enumerate(rr):
        struct.pack_into('<H', data, 23 + 2 * index, value)
    struct.pack_into('<3f', data, 40, *gravity)
    data[55] = contact
    struct.pack_into('<H', data, 72, skin)
    struct.pack_into('<H', data, 80, resp)
    return wp.build_frame(wp.HISTORY, 24, data[6], data[7:])


def history_end(cursor=7):
    body = bytearray(14)
    struct.pack_into('<I', body, 0, 1760400000)
    struct.pack_into('<I', body, 10, cursor)
    return wp.build_frame(wp.METADATA, 3, wp.HISTORY_END, body)


class FramingTests(unittest.TestCase):
    def test_crc8_check_values(self):
        self.assertEqual(wp.crc8(b'123456789'), 0xF4)
        for length, expected in (('14 00', 0x03), ('1c 00', 0xAB), ('08 00', 0xA8), ('07 00', 0x6B)):
            self.assertEqual(wp.crc8(hexbytes(length)), expected, length)

    def test_captured_event_frames(self):
        for raw, event, crc in ((EVENT_68, 68, 0x81C22E58), (EVENT_102, 0x66, 0x88630E34)):
            frame = wp.parse_frame(raw)
            self.assertEqual((frame.length, frame.type), (20, wp.EVENT))
            self.assertEqual(wp.crc32(raw[4:20]), crc)
            self.assertEqual(wp.parse_event(frame)['event'], event)
        self.assertEqual(wp.parse_event(wp.parse_frame(EVENT_68))['ts'], 0x6A63EE3C)

    def test_command_frames(self):
        cases = [
            (26, 0, b'\x00', 'aa 08 00 a8 23 00 1a 00 17 25 ee 23'),
            (35, 1, b'\x00', 'aa 08 00 a8 23 01 23 00 9a c2 a8 2c'),
            (7, 2, b'\x00', 'aa 08 00 a8 23 02 07 00 65 9d 06 df'),
            (63, 3, b'\x00', 'aa 08 00 a8 23 03 3f 00 a9 4b 5b c9'),
            (34, 4, b'\x00', 'aa 08 00 a8 23 04 22 00 30 31 78 33'),
            (22, 5, b'\x00', 'aa 08 00 a8 23 05 16 00 f0 a8 90 89'),
            (11, 6, b'', 'aa 07 00 6b 23 06 0b a5 5f c2 04'),
            (10, 7, wp.set_clock_body(1700000000), 'aa 0f 00 c3 23 07 0a 00 f1 53 65 00 00 00 00 d4 7a ca 1a'),
            (23, 8, wp.ack_history_body(struct.pack('<II', 7, 2)), 'aa 10 00 57 23 08 17 01 07 00 00 00 02 00 00 00 62 61 7c dc'),
            (20, 9, b'\x00', 'aa 08 00 a8 23 09 14 00 16 33 bc b2'),
        ]
        for cmd, seq, body, expected in cases:
            self.assertEqual(wp.build_command(cmd, seq, body), hexbytes(expected), cmd)

    def test_set_clock_nine_byte_form(self):
        self.assertEqual(len(wp.set_clock_body(1700000000, padding=5)), 9)
        with self.assertRaises(wp.ProtocolError):
            wp.set_clock_body(1, padding=3)

    def test_ack_body(self):
        body = wp.ack_history_body(struct.pack('<II', 7, 2))
        self.assertEqual((len(body), body[0]), (9, 1))
        with self.assertRaises(wp.ProtocolError):
            wp.ack_history_body(b'\x00' * 7)

    def test_destructive_commands_are_refused(self):
        for cmd in (15, 25, 29, 32, 33, 36, 37, 38, 45, 83, 96, 99, 142, 143, 144):
            with self.assertRaises(wp.ProtocolError):
                wp.build_command(cmd, 0)
        wp.build_command(wp.ABORT_HISTORY, 0)

    def test_parse_frame_rejects_corruption(self):
        bad_crc32 = bytearray(EVENT_68)
        bad_crc32[10] ^= 1
        bad_crc8 = bytearray(EVENT_68)
        bad_crc8[3] ^= 1
        for raw, reason in ((bad_crc32, 'crc32'), (bad_crc8, 'crc8'), (EVENT_68[:-1], 'size'), (b'\x00' + EVENT_68, 'start')):
            self.assertEqual(wp.frame_error(raw), reason)
            with self.assertRaises(wp.ProtocolError):
                wp.parse_frame(raw)


class ReassemblerTests(unittest.TestCase):
    def test_fragments_and_noise(self):
        record = v24_record()
        stream = b'\x01\x02' + EVENT_68 + b'\xaa\x00' + record + b'\xff' + EVENT_102
        reassembler = wp.Reassembler()
        frames = []
        for start in range(0, len(stream), 7):
            frames.extend(reassembler.feed(stream[start:start + 7]))
        self.assertEqual([frame.raw for frame in frames], [EVENT_68, record, EVENT_102])
        self.assertEqual(reassembler.buffer, bytearray())

    def test_bad_crc32_resyncs_to_next_frame(self):
        broken = bytearray(EVENT_68)
        broken[12] ^= 0xFF
        frames = wp.Reassembler().feed(bytes(broken) + EVENT_102)
        self.assertEqual([frame.raw for frame in frames], [EVENT_102])

    def test_oversized_length_is_skipped(self):
        frames = wp.Reassembler().feed(b'\xaa\xff\xff\x00' + EVENT_68)
        self.assertEqual([frame.raw for frame in frames], [EVENT_68])

    def test_reset_drops_partial_frame(self):
        reassembler = wp.Reassembler()
        self.assertEqual(reassembler.feed(EVENT_68[:10]), [])
        reassembler.reset()
        self.assertEqual([frame.raw for frame in reassembler.feed(EVENT_102)], [EVENT_102])


class DecoderTests(unittest.TestCase):
    def test_v24_record(self):
        record = wp.decode_history(wp.parse_frame(v24_record()))
        self.assertEqual((record['version'], record['ts'], record['hr'], record['rr']), (24, 1760400000, 58, [1030, 1012]))
        self.assertAlmostEqual(record['gravity'][2], 0.99, places=5)
        self.assertEqual((record['contact'], record['skinRaw'], record['respRaw']), (1, 1234, 4321))

    def test_v25_record(self):
        data = bytearray(80)
        struct.pack_into('<I', data, 11, 1760400100)
        struct.pack_into('<3h', data, 73, 0, -8192, 16384)
        raw = wp.build_frame(wp.HISTORY, 25, 0, data[7:])
        self.assertEqual(len(raw), 84)
        record = wp.decode_history(wp.parse_frame(raw))
        self.assertEqual((record['ts'], record['hr'], record['gravity']), (1760400100, None, (0.0, -0.5, 1.0)))

    def test_unknown_layout_is_flagged(self):
        raw = wp.build_frame(wp.HISTORY, 31, 0, bytes(60))
        self.assertEqual(wp.decode_history(wp.parse_frame(raw)), {'undecoded': True, 'version': 31})
        short_v25 = wp.build_frame(wp.HISTORY, 25, 0, bytes(60))
        self.assertTrue(wp.decode_history(wp.parse_frame(short_v25))['undecoded'])

    def test_history_end_token_and_kinds(self):
        frame = wp.parse_frame(history_end(cursor=7))
        self.assertEqual(len(frame.raw), 25)
        self.assertEqual(wp.metadata_kind(frame), wp.HISTORY_END)
        token = wp.history_end_token(frame)
        self.assertEqual(token, frame.raw[17:25])
        self.assertEqual(struct.unpack_from('<I', token)[0], 7)
        with self.assertRaises(wp.ProtocolError):
            wp.history_end_token(wp.parse_frame(EVENT_68))

    def test_response(self):
        body = bytes((wp.GET_BATTERY, 4, 1)) + struct.pack('<H', 873)
        frame = wp.parse_frame(wp.build_frame(wp.RESPONSE, 9, body[0], body[1:]))
        response = wp.parse_response(frame)
        self.assertEqual((response['cmd'], response['requestSeq'], response['result']), (26, 4, 'ok'))
        self.assertEqual(wp.battery_from_response(response['body']), 87.3)

    def test_battery_event(self):
        data = bytearray(27)
        data[6] = wp.EVENT_BATTERY
        struct.pack_into('<I', data, 8, 1760400000)
        struct.pack_into('<H', data, 17, 655)
        struct.pack_into('<H', data, 21, 3912)
        data[26] = 1
        event = wp.parse_event(wp.parse_frame(wp.build_frame(wp.EVENT, 1, data[6], data[7:])))
        self.assertEqual(event['battery'], {'percent': 65.5, 'millivolts': 3912, 'charging': True})

    def test_version_and_serial(self):
        version = bytes([1]) + struct.pack('<4I', 41, 17, 6, 0) + struct.pack('<4I', 17, 2, 2, 0) + bytes(35)
        self.assertEqual(wp.firmware_from_response(version), {'harvard': '41.17.6.0', 'boylston': '17.2.2.0'})
        hello = bytes(14) + b'4C0123456\x00' + bytes(107)
        self.assertEqual(wp.serial_from_hello(hello), '4C0123456')

    def test_realtime_frame(self):
        data = bytearray(18)
        struct.pack_into('<I', data, 6, 1760400000)
        data[12], data[13] = 61, 2
        struct.pack_into('<2H', data, 14, 980, 0)
        frame = wp.parse_frame(wp.build_frame(wp.REALTIME_HR, data[5], data[6], data[7:]))
        self.assertEqual(wp.decode_realtime(frame), {'ts': 1760400000, 'hr': 61, 'rr': [980]})

    def test_standard_heart_rate(self):
        self.assertEqual([wp.rr_ticks_to_ms(t) for t in (512, 1024, 1536)], [500, 1000, 1500])
        value = bytes((0x10 | 0x08, 62)) + struct.pack('<H', 5) + struct.pack('<2H', 1024, 1000)
        self.assertEqual(wp.parse_heart_rate_measurement(value), {'hr': 62, 'rr': [1000, 977]})
        self.assertEqual(wp.parse_heart_rate_measurement(bytes((0x01,)) + struct.pack('<H', 300)), {'hr': 300, 'rr': []})


if __name__ == '__main__':
    unittest.main()
