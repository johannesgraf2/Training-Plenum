"""The MCP server for Claude: token and OAuth sign-in, JSON-RPC, tools through the app's own API."""
import base64
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from cryptography.fernet import Fernet

import remote_access

WORKOUT = {'name': 'Schwelle 3×8', 'sport': 'ride', 'date': '2026-10-21', 'steps': [
    {'kind': 'step', 'intensity': 'warmup', 'duration': {'type': 'time', 'value': 600}, 'target': {'type': 'none'}},
    {'kind': 'repeat', 'count': 3, 'steps': [
        {'kind': 'step', 'intensity': 'interval', 'duration': {'type': 'time', 'value': 480}, 'target': {'type': 'power', 'low': 250, 'high': 265}},
        {'kind': 'step', 'intensity': 'recovery', 'duration': {'type': 'time', 'value': 240}, 'target': {'type': 'none'}}]}]}
CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'


def challenge(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()


class McpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + (root / 'mcp.db').as_posix(),
                                                 'UPLOAD_FOLDER': str(root / 'uploads'),
                                                 'TRAINHUB_AI_ENCRYPTION_KEY': Fernet.generate_key().decode(),
                                                 'TRAINHUB_TIMEZONE': 'Europe/Berlin'})
        cls.environment.start()
        # No real Tailscale in tests: the machine is pc.tail1234.ts.net.
        cls.tailscale = patch.object(remote_access, 'detect', return_value={
            'installed': True, 'running': True, 'dnsName': 'pc.tail1234.ts.net', 'tailnet': 'athlet@example.com',
            'https': True, 'serve': []})
        cls.tailscale.start()
        remote_access.status(refresh=True)
        spec = importlib.util.spec_from_file_location('mcp_test_application', Path(__file__).with_name('app.py'))
        cls.backend = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.backend
        spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.backend.initialize_database()
        cls.client = cls.backend.app.test_client()
        cls.client.get('/api/user')
        cls.Access, cls.Client, cls.Grant = cls.backend.app.extensions['mcp_models']

    @classmethod
    def tearDownClass(cls):
        with cls.backend.app.app_context():
            cls.backend.db.session.remove()
            cls.backend.db.engine.dispose()
        cls.tailscale.stop()
        remote_access.status(refresh=True)
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        with self.backend.app.app_context():
            for model in (self.Grant, self.Client, self.Access, self.backend.PlannedWorkout):
                model.query.delete()
            self.backend.db.session.commit()

    def token(self):
        response = self.client.post('/api/mcp/token', json={})
        self.assertEqual(response.status_code, 201)
        return response.get_json()['token']

    def rpc(self, method, params=None, token=None, identity=1, **headers):
        body = {'jsonrpc': '2.0', 'id': identity, 'method': method, **({'params': params} if params is not None else {})}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        return self.client.post('/mcp', json=body, headers=headers)

    def call(self, token, name, arguments=None):
        response = self.rpc('tools/call', {'name': name, 'arguments': arguments or {}}, token)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()['result']
        return result['isError'], result['content'][0]['text']

    def allow_write(self, value=True):
        self.assertEqual(self.client.put('/api/mcp/settings', json={'allowWrite': value}).status_code, 200)

    # ─── Personal token and JSON-RPC ───

    def test_requires_a_token_and_points_to_the_oauth_metadata(self):
        response = self.rpc('initialize', {})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['WWW-Authenticate'],
                         'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"')
        response = self.rpc('initialize', {}, token='falsch')
        self.assertEqual(response.status_code, 401)
        self.assertIn('error="invalid_token"', response.headers['WWW-Authenticate'])

    def test_token_is_stored_as_hash_shown_once_and_revocable(self):
        token = self.token()
        self.assertTrue(token.startswith('tp_'))
        with self.backend.app.app_context():
            row = self.backend.db.session.get(self.Access, self.backend.DEMO_USER_ID)
            self.assertEqual(row.token_hash, hashlib.sha256(token.encode()).hexdigest())
        status = self.client.get('/api/mcp').get_json()
        self.assertNotIn(token, json.dumps(status))
        self.assertEqual(self.client.get('/api/mcp').headers['Cache-Control'], 'no-store')
        self.assertEqual(self.rpc('ping', token=token).get_json(), {'jsonrpc': '2.0', 'id': 1, 'result': {}})
        newer = self.token()
        self.assertEqual(self.rpc('ping', token=token).status_code, 401)
        self.assertEqual(self.rpc('ping', token=newer).status_code, 200)
        self.client.delete('/api/mcp/token')
        self.assertEqual(self.rpc('ping', token=newer).status_code, 401)

    def test_initialize_negotiates_the_version_and_remembers_the_client(self):
        token = self.token()
        result = self.rpc('initialize', {'protocolVersion': '2025-06-18', 'clientInfo': {'name': 'claude-code'}}, token).get_json()['result']
        self.assertEqual(result['protocolVersion'], '2025-06-18')
        self.assertEqual(result['serverInfo']['name'], 'training-plenum')
        self.assertEqual(result['capabilities'], {'tools': {'listChanged': False}})
        self.assertIn('get_training_overview', result['instructions'])
        self.assertEqual(self.rpc('initialize', {'protocolVersion': '1999-01-01'}, token).get_json()['result']['protocolVersion'], '2025-11-25')
        self.assertEqual(self.client.get('/api/mcp').get_json()['token']['lastClient'], 'claude-code')

    def test_notifications_responses_batches_and_errors(self):
        token = self.token()
        headers = {'Authorization': f'Bearer {token}'}
        notification = self.client.post('/mcp', json={'jsonrpc': '2.0', 'method': 'notifications/initialized'}, headers=headers)
        self.assertEqual((notification.status_code, notification.get_data()), (202, b''))
        batch = self.client.post('/mcp', headers=headers, json=[{'jsonrpc': '2.0', 'id': 7, 'method': 'ping'},
                                                                 {'jsonrpc': '2.0', 'method': 'notifications/cancelled'}])
        self.assertEqual(batch.get_json(), [{'jsonrpc': '2.0', 'id': 7, 'result': {}}])
        self.assertEqual(self.rpc('unknown/method', token=token).get_json()['error']['code'], -32601)
        self.assertEqual(self.rpc('tools/call', {'name': 'nope'}, token).get_json()['error']['code'], -32602)
        broken = self.client.post('/mcp', data='{', headers={**headers, 'Content-Type': 'application/json'})
        self.assertEqual((broken.status_code, broken.get_json()['error']['code']), (400, -32700))
        # Newer clients probe with server/discover first and fall back to initialize on "method not found".
        probe = self.rpc('server/discover', {}, token, identity=9, **{'MCP-Protocol-Version': '2026-07-28'})
        self.assertEqual((probe.status_code, probe.get_json()['id'], probe.get_json()['error']['code']), (200, 9, -32601))
        self.assertEqual(self.client.get('/mcp', headers=headers).status_code, 405)
        self.assertEqual(self.rpc('prompts/list', token=token).get_json()['result'], {'prompts': []})

    def test_foreign_browser_origins_are_refused(self):
        token = self.token()
        self.assertEqual(self.rpc('ping', token=token, Origin='https://evil.example').status_code, 403)
        self.assertEqual(self.rpc('ping', token=token, Origin='https://other.tail9999.ts.net').status_code, 403)
        self.assertEqual(self.rpc('ping', token=token, Origin='https://pc.tail1234.ts.net').status_code, 200)

    # ─── Tools ───

    def test_lists_only_reading_tools_until_writing_is_allowed(self):
        token = self.token()
        names = lambda: [t['name'] for t in self.rpc('tools/list', token=token).get_json()['result']['tools']]  # noqa: E731
        self.assertNotIn('create_planned_workout', names())
        self.assertIn('get_activity', names())
        tool = self.rpc('tools/list', token=token).get_json()['result']['tools'][0]
        self.assertEqual(set(tool), {'name', 'title', 'description', 'inputSchema', 'annotations'})
        self.assertTrue(tool['annotations']['readOnlyHint'])
        failed, text = self.call(token, 'create_planned_workout', {'workout': WORKOUT})
        self.assertTrue(failed)
        self.assertIn('nur lesen', text)
        self.allow_write()
        self.assertIn('delete_planned_workout', names())

    def test_plans_changes_and_deletes_workouts_through_the_app(self):
        token = self.token()
        self.allow_write()
        failed, text = self.call(token, 'create_planned_workout', {'workout': WORKOUT})
        self.assertFalse(failed, text)
        created = json.loads(text)
        self.assertEqual(self.client.get('/api/workouts').get_json()[0]['name'], 'Schwelle 3×8')
        failed, text = self.call(token, 'list_planned_workouts', {'from': '2026-10-19', 'to': '2026-10-25'})
        self.assertEqual([w['id'] for w in json.loads(text)['workouts']], [created['id']])
        failed, text = self.call(token, 'update_planned_workout', {'id': created['id'], 'workout': {**WORKOUT, 'date': '2026-10-22'}})
        self.assertFalse(failed, text)
        self.assertEqual(self.client.get('/api/workouts').get_json()[0]['date'], '2026-10-22')
        self.client.put(f'/api/workouts/{created["id"]}/lock', json={'locked': True})
        failed, text = self.call(token, 'delete_planned_workout', {'id': created['id']})
        self.assertTrue(failed)
        self.assertIn('gesperrt', text)
        self.client.put(f'/api/workouts/{created["id"]}/lock', json={'locked': False})
        self.assertFalse(self.call(token, 'delete_planned_workout', {'id': created['id']})[0])
        self.assertEqual(self.client.get('/api/workouts').get_json(), [])

    def test_invalid_arguments_and_app_errors_come_back_as_tool_errors(self):
        token = self.token()
        self.allow_write()
        failed, text = self.call(token, 'list_activities', {'limit': 1000})
        self.assertTrue(failed)
        self.assertIn('limit', text)
        failed, text = self.call(token, 'get_activity', {'id': '../workouts'})
        self.assertTrue(failed)
        self.assertIn('Ungültige Argumente', text)
        failed, text = self.call(token, 'create_planned_workout', {'workout': {**WORKOUT, 'steps': [
            {'kind': 'step', 'intensity': 'active', 'duration': {'type': 'time', 'value': 60}, 'target': {'type': 'power', 'low': 300, 'high': 200}}]}})
        self.assertTrue(failed)
        self.assertIn('Zielbereich', text)
        self.assertTrue(self.call(token, 'get_activity', {'id': 'fehlt'})[0])

    def test_activity_details_never_contain_positions(self):
        token = self.token()
        self.client.put('/api/user', json={'ftp': 250, 'maxHr': 190})
        records = [{'time': t, 'hr': 140, 'power': 200 + t % 50, 'speed': 30.0, 'distance': t * 8.3,
                    'lat': 48.137, 'lng': 11.575} for t in range(0, 1800)]
        with self.backend.app.app_context():
            row = self.backend.Activity(id='ride-1', user_id=self.backend.DEMO_USER_ID, title='Runde', sport='ride',
                                        date=datetime(2026, 10, 15, 16, 0), duration=30, distance=15, time_series=json.dumps(records),
                                        fit_details=json.dumps({'timerSeconds': 1800, 'measurements': ['hr', 'power', 'gps'], 'laps': [
                                            {'startTime': '2026-10-15T16:00:00Z', 'timerSeconds': 1800, 'power': 224}]}))
            self.backend.db.session.add(row)
            self.backend.db.session.commit()
        failed, text = self.call(token, 'get_activity', {'id': 'ride-1', 'samples': 30})
        self.assertFalse(failed, text)
        detail = json.loads(text)
        self.assertNotIn('lat', text)
        self.assertNotIn('48.137', text)
        self.assertEqual(detail['measurements'], ['hr', 'power'])
        self.assertEqual(len(detail['samples']), 30)
        self.assertEqual(detail['laps'][0]['power'], 224)
        analysis = detail['analysis'][0]
        self.assertGreater(analysis['normalizedPower'], 200)
        self.assertGreater(analysis['tss'], 0)
        self.assertEqual(len(analysis['powerZoneMinutes']), 7)
        listed = json.loads(self.call(token, 'list_activities', {'from': '2026-10-15', 'to': '2026-10-15'})[1])
        self.assertEqual([a['id'] for a in listed['activities']], ['ride-1'])
        self.assertEqual(json.loads(self.call(token, 'list_activities', {'from': '2026-10-16'})[1])['count'], 0)
        load = json.loads(self.call(token, 'get_training_load', {'weeks': 104})[1])
        self.assertTrue(any(week['activities'] for week in load['weeks']))
        self.assertIn('current', load['fitness'])

    def test_reading_tools_answer_without_data(self):
        token = self.token()
        for name, arguments in [('get_training_overview', {}), ('get_today', {}), ('get_recovery', {}),
                                ('get_best_efforts', {'sport': 'run'}), ('list_planned_workouts', {})]:
            failed, text = self.call(token, name, arguments)
            self.assertFalse(failed, f'{name}: {text}')
            json.loads(text)

    # ─── OAuth for Claude's hosted apps ───

    def register(self, uris=(CLAUDE_CALLBACK,)):
        response = self.client.post('/oauth/register', json={'client_name': 'Claude', 'redirect_uris': list(uris)})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()['client_id']

    def pairing(self):
        response = self.client.post('/api/mcp/pairing', json={})
        self.assertEqual(response.status_code, 201)
        return response.get_json()['code']

    def authorize(self, client_id, code, verifier='v' * 64, redirect_uri=CLAUDE_CALLBACK, **extra):
        form = {'response_type': 'code', 'client_id': client_id, 'redirect_uri': redirect_uri, 'state': 'xyz',
                'code_challenge': challenge(verifier), 'code_challenge_method': 'S256', 'code': code, 'action': 'allow', **extra}
        return self.client.post('/oauth/authorize', data=form)

    def sign_in(self):
        client_id = self.register()
        response = self.authorize(client_id, self.pairing())
        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        query = parse_qs(urlparse(response.headers['Location']).query)
        tokens = self.client.post('/oauth/token', data={'grant_type': 'authorization_code', 'code': query['code'][0],
                                                        'redirect_uri': CLAUDE_CALLBACK, 'client_id': client_id,
                                                        'code_verifier': 'v' * 64})
        self.assertEqual(tokens.status_code, 200, tokens.get_data(as_text=True))
        return client_id, tokens.get_json()

    def test_discovery_documents_follow_the_forwarded_address(self):
        headers = {'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'pc.tail1234.ts.net:8443'}
        resource = self.client.get('/.well-known/oauth-protected-resource/mcp', headers=headers).get_json()
        self.assertEqual(resource['resource'], 'https://pc.tail1234.ts.net:8443/mcp')
        self.assertEqual(resource['authorization_servers'], ['https://pc.tail1234.ts.net:8443'])
        server = self.client.get('/.well-known/oauth-authorization-server', headers=headers).get_json()
        self.assertEqual(server['token_endpoint'], 'https://pc.tail1234.ts.net:8443/oauth/token')
        self.assertEqual(server['code_challenge_methods_supported'], ['S256'])
        self.assertEqual(server['token_endpoint_auth_methods_supported'], ['none'])
        spoofed = self.client.get('/.well-known/oauth-protected-resource', headers={'X-Forwarded-Host': 'evil"><script>'}).get_json()
        self.assertEqual(spoofed['resource'], 'http://localhost/mcp')

    def test_registration_accepts_https_and_loopback_redirects_only(self):
        self.register([CLAUDE_CALLBACK, 'http://localhost:3118/callback'])
        for uris in ([], ['http://evil.example/cb'], ['javascript:alert(1)'], ['https://claude.ai/cb#frag'], 'x'):
            self.assertEqual(self.client.post('/oauth/register', json={'redirect_uris': uris}).status_code, 400, uris)

    def test_consent_page_shows_the_app_and_the_redirect_host(self):
        client_id = self.register()
        page = self.client.get('/oauth/authorize', query_string={
            'response_type': 'code', 'client_id': client_id, 'redirect_uri': CLAUDE_CALLBACK, 'state': 's',
            'code_challenge': challenge('v' * 64), 'code_challenge_method': 'S256'})
        self.assertEqual(page.status_code, 200)
        text = page.get_data(as_text=True)
        self.assertIn('Claude möchte auf Training Plēnum zugreifen', text)
        self.assertIn('<strong>claude.ai</strong>', text)
        self.assertIn('nur lesen', text)
        self.assertEqual(page.headers['X-Frame-Options'], 'DENY')
        unknown = self.client.get('/oauth/authorize', query_string={'client_id': 'nope', 'redirect_uri': CLAUDE_CALLBACK})
        self.assertEqual(unknown.status_code, 400)
        wrong = self.client.get('/oauth/authorize', query_string={'client_id': client_id, 'redirect_uri': 'https://evil.example/cb'})
        self.assertEqual(wrong.status_code, 400)
        self.assertNotIn('Location', wrong.headers)
        plain = self.client.get('/oauth/authorize', query_string={'response_type': 'code', 'client_id': client_id,
                                                                    'redirect_uri': CLAUDE_CALLBACK, 'state': 's'})
        self.assertIn('error=invalid_request', plain.headers['Location'])

    def test_full_sign_in_gives_tokens_that_open_mcp_and_rotate(self):
        client_id, tokens = self.sign_in()
        self.assertEqual(tokens['token_type'], 'Bearer')
        self.assertEqual(self.rpc('ping', token=tokens['access_token']).status_code, 200)
        connections = self.client.get('/api/mcp').get_json()['connections']
        self.assertEqual([c['client'] for c in connections], ['Claude'])
        refreshed = self.client.post('/oauth/token', data={'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token'],
                                                           'client_id': client_id}).get_json()
        self.assertNotEqual(refreshed['refresh_token'], tokens['refresh_token'])
        self.assertEqual(self.rpc('ping', token=tokens['access_token']).status_code, 401)
        self.assertEqual(self.rpc('ping', token=refreshed['access_token']).status_code, 200)
        reused = self.client.post('/oauth/token', data={'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']})
        self.assertEqual((reused.status_code, reused.get_json()['error']), (400, 'invalid_grant'))
        self.client.delete(f'/api/mcp/connections/{connections[0]["id"]}')
        self.assertEqual(self.rpc('ping', token=refreshed['access_token']).status_code, 401)
        self.assertEqual(self.client.get('/api/mcp').get_json()['connections'], [])

    def test_codes_are_single_use_and_need_the_right_verifier(self):
        client_id = self.register()
        location = self.authorize(client_id, self.pairing()).headers['Location']
        code = parse_qs(urlparse(location).query)['code'][0]
        self.assertEqual(parse_qs(urlparse(location).query)['state'], ['xyz'])
        exchange = lambda verifier: self.client.post('/oauth/token', data={  # noqa: E731
            'grant_type': 'authorization_code', 'code': code, 'client_id': client_id, 'redirect_uri': CLAUDE_CALLBACK,
            'code_verifier': verifier})
        self.assertEqual(exchange('w' * 64).get_json()['error'], 'invalid_grant')
        self.assertEqual(exchange('v' * 64).get_json()['error'], 'invalid_grant')  # used up by the failed attempt

    def test_expired_codes_and_tokens_are_refused(self):
        client_id, tokens = self.sign_in()
        with self.backend.app.app_context():
            for grant in self.Grant.query.all():
                grant.expires_at = datetime.utcnow() - timedelta(seconds=1)
            self.backend.db.session.commit()
        self.assertEqual(self.rpc('ping', token=tokens['access_token']).status_code, 401)
        refresh = self.client.post('/oauth/token', data={'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']})
        self.assertEqual(refresh.get_json()['error'], 'invalid_grant')

    def test_the_approval_code_is_single_use_and_wears_out(self):
        client_id = self.register()
        self.assertEqual(self.authorize(client_id, 'ABCD-EFGH').status_code, 400)  # none pending
        code = self.pairing()
        self.assertRegex(code, r'^[A-Z2-9]{4}-[A-Z2-9]{4}$')
        self.assertEqual(self.client.get('/api/mcp').get_json()['pairingExpiresAt'] is not None, True)
        wrong = self.authorize(client_id, 'AAAA-AAAA')
        self.assertEqual(wrong.status_code, 400)
        self.assertIn('Noch 4 Versuche', wrong.get_data(as_text=True))
        self.assertEqual(self.authorize(client_id, code.lower().replace('-', ' ')).status_code, 302)
        self.assertEqual(self.authorize(client_id, code).status_code, 400)  # used
        code = self.pairing()
        for _ in range(5):
            self.authorize(client_id, 'AAAA-AAAA')
        self.assertEqual(self.authorize(client_id, code).status_code, 400)  # worn out by wrong attempts

    def test_loopback_redirects_match_any_port(self):
        client_id = self.register(['http://localhost/callback'])
        response = self.authorize(client_id, self.pairing(), redirect_uri='http://localhost:3118/callback')
        self.assertTrue(response.headers['Location'].startswith('http://localhost:3118/callback?code='))
        self.assertEqual(self.authorize(client_id, self.pairing(), redirect_uri='http://localhost:3118/other').status_code, 400)

    def test_deny_and_cross_site_posts(self):
        client_id = self.register()
        denied = self.authorize(client_id, '', action='deny')
        self.assertIn('error=access_denied', denied.headers['Location'])
        self.assertIn('state=xyz', denied.headers['Location'])
        form = {'response_type': 'code', 'client_id': client_id, 'redirect_uri': CLAUDE_CALLBACK, 'code': self.pairing(),
                'code_challenge': challenge('v' * 64), 'code_challenge_method': 'S256', 'action': 'allow'}
        self.assertEqual(self.client.post('/oauth/authorize', data=form, headers={'Origin': 'https://evil.example'}).status_code, 403)

    def test_disconnecting_all_removes_clients_and_tokens(self):
        _, tokens = self.sign_in()
        self.client.delete('/api/mcp/connections')
        self.assertEqual(self.rpc('ping', token=tokens['access_token']).status_code, 401)
        with self.backend.app.app_context():
            self.assertEqual(self.Client.query.count(), 0)

    # ─── Funnel and the Claude port ───

    def test_funnel_requests_reach_only_the_claude_paths(self):
        funnel = {'Tailscale-Funnel-Request': '?1'}
        self.assertEqual(self.client.get('/api/activities', headers=funnel).status_code, 403)
        self.assertEqual(self.client.get('/api/mcp', headers=funnel).status_code, 403)
        self.assertEqual(self.client.get('/.well-known/oauth-authorization-server', headers=funnel).status_code, 200)
        self.assertEqual(self.client.post('/mcp', json={}, headers=funnel).status_code, 401)

    def test_claude_port_serves_nothing_but_mcp_and_oauth(self):
        from werkzeug.test import Client
        public = Client(remote_access.claude_only(self.backend.app))
        self.assertEqual(public.get('/api/activities').status_code, 404)
        self.assertEqual(public.get('/').status_code, 404)
        self.assertEqual(public.get('/mcpx').status_code, 404)
        self.assertEqual(public.get('/.well-known/oauth-protected-resource/mcp').status_code, 200)
        self.assertEqual(public.post('/mcp', json={}).status_code, 401)

    def test_ui_routes_accept_the_tailnet_address_only(self):
        self.assertEqual(self.client.get('/api/mcp', headers={'Host': 'pc.tail1234.ts.net', 'Origin': 'https://pc.tail1234.ts.net'}).status_code, 200)
        self.assertEqual(self.client.get('/api/mcp', headers={'Host': 'other.tail9999.ts.net'}).status_code, 403)
        self.assertEqual(self.client.get('/api/mcp', headers={'Origin': 'https://other.tail9999.ts.net'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
