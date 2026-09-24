"""Start-page images and heart-rate sparklines, against an independently imported app and temporary folders."""
import importlib.util
import json
import os
from datetime import datetime
from io import BytesIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32
JPEG = b'\xff\xd8\xff\xe0' + b'\x00' * 32


class AppearanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.uploads = root / 'uploads'
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + (root / 'appearance.db').as_posix(),
                                                 'UPLOAD_FOLDER': str(cls.uploads),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        spec = importlib.util.spec_from_file_location('appearance_test_application', Path(__file__).with_name('app.py'))
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
        sys.modules.pop('appearance_test_application', None)
        cls.temp.cleanup()

    def setUp(self):
        for slot in ('background', 'race-goal'):
            self.client.delete(f'/api/appearance/{slot}/image')
        self.client.put('/api/appearance', json={'background': 'default'})

    def upload(self, slot, content, name='bild.png'):
        return self.client.post(f'/api/appearance/{slot}/image', data={'file': (BytesIO(content), name)},
                                content_type='multipart/form-data')

    def test_defaults_to_the_bundled_background_without_images(self):
        self.assertEqual(self.client.get('/api/appearance').json,
                         {'background': 'default', 'backgroundImage': None, 'raceGoalImage': None})

    def test_uploading_a_background_switches_to_it_and_serves_it_locally(self):
        response = self.upload('background', PNG)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json['background'], 'custom')
        self.assertTrue(response.json['backgroundImage'].startswith('/api/appearance/background/image?v='))
        image = self.client.get('/api/appearance/background/image')
        self.assertEqual(image.data, PNG)
        image.close()
        self.assertTrue((self.uploads / 'appearance' / 'home-background.png').exists())

    def test_replacing_an_image_keeps_one_file_per_slot(self):
        self.upload('race-goal', PNG)
        self.upload('race-goal', JPEG, 'foto.jpg')
        files = sorted(p.name for p in (self.uploads / 'appearance').iterdir() if p.name.startswith('race-goal'))
        self.assertEqual(files, ['race-goal.jpg'])
        self.assertEqual(self.client.get('/api/appearance').json['background'], 'default')

    def test_the_background_can_be_hidden_and_restored(self):
        self.upload('background', PNG)
        self.assertEqual(self.client.put('/api/appearance', json={'background': 'none'}).json['background'], 'none')
        self.assertEqual(self.client.put('/api/appearance', json={'background': 'custom'}).json['background'], 'custom')
        self.assertEqual(self.client.delete('/api/appearance/background/image').json,
                         {'background': 'default', 'backgroundImage': None, 'raceGoalImage': None})

    def test_rejects_other_files_and_unknown_modes(self):
        response = self.upload('background', b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'bild.svg')
        self.assertEqual(response.status_code, 400)
        self.assertIn('JPEG', response.json['error'])
        self.assertEqual(self.client.put('/api/appearance', json={'background': 'custom'}).status_code, 400)
        self.assertEqual(self.client.put('/api/appearance', json={'background': 'bunt'}).status_code, 400)
        self.assertEqual(self.upload('avatar', PNG).status_code, 404)
        self.assertEqual(self.client.get('/api/appearance/race-goal/image').status_code, 404)

    def test_rejects_images_over_ten_megabytes(self):
        response = self.upload('race-goal', PNG + b'\x00' * (10 * 1024 * 1024))
        self.assertEqual(response.status_code, 400)
        self.assertIn('10 MB', response.json['error'])

    def test_sparklines_average_heart_rate_and_skip_missing_readings(self):
        series = [{'time': i, 'hr': 100 + i} for i in range(96)] + [{'time': 96 + i} for i in range(20)]
        with self.backend.app.app_context():
            activity = self.backend.Activity(user_id=self.backend.DEMO_USER_ID, title='Test', sport='ride',
                                             date=datetime(2026, 9, 21, 17), time_series=json.dumps(series))
            empty = self.backend.Activity(user_id=self.backend.DEMO_USER_ID, title='Ohne HF', sport='run',
                                          date=datetime(2026, 9, 19, 9), time_series=json.dumps([{'time': 0}]))
            self.backend.db.session.add_all([activity, empty])
            self.backend.db.session.commit()
            ids = [activity.id, empty.id]
        result = self.client.get(f'/api/activities/sparklines?ids={",".join(ids)}').json
        self.assertEqual(result[ids[1]], [])
        self.assertTrue(40 <= len(result[ids[0]]) <= 48)
        self.assertEqual(result[ids[0]][0], 100)  # mean of 100 and 101
        self.assertEqual(result[ids[0]], sorted(result[ids[0]]))


if __name__ == '__main__':
    unittest.main()
