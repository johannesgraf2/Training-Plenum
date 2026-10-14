"""Headless WHOOP 4.0 bridge for Training Plenum.

Runs on the Mac host (Docker on macOS has no Bluetooth). It holds the strap
connection, stores every history chunk in a local SQLite outbox and only then
acknowledges it to the strap, and ships the raw frames to Training Plenum, which
decodes them. No UI: setup, status and all views live in Training Plenum.

    bridge.py setup <URL> <TOKEN>   write the config, test TP, trigger the Bluetooth prompt
    bridge.py run                   the service (launchd starts this)
    bridge.py status                last known state, read locally
    bridge.py scan                  list nearby WHOOP straps
"""
import argparse
import asyncio
import base64
import gzip
import hashlib
import json
import logging
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

try:
    import whoop_protocol as wp
except ImportError:  # Running from the repository instead of the installed copy.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
    import whoop_protocol as wp

VERSION = '1.0.0'
HOME = Path(os.environ.get('TRAININGPLENUM_WHOOP_HOME', Path.home() / '.trainingplenum-whoop'))
LAUNCH_AGENT = 'com.trainingplenum.whoop-bridge'
BATCH_FRAMES = 2000
HEARTBEAT_SECONDS = 30
REALTIME_FLUSH_SECONDS = 30
STORED_TYPES = {wp.HISTORY, wp.EVENT, wp.METADATA, wp.REALTIME_HR}

log = logging.getLogger('whoop-bridge')


# ─── Local state ───

class Outbox:
    """Frames waiting for Training Plenum. A row is deleted only after TP answered 2xx."""

    def __init__(self, path):
        self.path = str(path)
        with self.connect() as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('CREATE TABLE IF NOT EXISTS frames (id INTEGER PRIMARY KEY AUTOINCREMENT, '
                               'source TEXT NOT NULL, received_at REAL NOT NULL, data BLOB NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.execute('PRAGMA synchronous=FULL')
        return connection

    def add(self, rows):
        """Store (source, received_at, bytes) rows in one durable transaction."""
        connection = self.connect()
        try:
            with connection:
                connection.executemany('INSERT INTO frames (source, received_at, data) VALUES (?, ?, ?)',
                                       [(source, received, bytes(data)) for source, received, data in rows])
        finally:
            connection.close()

    def batch(self, limit=BATCH_FRAMES):
        with self.connect() as connection:
            return connection.execute('SELECT id, source, received_at, data FROM frames ORDER BY id LIMIT ?', (limit,)).fetchall()

    def delete_through(self, last_id):
        connection = self.connect()
        try:
            with connection:
                connection.execute('DELETE FROM frames WHERE id <= ?', (last_id,))
        finally:
            connection.close()

    def count(self):
        with self.connect() as connection:
            return connection.execute('SELECT COUNT(*) FROM frames').fetchone()[0]

    def install_id(self):
        connection = self.connect()
        try:
            with connection:
                row = connection.execute("SELECT value FROM meta WHERE key = 'install'").fetchone()
                if row:
                    return row[0]
                value = uuid.uuid4().hex[:12]
                connection.execute("INSERT INTO meta (key, value) VALUES ('install', ?)", (value,))
                return value
        finally:
            connection.close()


class Status:
    """What the heartbeat reports to TP; also written to status.json for `bridge.py status`."""

    def __init__(self, path=None):
        self.lock = threading.Lock()
        self.path = path
        self.values = {'bridgeVersion': VERSION, 'strapConnected': False}

    def update(self, **values):
        with self.lock:
            self.values.update(values)
            snapshot = dict(self.values)
        self.write(snapshot)

    def live(self, **values):
        """Fast-changing values (realtime HR): reported, but not rewritten to disk every second."""
        with self.lock:
            self.values.update(values)

    def write(self, snapshot):
        if self.path:
            try:
                temporary = Path(self.path).with_suffix('.tmp')
                temporary.write_text(json.dumps(snapshot, indent=2))
                temporary.replace(self.path)
            except OSError:
                pass

    def snapshot(self):
        with self.lock:
            return dict(self.values)


def now_iso(seconds=None):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() if seconds is None else seconds))


# ─── Strap protocol ───

