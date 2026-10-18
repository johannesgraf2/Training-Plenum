"""Training Plēnum from other devices over Tailscale.

`tailscale serve` publishes the app inside the tailnet at https://<machine>.<tailnet>.ts.net with a certificate, so
phone and laptop reach it from anywhere while the app itself keeps listening on 127.0.0.1. Claude's apps (web,
desktop connectors, mobile) connect from Anthropic's cloud, not from the device, so they reach only what
`tailscale funnel` publishes on the internet: the separate Claude port, which serves nothing but MCP and OAuth
(mcp_server.py). Funneling the app port would put the whole app, which has no sign-in, on the internet;
the status warns about that, and every request that arrives through Funnel (tailscaled marks it with
Tailscale-Funnel-Request and strips that header from clients) is refused outside the Claude paths.

The origin guard (coach_api.py) accepts exactly this machine's tailnet address, detected with `tailscale status`,
or the addresses in TRAINHUB_REMOTE_URL (Docker, where the container has no tailscale CLI). Never all of *.ts.net:
every tailnet can publish pages under that domain.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from flask import jsonify, request
from werkzeug.wrappers import Response

LOCAL_ORIGINS = ('http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000', 'http://127.0.0.1:5000',
                 'http://localhost', 'http://127.0.0.1')
CACHE_SECONDS = 300
# A request from a host not yet allowed re-checks Tailscale at most this often (Tailscale may start after the app).
RETRY_SECONDS = 30
CLAUDE_PORT = 5001
FUNNEL_PORT = 8443  # one of the ports Funnel allows; 443 stays for the tailnet-only app

# The only paths Claude's cloud needs: the MCP endpoint and the OAuth sign-in with its discovery documents.
PUBLIC_PATHS = ('/mcp', '/oauth/', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server')

_lock = threading.Lock()
_cache = {'at': None, 'value': None}


def cli_path():
    configured = os.environ.get('TRAINHUB_TAILSCALE_CLI')
    if configured:
        return configured
    found = shutil.which('tailscale')
    if found:
        return found
    candidates = {'win32': [Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Tailscale' / 'tailscale.exe'],
                  'darwin': [Path('/Applications/Tailscale.app/Contents/MacOS/Tailscale')]}.get(sys.platform, [])
    return next((str(path) for path in candidates if path.exists()), None)


def run_cli(*arguments):
    """Output of a tailscale command as JSON, or None when it fails."""
    path = cli_path()
    if not path:
        return None
    # The Windows app has no console; without this flag every call would flash a terminal window.
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0
    try:
        result = subprocess.run([path, *arguments, '--json'], capture_output=True, text=True, timeout=5, creationflags=flags)
        return json.loads(result.stdout) if result.returncode == 0 and result.stdout.strip() else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def port_of(target):
    """The local port a serve handler proxies to: http://127.0.0.1:5000, localhost:5000 or a bare 5000."""
    if not isinstance(target, str) or not target:
        return None
    value = target if '://' in target else f'http://{target}' if not target.isdigit() else f'http://127.0.0.1:{target}'
    try:
        parsed = urlparse(value)
        if parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            return None
        return parsed.port or (443 if parsed.scheme == 'https' else 80)
    except ValueError:
        return None


def serve_entries(config):
    """Web handlers of `tailscale serve status --json` as [{port, path, localPort, funnel}]."""
    if not isinstance(config, dict):
        return []
    funnel = {key for key, value in (config.get('AllowFunnel') or {}).items() if value}
    result = []
    for host_port, web in (config.get('Web') or {}).items():
        try:
            port = int(str(host_port).rsplit(':', 1)[1])
        except (IndexError, ValueError):
            continue
        for path, handler in ((web or {}).get('Handlers') or {}).items():
            result.append({'port': port, 'path': path, 'localPort': port_of((handler or {}).get('Proxy')),
                           'funnel': host_port in funnel})
    return sorted(result, key=lambda entry: (entry['port'], entry['path']))


def detect():
    path = cli_path()
    if not path:
        return {'installed': False, 'running': False, 'dnsName': None, 'tailnet': None, 'https': False, 'serve': []}
    status = run_cli('status')
    if not isinstance(status, dict):
        return {'installed': True, 'running': False, 'dnsName': None, 'tailnet': None, 'https': False, 'serve': [],
                'error': 'Tailscale antwortet nicht. Läuft die Tailscale-App?'}
    me = status.get('Self') or {}
    name = (me.get('DNSName') or '').rstrip('.') or None
    running = status.get('BackendState') == 'Running'
    return {'installed': True, 'running': running, 'state': status.get('BackendState'), 'dnsName': name,
            'tailnet': (status.get('CurrentTailnet') or {}).get('Name'),
            'magicDns': bool((status.get('CurrentTailnet') or {}).get('MagicDNSEnabled')),
            # Serve needs HTTPS certificates; the tailnet admin turns them on once.
            'https': bool(name and name in (status.get('CertDomains') or [])),
            'serve': serve_entries(run_cli('serve', 'status')) if running else []}


def status(refresh=False, max_age=CACHE_SECONDS):
    with _lock:
        at = _cache['at']
        if refresh or at is None or time.monotonic() - at > max_age:
            _cache['value'], _cache['at'] = detect(), time.monotonic()
        return _cache['value']


