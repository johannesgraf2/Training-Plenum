import os
import json
import hashlib
import uuid
import zipfile
from io import BytesIO
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from sqlalchemy import inspect, text
from sqlalchemy.orm import defer, load_only, selectinload
from sqlalchemy.exc import IntegrityError
from dateutil.tz import gettz
from fit_import import parse_fit_file, FitImportError, read_fit_bytes
from best_efforts import TARGETS, VERSION as EFFORT_VERSION, activity_efforts
from analytics import VERSION as ANALYTICS_VERSION, activity_summary, aggregate, fitness, valid
from workout_export import WorkoutError, validate_workout, export_workout
from training_plan import history_summary, make_block, date_range

app = Flask(__name__)
CORS(app)

# Config
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///' + os.path.join(basedir, 'data', 'trainhub.db'))
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', os.path.join(basedir, 'uploads'))
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(os.path.join(basedir, 'data'), exist_ok=True)

db = SQLAlchemy(app)

ALLOWED_EXTENSIONS = {'fit', 'gpx', 'tcx', 'csv'}


# ─── MODELS ───

class User(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = db.Column(db.String(120), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    age = db.Column(db.Integer)
    weight = db.Column(db.Float)
    sport = db.Column(db.String(50), default='cycling')
    ftp = db.Column(db.Float)
    max_hr = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    activities = db.relationship('Activity', backref='user', lazy=True)

    def to_dict(self):
        return {
            'id': self.id, 'email': self.email, 'name': self.name,
            'age': self.age, 'weight': self.weight, 'sport': self.sport,
            'ftp': self.ftp, 'maxHr': self.max_hr
        }


class Activity(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200))
    sport = db.Column(db.String(50), nullable=False)
    date = db.Column(db.DateTime, nullable=False)
    duration = db.Column(db.Float)  # minutes; FIT retains sub-second precision
    distance = db.Column(db.Float)    # km
    hr_avg = db.Column(db.Integer)
    hr_max = db.Column(db.Integer)
    power_avg = db.Column(db.Integer)
    cadence_avg = db.Column(db.Integer)
    elevation = db.Column(db.Integer)
    calories = db.Column(db.Integer)
    speed_avg = db.Column(db.Float)
    tags = db.Column(db.Text, default='[]')       # JSON
    notes = db.Column(db.Text, default='')
    source_file = db.Column(db.String(255))
    source_type = db.Column(db.String(10))
    file_hash = db.Column(db.String(64))
    time_series = db.Column(db.Text, default='[]') # JSON
    fit_details = db.Column(db.Text, default='{}')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, include_ts=False):
        details = json.loads(self.fit_details or '{}')
        d = {
            'id': self.id, 'title': self.title, 'sport': self.sport,
            'date': self.date.isoformat() + ('Z' if details else ''), 'duration': self.duration,
            'distance': self.distance, 'hrAvg': self.hr_avg, 'hrMax': self.hr_max,
            'power': self.power_avg, 'cadence': self.cadence_avg,
            'elevation': self.elevation, 'calories': self.calories,
            'speedAvg': self.speed_avg,
            'tags': json.loads(self.tags or '[]'),
            'notes': self.notes or '',
            'source': self.source_type or 'manual',
            'timerSeconds': details.get('timerSeconds'),
            'elapsedSeconds': details.get('elapsedSeconds'),
        }
        if include_ts:
            d['timeSeries'] = json.loads(self.time_series or '[]')
            d['fitDetails'] = details
            d['originalFileUrl'] = f'/api/activities/{self.id}/file' if self.source_file else None
        return d


