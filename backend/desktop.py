"""Training Plēnum as a Windows app: one process serves the built frontend and the API on 127.0.0.1:5000 and shows
them in its own window (WebView2, the Edge engine built into Windows). 127.0.0.1:5001 answers only Claude's MCP and
OAuth requests, for Tailscale Funnel (remote_access.py, mcp_server.py).

The data lives in %LOCALAPPDATA%\\Training Plenum (database, uploads, AI key file, window storage), not next to the
program, so updates and uninstalling keep it. TRAINHUB_HOME moves it elsewhere.

    python desktop.py               # window
    python desktop.py --browser     # default browser instead of the window, until Ctrl+C
    python desktop.py --smoke-test  # starts the server, checks API and page, exits (for the build)
"""
import json
import os
import sys
import threading
import traceback
import urllib.request
import webbrowser
from pathlib import Path

HOST = '127.0.0.1'
# Fixed, so the window keeps its origin: remembered Garmin folder and settings in the browser storage stay valid.
# The frontend is built against this address (REACT_APP_API_URL), and the coach accepts it as an origin.
PORT = 5000
URL = f'http://{HOST}:{PORT}'
TITLE = 'Training Plēnum'
WEBVIEW2_DOWNLOAD = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'


def bundle_dir():
    """Where the program files are: the PyInstaller folder, or the repository when run from source."""
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))


def frontend_dir():
    root = bundle_dir()
    return root / 'frontend' if hasattr(sys, '_MEIPASS') else root / 'frontend' / 'build'


def home_dir():
    if os.environ.get('TRAINHUB_HOME'):
        return Path(os.environ['TRAINHUB_HOME'])
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local' / 'share') / 'Training Plenum'


def log_to_file(home):
    """A windowed program has no console; its output goes to a log file in the data folder, fresh on every start."""
    if sys.stdout is None or sys.stderr is None:
        home.mkdir(parents=True, exist_ok=True)
        log = open(home / 'training-plenum.log', 'w', encoding='utf-8', buffering=1)
        sys.stdout, sys.stderr = sys.stdout or log, sys.stderr or log


def configure(home):
    """Point database, uploads and the AI key file into the data folder; settings from the environment win."""
    (home / 'data').mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('DATABASE_URL', 'sqlite:///' + (home / 'data' / 'trainhub.db').as_posix())
    os.environ.setdefault('UPLOAD_FOLDER', str(home / 'uploads'))
    os.environ.setdefault('TRAINHUB_AI_ENCRYPTION_KEY_FILE', str(home / 'data' / 'ai-encryption-key.txt'))


def add_frontend(app, root):
    """Serve the React build next to the API: files as they are, every other page path as index.html."""
    from flask import abort, send_from_directory
    app.static_folder = str(root / 'static')  # CRA puts its scripts and styles under /static

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def frontend(path):
        if path == 'api' or path.startswith('api/'):
            abort(404)
        if path and (root / path).is_file():
            return send_from_directory(root, path)
        response = send_from_directory(root, 'index.html')
        response.headers['Cache-Control'] = 'no-cache'  # a new version's scripts load right after an update
        return response


def running():
    """Whether Training Plēnum already answers on the port (a second start then only opens a window)."""
    try:
        with urllib.request.urlopen(f'{URL}/api/health', timeout=2) as response:
            return json.load(response).get('status') == 'ok'
    except (OSError, ValueError):
        return False


def start_server():
    from werkzeug.serving import make_server
    import app as backend
    from remote_access import start_claude_port
    add_frontend(backend.app, frontend_dir())
    # Page and API on one port: `tailscale serve --bg 5000` makes both reachable in the tailnet (remote_access.py).
    backend.app.config['TRAINHUB_APP_PORT'] = PORT
    backend.initialize_database()
    server = make_server(HOST, PORT, backend.app, threaded=True)  # raises OSError while the port is taken
    threading.Thread(target=server.serve_forever, name='http', daemon=True).start()
    start_claude_port(backend.app)
    backend.start_whoop_worker(backend.app)
    backend.start_garmin_worker(backend.app)
    return server


def message(text):
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, TITLE, 0x10)
    else:
        print(text, file=sys.stderr)


def smoke_test():
    server = start_server()
    try:
        with urllib.request.urlopen(f'{URL}/api/health', timeout=10) as response:
            health = json.load(response)
        with urllib.request.urlopen(f'{URL}/', timeout=10) as response:
            page = response.read().decode('utf-8')
        if health.get('status') != 'ok' or 'id="root"' not in page:
            raise SystemExit(f'Smoke test failed: {health}, page without root element')
        print(f'Smoke test ok: API {health.get("version")}, page {len(page)} bytes, data in {home_dir()}')
    finally:
        server.shutdown()


def show_window(home):
    import webview
    webview.settings['ALLOW_DOWNLOADS'] = True  # FIT and ZIP exports
    webview.create_window(TITLE, URL, width=1400, height=900, min_size=(900, 600), text_select=True)
    # Not private: keeps settings and the remembered Garmin folder between starts.
    webview.start(gui='edgechromium' if sys.platform == 'win32' else None, private_mode=False,
                  storage_path=str(home / 'webview'))


def main(arguments):
    home = home_dir()
    log_to_file(home)
    configure(home)
    if '--smoke-test' in arguments:
        try:
            return smoke_test()
        except Exception:  # into the log, not the error dialog of the windowed program, which would block the build
            traceback.print_exc()
            return 1
    server = None
    if not running():
        try:
            server = start_server()
        except OSError:
            message(f'Port {PORT} ist von einem anderen Programm belegt. Bitte dieses Programm beenden und '
                    f'{TITLE} erneut starten.')
            return 1
    if '--browser' in arguments:
        webbrowser.open(URL)
        print(f'{TITLE}: {URL} (beenden mit Strg+C)')
        threading.Event().wait()
    try:
        show_window(home)
    except Exception as error:  # e.g. WebView2 missing; the window library raises its own types
        message(f'Das App-Fenster konnte nicht geöffnet werden ({error}). Meist fehlt die Microsoft Edge '
                f'WebView2-Runtime: {WEBVIEW2_DOWNLOAD}')
        return 1
    finally:
        if server:
            server.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
