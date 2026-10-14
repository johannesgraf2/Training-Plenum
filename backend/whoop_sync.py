"""WHOOP 4.0 ingestion: the Mac bridge ships raw frames, this module decodes and stores them.

The bridge authenticates with a bearer token (only its SHA-256 is stored). Each
upload is kept gzipped in whoop_raw_batch for WHOOP_RAW_RETENTION_DAYS so a decoder
fix can be replayed over it, and is idempotent on batchId plus content hash.
Decoded samples go into one gzip JSON chunk per user and UTC hour (whoop_hour):
history samples (ts, HR, gravity, skin contact, raw skin temperature and
respiration), R-R intervals as (ts, arrival order, ms) and realtime HR. Gravity
is kept instead of a derived motion value so chunks can merge in any order;
motion is the gravity change between consecutive samples. A chunk's updated_at
tells later analytics which days need recomputing.
"""
import base64
import binascii
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import zlib
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

import whoop_protocol as wp

MAX_DECODED = 8 * 1024 * 1024
MAX_FRAMES = 20000
ONLINE_SECONDS = 180
EARLIEST = 1577836800  # 2020-01-01: older timestamps come from a strap that lost its clock.
BRIDGE_FIELDS = ('bridgeVersion', 'strapConnected', 'strapName', 'strapError', 'connectedAt', 'battery', 'firmware',
                 'serialHash', 'clockOk', 'clockOffset', 'lastSyncAt', 'lastOffload', 'lastError', 'uploadError',
                 'lastUploadAt', 'realtimeHr', 'outboxFrames')
BATCH_ID = re.compile(r'^[A-Za-z0-9._-]{1,120}$')