class PlannedWorkout(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    definition = db.Column(db.Text, nullable=False)
    locked = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {**json.loads(self.definition), 'id': self.id, 'locked': bool(self.locked)}


class WorkoutTemplate(db.Model):
    """A user's own workout, kept as a reusable template without a training date."""
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    definition = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {**json.loads(self.definition), 'id': self.id}


class TrainingBlock(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    definition = db.Column(db.Text, nullable=False)


class BestEffortCache(db.Model):
    activity_id = db.Column(db.String(36), db.ForeignKey('activity.id'), primary_key=True)
    version = db.Column(db.Integer, nullable=False)
    sport = db.Column(db.String(50), nullable=False)
    efforts = db.Column(db.Text, nullable=False)
    activity = db.relationship('Activity', backref=db.backref('effort_cache', uselist=False, cascade='all, delete-orphan'))


class AnalyticsCache(db.Model):
    activity_id = db.Column(db.String(36), db.ForeignKey('activity.id'), primary_key=True)
    version = db.Column(db.Integer, nullable=False)
    sport = db.Column(db.String(50), nullable=False)
    summary = db.Column(db.Text, nullable=False)
    activity = db.relationship('Activity', backref=db.backref('analytics_cache', uselist=False, cascade='all, delete-orphan'))


def initialize_database():
    """Add FIT metadata to existing personal databases without replacing their data."""
    with app.app_context():
        db.create_all()
        if 'fit_details' not in {column['name'] for column in inspect(db.engine).get_columns('activity')}:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE activity ADD COLUMN fit_details TEXT DEFAULT '{}'"))
        user_columns = {column['name'] for column in inspect(db.engine).get_columns('user')}
        workout_columns = {column['name'] for column in inspect(db.engine).get_columns('planned_workout')}
        with db.engine.begin() as connection:
            if 'locked' not in workout_columns:
                connection.execute(text('ALTER TABLE planned_workout ADD COLUMN locked BOOLEAN NOT NULL DEFAULT 0'))
            for column in ('ftp', 'max_hr'):
                if column not in user_columns:
                    connection.execute(text(f'ALTER TABLE user ADD COLUMN {column} FLOAT'))
            if 'analytics_at' not in {column['name'] for column in inspect(connection).get_columns('whoop_account')}:
                connection.execute(text('ALTER TABLE whoop_account ADD COLUMN analytics_at DATETIME'))
            if 'ai_provider_settings' in inspect(connection).get_table_names() and 'reasoning_effort' not in {
                    column['name'] for column in inspect(connection).get_columns('ai_provider_settings')}:
                connection.execute(text('ALTER TABLE ai_provider_settings ADD COLUMN reasoning_effort VARCHAR(20)'))


@app.errorhandler(413)
def upload_too_large(error):
    return jsonify({'error': 'Die Datei darf höchstens 50 MB groß sein.'}), 413


# ─── FILE PARSERS ───

def parse_gpx_file(filepath):
    """Parse .gpx file using gpxpy."""
    try:
        import gpxpy
        with open(filepath, 'r') as f:
            gpx = gpxpy.parse(f)

        time_series = []
        hrs = []
        speeds = []
        elevations = []
        total_distance = 0
        start_time = None
        points_list = []

        for track in gpx.tracks:
            for segment in track.segments:
                for i, point in enumerate(segment.points):
                    if start_time is None and point.time:
                        start_time = point.time
                    
                    elapsed = 0
                    if point.time and start_time:
                        elapsed = int((point.time - start_time).total_seconds())

                    ts_point = {'time': elapsed}

                    if point.elevation:
                        ts_point['elevation'] = round(point.elevation, 1)
                        elevations.append(point.elevation)

                    ts_point['lat'] = point.latitude
                    ts_point['lng'] = point.longitude

                    # Speed from extensions or calculated
                    if i > 0:
                        prev = segment.points[i - 1]
                        dist = point.distance_2d(prev)
                        if dist and point.time and prev.time:
                            dt = (point.time - prev.time).total_seconds()
                            if dt > 0:
                                spd = round((dist / dt) * 3.6, 1)
                                ts_point['speed'] = spd
                                speeds.append(spd)
                        total_distance += dist or 0

                    # HR from extensions
                    for ext in point.extensions:
                        for child in ext:
                            tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                            if tag.lower() == 'hr' and child.text:
                                hr = int(child.text)
                                ts_point['hr'] = hr
                                hrs.append(hr)

                    time_series.append(ts_point)
                    points_list.append(point)

        duration = 0
        if start_time and points_list:
            last_point = points_list[-1]
            if last_point.time:
                duration = int((last_point.time - start_time).total_seconds() / 60)

        elev_gain = 0
        if elevations:
            for i in range(1, len(elevations)):
                diff = elevations[i] - elevations[i-1]
                if diff > 0:
                    elev_gain += diff

        session_data = {
            'duration': duration,
            'distance': round(total_distance / 1000, 2),
            'elevation': int(elev_gain),
            'date': start_time,
            'sport': 'ride',  # default, user can change
        }
        if hrs:
            session_data['hr_avg'] = int(sum(hrs) / len(hrs))
            session_data['hr_max'] = max(hrs)
        if speeds:
            session_data['speed_avg'] = round(sum(speeds) / len(speeds), 1)
        if duration > 0:
            session_data['calories'] = int(duration * 8)  # rough estimate

        return session_data, time_series

    except Exception as e:
        print(f"GPX parse error: {e}")
        return {}, []


def parse_tcx_file(filepath):
    """Parse .tcx file using lxml."""
    try:
        from lxml import etree
        tree = etree.parse(filepath)
        root = tree.getroot()
        
        ns = {'tcx': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
              'ae': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'}

        time_series = []
        hrs = []
        speeds = []
        start_time = None
        total_distance = 0

        activities = root.findall('.//tcx:Activity', ns)
        sport = 'run'
        if activities:
            sport_attr = activities[0].get('Sport', 'Running')
            sport_map = {'Biking': 'ride', 'Running': 'run', 'Swimming': 'swim', 'Cycling': 'ride'}
            sport = sport_map.get(sport_attr, 'run')

        trackpoints = root.findall('.//tcx:Trackpoint', ns)
        for i, tp in enumerate(trackpoints):
            ts_point = {'time': i * 5}

            time_el = tp.find('tcx:Time', ns)
            if time_el is not None and time_el.text:
                from dateutil.parser import parse as parse_dt
                t = parse_dt(time_el.text)
                if start_time is None:
                    start_time = t
                ts_point['time'] = int((t - start_time).total_seconds())

            hr_el = tp.find('.//tcx:HeartRateBpm/tcx:Value', ns)
            if hr_el is not None and hr_el.text:
                hr = int(hr_el.text)
                ts_point['hr'] = hr
                hrs.append(hr)

            dist_el = tp.find('tcx:DistanceMeters', ns)
            if dist_el is not None and dist_el.text:
                total_distance = float(dist_el.text)

            alt_el = tp.find('tcx:AltitudeMeters', ns)
            if alt_el is not None and alt_el.text:
                ts_point['elevation'] = round(float(alt_el.text), 1)

            speed_el = tp.find('.//ae:Speed', ns)
            if speed_el is not None and speed_el.text:
                spd = round(float(speed_el.text) * 3.6, 1)
                ts_point['speed'] = spd
                speeds.append(spd)

            lat_el = tp.find('.//tcx:LatitudeDegrees', ns)
            lng_el = tp.find('.//tcx:LongitudeDegrees', ns)
            if lat_el is not None and lng_el is not None:
                ts_point['lat'] = float(lat_el.text)
                ts_point['lng'] = float(lng_el.text)

            time_series.append(ts_point)

        duration = 0
        if start_time and trackpoints:
            time_el = trackpoints[-1].find('tcx:Time', ns)
            if time_el is not None:
                from dateutil.parser import parse as parse_dt
                end = parse_dt(time_el.text)
                duration = int((end - start_time).total_seconds() / 60)

        session_data = {
            'duration': duration,
            'distance': round(total_distance / 1000, 2),
            'sport': sport,
            'date': start_time,
        }
        if hrs:
            session_data['hr_avg'] = int(sum(hrs) / len(hrs))
            session_data['hr_max'] = max(hrs)
        if speeds:
            session_data['speed_avg'] = round(sum(speeds) / len(speeds), 1)
        if duration:
            session_data['calories'] = int(duration * (8 if sport == 'ride' else 10))

        return session_data, time_series

    except Exception as e:
        print(f"TCX parse error: {e}")
        return {}, []


def parse_csv_file(filepath):
    """Parse a basic CSV with common column names."""
    import csv
    try:
        time_series = []
        hrs = []
        speeds = []
        
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                ts_point = {'time': i * 5}
                for key in row:
                    kl = key.lower().strip()
                    val = row[key].strip()
                    if not val:
                        continue
                    try:
                        if kl in ('hr', 'heart_rate', 'heartrate'):
                            ts_point['hr'] = int(float(val))
                            hrs.append(ts_point['hr'])
                        elif kl in ('speed', 'velocity'):
                            ts_point['speed'] = round(float(val), 1)
                            speeds.append(ts_point['speed'])
                        elif kl in ('power', 'watts'):
                            ts_point['power'] = int(float(val))
                        elif kl in ('cadence', 'cad'):
                            ts_point['cadence'] = int(float(val))
                        elif kl in ('elevation', 'altitude', 'alt'):
                            ts_point['elevation'] = round(float(val), 1)
                    except ValueError:
                        pass
                time_series.append(ts_point)

        duration = len(time_series) * 5 // 60
        session_data = {
            'duration': duration,
            'sport': 'run',
            'date': datetime.utcnow(),
        }
        if hrs:
            session_data['hr_avg'] = int(sum(hrs) / len(hrs))
            session_data['hr_max'] = max(hrs)

        return session_data, time_series

    except Exception as e:
        print(f"CSV parse error: {e}")
        return {}, []


PARSERS = {
    'fit': parse_fit_file,
    'gpx': parse_gpx_file,
    'tcx': parse_tcx_file,
    'csv': parse_csv_file,
}


def compute_file_hash(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            h.update(chunk)
    return h.hexdigest()


# ─── API ROUTES ───

# For MVP we use a single demo user
DEMO_USER_ID = 'demo-user-001'


@app.before_request
def ensure_demo_user():
    if not hasattr(app, '_demo_created'):
        with app.app_context():
            u = User.query.get(DEMO_USER_ID)
            if not u:
                u = User(id=DEMO_USER_ID, email='athlete@trainhub.de',
                         name='Johannes Graf', password_hash='demo', age=30, weight=75, sport='cycling')
                db.session.add(u)
                db.session.commit()
        app._demo_created = True


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': '1.0.0'})


@app.route('/api/user', methods=['GET'])
def get_user():
    u = User.query.get(DEMO_USER_ID)
    return jsonify(u.to_dict())


@app.errorhandler(WorkoutError)
def invalid_workout(error):
    return jsonify({'error': str(error)}), 400


@app.route('/api/workouts', methods=['GET', 'POST'])
def workouts():
    if request.method == 'GET':
        rows = PlannedWorkout.query.filter_by(user_id=DEMO_USER_ID).all()
        return jsonify(sorted((row.to_dict() for row in rows), key=lambda w: (w['date'], w['name'])))
    definition = validate_workout(request.get_json(silent=True))
    row = PlannedWorkout(user_id=DEMO_USER_ID, definition=json.dumps(definition))
    db.session.add(row)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@app.route('/api/workouts/<workout_id>', methods=['PUT', 'DELETE'])
def saved_workout(workout_id):
    row = PlannedWorkout.query.filter_by(id=workout_id, user_id=DEMO_USER_ID).first()
    if row is None:
        return jsonify({'error': 'Dieses Workout wurde nicht gefunden.'}), 404
    if row.locked:
        return jsonify({'error': 'Diese Einheit ist gesperrt. Bitte zuerst im AI Coach entsperren.'}), 409
    if request.method == 'DELETE':
        db.session.delete(row)
        db.session.commit()
        return '', 204
    row.definition = json.dumps(validate_workout(request.get_json(silent=True)))
    db.session.commit()
    return jsonify(row.to_dict())


MAX_WORKOUT_TEMPLATES = 200


@app.route('/api/workout-templates', methods=['GET', 'POST'])
def workout_templates():
    rows = WorkoutTemplate.query.filter_by(user_id=DEMO_USER_ID)
    if request.method == 'GET':
        return jsonify([row.to_dict() for row in rows.order_by(WorkoutTemplate.created_at.desc()).all()])
    data = request.get_json(silent=True)
    # A template has no date of its own; it gets the day it is applied to.
    definition = validate_workout({**data, 'date': '2000-01-01'} if isinstance(data, dict) else data)
    definition.pop('date')
    if rows.count() >= MAX_WORKOUT_TEMPLATES:
        raise WorkoutError(f'Es sind höchstens {MAX_WORKOUT_TEMPLATES} eigene Vorlagen möglich. Bitte zuerst alte Vorlagen löschen.')
    row = WorkoutTemplate(user_id=DEMO_USER_ID, definition=json.dumps(definition))
    db.session.add(row)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@app.route('/api/workout-templates/<template_id>', methods=['DELETE'])
def delete_workout_template(template_id):
    row = WorkoutTemplate.query.filter_by(id=template_id, user_id=DEMO_USER_ID).first()
    if row is None:
        return jsonify({'error': 'Diese Vorlage wurde nicht gefunden.'}), 404
    db.session.delete(row)
    db.session.commit()
    return '', 204


@app.route('/api/workouts/export', methods=['POST'])
def download_workout():
    definition = validate_workout(request.get_json(silent=True))
    try:
        content = export_workout(definition)
    except (ValueError, RuntimeError):
        app.logger.exception('Workout FIT export failed')
        return jsonify({'error': 'Die FIT-Datei konnte nicht geprüft werden. Bitte erneut versuchen.'}), 500
    filename = definition['date'] + '_' + (secure_filename(definition['name']) or 'workout') + '.fit'
    return send_file(BytesIO(content), mimetype='application/vnd.ant.fit', as_attachment=True,
                     download_name=filename, max_age=0)


@app.route('/api/workouts/export-range', methods=['GET'])
def download_workout_range():
    start, end = date_range(request.args.get('start'), request.args.get('end'))
    sport = request.args.get('sport', 'all')
    if sport not in ('all', 'ride', 'run', 'swim'):
        raise WorkoutError('Bitte alle Sportarten, Radfahren, Laufen oder Schwimmen auswählen.')
    selected = sorted((row.to_dict() for row in PlannedWorkout.query.filter_by(user_id=DEMO_USER_ID).all()),
                      key=lambda w: (w['date'], w['name'], w['id']))
    selected = [w for w in selected if start <= w['date'] <= end and (sport == 'all' or w['sport'] == sport)]
    if not selected:
        return jsonify({'error': 'Keine geplanten Workouts in diesem Zeitraum.'}), 404
    if len(selected) > 500:
        raise WorkoutError('Bitte einen Zeitraum mit höchstens 500 Workouts auswählen.')
    return workout_zip(selected, f'trainhub_{start}_{end}.zip')


@app.route('/api/workouts/export-selection', methods=['POST'])
def download_workout_selection():
    ids = (request.get_json(silent=True) or {}).get('ids')
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise WorkoutError('Bitte mindestens ein Workout auswählen.')
    if len(ids) > 500:
        raise WorkoutError('Bitte höchstens 500 Workouts auswählen.')
    rows = PlannedWorkout.query.filter(PlannedWorkout.user_id == DEMO_USER_ID, PlannedWorkout.id.in_(set(ids))).all()
    if len(rows) != len(set(ids)):
        return jsonify({'error': 'Mindestens ein ausgewähltes Workout existiert nicht mehr. Bitte die Liste neu laden.'}), 404
    selected = sorted((row.to_dict() for row in rows), key=lambda w: (w['date'], w['name'], w['id']))
    first, last = selected[0]['date'], selected[-1]['date']
    return workout_zip(selected, f'trainhub_{first}.zip' if first == last else f'trainhub_{first}_{last}.zip')


def workout_zip(selected, download_name):
    archive = BytesIO()
    try:
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for index, workout in enumerate(selected, 1):
                # The ordinal also preserves same-day workouts with identical names.
                filename = f"{workout['date']}_{index:03d}_{secure_filename(workout['name']) or 'workout'}.fit"
                bundle.writestr(filename, export_workout(workout))
    except (ValueError, RuntimeError):
        app.logger.exception('Batch FIT export failed')
        return jsonify({'error': 'Ein Workout konnte nicht exportiert werden. Es wurde kein unvollständiges ZIP erstellt.'}), 500
    archive.seek(0)
    return send_file(archive, mimetype='application/zip', as_attachment=True, download_name=download_name, max_age=0)


def planning_context():
    zone = gettz(request.args.get('timezone', 'UTC'))
    if zone is None:
        raise WorkoutError('Ungültige Zeitzone.')
    today = datetime.now(zone).date()
    # Read summaries only; large sensor streams are unnecessary for volume planning.
    rows = Activity.query.filter_by(user_id=DEMO_USER_ID).options(defer(Activity.time_series)).all()
    history = history_summary([{'date': a.date.isoformat(), 'sport': a.sport, 'duration': a.duration,
                                'details': json.loads(a.fit_details or '{}')} for a in rows], zone, today)
    user = db.session.get(User, DEMO_USER_ID)
    return history, user.ftp, today


@app.route('/api/training-blocks/context', methods=['GET'])
def training_context():
    history, ftp, today = planning_context()
    return jsonify({'history': history, 'ftp': ftp, 'today': today.isoformat()})


@app.route('/api/training-blocks/preview', methods=['POST'])
def preview_training_block():
    history, ftp, today = planning_context()
    return jsonify(make_block(request.get_json(silent=True), history, ftp, today))


@app.route('/api/training-blocks', methods=['POST'])
def save_training_block():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get('id'), str):
        raise WorkoutError('Die Block-ID fehlt.')
    try:
        identity = str(uuid.UUID(data['id']))
    except ValueError as exc:
        raise WorkoutError('Ungültige Block-ID.') from exc
    existing = db.session.get(TrainingBlock, identity)
    if existing:
        if existing.user_id != DEMO_USER_ID:
            return jsonify({'error': 'Block-ID bereits vergeben.'}), 409
        return jsonify(json.loads(existing.definition)), 200
    items = data.get('workouts')
    if not isinstance(items, list) or not 1 <= len(items) <= 32:
        raise WorkoutError('Bitte 1 bis 32 Workouts übergeben.')
    # Validate everything before writing any row. Repeated saves are idempotent.
    definitions = [validate_workout(item) for item in items]
    start, end = date_range(data.get('startDate'), data.get('endDate'))
    if (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days != 27:
        raise WorkoutError('Ein Trainingsblock umfasst genau 28 Tage.')
    if any(w['sport'] != 'ride' or not start <= w['date'] <= end for w in definitions):
        raise WorkoutError('Alle Rad-Workouts müssen innerhalb des Blocks liegen.')
    conflicts = [w.to_dict() for w in PlannedWorkout.query.filter_by(user_id=DEMO_USER_ID).all()
                 if start <= json.loads(w.definition)['date'] <= end]
    if conflicts:
        return jsonify({'error': 'Im Block-Zeitraum sind bereits Workouts geplant. Bitte diese zuerst prüfen und verschieben oder entfernen.'}), 409
    rows = [PlannedWorkout(id=str(uuid.uuid4()), user_id=DEMO_USER_ID, definition=json.dumps(w)) for w in definitions]
    result = {'id': identity, 'workouts': [row.to_dict() for row in rows]}
    db.session.add_all(rows)
    db.session.add(TrainingBlock(id=identity, user_id=DEMO_USER_ID, definition=json.dumps(result)))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        existing = db.session.get(TrainingBlock, identity)
        if existing and existing.user_id == DEMO_USER_ID:
            return jsonify(json.loads(existing.definition)), 200
        raise
    return jsonify(result), 201


@app.route('/api/user', methods=['PUT'])
def update_user():
    u = User.query.get(DEMO_USER_ID)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Bitte gültige Profildaten senden.'}), 400
    if 'name' in data:
        if not isinstance(data['name'], str) or not 1 <= len(data['name'].strip()) <= 100:
            return jsonify({'error': 'name: Bitte einen Namen mit 1 bis 100 Zeichen eingeben.'}), 400
        data['name'] = data['name'].strip()
    for field, lower, upper in [('ftp', 1, 1000), ('maxHr', 60, 250), ('age', 1, 120), ('weight', 20, 300)]:
        if field in data and data[field] is not None and (isinstance(data[field], bool) or not valid(data[field]) or not lower <= data[field] <= upper):
            return jsonify({'error': f'{field}: Bitte einen Wert zwischen {lower} und {upper} eingeben.'}), 400
    if data.get('age') is not None and data['age'] != int(data['age']):
        return jsonify({'error': 'age: Bitte ein ganzzahliges Alter eingeben.'}), 400
    if 'name' in data: u.name = data['name']
    if 'age' in data: u.age = data['age']
    if 'weight' in data: u.weight = data['weight']
    if 'sport' in data: u.sport = data['sport']
    if 'ftp' in data: u.ftp = data['ftp']
    if 'maxHr' in data: u.max_hr = data['maxHr']
    db.session.commit()
    return jsonify(u.to_dict())


@app.route('/api/activities', methods=['GET'])
def list_activities():
    sport = request.args.get('sport')
    q = Activity.query.filter_by(user_id=DEMO_USER_ID)
    if sport:
        q = q.filter_by(sport=sport)
    activities = q.options(defer(Activity.time_series)).order_by(Activity.date.desc()).all()
    return jsonify([a.to_dict() for a in activities])


def heart_rate_sparkline(series, points=48):
    """Average heart rate in equal slices of the recording; slices without readings are skipped."""
    values = [p.get('hr') for p in series if isinstance(p, dict)]
    if not values:
        return []
    size = max(1, len(values) / points)
    result = []
    for index in range(min(points, len(values))):
        chunk = [v for v in values[int(index * size):int((index + 1) * size)] if valid(v) and v > 0]
        if chunk:
            result.append(round(sum(chunk) / len(chunk)))
    return result if len(result) >= 2 else []


@app.route('/api/activities/sparklines', methods=['GET'])
def activity_sparklines():
    ids = [value for value in request.args.get('ids', '').split(',') if value][:20]
    rows = Activity.query.filter(Activity.user_id == DEMO_USER_ID, Activity.id.in_(ids)).options(load_only(Activity.id, Activity.time_series)).all() if ids else []
    return jsonify({a.id: heart_rate_sparkline(json.loads(a.time_series or '[]')) for a in rows})


@app.route('/api/activities/<activity_id>', methods=['GET'])
def get_activity(activity_id):
    a = Activity.query.get_or_404(activity_id)
    return jsonify(a.to_dict(include_ts=True))


@app.route('/api/activities/<activity_id>/file', methods=['GET'])
def download_activity_file(activity_id):
    a = Activity.query.filter_by(id=activity_id, user_id=DEMO_USER_ID).first_or_404()
    if not a.source_file:
        return jsonify({'error': 'Keine Originaldatei vorhanden.'}), 404
    details = json.loads(a.fit_details or '{}')
    return send_from_directory(app.config['UPLOAD_FOLDER'], a.source_file, as_attachment=True,
                               download_name=details.get('sourceFilename', a.source_file))


@app.route('/api/activities/<activity_id>', methods=['DELETE'])
def delete_activity(activity_id):
    a = Activity.query.get_or_404(activity_id)
    db.session.delete(a)
    db.session.commit()
    return jsonify({'deleted': True})


@app.route('/api/activities/<activity_id>', methods=['PUT'])
def update_activity(activity_id):
    a = Activity.query.get_or_404(activity_id)
    data = request.json
    if 'title' in data: a.title = data['title']
    if 'notes' in data: a.notes = data['notes']
    if 'tags' in data: a.tags = json.dumps(data['tags'])
    if 'sport' in data: a.sport = data['sport']
    db.session.commit()
    return jsonify(a.to_dict())


@app.route('/api/upload', methods=['POST'])
def upload_activity():
    sport = request.form.get('sport', 'run')
    title = request.form.get('title', '')

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    ext = 'fit' if file.filename.lower().endswith('.fit.gz') else file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'error': f'Unsupported file type: .{ext}. Supported: .fit, .gpx, .tcx, .csv'}), 400

    filename = secure_filename(f"{uuid.uuid4()}_{file.filename}")
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    # Duplicate detection
    try:
        file_hash = hashlib.sha256(read_fit_bytes(filepath)).hexdigest() if ext == 'fit' else compute_file_hash(filepath)
    except FitImportError as exc:
        os.remove(filepath)
        return jsonify({'error': str(exc)}), 422
    existing = Activity.query.filter_by(user_id=DEMO_USER_ID, file_hash=file_hash).first()
    if existing:
        os.remove(filepath)
        return jsonify({'error': 'Diese Datei wurde bereits importiert.', 'existing_id': existing.id}), 409

    # Parse
    parser = PARSERS.get(ext)
    if not parser:
        os.remove(filepath)
        return jsonify({'error': 'No parser available'}), 400

    try:
        session_data, time_series = parser(filepath)
    except FitImportError as e:
        os.remove(filepath)
        return jsonify({'error': str(e)}), 422
    except Exception:
        os.remove(filepath)
        app.logger.exception('Activity import failed')
        return jsonify({'error': 'Die Datei konnte nicht gelesen werden. Bitte das Dateiformat prüfen.'}), 422

    if not session_data:
        os.remove(filepath)
        return jsonify({'error': 'Could not extract data from file'}), 422

    details = session_data.get('fit_details', {})
    if details:
        details['sourceFilename'] = file.filename
    default_title = file.filename.rsplit('.', 1)[0].replace('_', ' ').replace('-', ' ')
    if details:
        sport_name = {'ride': 'Radfahren', 'run': 'Laufen', 'swim': 'Schwimmen', 'multisport': 'Multisport'}.get(session_data['sport'], session_data['sport'])
        default_title = f"{sport_name} · {session_data['date']:%d.%m.%Y}"
    # Create activity
    activity = Activity(
        user_id=DEMO_USER_ID,
        title=title or default_title,
        sport=session_data.get('sport', sport),
        date=session_data.get('date', datetime.utcnow()),
        duration=session_data.get('duration'),
        distance=session_data.get('distance'),
        hr_avg=session_data.get('hr_avg'),
        hr_max=session_data.get('hr_max'),
        power_avg=session_data.get('power_avg'),
        cadence_avg=session_data.get('cadence_avg'),
        elevation=session_data.get('elevation'),
        calories=session_data.get('calories'),
        speed_avg=session_data.get('speed_avg'),
        source_file=filename,
        source_type='.fit.gz' if file.filename.lower().endswith('.fit.gz') else f'.{ext}',
        file_hash=file_hash,
        time_series=json.dumps(time_series),
        fit_details=json.dumps(details),
        tags='[]',
        notes='',
    )
    db.session.add(activity)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        os.remove(filepath)
        raise

    # Batch imports only need a lightweight list row; detail requests retain all data.
    return jsonify(activity.to_dict(include_ts=request.args.get('summary') != '1')), 201


@app.route('/api/activities/manual', methods=['POST'])
def create_manual_activity():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    activity = Activity(
        user_id=DEMO_USER_ID,
        title=data.get('title', 'Workout'),
        sport=data.get('sport', 'run'),
        date=datetime.fromisoformat(data['date']) if 'date' in data else datetime.utcnow(),
        duration=data.get('duration', 0),
        distance=data.get('distance', 0),
        hr_avg=data.get('hrAvg'),
        hr_max=data.get('hrMax'),
        power_avg=data.get('power'),
        cadence_avg=data.get('cadence'),
        elevation=data.get('elevation'),
        calories=data.get('calories'),
        speed_avg=data.get('speedAvg'),
        source_type='manual',
        tags=json.dumps(data.get('tags', [])),
        notes=data.get('notes', ''),
        time_series='[]',
    )
    db.session.add(activity)
    db.session.commit()
    return jsonify(activity.to_dict()), 201


@app.route('/api/stats/weekly', methods=['GET'])
def weekly_stats():
    now = datetime.utcnow()
    weeks = []
    for w in range(4):
        end = now - timedelta(days=w * 7)
        start = end - timedelta(days=7)
        acts = Activity.query.filter(
            Activity.user_id == DEMO_USER_ID,
            Activity.date >= start,
            Activity.date < end
        ).all()
        weeks.append({
            'week': w,
            'label': 'This Week' if w == 0 else f'{w} Week{"s" if w > 1 else ""} Ago',
            'count': len(acts),
            'duration': sum(a.duration or 0 for a in acts),
            'distance': round(sum(a.distance or 0 for a in acts), 1),
            'calories': sum(a.calories or 0 for a in acts),
        })
    return jsonify(weeks)


@app.route('/api/best-efforts', methods=['GET'])
def best_efforts():
    sport = request.args.get('sport', 'ride')
    zone = gettz(request.args.get('timezone', 'Europe/Berlin'))
    if sport not in TARGETS or zone is None:
        return jsonify({'error': 'Ungültige Sportart oder Zeitzone.'}), 400
    period = request.args.get('year', str(datetime.now(zone).year))
    if period != 'all' and (not period.isascii() or not period.isdigit() or len(period) != 4 or not 1970 <= int(period) <= 9998):
        return jsonify({'error': 'Bitte ein gültiges Jahr oder All-Time auswählen.'}), 400
    query = Activity.query.filter_by(user_id=DEMO_USER_ID).filter(Activity.sport.in_([sport, 'multisport']))
    dates = db.session.query(Activity.date).filter(Activity.user_id == DEMO_USER_ID, Activity.sport.in_(['ride', 'run', 'multisport'])).all()
    years = sorted({date.replace(tzinfo=timezone.utc).astimezone(zone).year for (date,) in dates}, reverse=True)
    if period != 'all':
        start = datetime(int(period), 1, 1, tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None)
        end = datetime(int(period) + 1, 1, 1, tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None)
        query = query.filter(Activity.date >= start, Activity.date < end)
    # Cached requests read summaries only, not the full sensor streams.
    activities = query.options(load_only(Activity.id, Activity.title, Activity.sport, Activity.date), selectinload(Activity.effort_cache)).order_by(Activity.date, Activity.id).all()
    best = {}
    eligible = 0
    for activity in activities:
        cache = activity.effort_cache
        if cache is None or cache.version != EFFORT_VERSION or cache.sport != activity.sport:
            with db.session.no_autoflush:
                efforts = activity_efforts(json.loads(activity.time_series or '[]'), activity.sport, json.loads(activity.fit_details or '{}'), activity.date)
            if cache is None:
                cache = BestEffortCache(activity=activity)
                db.session.add(cache)
            cache.version, cache.sport, cache.efforts = EFFORT_VERSION, activity.sport, json.dumps(efforts)
        else:
            efforts = json.loads(cache.efforts)
        if efforts[sport]:
            eligible += 1
        for effort in efforts[sport]:
            previous = best.get(effort['target'])
            if previous is None or (effort['value'] > previous['value'] if sport == 'ride' else effort['value'] < previous['value']):
                best[effort['target']] = {**effort, 'activity': {'id': activity.id, 'title': activity.title, 'date': activity.date.isoformat() + 'Z'}}
    try:
        db.session.commit()
    except IntegrityError:
        # Overlapping year/All-Time requests may have cached the same activity.
        # The computed response remains valid; the other request owns the cache.
        db.session.rollback()
    return jsonify({'sport': sport, 'year': period, 'years': years, 'eligibleActivities': eligible,
                    'efforts': [best.get(target, {'target': target, 'value': None, 'activity': None}) for target in TARGETS[sport]]})


def load_analytics_rows():
    """Shared versioned summaries for dashboards and athlete context; warm reads skip streams."""
    activities = Activity.query.filter_by(user_id=DEMO_USER_ID).options(
        load_only(Activity.id, Activity.sport), selectinload(Activity.analytics_cache)).order_by(Activity.date, Activity.id).all()
    rows = []
    for activity in activities:
        cache = activity.analytics_cache
        if cache is None or cache.version != ANALYTICS_VERSION or cache.sport != activity.sport:
            with db.session.no_autoflush:
                summary = activity_summary(activity, json.loads(activity.time_series or '[]'), json.loads(activity.fit_details or '{}'))
            if cache is None:
                cache = AnalyticsCache(activity=activity)
                db.session.add(cache)
            cache.version, cache.sport, cache.summary = ANALYTICS_VERSION, activity.sport, json.dumps(summary)
        else:
            summary = json.loads(cache.summary)
        rows.extend({**row, 'activityId': activity.id} for row in summary)
    return rows


@app.route('/api/analytics', methods=['GET'])
def analytics():
    zone = gettz(request.args.get('timezone', 'Europe/Berlin'))
    period = request.args.get('year', str(datetime.now().year))
    sport = request.args.get('sport', 'all')
    if zone is None or sport not in ('all', 'ride', 'run', 'swim', 'walking', 'hiking', 'multisport'):
        return jsonify({'error': 'Ungültige Sportart oder Zeitzone.'}), 400
    if period != 'all' and (not period.isascii() or not period.isdigit() or len(period) != 4 or not 1970 <= int(period) <= 9998):
        return jsonify({'error': 'Bitte ein gültiges Jahr oder All-Time auswählen.'}), 400
    user = db.session.get(User, DEMO_USER_ID)
    rows = load_analytics_rows()
    result = aggregate(rows, period, zone, user.ftp, user.max_hr, sport)
    result['fitness'] = fitness(rows, zone, user.ftp, user.max_hr)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
    return jsonify(result)


def load_effort_rows():
    """Reuse per-activity best efforts, retaining dates without exposing recordings."""
    activities = Activity.query.filter_by(user_id=DEMO_USER_ID).filter(
        Activity.sport.in_(['ride', 'run', 'multisport'])).options(
        load_only(Activity.id, Activity.date, Activity.sport, Activity.fit_details),
        selectinload(Activity.effort_cache)).order_by(Activity.date, Activity.id).all()
    result = []
    for activity in activities:
        cache = activity.effort_cache
        details = json.loads(activity.fit_details or '{}')
        if cache is None or cache.version != EFFORT_VERSION or cache.sport != activity.sport:
            with db.session.no_autoflush:
                efforts = activity_efforts(json.loads(activity.time_series or '[]'), activity.sport, details, activity.date)
            if cache is None:
                cache = BestEffortCache(activity=activity)
                db.session.add(cache)
            cache.version, cache.sport, cache.efforts = EFFORT_VERSION, activity.sport, json.dumps(efforts)
        else:
            efforts = json.loads(cache.efforts)
        for sport, items in efforts.items():
            for effort in items:
                effort_date = activity.date + timedelta(seconds=effort.get('startSeconds', 0))
                result.append({'sport': sport, 'target': effort['target'], 'value': effort['value'],
                               'date': effort_date.isoformat(), 'utc': bool(details), 'activityId': activity.id})
    return result


from coach_api import register_coach
from appearance import register_appearance
from whoop_sync import register_whoop, start_whoop_worker
register_coach(app, db, User, Activity, PlannedWorkout, DEMO_USER_ID, load_analytics_rows, load_effort_rows)
register_appearance(app)
register_whoop(app, db, User, DEMO_USER_ID)


if __name__ == '__main__':
    initialize_database()
    start_whoop_worker(app)
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_DEBUG') == '1')
