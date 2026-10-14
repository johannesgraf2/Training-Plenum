"""Garmin Connect: pulls new activities as original FIT files and sends planned workouts.

Garmin has no free API for private use, so this relies on the unofficial garminconnect
library (MIT, needs Python 3.12+). The password is only used for the login; afterwards
just the session tokens are kept, encrypted with the server key of the AI coach.

Planned workouts from today on go to the Garmin Connect calendar, from where Garmin
syncs them to the device. Only workouts created here are ever changed or deleted.
"""
import io
import json
import os
import threading
import time
import uuid
import zipfile
from datetime import date, datetime, timedelta

from cryptography.fernet import InvalidToken
from flask import jsonify, request
from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session, object_session
from werkzeug.utils import secure_filename

from ai_provider import ProviderError, _cipher
from garmin_workouts import fingerprint, garmin_workout
from whoop_sync import local_zone
from workout_export import WorkoutError, validate_workout

FIRST_SYNC_DAYS = 90
OVERLAP_DAYS = 2  # Garmin lists late uploads under their start date
SAME_START_SECONDS = 120  # the same ride imported from another export
MFA_SECONDS = 600
PAUSE_SECONDS = 0.5  # between downloads, to stay a polite client
JOBS = ('cleanup', 'activities', 'workouts')  # run one at a time, in this order
UNAVAILABLE = 'Garmin Connect braucht Python 3.12 oder neuer und das Paket garminconnect (pip install -r requirements.txt).'


class GarminError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def library():
    try:
        import garminconnect
    except ImportError:
        return None
    return garminconnect


def default_client(email=None, password=None):
    module = library()
    if module is None:
        raise GarminError(UNAVAILABLE, 503)
    return module.Garmin(email=email, password=password, return_on_mfa=True)


def auto_sync_hours():
    try:
        return max(0.0, float(os.environ.get('GARMIN_SYNC_INTERVAL_HOURS', '6')))
    except ValueError:
        return 6.0


def today_local():
    return datetime.now(local_zone()).date()


def friendly(error):
    """Library exceptions in words a user can act on; never echoes credentials or tokens."""
    name = type(error).__name__
    if isinstance(error, GarminError):
        return error
    if name == 'GarminConnectAuthenticationError':
        return GarminError('Garmin hat die Anmeldung abgelehnt. Bitte E-Mail, Passwort oder Code prüfen.', 401)
    if name == 'GarminConnectTooManyRequestsError':
        return GarminError('Garmin meldet zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.', 429)
    return GarminError('Garmin Connect ist gerade nicht erreichbar. Bitte später erneut versuchen.', 502)


def http_status(error):
    return getattr(getattr(error, 'response', None), 'status_code', None)


def encrypt_tokens(tokens):
    return _cipher().encrypt(tokens.encode('utf-8')).decode('ascii')


def decrypt_tokens(ciphertext):
    try:
        return _cipher().decrypt(ciphertext.encode('ascii')).decode('utf-8')
    except (InvalidToken, ProviderError, UnicodeError, AttributeError):
        raise GarminError('Die gespeicherte Garmin-Anmeldung kann nicht gelesen werden. Bitte neu verbinden.', 401) from None


def fit_payload(data):
    """The ORIGINAL download is a ZIP around the device file; some uploads come back bare."""
    if data[8:12] == b'.FIT':
        return data
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                if name.lower().endswith('.fit'):
                    return archive.read(name)
    except zipfile.BadZipFile:
        pass
    return None


def start_of(item):
    try:
        return datetime.strptime(item['startTimeGMT'], '%Y-%m-%d %H:%M:%S')
    except (KeyError, TypeError, ValueError):
        return None


def schedule_id(response):
    response = response if isinstance(response, dict) else {}
    value = response.get('workoutScheduleId') or response.get('scheduleId') or response.get('id')
    return str(value) if value else None


def upgrade_garmin_tables(connection):
    """Columns added after the first Garmin release; existing rows keep their values."""
    if 'garmin_account' not in inspect(connection).get_table_names():
        return
    columns = {column['name'] for column in inspect(connection).get_columns('garmin_account')}
    for name, ddl in (('push_workouts', 'BOOLEAN NOT NULL DEFAULT 1'), ('last_push_at', 'DATETIME'),
                      ('last_push_result', "TEXT NOT NULL DEFAULT '{}'"), ('last_push_error', 'TEXT')):
        if name not in columns:
            connection.execute(text(f'ALTER TABLE garmin_account ADD COLUMN {name} {ddl}'))