def configured_urls():
    """Extra addresses from the environment: TRAINHUB_REMOTE_URL (comma separated) and the older TRAINHUB_COACH_ORIGINS."""
    values = ','.join(os.environ.get(name, '') for name in ('TRAINHUB_REMOTE_URL', 'TRAINHUB_COACH_ORIGINS'))
    return [value.strip().rstrip('/') for value in values.split(',') if value.strip()]


def tailnet_origins(current):
    name = current.get('dnsName')
    if not name:
        return []
    ports = sorted({entry['port'] for entry in current.get('serve', [])} | {443})
    return [f'https://{name}' if port == 443 else f'https://{name}:{port}' for port in ports]


def allowed_origins(host=None):
    """Origins the guarded API answers. Requests use the last detection, however old; only a host not yet allowed
    re-checks Tailscale (at most every RETRY_SECONDS), so ordinary requests never wait for the CLI."""
    with _lock:
        current = _cache['value']
    current = current if current is not None else status()
    allowed = {*LOCAL_ORIGINS, *configured_urls(), *tailnet_origins(current)}
    if host and host not in {urlparse(origin).hostname for origin in allowed}:
        with _lock:
            stale = _cache['at'] is None or time.monotonic() - _cache['at'] > RETRY_SECONDS
        if stale:
            allowed.update(tailnet_origins(status(refresh=True)))
    return allowed


def app_port(app):
    """The port that serves page and API together (Windows app: 5000, Docker: nginx on 80), if known."""
    value = app.config.get('TRAINHUB_APP_PORT') or os.environ.get('TRAINHUB_APP_PORT')
    try:
        return int(value) if value else None
    except ValueError:
        return None


def claude_port():
    """The port for Tailscale Funnel with only MCP and OAuth on it; TRAINHUB_CLAUDE_PORT=0 turns it off."""
    try:
        return int(os.environ.get('TRAINHUB_CLAUDE_PORT', CLAUDE_PORT))
    except ValueError:
        return CLAUDE_PORT


def summary(app, refresh=False):
    """What the dialog shows: Tailscale's state, which ports are published and the commands to publish them."""
    current = status(refresh=refresh)
    port, claude = app_port(app), claude_port()
    entries = current.get('serve', [])
    name = current.get('dnsName')
    remote = next((url for url in configured_urls() if url.startswith('https://')), None)
    served = next((e for e in entries if e['localPort'] == port and e['path'] == '/' and not e['funnel']), None) if port else None
    funnel = next((e for e in entries if e['localPort'] == claude and e['funnel']), None)
    return {
        'tailscale': {key: current.get(key) for key in ('installed', 'running', 'state', 'dnsName', 'tailnet', 'magicDns', 'https', 'error')},
        'appPort': port, 'claudePort': claude or None, 'claudePortRunning': bool(app.extensions.get('claude_port')),
        'funnelPort': FUNNEL_PORT,
        'appUrl': (f'https://{name}' + ('' if served['port'] == 443 else f':{served["port"]}')) if served and name else remote,
        'appServed': bool(served),
        'claudeUrl': f'https://{name}' + ('' if funnel['port'] == 443 else f':{funnel["port"]}') + '/mcp' if funnel and name else None,
        'claudeFunnel': bool(funnel),
        # Funnel on the app port would put every page on the internet; the guard below still blocks the API there.
        'appPublic': any(e['funnel'] and e['localPort'] is not None and e['localPort'] != claude for e in entries),
        'commands': {'serve': f'tailscale serve --bg {port}' if port else None,
                     'funnel': f'tailscale funnel --bg --https={FUNNEL_PORT} {claude}',
                     'serveOff': 'tailscale serve --https=443 off', 'funnelOff': f'tailscale funnel --https={FUNNEL_PORT} off'},
    }


def public_path(path):
    return path == '/mcp' or path.startswith(PUBLIC_PATHS[1:])


def claude_only(app):
    """The app as the Claude port serves it: MCP and OAuth only, everything else is not there."""
    def application(environ, start_response):
        if not public_path(environ.get('PATH_INFO', '')):
            response = Response(json.dumps({'error': 'Hier ist nur der Claude-Zugang (MCP) erreichbar.'}), 404,
                                content_type='application/json')
            return response(environ, start_response)
        return app(environ, start_response)
    return application


def start_claude_port(app):
    """Serve the Claude paths on their own port, by default 127.0.0.1:5001. A taken port only logs a warning:
    the app works without it, only Claude's hosted apps cannot connect then."""
    from werkzeug.serving import make_server
    port = claude_port()
    if not port:
        return None
    try:
        server = make_server(os.environ.get('TRAINHUB_CLAUDE_HOST', '127.0.0.1'), port, claude_only(app), threaded=True)
    except OSError as error:
        app.logger.warning('Claude port %s unavailable: %s', port, error)
        return None
    threading.Thread(target=server.serve_forever, name='claude-port', daemon=True).start()
    app.extensions['claude_port'] = server
    return server


def register_remote_access(app):
    @app.before_request
    def funnel_only_claude():
        if request.headers.get('Tailscale-Funnel-Request') and not public_path(request.path):
            return jsonify(error='Über Tailscale Funnel ist nur der Claude-Zugang erreichbar.'), 403
        return None

    @app.route('/api/remote-access', methods=['GET'])
    def remote_access_status():
        return jsonify(summary(app, refresh=request.args.get('refresh') == '1'))
