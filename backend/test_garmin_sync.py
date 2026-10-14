"""Garmin Connect sync tests: a fake client on a temporary database, no network."""
import importlib.util
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet

import garmin_sync
from garmin_sync import fit_payload, today_local
from garmin_workouts import garmin_workout
from test_fit_import import fit_fixture
from workout_export import validate_workout

FIXTURE_START = '2025-12-31 00:00:00'  # the start time inside fit_fixture()


class GarminConnectAuthenticationError(Exception):
    pass


class GarminConnectNotFoundError(Exception):
    pass


class Rejected(Exception):
    response = SimpleNamespace(status_code=400)


def zipped(content, name='12345_ACTIVITY.fit'):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr(name, content)
    return buffer.getvalue()


class FakeGarmin:
    ActivityDownloadFormat = SimpleNamespace(ORIGINAL='original')

    def __init__(self, world, email=None, password=None):
        self.world, self.email, self.password = world, email, password
        self.client = SimpleNamespace(dumps=lambda: json.dumps({'di_token': world.token, 'di_refresh_token': 'refresh'}))

    def login(self, tokenstore=None):
        if tokenstore is None:
            self.world.logins.append((self.email, self.password))
            if self.password != 'right':
                raise GarminConnectAuthenticationError('401')
            return ('needs_mfa', None) if self.world.mfa else (None, None)
        if self.world.expired:
            raise GarminConnectAuthenticationError('Username and password are required')
        self.world.loaded.append(json.loads(tokenstore)['di_token'])
        self.world.token = 'refreshed'
        return None, None

    def resume_login(self, _state, code):
        if code != '123456':
            raise GarminConnectAuthenticationError('MFA failed')
        return None, None

    def get_activities_by_date(self, start, end, sortorder=None):
        self.world.ranges.append((start, end, sortorder))
        return self.world.activities

    def download_activity(self, garmin_id, dl_fmt):
        assert dl_fmt == 'original'
        self.world.downloads.append(garmin_id)
        return self.world.files[garmin_id]

    # A tiny Garmin Connect calendar: workout library plus scheduled entries.
    def upload_workout(self, body):
        if body['workoutName'].endswith('Rejected'):
            raise Rejected('400')
        self.world.next_id += 1
        self.world.workouts[str(self.world.next_id)] = body
        return {'workoutId': self.world.next_id, 'workoutName': body['workoutName']}

    def schedule_workout(self, workout_id, day):
        self.world.next_id += 1
        self.world.calendar[str(self.world.next_id)] = (str(workout_id), day)
        return {'workoutScheduleId': self.world.next_id, 'calendarDate': day}

    def unschedule_workout(self, schedule_id):
        if self.world.calendar.pop(str(schedule_id), None) is None:
            raise GarminConnectNotFoundError('404')

    def delete_workout(self, workout_id):
        self.world.deleted.append(str(workout_id))
        if self.world.workouts.pop(str(workout_id), None) is None:
            raise GarminConnectNotFoundError('404')


class GarminAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.database = root / 'garmin.db'
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + cls.database.as_posix(),
                                                 'UPLOAD_FOLDER': str(root / 'uploads'),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('garmin_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')
        cls.Account, cls.Import, cls.Workout = cls.backend.app.extensions['garmin_models']
        cls.state = cls.backend.app.extensions['garmin']

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            for model in (self.Workout, self.Import, self.Account, self.backend.Activity, self.backend.PlannedWorkout):
                model.query.delete()
            self.backend.db.session.commit()
        self.world = SimpleNamespace(mfa=False, expired=False, token='first', logins=[], loaded=[], ranges=[], downloads=[],
                                     activities=[{'activityId': 101, 'startTimeGMT': '2026-10-01 06:00:00'}],
                                     files={'101': zipped(fit_fixture())}, next_id=1000, workouts={}, calendar={}, deleted=[])
        self.state.make_client = lambda email=None, password=None: FakeGarmin(self.world, email, password)
        self.state.pending = None
        self.state.wanted.clear()
        self.state.disconnect_after_cleanup = False
        self.state.push_enabled = False
        self.state.start = self.state.loop  # jobs run inside the request, so tests see their result
        self.pause = patch.object(garmin_sync, 'PAUSE_SECONDS', 0)
        self.pause.start()

    def tearDown(self):
        self.pause.stop()

    def post(self, path, payload=None):
        return self.client.post(f'/api/garmin{path}', json=payload or {})

    def activities(self):
        return self.client.get('/api/activities').get_json()

    def test_login_stores_only_encrypted_tokens_and_imports_the_original_fit(self):
        response = self.post('/login', {'email': 'me@example.com', 'password': 'right'})
        self.assertEqual(response.status_code, 200)
        status = response.get_json()
        self.assertTrue(status['connected'])
        self.assertEqual((status['email'], status['imported'], status['lastResult']['imported']), ('me@example.com', 1, 1))
        self.assertIsNotNone(status['syncedThrough'])
        self.assertEqual(self.world.downloads, ['101'])
        self.assertEqual(self.world.ranges[0][2], 'asc')
        [activity] = self.activities()
        self.assertEqual((activity['sport'], activity['source']), ('ride', '.fit'))
        with sqlite3.connect(self.database) as connection:
            stored = ' '.join(str(value) for row in connection.execute('SELECT * FROM garmin_account') for value in row)
        for secret in ('right', 'refresh', 'first', 'refreshed'):
            self.assertNotIn(secret, stored)

        # The next sync reuses the saved tokens, keeps the refreshed ones and skips known activities.
        self.assertEqual(self.post('/sync').status_code, 202)
        self.assertEqual(self.world.loaded[0], 'first')
        self.assertEqual(set(self.world.loaded[1:]), {'refreshed'})
        self.assertEqual(self.world.downloads, ['101'])
        self.assertEqual(len(self.activities()), 1)

    def test_mfa_login_waits_for_the_code_and_allows_a_retry(self):
        self.world.mfa = True
        response = self.post('/login', {'email': 'me@example.com', 'password': 'right'})
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.get_json()['mfaRequired'])
        self.assertFalse(response.get_json()['connected'])
        wrong = self.post('/mfa', {'code': '000000'})
        self.assertEqual(wrong.status_code, 401)
        self.assertTrue(self.client.get('/api/garmin').get_json()['mfaPending'])
        right = self.post('/mfa', {'code': '123456'})
        self.assertEqual(right.status_code, 200)
        self.assertTrue(right.get_json()['connected'])
        self.assertFalse(right.get_json()['mfaPending'])
        self.assertEqual(self.world.downloads, ['101'])

    def test_rejected_password_and_invalid_input(self):
        self.assertEqual(self.post('/login', {'email': 'me@example.com', 'password': 'wrong'}).status_code, 401)
        self.assertEqual(self.post('/login', {'email': 'not-an-email', 'password': 'right'}).status_code, 400)
        self.assertEqual(self.post('/mfa', {'code': '123456'}).status_code, 409)
        self.assertEqual(self.post('/sync').status_code, 409)
        self.assertFalse(self.client.get('/api/garmin').get_json()['connected'])

    def test_same_start_time_from_another_export_is_not_downloaded(self):
        self.assertEqual(self.client.post('/api/upload?summary=1', data={'file': (io.BytesIO(fit_fixture()), 'tp.fit')}).status_code, 201)
        self.world.activities = [{'activityId': 101, 'startTimeGMT': FIXTURE_START},
                                 {'activityId': 102, 'startTimeGMT': '2026-10-02 06:00:00'},
                                 {'activityId': 103, 'startTimeGMT': '2026-10-03 06:00:00'}]
        self.world.files.update({'102': zipped(fit_fixture()), '103': zipped(b'no fit here', 'notes.txt')})
        status = self.post('/login', {'email': 'me@example.com', 'password': 'right'}).get_json()
        # 101 matches by start time; 102 is the same file as the upload; 103 carries no FIT file.
        self.assertEqual(self.world.downloads, ['102', '103'])
        self.assertEqual(status['lastResult'], {'imported': 0, 'duplicate': 2, 'skipped': 1, 'failed': 0})
        self.assertEqual(len(self.activities()), 1)

    def test_expired_session_asks_for_a_new_login_and_disconnect_keeps_activities(self):
        self.post('/login', {'email': 'me@example.com', 'password': 'right'})
        self.world.expired = True
        self.post('/sync')
        status = self.client.get('/api/garmin').get_json()
        self.assertTrue(status['needsLogin'])
        self.assertIn('abgelaufen', status['lastError'])
        status = self.client.delete('/api/garmin').get_json()
        self.assertFalse(status['connected'])
        self.assertEqual(len(self.activities()), 1)

    def test_status_reports_a_missing_library(self):
        self.state.make_client = garmin_sync.default_client
        with patch.object(garmin_sync, 'library', return_value=None):
            self.assertFalse(self.client.get('/api/garmin').get_json()['available'])
            response = self.post('/login', {'email': 'me@example.com', 'password': 'right'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Python 3.12', response.get_json()['error'])

    def test_garmin_routes_are_limited_to_known_origins(self):
        response = self.client.get('/api/garmin', headers={'Origin': 'http://evil.example'})
        self.assertEqual(response.status_code, 403)


    # ─── planned workouts to the Garmin calendar ───

    def day(self, offset):
        return (today_local() + timedelta(days=offset)).isoformat()

    def plan(self, offset, name='Schwelle', watts=(280, 300)):
        return {'name': name, 'sport': 'ride', 'date': self.day(offset), 'steps': [
            {'kind': 'step', 'name': 'Einfahren', 'intensity': 'warmup', 'duration': {'type': 'time', 'value': 600}, 'target': {'type': 'none'}},
            {'kind': 'repeat', 'count': 3, 'steps': [
                {'kind': 'step', 'name': '', 'intensity': 'interval', 'duration': {'type': 'time', 'value': 480},
                 'target': {'type': 'power', 'low': watts[0], 'high': watts[1]}},
                {'kind': 'step', 'name': '', 'intensity': 'recovery', 'duration': {'type': 'time', 'value': 240}, 'target': {'type': 'none'}}]}]}

    def save(self, workout):
        response = self.client.post('/api/workouts', json=workout)
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def connect(self):
        self.assertEqual(self.post('/login', {'email': 'me@example.com', 'password': 'right'}).status_code, 200)

    def scheduled(self):
        return sorted((self.world.workouts[wid]['workoutName'], day) for wid, day in self.world.calendar.values())

    def test_plans_from_today_on_are_sent_and_follow_edits_moves_and_deletes(self):
        past = self.save(self.plan(-1, 'Gestern'))
        first = self.save(self.plan(0, 'Heute'))
        self.connect()
        today = today_local()
        self.assertEqual(self.scheduled(), [(f'{today:%d.%m.%Y} · Heute', self.day(0))])
        status = self.client.get('/api/garmin').get_json()
        self.assertEqual(status['workouts']['scheduled'], 1)
        self.assertEqual(status['workouts']['lastPushResult']['created'], 1)

        # Saving a new plan pushes it right away, without a manual sync.
        later = self.save(self.plan(3, 'Später'))
        self.assertIn(('%s · Später' % (today + timedelta(days=3)).strftime('%d.%m.%Y'), self.day(3)), self.scheduled())

        # Moving replaces the calendar entry instead of leaving a duplicate behind.
        self.assertEqual(self.client.put(f"/api/workouts/{later['id']}", json={**self.plan(5, 'Später')}).status_code, 200)
        self.assertEqual([day for _, day in self.scheduled()], [self.day(0), self.day(5)])
        self.assertEqual(len(self.world.workouts), 2)

        # Changing targets updates the workout; an unchanged save sends nothing.
        self.client.put(f"/api/workouts/{first['id']}", json=self.plan(0, 'Heute', watts=(300, 320)))
        [body] = [b for b in self.world.workouts.values() if b['workoutName'].endswith('Heute')]
        self.assertEqual(body['workoutSegments'][0]['workoutSteps'][1]['workoutSteps'][0]['targetValueOne'], 300)
        uploads = self.world.next_id
        self.client.put(f"/api/workouts/{first['id']}", json=self.plan(0, 'Heute', watts=(300, 320)))
        self.assertEqual(self.world.next_id, uploads)

        # Deleting a plan deletes exactly its workout; the past plan was never sent.
        self.assertEqual(self.client.delete(f"/api/workouts/{later['id']}").status_code, 204)
        self.assertEqual([day for _, day in self.scheduled()], [self.day(0)])
        self.assertNotIn(past['id'], {row['planned_id'] for row in self.links()})

    def links(self):
        with self.backend.app.app_context():
            return [{'planned_id': link.planned_id, 'day': link.day} for link in self.Workout.query.all()]

    def test_a_plan_that_has_passed_stays_but_one_moved_into_the_past_is_removed(self):
        plan = self.save(self.plan(1, 'Morgen'))
        self.connect()
        with self.backend.app.app_context():
            link = self.Workout.query.one()
            link.day = self.day(-2)  # as if the day had passed
            self.backend.db.session.commit()
        self.post('/sync')
        self.assertEqual(len(self.world.calendar), 1)
        self.client.put(f"/api/workouts/{plan['id']}", json=self.plan(-1, 'Morgen'))
        self.assertEqual(len(self.world.calendar), 1)  # the link says "past", so nothing is touched
        with self.backend.app.app_context():
            self.Workout.query.one().day = self.day(1)
            self.backend.db.session.commit()
        self.post('/sync')
        self.assertEqual(self.world.calendar, {})

    def test_switching_off_can_remove_only_our_workouts(self):
        self.world.workouts['1'] = {'workoutName': 'Schwellentraining aus Garmin Connect'}
        self.world.calendar['2'] = ('1', self.day(1))
        self.save(self.plan(1, 'Eins'))
        self.save(self.plan(2, 'Zwei'))
        self.connect()
        self.assertEqual(len(self.world.calendar), 3)
        status = self.client.put('/api/garmin/settings', json={'pushWorkouts': False, 'removeWorkouts': True}).get_json()
        self.assertFalse(status['pushWorkouts'])
        self.assertEqual(self.world.calendar, {'2': ('1', self.day(1))})
        self.assertEqual(list(self.world.workouts), ['1'])
        self.save(self.plan(3, 'Drei'))
        self.assertEqual(len(self.world.calendar), 1)  # switched off: new plans stay local
        self.client.put('/api/garmin/settings', json={'pushWorkouts': True})
        self.assertEqual(len(self.world.calendar), 4)

    def test_disconnect_with_cleanup_removes_workouts_first(self):
        self.save(self.plan(1))
        self.connect()
        response = self.client.delete('/api/garmin?deleteWorkouts=1')
        self.assertEqual(response.status_code, 202)
        self.assertEqual((self.world.calendar, self.world.workouts), ({}, {}))
        status = self.client.get('/api/garmin').get_json()
        self.assertFalse(status['connected'])
        self.assertEqual(self.links(), [])
        self.save(self.plan(2))
        self.assertEqual(self.world.calendar, {})

    def test_disconnect_without_cleanup_leaves_garmin_untouched(self):
        self.save(self.plan(1))
        self.connect()
        self.assertEqual(self.client.delete('/api/garmin').status_code, 200)
        self.assertEqual(len(self.world.calendar), 1)
        self.assertEqual(self.links(), [])

    def test_already_deleted_in_garmin_and_rejected_workouts_do_not_block_the_rest(self):
        plan = self.save(self.plan(1, 'Eins'))
        self.save(self.plan(2, 'Rejected'))
        self.connect()
        status = self.client.get('/api/garmin').get_json()['workouts']
        self.assertEqual(status['lastPushResult'], {'created': 1, 'updated': 0, 'removed': 0, 'failed': 1})
        self.assertIn('Rejected', status['lastPushError'])
        self.world.calendar.clear()
        self.world.workouts.clear()  # deleted by hand in Garmin Connect
        self.assertEqual(self.client.delete(f"/api/workouts/{plan['id']}").status_code, 204)
        self.assertEqual(self.client.get('/api/garmin').get_json()['workouts']['lastPushResult']['removed'], 1)

    def test_expired_login_stops_the_push_and_asks_for_a_new_login(self):
        self.connect()
        self.world.expired = True
        self.save(self.plan(1))
        status = self.client.get('/api/garmin').get_json()
        self.assertTrue(status['needsLogin'])
        self.assertIn('abgelaufen', status['workouts']['lastPushError'])
        self.assertEqual(self.world.calendar, {})


class WorkoutFormatTests(unittest.TestCase):
    def convert(self, sport, steps, **extra):
        return garmin_workout(validate_workout({'name': 'Test', 'sport': sport, 'date': '2026-10-20', 'steps': steps, **extra}))

    def step(self, intensity='active', duration=('time', 300), target=None, name=''):
        kind, value = duration
        return {'kind': 'step', 'name': name, 'intensity': intensity,
                'duration': {'type': kind, 'value': value} if kind != 'open' else {'type': 'open'},
                'target': target or {'type': 'none'}}

    def test_ride_with_repeats_and_power(self):
        body = self.convert('ride', [
            self.step('warmup', ('time', 600), name='Einfahren'),
            {'kind': 'repeat', 'count': 4, 'steps': [self.step('interval', ('time', 240), {'type': 'power', 'low': 300, 'high': 320}),
                                                     self.step('recovery', ('time', 180))]},
            self.step('cooldown', ('open', 0), {'type': 'cadence', 'low': 85, 'high': 95})], notes='Viel trinken')
        self.assertEqual(body['workoutName'], '20.10.2026 · Test')
        self.assertEqual(body['description'], 'Viel trinken')
        self.assertEqual(body['sportType'], {'sportTypeId': 2, 'sportTypeKey': 'cycling'})
        self.assertEqual(body['estimatedDurationInSecs'], 600 + 4 * 420)
        warmup, group, cooldown = body['workoutSegments'][0]['workoutSteps']
        self.assertEqual((warmup['stepOrder'], warmup['stepType']['stepTypeKey'], warmup['endConditionValue'], warmup['description']),
                         (1, 'warmup', 600.0, 'Einfahren'))
        self.assertEqual(warmup['targetType']['workoutTargetTypeKey'], 'no.target')
        self.assertEqual((group['type'], group['stepOrder'], group['numberOfIterations'], group['childStepId']), ('RepeatGroupDTO', 2, 4, 1))
        work, rest = group['workoutSteps']
        self.assertEqual((work['stepOrder'], work['childStepId'], work['stepType']['stepTypeKey']), (3, 1, 'interval'))
        self.assertEqual((work['targetType']['workoutTargetTypeKey'], work['targetValueOne'], work['targetValueTwo']), ('power.zone', 300, 320))
        self.assertEqual((rest['stepOrder'], rest['stepType']['stepTypeKey']), (4, 'recovery'))
        self.assertEqual((cooldown['stepOrder'], cooldown['endCondition']['conditionTypeKey']), (5, 'lap.button'))
        self.assertNotIn('endConditionValue', cooldown)
        self.assertEqual(cooldown['targetType']['workoutTargetTypeKey'], 'cadence')

    def test_run_pace_and_speed_become_metres_per_second(self):
        body = self.convert('run', [self.step('active', ('distance', 1000), {'type': 'pace', 'low': 240, 'high': 250}),
                                    self.step('active', ('time', 60), {'type': 'speed', 'low': 18, 'high': 36}),
                                    self.step('active', ('time', 60), {'type': 'heart_rate', 'low': 140, 'high': 150})])
        pace, speed, heart = body['workoutSegments'][0]['workoutSteps']
        self.assertEqual(body['sportType']['sportTypeKey'], 'running')
        self.assertEqual((pace['endCondition']['conditionTypeKey'], pace['endConditionValue']), ('distance', 1000.0))
        self.assertEqual(pace['targetType']['workoutTargetTypeKey'], 'pace.zone')
        self.assertEqual((pace['targetValueOne'], pace['targetValueTwo']), (4.0, 4.1667))  # slower pace first
        self.assertEqual((speed['targetValueOne'], speed['targetValueTwo']), (5.0, 10.0))
        self.assertEqual((heart['targetType']['workoutTargetTypeKey'], heart['targetValueOne']), ('heart.rate.zone', 140))

    def test_swim_uses_a_25_m_pool_and_rest_steps(self):
        body = self.convert('swim', [self.step('active', ('distance', 100)), self.step('recovery', ('time', 20))])
        self.assertEqual((body['poolLength'], body['poolLengthUnit']['unitKey']), (25.0, 'meter'))
        _, pause = body['workoutSegments'][0]['workoutSteps']
        self.assertEqual(pause['stepType']['stepTypeKey'], 'rest')

class PayloadTests(unittest.TestCase):
    def test_fit_comes_out_of_the_zip_or_as_is(self):
        content = fit_fixture()
        self.assertEqual(fit_payload(zipped(content)), content)
        self.assertEqual(fit_payload(content), content)
        self.assertIsNone(fit_payload(zipped(b'x', 'track.gpx')))
        self.assertIsNone(fit_payload(b'not a zip'))


if __name__ == '__main__':
    unittest.main()
