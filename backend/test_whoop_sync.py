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
from dateutil.tz import gettz

import whoop_protocol as wp
from whoop_sync import decode_frames, hour_view, merge_records, empty_hour, pack_hour, unpack_hour
from test_whoop_analytics import DAY, synthetic_night

BASE = 1760400000 // 3600 * 3600  # an hour boundary


def record(ts, hr=55, rr=(1000, 990), gravity=(0.0, 0.0, 1.0), version=24, contact=1):
    data = bytearray(84)
    struct.pack_into('<I', data, 11, ts)
    data[21] = hr
    data[22] = len(rr)
    for index, value in enumerate(rr):
        struct.pack_into('<H', data, 23 + 2 * index, value)
    struct.pack_into('<3f', data, 40, *gravity)
    data[55] = contact
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
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode(),
                                                 'TRAINHUB_TIMEZONE': 'Europe/Berlin'})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('whoop_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')
        cls.Account, cls.Batch, cls.Hour, cls.Day = cls.backend.app.extensions['whoop_models']
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
            for model in (self.Day, self.Hour, self.Batch, self.Account):
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
        self.recompute()
        self.assertFalse(self.client.get('/api/whoop').get_json()['reprocessing'])
        with self.backend.app.app_context():
            hour = self.backend.db.session.get(self.Hour, (self.backend.DEMO_USER_ID, BASE))
            self.assertEqual(hour_view(hour.data)['hr'], [50])
            self.assertEqual([row.batch_id for row in self.Batch.query.all()], ['b1'])

    def recompute(self):
        self.assertEqual(self.client.post('/api/whoop/recompute', json={}).status_code, 202)
        self.state.thread.join(60)
        status = self.client.get('/api/whoop').get_json()
        self.assertFalse(status['analytics']['computing'])
        return status

    def upload_night(self, token, nights=1, prefix='night'):
        """The synthetic night from test_whoop_analytics as v24 records, shifted back by whole days."""
        for back in range(nights):
            night = synthetic_night()
            beats = {ts: ms for ts, _, ms in night['rr']}
            frames = []
            for ts, hr, gravity, contact in zip(night['ts'], night['hr'], night['gravity'], night['contact']):
                shifted = ts - back * 86400
                frames.append(item(record(shifted, hr=hr or 0, rr=(beats[ts],) if ts in beats else (), gravity=gravity,
                                          contact=contact), received=1.0))
            for start in range(0, len(frames), 20000):
                response = self.upload(token, f'{prefix}-{back}-{start}', frames[start:start + 20000])
                self.assertEqual(response.status_code, 200, response.get_json())

    def test_night_becomes_a_day_with_sleep_hrv_and_rhr(self):
        token = self.connect()
        self.upload_night(token)
        status = self.recompute()
        self.assertEqual(status['analytics']['nights'], 1)
        days = self.client.get(f'/api/whoop/days?from={DAY.isoformat()}&to={DAY.isoformat()}').get_json()['days']
        self.assertEqual(len(days), 1)
        day = days[0]
        self.assertEqual((day['date'], day['hrv'], day['rhr'], day['sleep']['sessions']), (DAY.isoformat(), 40.0, 48.0, 1))
        self.assertTrue(day['sleep']['start'].startswith('2026-10-13T21:0'))
        self.assertEqual((day['confidence'], day['readiness']), ('calibrating', None))
        self.assertEqual(status['analytics']['latest']['date'], DAY.isoformat())

    def test_readiness_after_calibration_and_only_changed_days_recompute(self):
        token = self.connect()
        self.upload_night(token, nights=5)
        self.recompute()
        days = self.client.get(f'/api/whoop/days?from={(DAY - timedelta(days=4)).isoformat()}&to={DAY.isoformat()}').get_json()['days']
        self.assertEqual([day['nights'] for day in days], [1, 2, 3, 4, 5])
        self.assertEqual(days[-1]['confidence'], 'provisional')
        self.assertIsNotNone(days[-1]['readiness'])
        self.assertEqual(days[-1]['hrvBaseline']['mean'], 40.0)
        with self.backend.app.app_context():
            before = {row.date: row.computed_at for row in self.Day.query.all()}
            self.state.recompute_requested = False
        # A new sample at 12:30 on DAY touches DAY and the day before (whose window reaches into DAY).
        late = int(datetime(DAY.year, DAY.month, DAY.day, 12, 30, tzinfo=gettz('Europe/Berlin')).timestamp())
        self.upload(token, 'late', [item(record(late, hr=70))])
        self.state.trigger()
        self.state.thread.join(60)
        with self.backend.app.app_context():
            after = {row.date: row.computed_at for row in self.Day.query.all()}
        changed = sorted(day for day in after if after[day] != before.get(day))
        self.assertEqual(changed, [(DAY - timedelta(days=1)).isoformat(), DAY.isoformat()])
        self.assertEqual(len(after), 6)  # the evening before the first night has a strain value

    def test_days_validation(self):
        self.assertEqual(self.client.get('/api/whoop/days?from=2026-13-01').status_code, 400)
        self.assertEqual(self.client.get('/api/whoop/days?from=2025-01-01&to=2026-10-14').status_code, 400)
        self.assertEqual(self.client.get('/api/whoop/days').get_json()['days'], [])

    def test_disconnect_keeps_or_deletes_data(self):
        token = self.connect()
        self.upload(token, 'b1', [item(record(BASE))])
        self.assertFalse(self.client.delete('/api/whoop').get_json()['connected'])
        with self.backend.app.app_context():
            self.assertEqual(self.Hour.query.count(), 1)
        token = self.connect()
        self.backend.app.extensions['whoop'].maintain()
        with self.backend.app.app_context():
            self.assertEqual(self.Day.query.count(), 0)  # one sample is no day
            self.Day.query.delete()
            self.backend.db.session.add(self.Day(user_id=self.backend.DEMO_USER_ID, date='2026-10-14', version=1, nightly='{}'))
            self.backend.db.session.commit()
        self.client.delete('/api/whoop?deleteData=1')
        with self.backend.app.app_context():
            self.assertEqual((self.Hour.query.count(), self.Batch.query.count(), self.Day.query.count()), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
