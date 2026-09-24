"""Provider boundary: encrypted BYOK secrets and bounded, schema-checked requests.

No keys, provider error bodies, or generated content are included in errors. A
deployment-provided TRAINHUB_AI_ENCRYPTION_KEY always wins; otherwise the server
key lives in a local key file that is created once and never overwritten.
"""
import json
import os
import re
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography.fernet import Fernet, InvalidToken
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

DEFAULT_MODEL = 'gpt-4.1-mini'
KEY_ENV = 'TRAINHUB_AI_ENCRYPTION_KEY'
KEY_FILE_ENV = 'TRAINHUB_AI_ENCRYPTION_KEY_FILE'
DEFAULT_KEY_FILE = Path(__file__).resolve().parent.parent / '.run' / 'ai-encryption-key.txt'
MAX_RESPONSE_BYTES = 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 60


class ProviderError(ValueError):
    """An error message safe to return to the athlete."""


def validate_model(model):
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,119}', model):
        raise ProviderError('Bitte eine gültige Modell-ID eingeben.')
    return model


def _validate_key(key):
    if not isinstance(key, str) or not 8 <= len(key) <= 1024 or not all(33 <= ord(c) <= 126 for c in key):
        raise ProviderError('Bitte einen gültigen API-Key eingeben.')
    return key


def _cipher():
    configured = os.environ.get('TRAINHUB_AI_ENCRYPTION_KEY', '')
    if not configured:
        raise ProviderError('AI-Key-Speicherung ist nicht eingerichtet: TRAINHUB_AI_ENCRYPTION_KEY fehlt.')
    try:
        return Fernet(configured.encode('ascii'))
    except (ValueError, UnicodeError, TypeError):
        raise ProviderError('TRAINHUB_AI_ENCRYPTION_KEY ist ungültig; bitte die Server-Konfiguration prüfen.') from None


def key_file():
    return Path(os.environ.get(KEY_FILE_ENV) or DEFAULT_KEY_FILE)


def ensure_server_key():
    """Provide the Fernet server key for this process; returns where it came from.

    'environment' and 'file' reuse an existing key, 'created' wrote a new key file,
    'invalid' found an unusable file (left untouched) and 'unavailable' could not
    read or write it. Without a key, saving a provider key stays disabled.
    """
    if os.environ.get(KEY_ENV):
        return 'environment'
    path = key_file()
    source = 'file'
    try:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                # Exclusive creation: a second starting process never replaces an existing key.
                handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(handle, 'w', encoding='ascii') as output:
                    output.write(Fernet.generate_key().decode('ascii') + '\n')
                source = 'created'
        key = path.read_text(encoding='ascii').strip()
        Fernet(key.encode('ascii'))
    except (ValueError, UnicodeError, TypeError):
        return 'invalid'
    except OSError:
        return 'unavailable'
    os.environ[KEY_ENV] = key
    return source


def encrypt_key(key):
    return _cipher().encrypt(_validate_key(key).encode('ascii')).decode('ascii')


def decrypt_key(ciphertext):
    cipher = _cipher()
    try:
        return _validate_key(cipher.decrypt(ciphertext.encode('ascii')).decode('ascii'))
    except (InvalidToken, UnicodeError, ValueError, TypeError, AttributeError):
        raise ProviderError('Der gespeicherte AI-Key kann nicht entschlüsselt werden. Bitte erneut hinterlegen.') from None


def _reject_constant(value):
    raise ValueError('Non-finite JSON number')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON property')
        result[key] = value
    return result


def validate_response(value, schema):
    """Validate even when a provider claims it already enforced a strict schema."""
    try:
        # jsonschema treats NaN as a number. Reject non-finite values explicitly.
        json.dumps(value, allow_nan=False)
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(value)
    except (ValueError, TypeError, RecursionError, SchemaError, ValidationError):
        raise ProviderError('Die AI-Antwort entspricht nicht dem erwarteten JSON-Schema.') from None
    return value


