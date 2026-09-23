"""Coach integration tests use an independently imported app and temporary SQLite only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import Mock, patch

from cryptography.fernet import Fernet
from coach_domain import DEFAULT_PROFILE, DAYS, iso_week
from coach_templates import PARAM_NAMES


class CoachAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + (root / 'coach.db').as_posix(),
                                                 'UPLOAD_FOLDER': str(root / 'uploads'),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('coach_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')
        cls.State, cls.Settings, cls.Proposal = cls.backend.app.extensions['coach_models']

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            for model in (self.Proposal, self.State, self.Settings, self.backend.PlannedWorkout,
                          self.backend.AnalyticsCache, self.backend.BestEffortCache, self.backend.Activity):
                model.query.delete()
            user = self.backend.db.session.get(self.backend.User, self.backend.DEMO_USER_ID)
            user.ftp, user.max_hr = 250, 190
            self.backend.db.session.commit()
        self.start = date.today() + timedelta(days=7 - date.today().weekday())
        self.week = iso_week(self.start)
        self.profile = copy.deepcopy(DEFAULT_PROFILE)
        self.profile['availability'] = {'preferredWeeklyHours': 5, 'absoluteMaxWeeklyHours': 10,
                                         'defaultAvailability': dict.fromkeys(DAYS, 120)}
        fields = {key: self.profile[key] for key in ('goal', 'availability', 'preferences', 'limitations', 'currentState')}
        self.assertEqual(self.client.put('/api/athlete-profile', json=fields).status_code, 200)
        self.assertEqual(self.client.put('/api/ai-provider', json={'provider': 'openai', 'model': 'gpt-4.1-mini',
                                                                 'apiKey': 'sk-test-never-a-real-key-1234'}).status_code, 200)

    def session(self, identity='monday', day='mon', duration=60):
        return {'id': identity, 'day': day, 'template': 'bike_z2',
                'params': {**dict.fromkeys(PARAM_NAMES), 'durationMin': duration}}

    def propose(self, body, decision, expected=201):
        provider = Mock()
        provider.generate.return_value = copy.deepcopy(decision)
        with patch('coach_api.get_provider', return_value=provider):
            response = self.client.post('/api/coach/proposals?timezone=Europe/Berlin', json=body)
        self.assertEqual(response.status_code, expected, response.get_json())
        return response.get_json(), provider

    def confirm(self, proposal, expected=200):
        response = self.client.post('/api/coach/proposals/' + proposal['id'] + '/confirm', json={'confirm': True})
        self.assertEqual(response.status_code, expected, response.get_json())
        return response.get_json()

    def macro(self):
        proposal, _ = self.propose({'kind': 'macro', 'startDate': self.start.isoformat(), 'weeks': 2},
                                    {'weeks': [{'week': 1, 'phase': 'base', 'targetHours': 5, 'focus': 'Grundlage'},
                                               {'week': 2, 'phase': 'recovery', 'targetHours': 4, 'focus': 'Erholung'}]})
        self.confirm(proposal)
        return proposal

    def week_plan(self):
        self.macro()
        proposal, _ = self.propose({'kind': 'week', 'week': self.week},
                                    {'week': self.week, 'targetHours': 1, 'focus': 'Locker', 'sessions': [self.session()]})
        return self.confirm(proposal)['weeks'][self.week]

    def test_encrypted_key_is_never_returned_and_fail_closed(self):
        status = self.client.get('/api/ai-provider')
        self.assertEqual(status.headers['Cache-Control'], 'no-store')
        self.assertEqual(status.json['keyLast4'], '1234')
        self.assertNotIn('sk-test', status.get_data(as_text=True))
        with self.backend.app.app_context():
            value = self.backend.db.session.get(self.Settings, self.backend.DEMO_USER_ID)
            self.assertNotIn('sk-test', value.encrypted_key)
        with patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': ''}):
            response = self.client.put('/api/ai-provider', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'apiKey': 'sk-new-key'})
            self.assertEqual(response.status_code, 502)
        self.assertEqual(self.client.get('/api/ai-provider').json['keyLast4'], '1234')
        self.client.delete('/api/ai-provider')
        self.assertFalse(self.client.get('/api/ai-provider').json['configured'])

    def test_untrusted_origins_and_non_json_writes_denied(self):
        for path in ('/api/ai-provider', '/api/athlete-profile', '/api/coach/plan'):
            self.assertEqual(self.client.get(path, headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/api/coach/proposals', data='{}').status_code, 415)
        self.assertEqual(self.client.get('/api/ai-provider', headers={'Host': 'evil.example'}).status_code, 403)

    def test_snapshot_has_no_streams_and_reuses_caches(self):
        self.client.post('/api/activities/manual', json={'date': date.today().isoformat(), 'sport': 'ride', 'duration': 60, 'distance': 30})
        response = self.client.get('/api/athlete-snapshot')
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['observed']['currentTraining']['last7Days']['trainingHours'], 1)
        self.assertIsNone(response.json['observed']['currentTraining']['last7Days']['cyclingTss'])
        for forbidden in ('timeSeries', 'time_series', 'histogram', 'fitDetails', 'encrypted_key', 'email'):
            self.assertNotIn(forbidden, response.get_data(as_text=True))
        with patch.object(self.backend, 'activity_summary', side_effect=AssertionError('warm cache should be reused')):
            self.assertEqual(self.client.get('/api/athlete-snapshot').status_code, 200)

    def test_macro_is_staged_explicit_confirm_and_idempotent(self):
        decision = {'weeks': [{'week': 1, 'phase': 'base', 'targetHours': 5, 'focus': 'Grundlage'}]}
        proposal, provider = self.propose({'kind': 'macro', 'startDate': self.start.isoformat(), 'weeks': 1}, decision)
        self.assertIsNone(self.client.get('/api/coach/plan').json['macroPlan'])
        for bad in ({}, {'confirm': 1}, {'confirm': 'true'}, {'confirm': True, 'after': {}}):
            self.assertEqual(self.client.post('/api/coach/proposals/' + proposal['id'] + '/confirm', json=bad).status_code, 400)
        result = self.confirm(proposal)
        self.assertEqual(self.confirm(proposal)['revision'], result['revision'])
        context = provider.generate.call_args.args[3]
        self.assertIn('snapshot', context)
        self.assertNotIn('timeSeries', json.dumps(context))

    def test_week_workouts_enter_existing_calendar_only_on_confirm(self):
        self.macro()
        proposal, _ = self.propose({'kind': 'week', 'week': self.week}, {'week': self.week, 'targetHours': 1, 'focus': 'Basis', 'sessions': [self.session()]})
        self.assertEqual(self.client.get('/api/workouts').json, [])
        week = self.confirm(proposal)['weeks'][self.week]
        workouts = self.client.get('/api/workouts').json
        self.assertEqual(len(workouts), 1)
        self.assertEqual(workouts[0]['id'], week['sessions'][0]['id'])
        self.assertEqual(workouts[0]['date'], self.start.isoformat())
        self.assertEqual(self.client.post('/api/workouts/export', json=workouts[0]).status_code, 200)
        self.confirm(proposal)
        self.assertEqual(len(self.client.get('/api/workouts').json), 1)

    def test_patch_has_no_snapshot_and_preserves_untouched_id(self):
        week = self.week_plan()
        identity = week['sessions'][0]['id']
        replacement = self.session(identity, duration=90)
        proposal, provider = self.propose({'kind': 'patch', 'week': self.week, 'instruction': 'Montag länger'},
            {'week': self.week, 'targetHours': 1.5, 'focus': 'Basis', 'operations': [{'op': 'replace', 'sessionId': identity, 'session': replacement}]})
        self.assertNotIn('snapshot', provider.generate.call_args.args[3])
        before = self.client.get('/api/workouts').json[0]
        self.assertEqual(before['id'], identity)
        result = self.confirm(proposal)['weeks'][self.week]
        self.assertEqual(result['calculatedHours'], 1.5)
        self.assertEqual(result['sessions'][0]['id'], identity)

    def test_locked_session_rejects_patch_and_legacy_edit_delete(self):
        identity = self.week_plan()['sessions'][0]['id']
        self.assertEqual(self.client.put(f'/api/workouts/{identity}/lock', json={'locked': True}).status_code, 200)
        workout = self.client.get('/api/workouts').json[0]
        self.assertEqual(self.client.delete('/api/workouts/' + identity).status_code, 409)
        self.assertEqual(self.client.put('/api/workouts/' + identity, json=workout).status_code, 409)
        self.propose({'kind': 'patch', 'week': self.week}, {'week': self.week, 'targetHours': 0, 'focus': 'Rest',
                     'operations': [{'op': 'remove', 'sessionId': identity, 'session': None}]}, expected=400)
        proposal, _ = self.propose({'kind': 'patch', 'week': self.week}, {'week': self.week, 'targetHours': 1, 'focus': 'Rest', 'operations': []})
        self.confirm(proposal)
        self.assertTrue(self.client.get('/api/workouts').json[0]['locked'])

    def test_context_change_invalidates_proposal(self):
        self.macro()
        proposal, _ = self.propose({'kind': 'week', 'week': self.week}, {'week': self.week, 'targetHours': 1, 'focus': 'Basis', 'sessions': [self.session()]})
        self.client.put('/api/coach/weekly-overrides/' + self.week, json={'overrides': {'mon': {'available': False}}, 'note': 'Arbeit'})
        self.confirm(proposal, 409)
        self.assertEqual(self.client.get('/api/workouts').json, [])

    def test_lock_change_invalidates_pending_patch(self):
        identity = self.week_plan()['sessions'][0]['id']
        proposal, _ = self.propose({'kind': 'patch', 'week': self.week}, {'week': self.week, 'targetHours': 0, 'focus': 'Rest',
                         'operations': [{'op': 'remove', 'sessionId': identity, 'session': None}]})
        self.client.put(f'/api/workouts/{identity}/lock', json={'locked': True})
        self.confirm(proposal, 409)
        self.assertEqual(len(self.client.get('/api/workouts').json), 1)

    def test_daily_time_weekly_max_and_existing_calendar_constraints(self):
        self.macro()
        self.client.put('/api/coach/daily-overrides/' + self.start.isoformat(), json={'maxMinutes': 45, 'action': 'reduce'})
        decision = {'week': self.week, 'targetHours': 1, 'focus': 'Basis', 'sessions': [self.session()]}
        self.propose({'kind': 'week', 'week': self.week}, decision, expected=400)
        self.assertEqual(self.client.get('/api/workouts').json, [])
        self.client.put('/api/coach/daily-overrides/' + self.start.isoformat(), json={})
        from coach_templates import render_session
        manual = render_session('bike_z2', {'durationMin': 90}, self.start.isoformat(), 250)['workout']
        self.client.post('/api/workouts', json=manual)
        self.propose({'kind': 'week', 'week': self.week}, {**decision, 'targetHours': 2.5}, expected=400)

    def test_overrides_are_separate_checkins_are_athlete_data(self):
        self.client.put('/api/coach/weekly-overrides/' + self.week, json={'overrides': {'thu': {'available': False}}, 'note': 'Arbeit'})
        checkin = {'date': self.start.isoformat(), 'fatigue': 3, 'motivation': 5, 'stress': 2, 'sleepQuality': 4, 'soreness': 2, 'notes': 'Müde'}
        self.assertEqual(self.client.post('/api/coach/check-ins', json=checkin).status_code, 200)
        value = self.client.get('/api/athlete-profile').json
        self.assertEqual(value['availability']['defaultAvailability']['thu'], 120)
        self.assertEqual(value['source'], 'athlete')
        self.assertEqual(len(value['checkIns']), 1)
        self.assertEqual(self.client.post('/api/coach/check-ins', json={**checkin, 'fatigue': True}).status_code, 400)

    def test_schema_rejects_extra_fields_invalid_weeks_and_nan(self):
        for body in ({'goal': {'prompt': 'oops'}}, {'availability': {'absoluteMaxWeeklyHours': float('nan')}}, {'source': 'calculated'}):
            self.assertEqual(self.client.put('/api/athlete-profile', json=body).status_code, 400)
        self.assertEqual(self.client.put('/api/coach/weekly-overrides/2026-W54', json={'overrides': {}, 'note': ''}).status_code, 400)
        self.macro()
        self.propose({'kind': 'week', 'week': self.week}, {'week': self.week, 'targetHours': 1, 'focus': 'Basis', 'sessions': [self.session()], 'rawWorkout': []}, expected=400)

    def test_discard_expiry_and_import_invalidate_proposals(self):
        self.macro()
        body = {'kind': 'week', 'week': self.week}
        decision = {'week': self.week, 'targetHours': 1, 'focus': 'Basis', 'sessions': [self.session()]}
        proposal, _ = self.propose(body, decision)
        self.client.post('/api/coach/proposals/' + proposal['id'] + '/discard', json={})
        self.confirm(proposal, 409)
        proposal, _ = self.propose(body, decision)
        self.client.post('/api/activities/manual', json={'date': date.today().isoformat(), 'sport': 'ride', 'duration': 60})
        self.confirm(proposal, 409)
        proposal, _ = self.propose(body, decision)
        with self.backend.app.app_context():
            row = self.backend.db.session.get(self.Proposal, proposal['id'])
            row.created_at -= timedelta(days=2)
            self.backend.db.session.commit()
        self.confirm(proposal, 409)

    def test_manual_edit_and_delete_sync_plan_totals(self):
        self.week_plan()
        workout = self.client.get('/api/workouts').json[0]
        workout['steps'] = [{'kind': 'step', 'name': 'Locker', 'intensity': 'active', 'duration': {'type': 'time', 'value': 1800}, 'target': {'type': 'none'}}]
        self.client.put('/api/workouts/' + workout['id'], json=workout)
        self.assertEqual(self.client.get('/api/coach/plan').json['weeks'][self.week]['calculatedHours'], .5)
        self.client.delete('/api/workouts/' + workout['id'])
        self.assertEqual(self.client.get('/api/coach/plan').json['weeks'][self.week]['calculatedHours'], 0)

    def test_unknown_provider_and_connection_check_are_sanitized(self):
        self.assertEqual(self.client.put('/api/ai-provider', json={'provider': 'evil', 'model': 'x', 'apiKey': 'secret'}).status_code, 502)
        provider = Mock()
        provider.test_connection.return_value = {'connected': True, 'model': 'gpt-4.1-mini'}
        with patch('coach_api.get_provider', return_value=provider):
            self.assertTrue(self.client.post('/api/ai-provider/test', json={}).json['connected'])


if __name__ == '__main__':
    unittest.main()
