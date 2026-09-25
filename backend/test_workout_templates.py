"""Own workout templates, against an independently imported app and a temporary SQLite database."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet


def workout(**changes):
    return {'version': 1, 'name': '4 × 8 min Schwelle', 'sport': 'ride', 'date': '2026-09-24', 'notes': 'Eigenes Workout',
            'steps': [{'kind': 'step', 'name': 'Einfahren', 'intensity': 'warmup', 'duration': {'type': 'time', 'value': 600},
                       'target': {'type': 'power', 'low': 150, 'high': 150}},
                      {'kind': 'repeat', 'count': 4, 'steps': [
                          {'kind': 'step', 'name': '', 'intensity': 'interval', 'duration': {'type': 'time', 'value': 480},
                           'target': {'type': 'power', 'low': 260, 'high': 270}},
                          {'kind': 'step', 'name': '', 'intensity': 'recovery', 'duration': {'type': 'time', 'value': 240},
                           'target': {'type': 'none'}}]}]} | changes


class WorkoutTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + (root / 'templates.db').as_posix(),
                                                 'UPLOAD_FOLDER': str(root / 'uploads'),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('template_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.environment.stop()
        sys.modules.pop('template_test_application', None)
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            self.backend.WorkoutTemplate.query.delete()
            self.backend.db.session.commit()

    def test_saved_template_has_no_date_and_is_listed_newest_first(self):
        self.assertEqual(self.client.get('/api/workout-templates').json, [])
        first = self.client.post('/api/workout-templates', json=workout())
        self.assertEqual(first.status_code, 201)
        self.assertNotIn('date', first.json)
        self.assertEqual(first.json['steps'][1]['count'], 4)
        self.assertEqual(first.json['notes'], 'Eigenes Workout')
        second = self.client.post('/api/workout-templates', json=workout(name='Lange Ausfahrt', id='ignored')).json
        self.assertNotEqual(second['id'], 'ignored')
        self.assertEqual([t['name'] for t in self.client.get('/api/workout-templates').json][0], 'Lange Ausfahrt')
        # Templates are separate from the calendar.
        self.assertEqual(self.client.get('/api/workouts').json, [])

    def test_template_without_date_or_name_and_invalid_steps_are_rejected(self):
        without_date = workout()
        del without_date['date']
        self.assertEqual(self.client.post('/api/workout-templates', json=without_date).status_code, 201)
        for invalid in (workout(name='  '), workout(steps=[]), workout(sport='ski'), None):
            with self.subTest(invalid=invalid):
                response = self.client.post('/api/workout-templates', json=invalid)
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)
        self.assertEqual(len(self.client.get('/api/workout-templates').json), 1)

    def test_delete_removes_only_the_template(self):
        identity = self.client.post('/api/workout-templates', json=workout()).json['id']
        self.assertEqual(self.client.delete(f'/api/workout-templates/{identity}').status_code, 204)
        self.assertEqual(self.client.get('/api/workout-templates').json, [])
        self.assertEqual(self.client.delete(f'/api/workout-templates/{identity}').status_code, 404)

    def test_number_of_templates_is_limited(self):
        with patch.object(self.backend, 'MAX_WORKOUT_TEMPLATES', 2):
            for _ in range(2):
                self.assertEqual(self.client.post('/api/workout-templates', json=workout()).status_code, 201)
            response = self.client.post('/api/workout-templates', json=workout())
        self.assertEqual(response.status_code, 400)
        self.assertIn('höchstens 2', response.json['error'])


if __name__ == '__main__':
    unittest.main()
