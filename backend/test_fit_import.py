"""Run: python -m unittest -v test_fit_import (isolated temporary database)."""
import gzip
import io
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime

from fit_import import parse_fit_file, FitImportError


def crc(data):
    value = 0
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ (0xA001 if value & 1 else 0)
    return value


def definition(local, global_id, fields):
    return bytes([0x40 | local, 0, 0]) + struct.pack('<HB', global_id, len(fields)) + b''.join(bytes(f) for f in fields)


def fit_fixture(count=3, multisport=False, file_type=4, missing_timer=False):
    # Tiny binary files exercise the real FIT decoder, including CRC, scaling and sentinels.
    start = 1136073600  # fixed FIT epoch seconds
    body = definition(0, 0, [(0, 1, 0)]) + bytes([0, file_type])
    body += definition(1, 20, [(253, 4, 0x86), (3, 1, 2), (7, 2, 0x84), (6, 2, 0x84), (73, 4, 0x86), (0, 4, 0x85), (1, 4, 0x85)])
    for i in range(count):
        body += bytes([1]) + struct.pack('<IBHHIii', start + i * 3, 140 if i != 1 else 255,
                                         0 if i == 0 else 65535 if i == 1 else 220,
                                         1000, 0 if i == 0 else 2500, 0, 0)
    fields = [(2, 4, 0x86), (5, 1, 0), (7, 4, 0x86), (8, 4, 0x86), (9, 4, 0x86), (16, 1, 2), (20, 2, 0x84)]
    body += definition(2, 18, fields)
    body += bytes([2]) + struct.pack('<IBIIIBH', start, 2, 20500, 0xFFFFFFFF if missing_timer else 10250, 123456, 140, 0)
    if multisport:
        body += bytes([2]) + struct.pack('<IBIIIBH', start + 30, 1, 12500, 11000, 45678, 155, 200)
    header = struct.pack('<BBHI4s', 12, 0x20, 2100, len(body), b'.FIT')
    content = header + body
    return content + struct.pack('<H', crc(content))


class FitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        os.environ['DATABASE_URL'] = 'sqlite:///' + str(cls.root / 'test.db').replace('\\', '/')
        os.environ['UPLOAD_FOLDER'] = str(cls.root / 'uploads')
        import app as backend
        cls.backend = backend
        backend.initialize_database()
        backend.app.config['TESTING'] = True
        cls.client = backend.app.test_client()

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            self.backend.PlannedWorkout.query.delete()
            self.backend.AnalyticsCache.query.delete()
            self.backend.BestEffortCache.query.delete()
            self.backend.Activity.query.delete()
            self.backend.db.session.commit()
        for path in (self.root / 'uploads').iterdir():
            path.unlink()

    def parse(self, content):
        path = self.root / 'fixture.fit'
        path.write_bytes(content)
        return parse_fit_file(path)

    def test_analytics_api_settings_cache_and_refresh(self):
        uploaded = self.upload(fit_fixture()).get_json()
        response = self.client.get('/api/analytics?year=all&timezone=Europe/Berlin')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['totals']['count'], 1)
        self.assertIsNone(response.get_json()['totals']['elevation'])
        with self.backend.app.app_context():
            self.assertEqual(self.backend.AnalyticsCache.query.count(), 1)
        saved = self.client.put('/api/user', json={'ftp': 234, 'maxHr': 187})
        self.assertEqual(saved.get_json()['ftp'], 234)
        with patch.object(self.backend, 'activity_summary', side_effect=AssertionError('cache missed')):
            cached = self.client.get('/api/analytics?year=all').get_json()
        self.assertEqual(cached['settings'], {'ftp': 234, 'maxHr': 187})
        self.client.put('/api/activities/' + uploaded['id'], json={'sport': 'run'})
        self.assertEqual(self.client.get('/api/analytics?year=all').get_json()['cyclingYears'], [])
        self.client.delete('/api/activities/' + uploaded['id'])
        self.assertEqual(self.client.get('/api/analytics?year=all').get_json()['totals']['count'], 0)
        with self.backend.app.app_context():
            self.assertEqual(self.backend.AnalyticsCache.query.count(), 0)

    def test_analytics_rejects_invalid_settings_and_filters(self):
        for query in ('year=nope', 'year=9999', 'timezone=invalid', 'sport=invalid'):
            self.assertEqual(self.client.get('/api/analytics?' + query).status_code, 400)
        for data in ({'ftp': 0}, {'ftp': '250'}, {'maxHr': 999}, {'ftp': True}):
            self.assertEqual(self.client.put('/api/user', json=data).status_code, 400)
        self.assertEqual(self.client.put('/api/user', json={'ftp': None, 'maxHr': None}).status_code, 200)

    def upload(self, content, filename='activity.fit'):
        return self.client.post('/api/upload', data={'file': (io.BytesIO(content), filename)}, content_type='multipart/form-data')

    def test_exact_time_zero_missing_enhanced_fields_and_gps(self):
        summary, points = self.parse(fit_fixture())
        self.assertEqual([p['time'] for p in points], [0, 3, 6])
        self.assertTrue(points[0]['timestamp'].endswith('Z'))
        self.assertEqual(points[0]['power'], 0)
        self.assertEqual(points[0]['speed'], 0)
        self.assertNotIn('power', points[1])
        self.assertNotIn('hr', points[1])
        self.assertEqual(points[1]['speed'], 9)
        self.assertEqual(points[0]['lat'], 0)
        self.assertEqual(points[0]['lng'], 0)
        self.assertEqual(summary['duration'] * 60, 10.25)
        self.assertEqual(summary['fit_details']['elapsedSeconds'], 20.5)
        self.assertEqual(summary['power_avg'], 0)
        self.assertAlmostEqual(summary['distance'], 1.23456)

    def test_multisport_keeps_each_session(self):
        summary, _ = self.parse(fit_fixture(multisport=True))
        self.assertEqual(summary['sport'], 'multisport')
        self.assertEqual([s['sport'] for s in summary['fit_details']['sessions']], ['ride', 'run'])
        self.assertEqual(summary['fit_details']['timerSeconds'], 21.25)
        self.assertEqual(summary['fit_details']['elapsedSeconds'], 42.5)
        self.assertIsNone(summary['hr_avg'])
        self.assertAlmostEqual(summary['distance'], 1.69134)

    def test_missing_timer_stays_missing(self):
        summary, _ = self.parse(fit_fixture(missing_timer=True))
        self.assertIsNone(summary['duration'])
        self.assertIsNone(summary['fit_details']['timerSeconds'])

    def test_invalid_crc_truncated_and_non_activity_rejected(self):
        valid = fit_fixture()
        for content in (b'not a fit', valid[:-4], valid[:-1] + bytes([valid[-1] ^ 1]), fit_fixture(file_type=5)):
            with self.subTest(size=len(content)), self.assertRaises(FitImportError):
                self.parse(content)

    def test_full_recording_persists_original_and_duplicate_does_not_write(self):
        content = fit_fixture(count=6001)
        response = self.upload(content, 'recording.FIT')
        self.assertEqual(response.status_code, 201, response.json)
        activity = response.json
        self.assertEqual(len(activity['timeSeries']), 6001)
        self.assertEqual(activity['timerSeconds'], 10.25)
        self.assertEqual(activity['fitDetails']['recordCount'], 6001)
        self.assertTrue(activity['date'].endswith('Z'))
        with self.backend.app.app_context():
            self.backend.db.session.remove()
        persisted = self.client.get('/api/activities/' + activity['id']).json
        self.assertEqual(persisted, activity)
        downloaded = self.client.get(activity['originalFileUrl'])
        self.assertEqual(downloaded.data, content)
        downloaded.close()
        duplicate = self.upload(gzip.compress(content), 'copy.fit.gz')
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json['existing_id'], activity['id'])
        self.assertEqual(len(self.client.get('/api/activities').json), 1)
        self.assertEqual(len(list((self.root / 'uploads').iterdir())), 1)

    def test_compressed_original_is_preserved(self):
        content = gzip.compress(fit_fixture())
        response = self.upload(content, 'recording.fit.gz')
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json['source'], '.fit.gz')
        original = self.client.get(response.json['originalFileUrl'])
        self.assertEqual(original.data, content)
        original.close()

    def test_batch_summary_keeps_full_recording_in_database(self):
        content = fit_fixture(count=6001)
        response = self.client.post('/api/upload?summary=1', data={'file': (io.BytesIO(content), 'batch.fit')})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertNotIn('timeSeries', response.json)
        detail = self.client.get('/api/activities/' + response.json['id']).json
        self.assertEqual(len(detail['timeSeries']), 6001)
        self.assertEqual(detail['fitDetails']['recordCount'], 6001)
        self.assertEqual(detail['timerSeconds'], response.json['timerSeconds'])

    def test_bad_upload_cleanup_and_json_errors(self):
        for content, filename, status in [(b'bad', 'bad.fit', 422), (b'bad', 'bad.fit.gz', 422), (b'bad', 'bad.txt', 400)]:
            response = self.upload(content, filename)
            self.assertEqual(response.status_code, status)
            self.assertIn('error', response.json)
        self.assertEqual(list((self.root / 'uploads').iterdir()), [])
        self.assertEqual(self.client.get('/api/activities').json, [])

    def test_decompressed_size_limit(self):
        with patch('fit_import.MAX_FIT_BYTES', 100):
            response = self.upload(gzip.compress(b'x' * 101), 'large.fit.gz')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(list((self.root / 'uploads').iterdir()), [])

    def test_http_size_limit(self):
        with patch.dict(self.backend.app.config, MAX_CONTENT_LENGTH=100):
            response = self.upload(b'x' * 101)
        self.assertEqual(response.status_code, 413)
        self.assertIn('error', response.json)

    def test_existing_schema_migration_is_idempotent(self):
        # The app's existing database is never used by these tests.
        with self.backend.app.app_context():
            self.backend.db.session.remove()
            self.backend.db.engine.dispose()
        connection = sqlite3.connect(self.root / 'test.db')
        connection.execute('ALTER TABLE activity DROP COLUMN fit_details')
        connection.commit()
        connection.close()
        self.backend.initialize_database()
        self.backend.initialize_database()
        self.assertEqual(self.upload(fit_fixture()).status_code, 201)

    def test_planned_workout_save_reload_edit_export_delete_keeps_activities_separate(self):
        from test_workout_export import example
        from garmin_fit_sdk import Decoder, Stream
        workout = example()
        self.client.post('/api/activities/manual', json={'title': 'Completed ride', 'sport': 'ride', 'date': '2026-09-23', 'duration': 60})
        before = self.client.get('/api/activities').json
        created = self.client.post('/api/workouts', json=workout)
        self.assertEqual(created.status_code, 201)
        identity = created.json['id']
        self.backend.initialize_database()  # Existing activities and plans survive startup.
        self.assertEqual(self.backend.app.test_client().get('/api/workouts').json, [created.json])
        workout.update(name='Changed workout', date='2026-09-25', sport='ride')
        updated = self.client.put(f'/api/workouts/{identity}', json=workout)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json['id'], identity)
        download = self.client.post('/api/workouts/export', json=updated.json)
        self.assertEqual(download.status_code, 200)
        self.assertIn('2026-09-25_Changed_workout.fit', download.headers['Content-Disposition'])
        self.assertEqual(download.mimetype, 'application/vnd.ant.fit')
        self.assertTrue(Decoder(Stream.from_byte_array(bytearray(download.data))).check_integrity())
        decoded, errors = Decoder(Stream.from_byte_array(bytearray(download.data))).read()
        self.assertEqual(errors, [])
        self.assertEqual(decoded['workout_mesgs'][0]['wkt_name'], '25.09.2026 · Changed workout')
        self.assertEqual(self.client.get('/api/workouts').json, [updated.json])
        self.assertEqual(self.client.get('/api/activities').json, before)
        self.assertEqual(self.client.delete(f'/api/workouts/{identity}').status_code, 204)
        self.assertEqual(self.client.get('/api/workouts').json, [])
        self.assertEqual(self.client.get('/api/activities').json, before)
        self.assertEqual(self.client.put(f'/api/workouts/{identity}', json=workout).status_code, 404)

    def test_invalid_workout_requests_do_not_save_or_export(self):
        from test_workout_export import example
        for payload in [None, [], {}, {**example(), 'steps': []}]:
            for path in ['/api/workouts', '/api/workouts/export']:
                response = self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)
        self.assertEqual(self.client.get('/api/workouts').json, [])
        created = self.client.post('/api/workouts', json=example()).json
        self.assertEqual(self.client.put('/api/workouts/' + created['id'], json={'name': ''}).status_code, 400)
        self.assertEqual(self.client.get('/api/workouts').json, [created])
        with patch.object(self.backend, 'export_workout', side_effect=RuntimeError('CRC failed')):
            self.assertEqual(self.client.post('/api/workouts/export', json=example()).status_code, 500)

    def add_effort_activity(self, identity, date, power, sport='ride'):
        self.client.get('/api/health')
        with self.backend.app.app_context():
            activity = self.backend.Activity(id=identity, user_id=self.backend.DEMO_USER_ID, title=identity,
                sport=sport, date=datetime.fromisoformat(date),
                time_series=json.dumps([{'time': t, 'power': power, 'distance': t * 10} for t in range(0, 61, 10)]))
            self.backend.db.session.add(activity)
            self.backend.db.session.commit()

    def test_best_efforts_filter_local_year_sport_and_all_time(self):
        self.add_effort_activity('older', '2025-06-01', 400)
        self.add_effort_activity('boundary', '2025-12-31T23:30:00', 300)
        self.add_effort_activity('newer', '2026-06-01', 200)
        self.add_effort_activity('run', '2026-06-01', 900, 'run')
        result = self.client.get('/api/best-efforts?sport=ride&year=2026&timezone=Europe/Berlin').json
        self.assertEqual(result['efforts'][0]['activity']['id'], 'boundary')
        self.assertEqual(result['efforts'][0]['value'], 300)
        self.assertIsNone(result['efforts'][-1]['value'])
        self.assertEqual(result['years'], [2026, 2025])
        result = self.client.get('/api/best-efforts?sport=ride&year=all').json
        self.assertEqual(result['efforts'][0]['activity']['id'], 'older')
        result = self.client.get('/api/best-efforts?sport=run&year=2026').json
        self.assertEqual(result['efforts'][0]['value'], 40)
        self.assertEqual(result['efforts'][0]['activity']['id'], 'run')

    def test_best_effort_cache_updates_after_upload_sport_change_and_deletion(self):
        self.add_effort_activity('first', '2026-06-01', 200)
        self.client.get('/api/best-efforts?year=2026')
        with patch.object(self.backend, 'activity_efforts', side_effect=AssertionError('Must use cache')):
            self.assertEqual(self.client.get('/api/best-efforts?year=all').json['efforts'][0]['value'], 200)
        self.add_effort_activity('second', '2026-06-02', 300)
        self.assertEqual(self.client.get('/api/best-efforts?year=2026').json['efforts'][0]['value'], 300)
        self.client.put('/api/activities/second', json={'sport': 'run'})
        self.assertEqual(self.client.get('/api/best-efforts?year=2026').json['efforts'][0]['value'], 200)
        self.assertEqual(self.client.get('/api/best-efforts?year=2026&sport=run').json['efforts'][0]['value'], 40)
        self.client.delete('/api/activities/first')
        self.assertIsNone(self.client.get('/api/best-efforts?year=2026').json['efforts'][0]['value'])
        with self.backend.app.app_context():
            self.assertIsNone(self.backend.db.session.get(self.backend.BestEffortCache, 'first'))

    def test_best_effort_missing_data_and_invalid_filters(self):
        self.client.post('/api/activities/manual', json={'title': 'Only summary', 'sport': 'ride', 'date': '2026-06-01', 'duration': 120, 'power': 999})
        result = self.client.get('/api/best-efforts?year=2026').json
        self.assertTrue(all(effort['value'] is None for effort in result['efforts']))
        for query in ['sport=swim', 'year=bad', 'year=99999', 'timezone=Not/AZone']:
            self.assertEqual(self.client.get('/api/best-efforts?' + query).status_code, 400)


if __name__ == '__main__':
    unittest.main()