class WhoopError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def utc(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z') if value else None


def from_unix(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).replace(tzinfo=None)


def retention_days():
    try:
        return max(1, int(os.environ.get('WHOOP_RAW_RETENTION_DAYS', '30')))
    except ValueError:
        return 30


# ─── Decoding and merging (pure) ───

def decode_frames(frames, now=None):
    """Turn uploaded [source, receivedAt, base64] items into history records and realtime HR."""
    now = time.time() if now is None else now
    if not isinstance(frames, list) or len(frames) > MAX_FRAMES:
        raise WhoopError(f'frames muss eine Liste mit höchstens {MAX_FRAMES} Einträgen sein.')
    records, realtime = [], []
    counts = {'frames': len(frames), 'invalid': 0, 'undecoded': 0, 'badTime': 0, 'events': 0, 'versions': {},
              'undecodedVersions': set()}
    for item in frames:
        if not (isinstance(item, list) and len(item) == 3 and item[0] in ('whoop', 'hrm')
                and isinstance(item[1], (int, float)) and isinstance(item[2], str)):
            raise WhoopError('Ungültiger Frame-Eintrag.')
        source, received, encoded = item
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise WhoopError('Frame ist kein gültiges Base64.') from None
        if source == 'hrm':
            measurement = wp.parse_heart_rate_measurement(raw)
            if measurement and measurement['hr'] and EARLIEST <= received <= now + 86400:
                realtime.append((int(received), measurement['hr']))
            elif not measurement:
                counts['invalid'] += 1
            continue
        try:
            frame = wp.parse_frame(raw)
        except wp.ProtocolError:
            counts['invalid'] += 1
            continue
        if frame.type == wp.HISTORY:
            record = wp.decode_history(frame)
            version = str(record['version'])
            counts['versions'][version] = counts['versions'].get(version, 0) + 1
            if record.get('undecoded'):
                counts['undecoded'] += 1
                counts['undecodedVersions'].add(version)
            elif not EARLIEST <= record['ts'] <= now + 86400:
                counts['badTime'] += 1
            else:
                records.append(record)
        elif frame.type == wp.REALTIME_HR:
            sample = wp.decode_realtime(frame)
            if sample and sample['hr'] and EARLIEST <= sample['ts'] <= now + 86400:
                realtime.append((sample['ts'], sample['hr']))
        elif frame.type == wp.EVENT:
            counts['events'] += 1
    return records, realtime, counts


def empty_hour():
    return {'samples': {}, 'rr': {}, 'rt': {}}


def unpack_hour(blob):
    if not blob:
        return empty_hour()
    data = json.loads(gzip.decompress(blob))
    samples = {}
    for index, ts in enumerate(data['ts']):
        gravity = data['grav'][index]
        samples[ts] = [data['hr'][index], *(gravity or (None, None, None)), data['contact'][index],
                       data['skin'][index], data['resp'][index]]
    return {'samples': samples, 'rr': {(ts, order): ms for ts, order, ms in data['rr']}, 'rt': dict(data['rt'])}


def pack_hour(hour):
    ordered = sorted(hour['samples'].items())
    data = {'v': 1, 'ts': [ts for ts, _ in ordered], 'hr': [sample[0] for _, sample in ordered],
            'grav': [None if sample[1] is None else sample[1:4] for _, sample in ordered],
            'contact': [sample[4] for _, sample in ordered], 'skin': [sample[5] for _, sample in ordered],
            'resp': [sample[6] for _, sample in ordered],
            'rr': [[ts, order, ms] for (ts, order), ms in sorted(hour['rr'].items())],
            'rt': sorted([ts, hr] for ts, hr in hour['rt'].items())}
    return gzip.compress(json.dumps(data, separators=(',', ':')).encode(), mtime=0)


def hour_view(blob):
    """Columns of one stored hour for analytics: gravity in g, R-R as (ts, order, ms)."""
    hour = unpack_hour(blob)
    ordered = sorted(hour['samples'].items())
    return {'ts': [ts for ts, _ in ordered], 'hr': [sample[0] for _, sample in ordered],
            'gravity': [None if sample[1] is None else tuple(value / 10000 for value in sample[1:4]) for _, sample in ordered],
            'contact': [sample[4] for _, sample in ordered], 'skinRaw': [sample[5] for _, sample in ordered],
            'respRaw': [sample[6] for _, sample in ordered],
            'rr': [(ts, order, ms) for (ts, order), ms in sorted(hour['rr'].items())],
            'realtime': sorted(hour['rt'].items())}


def merge_records(hour, records, realtime, replace=False):
    """Add records to one hour. Duplicates (same ts) are skipped, or overwritten when replacing."""
    added = 0
    for record in records:
        ts = record['ts']
        if ts in hour['samples'] and not replace:
            continue
        added += ts not in hour['samples']
        gravity = tuple(round(value * 10000) for value in record['gravity']) if record['gravity'] else (None, None, None)
        hour['samples'][ts] = [record['hr'], *gravity, record['contact'], record['skinRaw'], record['respRaw']]
        for key in [key for key in hour['rr'] if key[0] == ts]:
            del hour['rr'][key]
        for order, ms in enumerate(record['rr']):
            hour['rr'][(ts, order)] = ms
    for ts, hr in realtime:
        if replace or ts not in hour['rt']:
            hour['rt'][ts] = hr
    return added


def by_hour(records, realtime):
    groups = {}
    for record in records:
        groups.setdefault(record['ts'] // 3600 * 3600, ([], []))[0].append(record)
    for sample in realtime:
        groups.setdefault(sample[0] // 3600 * 3600, ([], []))[1].append(sample)
    return groups


def read_body(limit=MAX_DECODED):
    if request.content_length and request.content_length > limit:
        raise WhoopError('Der Upload ist zu groß.', 413)
    data = request.get_data(cache=False)
    if request.headers.get('Content-Encoding', '').lower() == 'gzip':
        try:
            inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
            data = inflater.decompress(data, limit + 1)
        except zlib.error:
            raise WhoopError('Der Upload ist kein gültiges gzip.') from None
        if len(data) > limit or inflater.unconsumed_tail:
            raise WhoopError('Der entpackte Upload ist größer als 8 MB.', 413)
    if len(data) > limit:
        raise WhoopError('Der Upload ist zu groß.', 413)
    return data


# ─── Flask integration ───

class WhoopState:
    def __init__(self):
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.reprocess_requested = False
        self.reprocessing = False
        self.thread = None
        self.worker = False
        self.app = None
        self.maintain = None

    def trigger(self, reprocess=False):
        if reprocess:
            self.reprocess_requested = True
            self.reprocessing = True
        if self.worker:
            self.wake.set()
        elif self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self.maintain, daemon=True)
            self.thread.start()


def register_whoop(app, db, User, user_id):
    class WhoopAccount(db.Model):
        __tablename__ = 'whoop_account'
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), primary_key=True)
        token_hash = db.Column(db.String(64), nullable=True)
        token_created_at = db.Column(db.DateTime, nullable=True)
        bridge_last_seen = db.Column(db.DateTime, nullable=True)
        bridge_status = db.Column(db.Text, nullable=False, default='{}')
        sync_requested = db.Column(db.Boolean, nullable=False, default=False)
        data_through = db.Column(db.DateTime, nullable=True)
        stats = db.Column(db.Text, nullable=False, default='{}')
        last_error = db.Column(db.Text, nullable=True)

    class WhoopRawBatch(db.Model):
        __tablename__ = 'whoop_raw_batch'
        batch_id = db.Column(db.String(120), primary_key=True)
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
        sha256 = db.Column(db.String(64), nullable=False)
        frame_count = db.Column(db.Integer, nullable=False)
        blob = db.Column(db.LargeBinary, nullable=False)
        received_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    class WhoopHour(db.Model):
        __tablename__ = 'whoop_hour'
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), primary_key=True)
        hour_ts = db.Column(db.Integer, primary_key=True)
        samples = db.Column(db.Integer, nullable=False, default=0)
        data = db.Column(db.LargeBinary, nullable=False)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    state = WhoopState()
    state.app = app
    app.extensions['whoop'] = state
    app.extensions['whoop_models'] = (WhoopAccount, WhoopRawBatch, WhoopHour)

    @app.errorhandler(WhoopError)
    def whoop_error(error):
        db.session.rollback()
        return jsonify(error=str(error)), error.status

    def account():
        return db.session.get(WhoopAccount, user_id)

    def stats_of(row):
        return json.loads(row.stats or '{}')

    def status_body():
        row = account()
        if row is None or row.token_hash is None:
            return {'connected': False, 'reprocessing': state.reprocessing, 'rawRetentionDays': retention_days()}
        seen = row.bridge_last_seen
        age = (datetime.utcnow() - seen).total_seconds() if seen else None
        return {'connected': True, 'tokenCreatedAt': utc(row.token_created_at), 'syncRequested': row.sync_requested,
                'bridge': {**json.loads(row.bridge_status or '{}'), 'lastSeen': utc(seen),
                           'online': age is not None and age <= ONLINE_SECONDS,
                           'offlineHours': None if age is None else round(age / 3600, 1)},
                'dataThrough': utc(row.data_through), 'stats': stats_of(row), 'lastError': row.last_error,
                'hours': WhoopHour.query.filter_by(user_id=user_id).count(),
                'reprocessing': state.reprocessing, 'rawRetentionDays': retention_days()}

    def bridge_account():
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer ') or not header[7:].strip():
            raise WhoopError('Bridge-Token fehlt.', 401)
        row = account()
        digest = hashlib.sha256(header[7:].strip().encode()).hexdigest()
        if row is None or row.token_hash is None or not hmac.compare_digest(digest, row.token_hash):
            raise WhoopError('Bridge-Token ungültig. In Training Plenum unter WHOOP ein neues erzeugen.', 403)
        return row

    def store(records, realtime, replace=False):
        """Merge into hour chunks. Caller holds state.lock and commits."""
        added = 0
        now = datetime.utcnow()
        for hour_ts, (hour_records, hour_realtime) in by_hour(records, realtime).items():
            row = db.session.get(WhoopHour, (user_id, hour_ts))
            hour = unpack_hour(row.data if row else None)
            before = (len(hour['samples']), len(hour['rt']))
            count = merge_records(hour, hour_records, hour_realtime, replace)
            if not replace and (len(hour['samples']), len(hour['rt'])) == before:
                continue
            added += count
            if row is None:
                row = WhoopHour(user_id=user_id, hour_ts=hour_ts)
                db.session.add(row)
            row.data, row.samples, row.updated_at = pack_hour(hour), len(hour['samples']), now
        return added

    def note(row, records, realtime, counts, added):
        stats = stats_of(row)
        for key in ('invalid', 'undecoded', 'badTime', 'events'):
            stats[key] = stats.get(key, 0) + counts[key]
        versions = stats.setdefault('versions', {})
        for version, count in counts['versions'].items():
            versions[version] = versions.get(version, 0) + count
        stats['records'] = stats.get('records', 0) + added
        stats['realtimeSamples'] = stats.get('realtimeSamples', 0) + len(realtime)
        latest = lambda key, values: max([stats.get(key) or 0, *values]) or None  # noqa: E731
        stats['lastHrAt'] = latest('lastHrAt', [r['ts'] for r in records if r['hr']])
        stats['lastRrAt'] = latest('lastRrAt', [r['ts'] for r in records if r['rr']])
        stats['lastRealtimeAt'] = latest('lastRealtimeAt', [ts for ts, _ in realtime])
        stats['lastBatchAt'] = utc(datetime.utcnow())
        row.stats = json.dumps(stats)
        if records:
            newest = from_unix(max(r['ts'] for r in records))
            row.data_through = max(filter(None, (row.data_through, newest)))
        if counts['undecoded']:
            row.last_error = (f'{counts["undecoded"]} Datensätze mit unbekanntem Format (Version '
                              f'{", ".join(sorted(counts["undecodedVersions"]))}) bleiben als Rohdaten erhalten.')

    # UI routes (origin guard in coach_api.py)

    @app.route('/api/whoop', methods=['GET'])
    def whoop_status():
        return jsonify(status_body())

    @app.route('/api/whoop/token', methods=['POST'])
    def whoop_token():
        row = account()
        if row is None:
            row = WhoopAccount(user_id=user_id)
            db.session.add(row)
        token = secrets.token_urlsafe(32)
        row.token_hash = hashlib.sha256(token.encode()).hexdigest()
        row.token_created_at = datetime.utcnow()
        db.session.commit()
        return jsonify(token=token, status=status_body()), 201

    @app.route('/api/whoop', methods=['DELETE'])
    def whoop_disconnect():
        row = account()
        if row is not None:
            db.session.delete(row)
        if request.args.get('deleteData') == '1':
            WhoopHour.query.filter_by(user_id=user_id).delete()
            WhoopRawBatch.query.filter_by(user_id=user_id).delete()
        db.session.commit()
        return jsonify(status_body())

    @app.route('/api/whoop/sync', methods=['POST'])
    def whoop_sync():
        row = account()
        if row is None or row.token_hash is None:
            raise WhoopError('WHOOP ist noch nicht verbunden.', 409)
        row.sync_requested = True
        db.session.commit()
        return jsonify(status_body())

    @app.route('/api/whoop/recompute', methods=['POST'])
    def whoop_recompute():
        if not WhoopRawBatch.query.filter_by(user_id=user_id).count():
            raise WhoopError('Keine Rohdaten zum Neueinlesen vorhanden.', 409)
        state.trigger(reprocess=True)
        return jsonify(status_body()), 202

    # Bridge routes (bearer token; exempt from the JSON and 64 KB checks)

    @app.route('/api/whoop/bridge/heartbeat', methods=['POST'])
    def bridge_heartbeat():
        row = bridge_account()
        if (request.content_length or 0) > 65536:
            raise WhoopError('Heartbeat darf höchstens 64 KB groß sein.', 413)
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise WhoopError('Heartbeat muss ein JSON-Objekt sein.')
        row.bridge_status = json.dumps({key: body[key] for key in BRIDGE_FIELDS if key in body})
        row.bridge_last_seen = datetime.utcnow()
        requested, row.sync_requested = row.sync_requested, False
        db.session.commit()
        return jsonify(syncRequested=requested)

    @app.route('/api/whoop/bridge/frames', methods=['POST'])
    def bridge_frames():
        row = bridge_account()
        data = read_body()
        try:
            body = json.loads(data)
        except ValueError:
            raise WhoopError('Der Upload ist kein gültiges JSON.') from None
        batch_id = body.get('batchId') if isinstance(body, dict) else None
        if not isinstance(batch_id, str) or not BATCH_ID.match(batch_id):
            raise WhoopError('batchId fehlt oder ist ungültig.')
        digest = hashlib.sha256(data).hexdigest()
        with state.lock:
            existing = db.session.get(WhoopRawBatch, batch_id)
            if existing is not None:
                if existing.user_id != user_id or existing.sha256 != digest:
                    raise WhoopError('batchId wurde schon mit anderem Inhalt hochgeladen.', 409)
                return jsonify(batchId=batch_id, duplicate=True, accepted=existing.frame_count)
            records, realtime, counts = decode_frames(body.get('frames'))
            added = store(records, realtime)
            note(row, records, realtime, counts, added)
            row.bridge_last_seen = datetime.utcnow()
            db.session.add(WhoopRawBatch(batch_id=batch_id, user_id=user_id, sha256=digest, frame_count=counts['frames'],
                                         blob=gzip.compress(data, mtime=0)))
            db.session.commit()
        return jsonify(batchId=batch_id, duplicate=False, accepted=counts['frames'], records=len(records),
                       added=added, undecoded=counts['undecoded'], invalid=counts['invalid'], realtime=len(realtime))

    # Maintenance: prune expired raw batches, replay retained ones after a decoder fix.

    def reprocess():
        replayed = 0
        for batch_id, in db.session.query(WhoopRawBatch.batch_id).filter_by(user_id=user_id).order_by(WhoopRawBatch.received_at).all():
            blob = db.session.get(WhoopRawBatch, batch_id).blob
            records, realtime, _ = decode_frames(json.loads(gzip.decompress(blob))['frames'])
            with state.lock:
                store(records, realtime, replace=True)
                row = account()
                if row is not None and records:
                    newest = from_unix(max(r['ts'] for r in records))
                    row.data_through = max(filter(None, (row.data_through, newest)))
                db.session.commit()
            db.session.expunge_all()
            replayed += 1
        return replayed

    def maintain():
        with app.app_context():
            try:
                cutoff = datetime.utcnow() - timedelta(days=retention_days())
                WhoopRawBatch.query.filter(WhoopRawBatch.received_at < cutoff).delete()
                db.session.commit()
                if state.reprocess_requested:
                    state.reprocess_requested = False
                    reprocess()
            except Exception as error:  # noqa: BLE001 - reported in the status, the worker keeps running
                db.session.rollback()
                app.logger.exception('WHOOP maintenance failed')
                row = account()
                if row is not None:
                    row.last_error = f'Neueinlesen fehlgeschlagen: {error}'
                    db.session.commit()
            finally:
                state.reprocessing = state.reprocess_requested
                db.session.remove()

    state.maintain = maintain
    return WhoopAccount, WhoopRawBatch, WhoopHour


def start_whoop_worker(app, interval=3600):
    """Hourly pruning in one daemon thread; /recompute wakes it early."""
    state = app.extensions['whoop']
    if state.worker:
        return
    state.worker = True

    def loop():
        while True:
            state.maintain()
            state.wake.wait(interval)
            state.wake.clear()

    threading.Thread(target=loop, name='whoop-worker', daemon=True).start()