class StrapSession:
    """One Bluetooth connection: handshake once, then any number of history offloads.

    `write` is an async callable that writes one command frame with response.
    Notifications from 0003/0004/0005 go to on_data, 2A37 to on_heart_rate.
    """

    def __init__(self, write, outbox, status, response_timeout=3.0, watchdog=60.0, settle=1.5, clock_tolerance=5):
        self.write = write
        self.outbox = outbox
        self.status = status
        self.response_timeout = response_timeout
        self.watchdog = watchdog
        self.settle = settle
        self.clock_tolerance = clock_tolerance
        self.reassembler = wp.Reassembler()
        self.seq = 0
        self.pending = {}
        self.chunk = []
        self.realtime = []
        self.commits = []
        self.commit_lock = asyncio.Lock()
        self.offload_done = None
        self.last_activity = 0.0
        self.handshaken = False
        self.lost = asyncio.Event()
        self.failed = False
        self.records = 0
        self.chunks = 0

    def loop_time(self):
        return asyncio.get_running_loop().time()

    async def send(self, cmd, body=b'\x00'):
        seq = self.seq
        self.seq = (self.seq + 1) & 0xFF
        await self.write(wp.build_command(cmd, seq, body))
        return seq

    async def request(self, cmd, body=b'\x00'):
        """Send a command and wait for its final reply, matched on (command, request seq)."""
        key = (cmd, self.seq)
        future = asyncio.get_running_loop().create_future()
        self.pending[key] = future
        try:
            await self.send(cmd, body)
            return await asyncio.wait_for(future, self.response_timeout)
        except asyncio.TimeoutError:
            log.info('Keine Antwort auf Kommando %s', cmd)
            return None
        finally:
            self.pending.pop(key, None)

    # Notifications

    def on_data(self, data):
        for frame in self.reassembler.feed(data):
            self.on_frame(frame)

    def on_heart_rate(self, value):
        measurement = wp.parse_heart_rate_measurement(value)
        if measurement is None:
            return
        self.realtime.append(('hrm', time.time(), bytes(value)))
        if measurement['hr']:
            self.status.live(realtimeHr={'bpm': measurement['hr'], 'at': now_iso()})

    def on_frame(self, frame):
        if frame.type == wp.RESPONSE:
            response = wp.parse_response(frame)
            future = response and self.pending.get((response['cmd'], response['requestSeq']))
            if future and not future.done() and response['result'] != 'pending':
                future.set_result(response)
            return
        if frame.type in (wp.HISTORY, wp.EVENT, wp.METADATA, wp.CONSOLE):
            self.last_activity = self.loop_time()
        if frame.type == wp.HISTORY:
            self.chunk.append(frame.raw)
        elif frame.type == wp.METADATA and frame.cmd == wp.HISTORY_END:
            frames, self.chunk = self.chunk + [frame.raw], []
            self.commits.append(asyncio.ensure_future(self.finish_chunk(frame, frames)))
        elif frame.type == wp.METADATA and frame.cmd == wp.HISTORY_COMPLETE:
            if self.offload_done:
                self.offload_done.set()
        elif frame.type in STORED_TYPES:
            self.realtime.append(('whoop', time.time(), frame.raw))
            event = wp.parse_event(frame)
            if event and 'battery' in event:
                self.status.update(battery={**event['battery'], 'source': 'event', 'at': now_iso()})
            elif event and event['event'] == wp.EVENT_RTC_LOST:
                self.status.update(clockOk=False, lastError='Der Strap meldet eine verlorene Uhrzeit (RTC_LOST).')

    async def finish_chunk(self, end, frames):
        """Commit the chunk to the outbox, then acknowledge it. Any failure: no ACK, abort."""
        async with self.commit_lock:
            try:
                token = wp.history_end_token(end)
                received = time.time()
                await asyncio.to_thread(self.outbox.add, [('whoop', received, raw) for raw in frames])
            except Exception as error:  # noqa: BLE001 - anything here must stop the trim
                log.error('Chunk konnte nicht gespeichert werden, kein ACK: %s', error)
                self.status.update(lastError=f'Chunk nicht gespeichert: {error}')
                self.failed = True
                await self.send(wp.ABORT_HISTORY)
                if self.offload_done:
                    self.offload_done.set()
                return
            log.debug('END %s', end.raw.hex())
            await self.send(wp.HISTORY_RESULT, wp.ack_history_body(token))
            self.records += sum(1 for raw in frames if raw[4] == wp.HISTORY)
            self.chunks += 1

    def on_disconnect(self):
        self.lost.set()
        for future in self.pending.values():
            if not future.done():
                future.set_result(None)
        if self.offload_done:
            self.offload_done.set()

    def take_realtime(self):
        """Called on the event loop, which is also where notifications append."""
        rows, self.realtime = self.realtime, []
        return rows

    # Commands

    async def handshake(self):
        if self.handshaken:
            raise RuntimeError('Der Verbindungsaufbau läuft nur einmal pro Verbindung.')
        self.handshaken = True
        battery = await self.request(wp.GET_BATTERY)  # The first confirmed write bonds the strap.
        if battery and battery['result'] == 'ok' and wp.battery_from_response(battery['body']) is not None:
            self.status.update(battery={'percent': wp.battery_from_response(battery['body']), 'source': 'command', 'at': now_iso()})
        hello = await self.request(wp.GET_HELLO)
        serial = hello and wp.serial_from_hello(hello['body'])
        if serial:
            self.status.update(serialHash=hashlib.sha256(serial.encode()).hexdigest()[:12])
        version = await self.request(wp.REPORT_VERSION)
        firmware = version and wp.firmware_from_response(version['body'])
        if firmware:
            self.status.update(firmware=firmware)
        await self.sync_clock()
        await self.request(wp.REALTIME_RAW_STREAM, b'\x00')  # Raw optical/IMU stream off.
        await self.request(wp.GET_DATA_RANGE)  # Diagnostics only.
        await asyncio.sleep(self.settle)

    async def sync_clock(self):
        """Set the strap clock and read it back; firmware accepts either the 8- or 9-byte form."""
        for padding in (4, 5):
            await self.request(wp.SET_CLOCK, wp.set_clock_body(time.time(), padding))
            reply = await self.request(wp.GET_CLOCK, b'')
            clock = reply and wp.clock_from_response(reply['body'])
            if clock and abs(clock - time.time()) <= self.clock_tolerance:
                self.status.update(clockOk=True, clockOffset=round(clock - time.time()))
                return True
        self.status.update(clockOk=False)
        log.warning('Uhrzeit des Straps konnte nicht bestätigt werden.')
        return False

    async def offload(self):
        """Pull history until COMPLETE, an error, or 60 s without history traffic."""
        self.offload_done = asyncio.Event()
        self.records = self.chunks = 0
        self.failed = False
        self.last_activity = self.loop_time()
        await self.request(wp.SEND_HISTORY)  # The reply only means "accepted".
        aborted = False
        while not self.offload_done.is_set() and not self.lost.is_set():
            remaining = self.watchdog - (self.loop_time() - self.last_activity)
            if remaining <= 0:
                log.warning('Watchdog: %s s ohne Verlaufsdaten, Abbruch ohne Trim.', self.watchdog)
                await self.send(wp.ABORT_HISTORY)
                aborted = True
                break
            try:
                await asyncio.wait_for(self.offload_done.wait(), remaining)
            except asyncio.TimeoutError:
                pass
        commits, self.commits = self.commits, []
        await asyncio.gather(*commits, return_exceptions=True)
        self.chunk = []  # Not acknowledged; the strap replays it next time.
        aborted = aborted or self.failed or self.lost.is_set()
        result = {'records': self.records, 'chunks': self.chunks, 'aborted': aborted, 'finishedAt': now_iso()}
        self.status.update(lastOffload=result, **({} if aborted else {'lastSyncAt': result['finishedAt']}))
        log.info('Offload: %s Datensätze in %s Chunks%s', self.records, self.chunks, ' (abgebrochen)' if aborted else '')
        return result


