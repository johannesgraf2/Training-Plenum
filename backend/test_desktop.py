"""The Windows app's server: the frontend build next to the API, and the data folder outside the program."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet

import desktop


class DesktopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.home = root / 'home'
        cls.environment = patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()})
        cls.environment.start()
        for name in ('DATABASE_URL', 'UPLOAD_FOLDER', 'TRAINHUB_AI_ENCRYPTION_KEY_FILE'):
            os.environ.pop(name, None)
        desktop.configure(cls.home)
        cls.build = root / 'build'
        (cls.build / 'static' / 'js').mkdir(parents=True)
        (cls.build / 'index.html').write_text('<div id="root"></div>', encoding='utf-8')
        (cls.build / 'favicon.svg').write_text('<svg/>', encoding='utf-8')
        (cls.build / 'static' / 'js' / 'main.js').write_text('console.log(1)', encoding='utf-8')
        spec = importlib.util.spec_from_file_location('desktop_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        desktop.add_frontend(cls.backend.app, cls.build)
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.environment.stop()
        cls.temp.cleanup()

    def test_data_lives_in_the_home_folder(self):
        self.assertEqual(os.environ['DATABASE_URL'], 'sqlite:///' + (self.home / 'data' / 'trainhub.db').as_posix())
        self.assertEqual(os.environ['UPLOAD_FOLDER'], str(self.home / 'uploads'))
        self.assertTrue((self.home / 'data' / 'trainhub.db').exists())

    def test_environment_settings_win(self):
        with patch.dict(os.environ, {'UPLOAD_FOLDER': '/elsewhere'}):
            desktop.configure(self.home)
            self.assertEqual(os.environ['UPLOAD_FOLDER'], '/elsewhere')

    def test_home_folder_follows_local_app_data(self):
        with patch.dict(os.environ, {'LOCALAPPDATA': r'C:\Users\athlet\AppData\Local'}):
            os.environ.pop('TRAINHUB_HOME', None)
            self.assertEqual(desktop.home_dir(), Path(r'C:\Users\athlet\AppData\Local') / 'Training Plenum')
        with patch.dict(os.environ, {'TRAINHUB_HOME': '/daten'}):
            self.assertEqual(desktop.home_dir(), Path('/daten'))

    def test_pages_files_and_scripts_come_from_the_build(self):
        for path in ('/', '/kalender/2026-10'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'id="root"', response.data)
            self.assertEqual(response.headers['Cache-Control'], 'no-cache')
            response.close()
        for path, body in (('/favicon.svg', b'<svg/>'), ('/static/js/main.js', b'console.log(1)')):
            response = self.client.get(path)
            self.assertEqual(response.data, body)
            response.close()

    def test_api_stays_the_api(self):
        self.assertEqual(self.client.get('/api/health').get_json()['status'], 'ok')
        self.assertEqual(self.client.get('/api/does-not-exist').status_code, 404)
        self.assertEqual(self.client.get('/api').status_code, 404)


if __name__ == '__main__':
    unittest.main()
