"""WHOOP ingestion tests: an independently imported app on a temporary SQLite database."""
import base64
import gzip
import importlib.util
import json
import os
import struct
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet

import whoop_protocol as wp
from whoop_sync import decode_frames, hour_view, merge_records, empty_hour, pack_hour, unpack_hour

BASE = 1760400000 // 3600 * 3600  # an hour boundary


def record(ts, hr=55, rr=(1000, 990), gravity=(0.0, 0.0, 1.0), version=24):
    data = bytearray(84)
    struct.pack_into('<I', data, 11, ts)
    data[21] = hr
    data[22] = len(rr)
    for index, value in enumerate(rr):
        struct.pack_into('<H', data, 23 + 2 * index, value)
    struct.pack_into('<3f', data, 40, *gravity)
    data[55] = 1
    struct.pack_into('<H', data, 72, 900)
    return wp.build_frame(wp.HISTORY, version, data[6], data[7:])


def item(raw, source='whoop', received=None):
    return [source, received or time.time(), base64.b64encode(raw).decode()]


def body(batch_id, frames):
    return gzip.compress(json.dumps({'batchId': batch_id, 'frames': frames}).encode(), mtime=0)


class PureTests(unittest.TestCase):
    def test_decode_sorts_frames_into_records_realtime_and_counters(self):
        broken = bytearray(record(BASE))
        broken[30] ^= 1
        frames = [item(record(BASE)), item(record(BASE + 1, version=31)), item(bytes(broken)),
                  item(record(1000)), item(bytes((0x00, 61)), 'hrm', BASE + 5.4)]
        records, realtime, counts = decode_frames(frames)
        self.assertEqual([r['ts'] for r in records], [BASE])
        self.assertEqual(realtime, [(BASE + 5, 61)])
        self.assertEqual((counts['undecoded'], counts['invalid'], counts['badTime']), (1, 1, 1))
        self.assertEqual(counts['versions'], {'24': 2, '31': 1})

    def test_merge_dedupes_on_timestamp_and_keeps_rr_order(self):
        hour = empty_hour()
        first = wp.decode_history(wp.parse_frame(record(BASE, rr=(1000, 990))))
        self.assertEqual(merge_records(hour, [first], []), 1)
        self.assertEqual(merge_records(hour, [first], [(BASE, 60)]), 0)
        view = hour_view(pack_hour(hour))
        self.assertEqual(view['rr'], [(BASE, 0, 1000), (BASE, 1, 990)])
        self.assertEqual(view['gravity'], [(0.0, 0.0, 1.0)])
        self.assertEqual(view['realtime'], [(BASE, 60)])
        fixed = dict(first, hr=57, rr=[1010])
        merge_records(hour, [fixed], [], replace=True)
        restored = unpack_hour(pack_hour(hour))
        self.assertEqual(restored['samples'][BASE][0], 57)
        self.assertEqual(restored['rr'], {(BASE, 0): 1010})


class WhoopAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + (root / 'whoop.db').as_posix(),
                                                 'UPLOAD_FOLDER': str(root / 'uploads'),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('whoop_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')
        cls.Account, cls.Batch, cls.Hour = cls.backend.app.extensions['whoop_models']
        cls.state = cls.backend.app.extensions['whoop']

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            for model in (self.Hour, self.Batch, self.Account):
                model.query.delete()
            self.backend.db.session.commit()

    def connect(self):
        response = self.client.post('/api/whoop/token', json={})
        self.assertEqual(response.status_code, 201)
        return response.get_json()['token']

    def upload(self, token, batch_id, frames, raw=None):
        return self.client.post('/api/whoop/bridge/frames', data=raw if raw is not None else body(batch_id, frames),
                                headers={'Authorization': f'Bearer {token}', 'Content-Encoding': 'gzip',
                                         'Content-Type': 'application/json'})

    def test_status_before_connecting(self):
        response = self.client.get('/api/whoop')
        self.assertEqual(response.get_json()['connected'], False)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.client.post('/api/whoop/sync', json={}).status_code, 409)

    def test_token_is_stored_only_as_hash_and_rotates(self):
        token = self.connect()
        with self.backend.app.app_context():
            stored = self.backend.db.session.get(self.Account, self.backend.DEMO_USER_ID).token_hash
        self.assertNotEqual(stored, token)
        self.assertEqual(len(stored), 64)
        rotated = self.connect()
        heartbeat = lambda value: self.client.post('/api/whoop/bridge/heartbeat', json={},  # noqa: E731
                                                   headers={'Authorization': f'Bearer {value}'})
        self.assertEqual(heartbeat(token).status_code, 403)
        self.assertEqual(heartbeat(rotated).status_code, 200)

    def test_bridge_auth(self):
        self.assertEqual(self.client.post('/api/whoop/bridge/heartbeat', json={}).status_code, 401)
        token = self.connect()
        self.assertEqual(self.client.post('/api/whoop/bridge/heartbeat', json={},
                                          headers={'Authorization': 'Bearer falsch'}).status_code, 403)
        self.assertEqual(self.upload('falsch', 'b1', []).status_code, 403)
        self.assertEqual(self.upload(token, 'b1', []).status_code, 200)

    def test_heartbeat_stores_whitelisted_status_and_hands_out_sync_request(self):
        token = self.connect()
        headers = {'Authorization': f'Bearer {token}'}
        self.client.post('/api/whoop/sync', json={})
        reply = self.client.post('/api/whoop/bridge/heartbeat', headers=headers,
                                 json={'strapConnected': True, 'battery': {'percent': 80}, 'secret': 'x'})
        self.assertEqual(reply.get_json(), {'syncRequested': True})
        reply = self.client.post('/api/whoop/bridge/heartbeat', headers=headers, json={'strapConnected': True})
        self.assertEqual(reply.get_json(), {'syncRequested': False})
        status = self.client.get('/api/whoop').get_json()
        self.assertTrue(status['bridge']['online'])
        self.assertTrue(status['bridge']['strapConnected'])
        self.assertNotIn('secret', status['bridge'])
        self.assertEqual(self.client.post('/api/whoop/bridge/heartbeat', headers=headers, data='x' * 70000,
                                          content_type='application/json').status_code, 413)

    def test_upload_decodes_dedupes_and_reports_data_through(self):
        token = self.connect()
        frames = [item(record(BASE + i)) for i in range(3)] + [item(record(BASE + 3600, rr=()))]
        result = self.upload(token, 'b1', frames).get_json()
        self.assertEqual((result['accepted'], result['records'], result['added']), (4, 4, 4))
        overlapping = [item(record(BASE + 2)), item(record(BASE + 4))]
        self.assertEqual(self.upload(token, 'b2', overlapping).get_json()['added'], 1)
        status = self.client.get('/api/whoop').get_json()
        self.assertEqual(status['hours'], 2)
        self.assertEqual(status['stats']['records'], 5)
        self.assertEqual(status['dataThrough'], datetime.utcfromtimestamp(BASE + 3600).isoformat() + 'Z')
        self.assertEqual(status['stats']['lastRrAt'], BASE + 4)
        with self.backend.app.app_context():
            hour = self.backend.db.session.get(self.Hour, (self.backend.DEMO_USER_ID, BASE))
            view = hour_view(hour.data)
        self.assertEqual(view['ts'], [BASE, BASE + 1, BASE + 2, BASE + 4])
        self.assertEqual(view['hr'], [55] * 4)
        self.assertEqual(len(view['rr']), 8)

    def test_batches_are_idempotent_and_conflicts_rejected(self):
        token = self.connect()
        frames = [item(record(BASE), received=1.0)]
        self.assertFalse(self.upload(token, 'same', frames).get_json()['duplicate'])
        self.assertTrue(self.upload(token, 'same', frames).get_json()['duplicate'])
        other = [item(record(BASE + 1), received=1.0)]
        self.assertEqual(self.upload(token, 'same', other).status_code, 409)
        self.assertEqual(self.client.get('/api/whoop').get_json()['stats']['records'], 1)

    def test_upload_limits_and_validation(self):
        token = self.connect()
        bomb = gzip.compress(b'{"batchId":"x","frames":[]}' + b' ' * (9 * 1024 * 1024), mtime=0)
        self.assertEqual(self.upload(token, None, None, raw=bomb).status_code, 413)
        self.assertEqual(self.upload(token, None, None, raw=b'not gzip').status_code, 400)
        self.assertEqual(self.upload(token, 'bad id!', []).status_code, 400)
        self.assertEqual(self.upload(token, 'b', [['whoop', 1, '***']]).status_code, 400)

    def test_unknown_record_version_is_kept_and_reported(self):
        token = self.connect()
        result = self.upload(token, 'b1', [item(record(BASE, version=31))]).get_json()
        self.assertEqual((result['records'], result['undecoded']), (0, 1))
        status = self.client.get('/api/whoop').get_json()
        self.assertIn('Version 31', status['lastError'])
        with self.backend.app.app_context():
            self.assertEqual(self.Batch.query.count(), 1)

    def test_guard_exemption_applies_only_to_bridge_routes(self):
        token = self.connect()
        self.assertEqual(self.client.post('/api/whoop/sync', data='x', content_type='text/plain').status_code, 415)
        self.assertEqual(self.client.post('/api/whoop/sync', json={}, headers={'Origin': 'http://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/api/whoop/bridge/heartbeat', json={}, headers={
            'Authorization': f'Bearer {token}', 'Origin': 'http://evil.example'}).status_code, 403)
        self.assertEqual(self.upload(token, 'b1', [item(record(BASE + i)) for i in range(200)]).status_code, 200)

    def test_recompute_replays_raw_batches_and_prunes_expired_ones(self):
        token = self.connect()
        self.assertEqual(self.client.post('/api/whoop/recompute', json={}).status_code, 409)
        self.upload(token, 'b1', [item(record(BASE, hr=50))])
        with self.backend.app.app_context():
            hour = self.backend.db.session.get(self.Hour, (self.backend.DEMO_USER_ID, BASE))
            damaged = unpack_hour(hour.data)
            damaged['samples'][BASE][0] = 1
            hour.data = pack_hour(damaged)
            self.backend.db.session.add(self.Batch(batch_id='old', user_id=self.backend.DEMO_USER_ID, sha256='0' * 64,
                                                   frame_count=0, blob=body('old', []),
                                                   received_at=datetime.utcnow() - timedelta(days=40)))
            self.backend.db.session.commit()
        self.assertEqual(self.client.post('/api/whoop/recompute', json={}).status_code, 202)
        self.state.thread.join(10)
        self.assertFalse(self.client.get('/api/whoop').get_json()['reprocessing'])
        with self.backend.app.app_context():
            hour = self.backend.db.session.get(self.Hour, (self.backend.DEMO_USER_ID, BASE))
            self.assertEqual(hour_view(hour.data)['hr'], [50])
            self.assertEqual([row.batch_id for row in self.Batch.query.all()], ['b1'])

    def test_disconnect_keeps_or_deletes_data(self):
        token = self.connect()
        self.upload(token, 'b1', [item(record(BASE))])
        self.assertFalse(self.client.delete('/api/whoop').get_json()['connected'])
        with self.backend.app.app_context():
            self.assertEqual(self.Hour.query.count(), 1)
        token = self.connect()
        self.client.delete('/api/whoop?deleteData=1')
        with self.backend.app.app_context():
            self.assertEqual((self.Hour.query.count(), self.Batch.query.count()), (0, 0))


if __name__ == '__main__':
    unittest.main()