# ─── Training Plenum ───

class TPError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class TPClient:
    def __init__(self, url, token, timeout=60):
        self.url = url.rstrip('/')
        self.token = token
        self.timeout = timeout

    def post(self, path, payload, compress=False):
        body = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {self.token}'}
        if compress:
            body = gzip.compress(body, mtime=0)
            headers['Content-Encoding'] = 'gzip'
        request = urllib.request.Request(self.url + path, data=body, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read()).get('error') or error.reason
            except (ValueError, AttributeError):
                message = error.reason
            raise TPError(f'HTTP {error.code}: {message}', error.code) from error
        except (urllib.error.URLError, OSError) as error:
            raise TPError(f'Training Plenum nicht erreichbar: {getattr(error, "reason", error)}') from error


def upload_payload(install_id, rows):
    frames = [[source, round(received, 3), base64.b64encode(data).decode()] for _, source, received, data in rows]
    digest = hashlib.sha256(json.dumps(frames, separators=(',', ':')).encode()).hexdigest()[:12]
    return {'batchId': f'{install_id}-{rows[0][0]}-{rows[-1][0]}-{digest}', 'bridgeVersion': VERSION, 'frames': frames}


def upload_once(outbox, client, install_id, limit=BATCH_FRAMES):
    """Ship the oldest frames. Returns how many were confirmed; raises TPError and keeps them."""
    rows = outbox.batch(limit)
    if not rows:
        return 0
    client.post('/api/whoop/bridge/frames', upload_payload(install_id, rows), compress=True)
    outbox.delete_through(rows[-1][0])
    return len(rows)


