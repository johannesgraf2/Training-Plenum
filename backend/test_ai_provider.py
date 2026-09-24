import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from cryptography.fernet import Fernet

from ai_provider import (DEFAULT_MODEL, MAX_RESPONSE_BYTES, OpenAIProvider, ProviderError,
                         _NoRedirect, decrypt_key, encrypt_key, ensure_server_key, get_provider, validate_response)


SCHEMA = {'type': 'object', 'properties': {'hours': {'type': 'number', 'minimum': 0, 'maximum': 20}},
          'required': ['hours'], 'additionalProperties': False}


def envelope(text='{"hours": 8}'):
    return {'status': 'completed', 'output': [{'type': 'message', 'status': 'completed',
            'content': [{'type': 'output_text', 'text': text}]}]}


class KeyStorageTests(unittest.TestCase):
    def test_ciphertext_roundtrip_randomized_and_requires_the_original_server_key(self):
        key = 'secret-api-key-not-for-browser'
        server_key = Fernet.generate_key().decode()
        with patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': server_key}):
            ciphertext = encrypt_key(key)
            self.assertNotIn(key, ciphertext)
            self.assertNotEqual(ciphertext, encrypt_key(key))
            self.assertEqual(decrypt_key(ciphertext), key)
        with patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()}):
            with self.assertRaises(ProviderError) as error:
                decrypt_key(ciphertext)
            self.assertNotIn(key, str(error.exception))

    def test_missing_or_invalid_encryption_config_fails_closed(self):
        for value in ('', 'bad-config', 'ä'):
            with patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': value}):
                with self.assertRaises(ProviderError):
                    encrypt_key('secret-api-key')
                with self.assertRaises(ProviderError):
                    decrypt_key('saved-ciphertext')

    def test_invalid_api_keys_cannot_inject_headers(self):
        with patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode()}):
            for value in ('', 'short', 'key\r\nInjected: x', None, 'secret api key', 'secretäkey'):
                with self.assertRaises(ProviderError):
                    encrypt_key(value)


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = OpenAIProvider()

    def fake_http(self, payload):
        opened = MagicMock()
        opened.open.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        return opened

    def test_structured_request_is_compact_non_storing_and_returns_validated_data(self):
        opener = self.fake_http(envelope())
        with patch('ai_provider.build_opener', return_value=opener):
            result = self.provider.generate('secret-api-key', DEFAULT_MODEL, 'Use templates.', {'ftp': 250}, SCHEMA)
        self.assertEqual(result, {'hours': 8})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
        self.assertEqual(request.method, 'POST')
        self.assertEqual(request.get_header('Authorization'), 'Bearer secret-api-key')
        payload = json.loads(request.data)
        self.assertFalse(payload['store'])
        self.assertEqual(payload['input'], '{"ftp":250}')
        self.assertEqual(payload['text']['format']['schema'], SCHEMA)
        self.assertTrue(payload['text']['format']['strict'])
        self.assertNotIn('secret-api-key', request.data.decode())
        self.assertEqual(opener.open.call_count, 1)
        self.assertLessEqual(opener.open.call_args.kwargs['timeout'], 60)
        self.assertNotIn('reasoning', payload)

    def test_reasoning_effort_is_sent_with_more_output_budget_and_time(self):
        opener = self.fake_http(envelope())
        with patch('ai_provider.build_opener', return_value=opener):
            self.provider.generate('secret-api-key', 'gpt-6-sol', 'Use templates.', {}, SCHEMA, reasoning_effort='medium')
        payload = json.loads(opener.open.call_args.args[0].data)
        self.assertEqual(payload['reasoning'], {'effort': 'medium'})
        self.assertGreater(payload['max_output_tokens'], 10000)
        self.assertGreater(opener.open.call_args.kwargs['timeout'], 60)
        with patch.object(self.provider, '_request') as request:
            with self.assertRaises(ProviderError):
                self.provider.generate('secret-api-key', 'gpt-6-sol', 'x', {}, SCHEMA, reasoning_effort='extreme')
            request.assert_not_called()

    def test_connection_does_not_generate_and_checks_model(self):
        opener = self.fake_http({'id': DEFAULT_MODEL, 'object': 'model'})
        with patch('ai_provider.build_opener', return_value=opener):
            result = self.provider.test_connection('secret-api-key', DEFAULT_MODEL)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.full_url, 'https://api.openai.com/v1/models/' + DEFAULT_MODEL)
        self.assertIsNone(request.data)
        self.assertTrue(result['connected'])
        self.assertNotIn('secret-api-key', str(result))

    def test_model_validation_prevents_changing_endpoint(self):
        for model in ('../../me', 'a?key=x', 'https://example.test', 'name\n', '', None):
            with patch.object(self.provider, '_request') as request:
                with self.assertRaises(ProviderError):
                    self.provider.test_connection('secret-api-key', model)
                request.assert_not_called()

    def test_schema_validation_rejects_unknown_missing_invalid_and_nonfinite_fields(self):
        for body in ('{"hours": 30}', '{"hours": "8"}', '{"hours": true}', '{}',
                     '{"hours": 8, "raw": []}', '{"hours": NaN}', '{"hours": Infinity}',
                     '{"hours": 1e999}', '{"hours": 8, "hours": 9}', 'not-json'):
            with patch.object(self.provider, '_request', return_value=envelope(body)):
                with self.assertRaises(ProviderError):
                    self.provider.generate('secret-api-key', DEFAULT_MODEL, 'instructions', {}, SCHEMA)
        with self.assertRaises(ProviderError):
            validate_response({'hours': float('nan')}, SCHEMA)

    def test_refusal_incomplete_and_malformed_output_are_safe(self):
        refusal = envelope()
        refusal['output'][0]['content'] = [{'type': 'refusal', 'refusal': 'secret-provider-text'}]
        partial = envelope()
        partial['status'] = 'incomplete'
        bad_message = envelope()
        bad_message['output'][0]['status'] = 'in_progress'
        multiple = envelope()
        multiple['output'] *= 2
        for result in (refusal, partial, bad_message, multiple, {'status': 'completed', 'output': None}):
            with patch.object(self.provider, '_request', return_value=result):
                with self.assertRaises(ProviderError) as error:
                    self.provider.generate('secret-api-key', DEFAULT_MODEL, 'instructions', {}, SCHEMA)
                self.assertNotIn('secret-provider-text', str(error.exception))

    def test_http_errors_and_timeouts_never_expose_provider_bodies_or_keys_and_do_not_retry(self):
        for error in (HTTPError('https://api.openai.com/v1/responses', 401, 'secret-api-key', {},
                                io.BytesIO(b'{"error":"secret-api-key"}')),
                      URLError('secret-api-key'), TimeoutError('secret-api-key')):
            opener = MagicMock()
            opener.open.side_effect = error
            with patch('ai_provider.build_opener', return_value=opener):
                with self.assertRaises(ProviderError) as caught:
                    self.provider.generate('secret-api-key', DEFAULT_MODEL, 'instructions', {}, SCHEMA)
            self.assertNotIn('secret-api-key', str(caught.exception))
            self.assertEqual(opener.open.call_count, 1)

    def test_redirects_disabled_and_response_size_bounded(self):
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, '', {}, 'https://attacker.test'))
        opener = self.fake_http({})
        response = opener.open.return_value.__enter__.return_value
        response.read.return_value = b'x' * (MAX_RESPONSE_BYTES + 1)
        with patch('ai_provider.build_opener', return_value=opener):
            with self.assertRaises(ProviderError):
                self.provider.test_connection('secret-api-key', DEFAULT_MODEL)
        response.read.assert_called_once_with(MAX_RESPONSE_BYTES + 1)

    def test_unsupported_provider_has_safe_error(self):
        self.assertIsInstance(get_provider('openai'), OpenAIProvider)
        with self.assertRaises(ProviderError):
            get_provider('secret-api-key')



class ServerKeyTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'run' / 'ai-encryption-key.txt'
        self.environment = patch.dict(os.environ, {'TRAINHUB_AI_ENCRYPTION_KEY_FILE': str(self.path)})
        self.environment.start()
        os.environ.pop('TRAINHUB_AI_ENCRYPTION_KEY', None)

    def tearDown(self):
        self.environment.stop()
        self.folder.cleanup()

    def test_key_file_is_created_once_and_reused(self):
        self.assertEqual(ensure_server_key(), 'created')
        created = self.path.read_text(encoding='ascii').strip()
        Fernet(created.encode())
        self.assertEqual(os.environ['TRAINHUB_AI_ENCRYPTION_KEY'], created)
        os.environ.pop('TRAINHUB_AI_ENCRYPTION_KEY')
        self.assertEqual(ensure_server_key(), 'file')
        self.assertEqual(os.environ['TRAINHUB_AI_ENCRYPTION_KEY'], created)
        self.assertEqual(self.path.read_text(encoding='ascii').strip(), created)
        self.assertEqual(decrypt_key(encrypt_key('sk-test-local-key-1234')), 'sk-test-local-key-1234')

    def test_environment_wins_and_invalid_files_are_never_replaced(self):
        os.environ['TRAINHUB_AI_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
        self.assertEqual(ensure_server_key(), 'environment')
        self.assertFalse(self.path.exists())
        os.environ.pop('TRAINHUB_AI_ENCRYPTION_KEY')
        self.path.parent.mkdir(parents=True)
        self.path.write_text('kein-schluessel', encoding='ascii')
        self.assertEqual(ensure_server_key(), 'invalid')
        self.assertNotIn('TRAINHUB_AI_ENCRYPTION_KEY', os.environ)
        self.assertEqual(self.path.read_text(encoding='ascii'), 'kein-schluessel')


if __name__ == '__main__':
    unittest.main()