class AIProvider(ABC):
    @abstractmethod
    def generate(self, api_key, model, instructions, context, schema):
        """Return a schema-validated JSON recommendation."""

    @abstractmethod
    def test_connection(self, api_key, model):
        """Check credentials/model access without generating a plan."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward Authorization to another endpoint, even on same-host redirects.
        return None


class OpenAIProvider(AIProvider):
    base_url = 'https://api.openai.com/v1'

    def _request(self, api_key, path, payload=None):
        _validate_key(api_key)
        try:
            data = None if payload is None else json.dumps(payload, separators=(',', ':'), ensure_ascii=False,
                                                           allow_nan=False).encode('utf-8')
            request = Request(self.base_url + path, data=data,
                              headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
                              method='GET' if data is None else 'POST')
            # No automatic retries: a retry could charge for another generation.
            with build_opener(_NoRedirect()).open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ProviderError('Die AI-Antwort überschreitet die erlaubte Größe.')
            result = json.loads(raw.decode('utf-8'), parse_constant=_reject_constant, object_pairs_hook=_unique_object)
            if not isinstance(result, dict):
                raise ProviderError('Der AI-Provider hat keine gültige JSON-Antwort geliefert.')
            return result
        except HTTPError as error:
            code = error.code
            error.close()
            message = {401: 'Der AI-Provider hat den API-Key abgelehnt.',
                       403: 'Der AI-Key hat keine Berechtigung für dieses Modell.',
                       404: 'Das konfigurierte Modell ist nicht verfügbar.',
                       429: 'AI-Kontingent oder Anfragelimit erreicht. Bitte später erneut versuchen.'}.get(code)
            raise ProviderError(message or 'Der AI-Provider konnte die Anfrage nicht verarbeiten.') from None
        except (URLError, OSError, TimeoutError):
            raise ProviderError('Der AI-Provider ist derzeit nicht erreichbar. Bitte später erneut versuchen.') from None
        except (ValueError, UnicodeError, TypeError, RecursionError) as error:
            if isinstance(error, ProviderError):
                raise
            raise ProviderError('Der AI-Provider hat keine gültige JSON-Antwort geliefert.') from None

    def test_connection(self, api_key, model):
        model = validate_model(model)
        result = self._request(api_key, '/models/' + model)
        if result.get('object') != 'model' or result.get('id') != model:
            raise ProviderError('Das konfigurierte Modell konnte nicht bestätigt werden.')
        return {'provider': 'openai', 'model': model, 'connected': True,
                'message': 'Verbindung und Modellzugriff bestätigt. Strukturierte Ausgabe wird bei der Planung geprüft.'}

    def generate(self, api_key, model, instructions, context, schema):
        model = validate_model(model)
        try:
            Draft202012Validator.check_schema(schema)
            compact_context = json.dumps(context, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        except (SchemaError, ValueError, TypeError, RecursionError):
            raise ProviderError('Der AI-Planungskontext oder das Antwortschema ist ungültig.') from None
        result = self._request(api_key, '/responses', {
            'model': model, 'store': False, 'instructions': instructions,
            'input': compact_context, 'max_output_tokens': 10000,
            'text': {'format': {'type': 'json_schema', 'name': 'trainhub_recommendation',
                                'strict': True, 'schema': schema}},
        })
        if result.get('status') != 'completed' or result.get('error'):
            raise ProviderError('Die AI-Antwort ist unvollständig. Der Plan wurde nicht geändert.')
        texts = []
        outputs = result.get('output')
        if not isinstance(outputs, list):
            raise ProviderError('Der AI-Provider hat keine strukturierte Empfehlung geliefert.')
        for item in outputs:
            if not isinstance(item, dict) or item.get('type') != 'message':
                continue
            if item.get('status') != 'completed' or not isinstance(item.get('content'), list):
                raise ProviderError('Die AI-Antwort ist unvollständig. Der Plan wurde nicht geändert.')
            for content in item['content']:
                if not isinstance(content, dict):
                    raise ProviderError('Der AI-Provider hat keine strukturierte Empfehlung geliefert.')
                if content.get('type') == 'refusal':
                    raise ProviderError('Der AI-Provider hat diese Planungsanfrage abgelehnt.')
                if content.get('type') == 'output_text' and isinstance(content.get('text'), str):
                    texts.append(content['text'])
        if len(texts) != 1:
            raise ProviderError('Der AI-Provider hat keine eindeutige strukturierte Empfehlung geliefert.')
        try:
            value = json.loads(texts[0], parse_constant=_reject_constant, object_pairs_hook=_unique_object)
        except (ValueError, TypeError, RecursionError):
            raise ProviderError('Die AI-Antwort enthält kein gültiges JSON.') from None
        return validate_response(value, schema)


PROVIDERS = {'openai': OpenAIProvider()}


def get_provider(name):
    if not isinstance(name, str) or name not in PROVIDERS:
        raise ProviderError('Dieser AI-Provider wird noch nicht unterstützt.')
    return PROVIDERS[name]
