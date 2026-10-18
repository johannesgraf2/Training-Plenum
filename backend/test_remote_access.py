"""Tailscale detection, the published ports and which origins the guarded API accepts."""
import json
import os
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import remote_access

STATUS = {'BackendState': 'Running', 'Self': {'DNSName': 'pc.tail1234.ts.net.', 'HostName': 'pc'},
          'CurrentTailnet': {'Name': 'athlet@example.com', 'MagicDNSEnabled': True}, 'CertDomains': ['pc.tail1234.ts.net']}
SERVE = {'TCP': {'443': {'HTTPS': True}, '8443': {'HTTPS': True}},
         'Web': {'pc.tail1234.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:5000'}}},
                 'pc.tail1234.ts.net:8443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:5001'}}}},
         'AllowFunnel': {'pc.tail1234.ts.net:8443': True}}


def cli(outputs):
    """A fake tailscale binary answering `status --json` and `serve status --json`."""
    def run(command, **options):
        key = ' '.join(command[1:-1])
        if key not in outputs:
            return SimpleNamespace(returncode=1, stdout='')
        return SimpleNamespace(returncode=0, stdout=json.dumps(outputs[key]))
    return run


class RemoteAccessTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'TRAINHUB_TAILSCALE_CLI': '/usr/bin/tailscale'})
        self.environment.start()
        for name in ('TRAINHUB_REMOTE_URL', 'TRAINHUB_COACH_ORIGINS', 'TRAINHUB_APP_PORT', 'TRAINHUB_CLAUDE_PORT'):
            os.environ.pop(name, None)
        self.app = SimpleNamespace(config={'TRAINHUB_APP_PORT': 5000}, extensions={})

    def tearDown(self):
        self.environment.stop()
        remote_access.status(refresh=True)

    def detect(self, outputs):
        with patch.object(subprocess, 'run', side_effect=cli(outputs)):
            return remote_access.status(refresh=True)

    def test_reads_name_tailnet_and_published_ports(self):
        current = self.detect({'status': STATUS, 'serve status': SERVE})
        self.assertEqual(current['dnsName'], 'pc.tail1234.ts.net')
        self.assertTrue(current['running'] and current['https'] and current['magicDns'])
        self.assertEqual(current['serve'], [{'port': 443, 'path': '/', 'localPort': 5000, 'funnel': False},
                                            {'port': 8443, 'path': '/', 'localPort': 5001, 'funnel': True}])
        summary = remote_access.summary(self.app)
        self.assertEqual(summary['appUrl'], 'https://pc.tail1234.ts.net')
        self.assertEqual(summary['claudeUrl'], 'https://pc.tail1234.ts.net:8443/mcp')
        self.assertTrue(summary['appServed'] and summary['claudeFunnel'])
        self.assertFalse(summary['appPublic'])
        self.assertEqual(summary['commands']['serve'], 'tailscale serve --bg 5000')
        self.assertEqual(summary['commands']['funnel'], 'tailscale funnel --bg --https=8443 5001')

    def test_warns_when_the_app_port_is_on_the_internet(self):
        funneled = {'Web': {'pc.tail1234.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://localhost:5000'}}}},
                    'AllowFunnel': {'pc.tail1234.ts.net:443': True}}
        self.detect({'status': STATUS, 'serve status': funneled})
        summary = remote_access.summary(self.app)
        self.assertTrue(summary['appPublic'])
        self.assertFalse(summary['appServed'])

    def test_missing_or_stopped_tailscale(self):
        with patch.object(remote_access, 'cli_path', return_value=None):
            self.assertEqual(remote_access.status(refresh=True)['installed'], False)
        stopped = self.detect({'status': {**STATUS, 'BackendState': 'Stopped'}})
        self.assertEqual((stopped['installed'], stopped['running'], stopped['serve']), (True, False, []))
        broken = self.detect({})
        self.assertIn('Tailscale antwortet nicht', broken['error'])
        with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired('tailscale', 5)):
            self.assertIsNone(remote_access.run_cli('status'))

    def test_no_app_port_means_no_serve_command(self):
        self.detect({'status': STATUS, 'serve status': {}})
        summary = remote_access.summary(SimpleNamespace(config={}, extensions={}))
        self.assertIsNone(summary['commands']['serve'])
        self.assertIsNone(summary['appUrl'])

    def test_allows_this_tailnet_name_but_never_other_ts_net_hosts(self):
        self.detect({'status': STATUS, 'serve status': SERVE})
        allowed = remote_access.allowed_origins()
        self.assertIn('https://pc.tail1234.ts.net', allowed)
        self.assertIn('https://pc.tail1234.ts.net:8443', allowed)
        self.assertIn('http://localhost:3000', allowed)
        self.assertNotIn('https://other.tail1234.ts.net', allowed)

    def test_configured_addresses_for_docker(self):
        with patch.object(remote_access, 'cli_path', return_value=None):
            remote_access.status(refresh=True)
        with patch.dict(os.environ, {'TRAINHUB_REMOTE_URL': 'https://nas.tail1234.ts.net/, https://nas.tail1234.ts.net:8443',
                                     'TRAINHUB_COACH_ORIGINS': 'http://trainhub.local'}):
            allowed = remote_access.allowed_origins()
            summary = remote_access.summary(self.app)
        self.assertTrue({'https://nas.tail1234.ts.net', 'https://nas.tail1234.ts.net:8443', 'http://trainhub.local'} <= allowed)
        self.assertEqual(summary['appUrl'], 'https://nas.tail1234.ts.net')

    def test_an_unknown_host_rechecks_tailscale(self):
        with patch.object(remote_access, 'cli_path', return_value=None):
            remote_access.status(refresh=True)
        self.assertNotIn('https://pc.tail1234.ts.net', remote_access.allowed_origins())
        # Tailscale started after the app: the next request from the new name looks again (once the retry time passed).
        with patch.object(remote_access, 'RETRY_SECONDS', -1), patch.object(subprocess, 'run', side_effect=cli({'status': STATUS})):
            self.assertIn('https://pc.tail1234.ts.net', remote_access.allowed_origins('pc.tail1234.ts.net'))

    def test_proxy_targets(self):
        self.assertEqual(remote_access.port_of('http://127.0.0.1:5000'), 5000)
        self.assertEqual(remote_access.port_of('localhost:5001'), 5001)
        self.assertEqual(remote_access.port_of('5000'), 5000)
        self.assertEqual(remote_access.port_of('http://localhost'), 80)
        self.assertIsNone(remote_access.port_of('http://192.168.1.5:5000'))
        self.assertIsNone(remote_access.port_of(None))
        self.assertEqual(remote_access.serve_entries({'Web': {'broken': {'Handlers': {'/': {}}}}}), [])

    def test_public_paths(self):
        for path in ('/mcp', '/oauth/token', '/oauth/authorize', '/.well-known/oauth-protected-resource/mcp',
                     '/.well-known/oauth-authorization-server'):
            self.assertTrue(remote_access.public_path(path), path)
        for path in ('/', '/api/activities', '/mcp/x', '/mcpx', '/.well-known/other', '/oauth'):
            self.assertFalse(remote_access.public_path(path), path)


if __name__ == '__main__':
    unittest.main()