async def uploader(outbox, client, status, wake):
    install_id = await asyncio.to_thread(outbox.install_id)
    delay = 10
    while True:
        try:
            sent = await asyncio.to_thread(upload_once, outbox, client, install_id)
            if sent:
                status.update(lastUploadAt=now_iso(), uploadError=None)
                delay = 10
                continue
        except TPError as error:
            log.warning('Upload fehlgeschlagen: %s', error)
            status.update(uploadError=str(error))
            delay = min(delay * 2, 300)
        wake.clear()
        try:
            await asyncio.wait_for(wake.wait(), delay)
        except asyncio.TimeoutError:
            pass


async def heartbeat(outbox, client, status, sync_requested):
    while True:
        try:
            body = {**status.snapshot(), 'outboxFrames': await asyncio.to_thread(outbox.count)}
            reply = await asyncio.to_thread(client.post, '/api/whoop/bridge/heartbeat', body)
            if reply.get('syncRequested'):
                log.info('Training Plenum fordert einen Sync an.')
                sync_requested.set()
        except TPError as error:
            log.warning('Heartbeat fehlgeschlagen: %s', error)
        await asyncio.sleep(HEARTBEAT_SECONDS)


# ─── Bluetooth ───

def is_whoop(device, advertisement):
    uuids = [value.lower() for value in (advertisement.service_uuids or [])]
    name = advertisement.local_name or device.name or ''
    return wp.SERVICE_UUID in uuids or name.upper().startswith('WHOOP')


async def find_strap(config, timeout=20):
    from bleak import BleakScanner
    if config.get('device'):
        device = await BleakScanner.find_device_by_address(config['device'], timeout=timeout)
        if device:
            return device
    return await BleakScanner.find_device_by_filter(is_whoop, timeout=timeout)


async def wait_any(events, timeout):
    waiters = [asyncio.ensure_future(event.wait()) for event in events]
    try:
        await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for waiter in waiters:
            waiter.cancel()


async def connected_session(client, session, sync_requested, wake_upload, sync_minutes, realtime_hr):
    for characteristic in (wp.RESPONSE_UUID, wp.EVENT_UUID, wp.DATA_UUID):
        await client.start_notify(characteristic, lambda _, data: session.on_data(data))
    if realtime_hr:
        try:
            await client.start_notify(wp.HEART_RATE_UUID, lambda _, data: session.on_heart_rate(data))
        except Exception as error:  # noqa: BLE001 - optional characteristic
            log.info('Herzfrequenz-Profil nicht verfügbar: %s', error)

    async def flush_periodically():
        while True:
            await asyncio.sleep(REALTIME_FLUSH_SECONDS)
            rows = session.take_realtime()
            if rows:
                await asyncio.to_thread(session.outbox.add, rows)

    flusher = asyncio.ensure_future(flush_periodically())
    try:
        await session.handshake()
        while not session.lost.is_set():
            await session.offload()
            wake_upload.set()
            sync_requested.clear()
            await wait_any((sync_requested, session.lost), sync_minutes * 60)
    finally:
        flusher.cancel()
        rows = session.take_realtime()
        if rows:
            session.outbox.add(rows)
        session.reassembler.reset()


async def bluetooth(config, outbox, status, sync_requested, wake_upload):
    from bleak import BleakClient
    delay = 15
    while True:
        try:
            device = await find_strap(config)
            if device is None:
                status.update(strapConnected=False, strapError='Kein WHOOP-Strap in Reichweite.')
            else:
                holder = {}
                loop = asyncio.get_running_loop()

                def on_lost(_client):
                    if 'session' in holder:
                        loop.call_soon_threadsafe(holder['session'].on_disconnect)

                async with BleakClient(device, disconnected_callback=on_lost) as client:
                    async def write(frame):
                        await client.write_gatt_char(wp.COMMAND_UUID, frame, response=True)

                    holder['session'] = session = StrapSession(write, outbox, status)
                    log.info('Verbunden mit %s', device.name or device.address)
                    status.update(strapConnected=True, strapName=device.name, strapError=None, connectedAt=now_iso())
                    if config.get('device') != device.address:
                        config['device'] = device.address
                        save_config(config)
                    delay = 15
                    await connected_session(client, session, sync_requested, wake_upload,
                                            config.get('syncMinutes', 15), config.get('realtimeHr', True))
        except Exception as error:  # noqa: BLE001 - the service keeps reconnecting
            log.warning('Bluetooth: %s', error)
            status.update(strapError=str(error))
            delay = min(delay * 2, 300)
        status.update(strapConnected=False)
        await asyncio.sleep(delay)