class GarminState:
    def __init__(self):
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.make_client = default_client
        self.pending = None  # (client, email, expires) while Garmin waits for the MFA code
        self.wanted = set()
        self.running = False
        self.job = None
        self.progress = None
        self.disconnect_after_cleanup = False
        self.push_enabled = False  # cached, so saving a workout never waits for the database
        self.worker = False
        self.run_job = None

    def available(self):
        return self.make_client is not default_client or library() is not None

    def busy_with(self, job):
        return self.job == job or job in self.wanted

    def request(self, *jobs):
        with self.lock:
            self.wanted.update(jobs)
            if self.running:
                return
            self.running = True
        self.start()

    def start(self):
        threading.Thread(target=self.loop, name='garmin-sync', daemon=True).start()

    def loop(self):
        while True:
            with self.lock:
                job = next((name for name in JOBS if name in self.wanted), None)
                if job is None:
                    self.running = False
                    return
                self.wanted.discard(job)
                self.job = job
            try:
                self.run_job(job)
            finally:
                self.job, self.progress = None, None


def register_garmin(app, db, Activity, PlannedWorkout, user_id, import_recording, ImportRejected):
    class GarminAccount(db.Model):
        __tablename__ = 'garmin_account'
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), primary_key=True)
        email = db.Column(db.String(254), nullable=False)
        tokens = db.Column(db.Text, nullable=True)
        connected_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        needs_login = db.Column(db.Boolean, nullable=False, default=False)
        synced_through = db.Column(db.Date, nullable=True)
        last_sync_at = db.Column(db.DateTime, nullable=True)
        last_result = db.Column(db.Text, nullable=False, default='{}')
        last_error = db.Column(db.Text, nullable=True)
        push_workouts = db.Column(db.Boolean, nullable=False, default=True)
        last_push_at = db.Column(db.DateTime, nullable=True)
        last_push_result = db.Column(db.Text, nullable=False, default='{}')
        last_push_error = db.Column(db.Text, nullable=True)

    class GarminImport(db.Model):
        """One row per Garmin activity already handled, so a sync never downloads it twice."""
        __tablename__ = 'garmin_import'
        garmin_id = db.Column(db.String(32), primary_key=True)
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
        activity_id = db.Column(db.String(36), nullable=True)
        status = db.Column(db.String(20), nullable=False)
        message = db.Column(db.Text, nullable=True)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class GarminWorkout(db.Model):
        """A planned workout sent to Garmin; only these are ever changed or deleted there."""
        __tablename__ = 'garmin_workout'
        planned_id = db.Column(db.String(36), primary_key=True)
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False, index=True)
        garmin_workout_id = db.Column(db.String(32), nullable=False)
        schedule_id = db.Column(db.String(32), nullable=True)
        day = db.Column(db.String(10), nullable=False)
        fingerprint = db.Column(db.String(64), nullable=False)
        synced_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    state = GarminState()
    app.extensions['garmin'] = state
    app.extensions['garmin_models'] = (GarminAccount, GarminImport, GarminWorkout)

    # Every saved, moved or deleted plan (editor, calendar, AI coach) queues a push after the commit.
    dirty = f'garmin-workouts-{id(state)}'

    def plan_changed(_mapper, _connection, target):
        session = object_session(target)
        if session is not None:
            session.info[dirty] = True

    for name in ('after_insert', 'after_update', 'after_delete'):
        event.listen(PlannedWorkout, name, plan_changed)

    @event.listens_for(Session, 'after_commit')
    def plans_committed(session):
        if session.info.pop(dirty, False) and state.push_enabled:
            state.request('workouts')

    @event.listens_for(Session, 'after_rollback')
    def plans_rolled_back(session):
        session.info.pop(dirty, None)

    @app.errorhandler(GarminError)
    def garmin_error(error):
        db.session.rollback()
        return jsonify(error=str(error)), error.status

    def account():
        return db.session.get(GarminAccount, user_id)

    def refresh_flags(row):
        state.push_enabled = bool(row and row.tokens and row.push_workouts)

    def mfa_pending():
        if state.pending and state.pending[2] < time.monotonic():
            state.pending = None
        return state.pending is not None

    def status_body():
        row = account()
        today = today_local().isoformat()
        return {
            'available': state.available(),
            'connected': bool(row and row.tokens),
            'email': row.email if row else None,
            'connectedAt': row.connected_at.isoformat() + 'Z' if row else None,
            'needsLogin': bool(row and row.needs_login),
            'syncedThrough': row.synced_through.isoformat() if row and row.synced_through else None,
            'lastSyncAt': row.last_sync_at.isoformat() + 'Z' if row and row.last_sync_at else None,
            'lastResult': json.loads(row.last_result or '{}') if row else {},
            'lastError': row.last_error if row else None,
            'imported': GarminImport.query.filter_by(user_id=user_id, status='imported').count(),
            'syncing': state.busy_with('activities'),
            'progress': state.progress if state.job == 'activities' else None,
            'mfaPending': mfa_pending(),
            'autoSyncHours': auto_sync_hours(),
            'pushWorkouts': bool(row and row.push_workouts),
            'workouts': {
                'scheduled': GarminWorkout.query.filter(GarminWorkout.user_id == user_id, GarminWorkout.day >= today).count(),
                'sent': GarminWorkout.query.filter_by(user_id=user_id).count(),
                'pushing': state.busy_with('workouts'),
                'removing': state.busy_with('cleanup'),
                'lastPushAt': row.last_push_at.isoformat() + 'Z' if row and row.last_push_at else None,
                'lastPushResult': json.loads(row.last_push_result or '{}') if row else {},
                'lastPushError': row.last_push_error if row else None,
            },
            'disconnecting': state.disconnect_after_cleanup,
        }

    def connect(client, email):
        tokens = client.client.dumps()
        row = account()
        if row is None:
            row = GarminAccount(user_id=user_id, email=email, push_workouts=True)
            db.session.add(row)
        elif row.email != email:
            # Another Garmin account: workouts sent before belong to the old one.
            GarminWorkout.query.filter_by(user_id=user_id).delete()
        row.email, row.tokens, row.needs_login, row.last_error = email, encrypt_tokens(tokens), False, None
        row.connected_at = datetime.utcnow()
        db.session.commit()
        refresh_flags(row)
        state.pending = None
        state.request('activities', 'workouts')

    def forget_account():
        row = account()
        if row is not None:
            db.session.delete(row)
        GarminWorkout.query.filter_by(user_id=user_id).delete()
        db.session.commit()
        refresh_flags(None)

    @app.route('/api/garmin', methods=['GET'])
    def garmin_status():
        return jsonify(status_body())

    @app.route('/api/garmin/login', methods=['POST'])
    def garmin_login():
        payload = request.get_json(silent=True) or {}
        email, password = str(payload.get('email', '')).strip(), payload.get('password')
        if not 3 <= len(email) <= 254 or '@' not in email:
            raise GarminError('Bitte die E-Mail-Adresse deines Garmin-Kontos eingeben.')
        if not isinstance(password, str) or not 1 <= len(password) <= 256:
            raise GarminError('Bitte das Passwort deines Garmin-Kontos eingeben.')
        state.pending = None
        client = state.make_client(email=email, password=password)
        try:
            result, _ = client.login()
        except Exception as error:
            raise friendly(error) from None
        if result == 'needs_mfa':
            state.pending = (client, email, time.monotonic() + MFA_SECONDS)
            return jsonify({**status_body(), 'mfaRequired': True}), 202
        connect(client, email)
        return jsonify(status_body())

    @app.route('/api/garmin/mfa', methods=['POST'])
    def garmin_mfa():
        code = str((request.get_json(silent=True) or {}).get('code', '')).strip()
        if not mfa_pending():
            raise GarminError('Die Anmeldung ist abgelaufen. Bitte erneut mit E-Mail und Passwort anmelden.', 409)
        if not code.isdigit() or not 4 <= len(code) <= 10:
            raise GarminError('Bitte den Code aus der E-Mail oder App von Garmin eingeben.')
        client, email, _ = state.pending
        try:
            client.resume_login(None, code)
        except Exception as error:
            raise friendly(error) from None  # a wrong code keeps the pending login for another try
        connect(client, email)
        return jsonify(status_body())

    def connected_account():
        row = account()
        if row is None or not row.tokens:
            raise GarminError('Garmin Connect ist noch nicht verbunden.', 409)
        return row

    @app.route('/api/garmin/sync', methods=['POST'])
    def garmin_sync():
        connected_account()
        state.request('activities', 'workouts')
        return jsonify(status_body()), 202

    @app.route('/api/garmin/settings', methods=['PUT'])
    def garmin_settings():
        payload = request.get_json(silent=True) or {}
        push = payload.get('pushWorkouts')
        if not isinstance(push, bool):
            raise GarminError('Bitte angeben, ob geplante Einheiten an Garmin gehen sollen.')
        row = connected_account()
        row.push_workouts = push
        db.session.commit()
        refresh_flags(row)
        if push:
            state.request('workouts')
        elif payload.get('removeWorkouts') is True:
            state.request('cleanup')
        return jsonify(status_body())

    @app.route('/api/garmin', methods=['DELETE'])
    def garmin_disconnect():
        # Imported activities and the list of handled Garmin IDs stay; only the login goes.
        state.pending = None
        row = account()
        sent = GarminWorkout.query.filter_by(user_id=user_id).count()
        if request.args.get('deleteWorkouts') == '1' and row is not None and row.tokens and sent:
            state.disconnect_after_cleanup = True
            state.push_enabled = False
            state.request('cleanup')
            return jsonify(status_body()), 202
        forget_account()
        return jsonify(status_body())

    def signed_in(row):
        client = state.make_client()
        client.login(decrypt_tokens(row.tokens))
        return client

    def keep_session(row, client):
        row.tokens = encrypt_tokens(client.client.dumps())  # keeps the refreshed session

    def handle(client, item):
        garmin_id = str(item.get('activityId') or '')
        if not garmin_id.isdigit() or db.session.get(GarminImport, garmin_id):
            return None
        start = start_of(item)
        if start is not None:
            window = timedelta(seconds=SAME_START_SECONDS)
            same = Activity.query.filter(Activity.user_id == user_id, Activity.date.between(start - window, start + window)).first()
            if same:
                return GarminImport(garmin_id=garmin_id, user_id=user_id, activity_id=same.id, status='duplicate')
        data = fit_payload(client.download_activity(garmin_id, dl_fmt=client.ActivityDownloadFormat.ORIGINAL))
        time.sleep(PAUSE_SECONDS)
        if data is None:
            return GarminImport(garmin_id=garmin_id, user_id=user_id, status='skipped', message='Keine FIT-Datei (z. B. manuell eingetragen).')
        name = f'garmin-{garmin_id}.fit'
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(f'{uuid.uuid4()}_{name}'))
        with open(filepath, 'wb') as output:
            output.write(data)
        try:
            activity = import_recording(filepath, name)
        except ImportRejected as rejected:
            status = 'duplicate' if rejected.status == 409 else 'failed'
            return GarminImport(garmin_id=garmin_id, user_id=user_id, activity_id=rejected.existing_id, status=status, message=str(rejected))
        return GarminImport(garmin_id=garmin_id, user_id=user_id, activity_id=activity.id, status='imported')

    def pull_activities(row, client):
        counts = {'imported': 0, 'duplicate': 0, 'skipped': 0, 'failed': 0}
        today = date.today()
        start = row.synced_through - timedelta(days=OVERLAP_DAYS) if row.synced_through else today - timedelta(days=FIRST_SYNC_DAYS)
        listed = client.get_activities_by_date(start.isoformat(), today.isoformat(), sortorder='asc')
        state.progress = {'done': 0, 'total': len(listed)}
        try:
            for item in listed:
                record = handle(client, item)
                if record is not None:
                    db.session.add(record)
                    db.session.commit()
                    counts[record.status] += 1
                state.progress = {'done': state.progress['done'] + 1, 'total': len(listed)}
                row.synced_through = (start_of(item) or datetime.combine(today, datetime.min.time())).date()
            row.synced_through = today
        finally:
            row.last_sync_at = datetime.utcnow()
            row.last_result = json.dumps(counts)

    def remove(client, link):
        for action, ident in ((client.unschedule_workout, link.schedule_id), (client.delete_workout, link.garmin_workout_id)):
            if not ident:
                continue
            try:
                action(ident)
            except Exception as error:
                if type(error).__name__ != 'GarminConnectNotFoundError' and http_status(error) != 404:
                    raise  # already deleted in Garmin Connect counts as removed

    def push_workouts(row, client):
        counts = {'created': 0, 'updated': 0, 'removed': 0, 'failed': 0}
        problems = []
        today = today_local().isoformat()
        planned = {plan.id: plan for plan in PlannedWorkout.query.filter_by(user_id=user_id).all()}
        links = {link.planned_id: link for link in GarminWorkout.query.filter_by(user_id=user_id).all()}
        wanted = {}
        for plan_id, plan in planned.items():
            try:
                workout = validate_workout(json.loads(plan.definition))
            except (WorkoutError, ValueError):
                continue
            if workout['date'] >= today:
                body = garmin_workout(workout)
                wanted[plan_id] = (workout, body, fingerprint(body, workout['date']))
        try:
            for plan_id, link in links.items():
                # Deleted plans go; past ones stay, unless the plan was moved from the future into the past.
                if plan_id not in wanted and (plan_id not in planned or link.day >= today):
                    remove(client, link)
                    db.session.delete(link)
                    db.session.commit()
                    counts['removed'] += 1
            for plan_id, (workout, body, print_) in sorted(wanted.items(), key=lambda item: item[1][0]['date']):
                link = links.get(plan_id)
                if link is not None and link.fingerprint == print_:
                    continue
                if link is not None:
                    remove(client, link)
                    db.session.delete(link)
                    db.session.commit()
                try:
                    created = client.upload_workout(body)
                    garmin_id = str(created['workoutId'])
                    scheduled = client.schedule_workout(garmin_id, workout['date'])
                except Exception as error:
                    if http_status(error) not in (400, 404, 409, 422) and not isinstance(error, (KeyError, TypeError)):
                        raise
                    counts['failed'] += 1
                    problems.append(f'„{workout["name"]}“ am {date.fromisoformat(workout["date"]):%d.%m.}: Garmin hat das Workout abgelehnt.')
                    continue
                db.session.add(GarminWorkout(planned_id=plan_id, user_id=user_id, garmin_workout_id=garmin_id,
                                             schedule_id=schedule_id(scheduled), day=workout['date'], fingerprint=print_))
                db.session.commit()
                counts['updated' if link is not None else 'created'] += 1
        finally:
            row.last_push_at = datetime.utcnow()
            row.last_push_result = json.dumps(counts)
            row.last_push_error = ' '.join(problems[:3]) or None

    def remove_all(client):
        for link in GarminWorkout.query.filter_by(user_id=user_id).all():
            remove(client, link)
            db.session.delete(link)
            db.session.commit()

    def run_job(job):
        with app.app_context():
            row = account()
            if row is None or not row.tokens or (job == 'workouts' and not row.push_workouts):
                return
            error = None
            try:
                client = signed_in(row)
                if job == 'activities':
                    pull_activities(row, client)
                elif job == 'workouts':
                    push_workouts(row, client)
                else:
                    remove_all(client)
                keep_session(row, client)
            except Exception as caught:
                db.session.rollback()
                error = friendly(caught)
                if error.status == 401:
                    error = GarminError('Die Garmin-Anmeldung ist abgelaufen. Bitte neu verbinden.', 401)
                if error.status == 502:
                    app.logger.exception('Garmin %s failed', job)
                else:
                    app.logger.warning('Garmin %s stopped: %s', job, error)
            row = account()
            if row is None:  # disconnected meanwhile
                return
            if job == 'activities':
                row.last_error = str(error) if error else None
            elif error:
                row.last_push_error = str(error)
            if error and error.status == 401:
                row.needs_login = True
            db.session.commit()
            if job == 'cleanup' and state.disconnect_after_cleanup:
                state.disconnect_after_cleanup = False
                if error is None:
                    forget_account()
                else:
                    refresh_flags(row)

    state.run_job = run_job
    state.refresh = lambda: refresh_flags(account())


def start_garmin_worker(app):
    """Syncs at start and then every GARMIN_SYNC_INTERVAL_HOURS (default 6, 0 switches it off) while connected."""
    state = app.extensions['garmin']
    with app.app_context():
        state.refresh()
    hours = auto_sync_hours()
    if state.worker or not hours:
        return
    state.worker = True

    def loop():
        while True:
            state.request('activities', 'workouts')
            state.wake.wait(hours * 3600)
            state.wake.clear()

    threading.Thread(target=loop, name='garmin-worker', daemon=True).start()