# ─── Commands ───

def config_path():
    return HOME / 'config.json'


def load_config():
    try:
        return json.loads(config_path().read_text())
    except FileNotFoundError:
        sys.exit(f'Keine Konfiguration unter {config_path()}. Zuerst: bridge.py setup <URL> <TOKEN>')


def save_config(config):
    HOME.mkdir(parents=True, exist_ok=True)
    path = config_path()
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(config, indent=2))
    os.chmod(temporary, 0o600)
    temporary.replace(path)


async def run():
    config = load_config()
    outbox = Outbox(HOME / 'outbox.db')
    status = Status(HOME / 'status.json')
    client = TPClient(config['url'], config['token'])
    sync_requested, wake_upload = asyncio.Event(), asyncio.Event()
    log.info('WHOOP-Bridge %s, Ziel %s, %s Frames im Puffer', VERSION, config['url'], outbox.count())
    await asyncio.gather(bluetooth(config, outbox, status, sync_requested, wake_upload),
                         uploader(outbox, client, status, wake_upload),
                         heartbeat(outbox, client, status, sync_requested))


async def scan(timeout=10):
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    return [(device, advertisement) for device, advertisement in found.values() if is_whoop(device, advertisement)]


def setup(url, token):
    if not url.startswith(('http://', 'https://')):
        sys.exit('Die URL muss mit http:// oder https:// beginnen, z. B. http://localhost:5000')
    previous = {}
    if config_path().exists():
        previous = json.loads(config_path().read_text())
    config = {**previous, 'url': url.rstrip('/'), 'token': token}
    try:
        TPClient(url, token, timeout=10).post('/api/whoop/bridge/heartbeat', {'bridgeVersion': VERSION, 'strapConnected': False})
        print('✓ Training Plenum erreicht, Token gültig.')
    except TPError as error:
        sys.exit(f'✗ {error}\nKonfiguration nicht gespeichert.')
    save_config(config)
    print(f'✓ Konfiguration gespeichert: {config_path()}')
    print('Suche WHOOP-Strap (macOS fragt beim ersten Mal nach der Bluetooth-Berechtigung) …')
    try:
        straps = asyncio.run(scan())
    except Exception as error:  # noqa: BLE001
        straps = []
        print(f'✗ Bluetooth-Suche fehlgeschlagen: {error}')
    for device, advertisement in straps:
        print(f'✓ Gefunden: {advertisement.local_name or device.name} ({device.address}), Signal {advertisement.rssi} dBm')
    if not straps:
        print('Kein Strap gefunden. Strap tragen, laden und von der WHOOP-App trennen; die Bridge sucht später weiter.')
    restart_agent()


def restart_agent():
    plist = Path.home() / 'Library' / 'LaunchAgents' / f'{LAUNCH_AGENT}.plist'
    if sys.platform != 'darwin' or not plist.exists():
        print('Dienst starten: bridge.py run')
        return
    domain = f'gui/{os.getuid()}'
    subprocess.run(['launchctl', 'bootout', f'{domain}/{LAUNCH_AGENT}'], capture_output=True)
    started = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
    if started.returncode == 0:
        print(f'✓ Hintergrunddienst gestartet. Log: {HOME / "bridge.log"}')
    else:
        print(f'✗ launchctl: {started.stderr.strip()}')


def main(argv=None):
    parser = argparse.ArgumentParser(description='WHOOP-4.0-Bridge für Training Plenum')
    commands = parser.add_subparsers(dest='command', required=True)
    configure = commands.add_parser('setup', help='TP-Adresse und Token speichern')
    configure.add_argument('url')
    configure.add_argument('token')
    commands.add_parser('run', help='Dienst starten')
    commands.add_parser('status', help='Letzten Zustand anzeigen')
    commands.add_parser('scan', help='WHOOP-Straps in der Nähe suchen')
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    HOME.mkdir(parents=True, exist_ok=True)
    if args.command == 'setup':
        setup(args.url, args.token)
    elif args.command == 'run':
        asyncio.run(run())
    elif args.command == 'status':
        path = HOME / 'status.json'
        print(path.read_text() if path.exists() else 'Noch kein Status; läuft der Dienst?')
        print(f'Frames im Puffer: {Outbox(HOME / "outbox.db").count()}')
    elif args.command == 'scan':
        for device, advertisement in asyncio.run(scan()):
            print(f'{advertisement.local_name or device.name}\t{device.address}\t{advertisement.rssi} dBm')


if __name__ == '__main__':
    main()
