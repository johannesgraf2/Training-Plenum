"""Claude on Training Plēnum: a Model Context Protocol server at /mcp.

Streamable HTTP without sessions: every JSON-RPC request is a POST answered with one JSON response, and GET opens
no event stream (405). The version is negotiated in `initialize`; the MCP-Protocol-Version header is not checked, so
newer clients that first probe with `server/discover` get "method not found" for it and fall back to the handshake. The tools read through the app's own API (`internal`), so Claude gets what the app shows,
with the same checks and the same Garmin calendar sync on changes. Tools that change planned workouts exist only
while the athlete allows writing. GPS positions never leave: activity details carry no coordinates.

Two kinds of bearer token open /mcp:
- The personal token, created in the app and shown once, for Claude Code and Claude Desktop (mcp-remote). Only its
  SHA-256 is stored, like the WHOOP bridge token.
- OAuth 2.1 for Claude's hosted apps (claude.ai, desktop connectors, mobile). They register themselves (RFC 7591),
  sign in with PKCE (S256) and refresh with rotating refresh tokens. Those apps connect from Anthropic's cloud, so the
  sign-in page is on the internet once the Claude port is published with Tailscale Funnel (remote_access.py); it
  therefore asks for a one-time approval code that only the app itself shows.
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlencode, urlparse

from dateutil.tz import gettz
from flask import jsonify, make_response, redirect, request
from jsonschema import Draft202012Validator

from analytics import HR_LIMITS, POWER_LIMITS, activity_summary, zones
from remote_access import allowed_origins

VERSION = '1.0.0'
PROTOCOL_VERSIONS = ('2025-11-25', '2025-06-18', '2025-03-26')
ACCESS_SECONDS = 3600
REFRESH_DAYS = 60
CODE_SECONDS = 300
PAIRING_MINUTES = 10
PAIRING_ATTEMPTS = 5
PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no 0/O, 1/I: read off one screen, typed on another
MAX_CLIENTS = 100
MAX_BODY = 1024 * 1024
USED_EVERY = timedelta(minutes=1)  # how often "last used" is written
LOOPBACK = ('localhost', '127.0.0.1', '::1')
HOST = re.compile(r'^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$')
VERIFIER = re.compile(r'^[A-Za-z0-9._~-]{43,128}$')
CHANNELS = ('hr', 'power', 'speed', 'cadence', 'elevation', 'distance')

INSTRUCTIONS = (
    'Training Plēnum ist die selbst gehostete Trainingsplattform des Athleten (Radfahren, Laufen, Schwimmen). '
    'Beginne mit get_training_overview für Profil, Schwellen, aktuelle Belastung und Ziele. Einheiten: Dauer in '
    'Minuten, Distanz in km, Leistung in Watt, Puls in bpm, Pace in Sekunden pro km. Fitness ist die CTL (42 Tage), '
    'Zonen beziehen sich auf die gespeicherte FTP und HFmax. Werte sind eigene Berechnungen der Plattform; WHOOP-Werte '
    'sind Näherungen, kein Medizinprodukt. Plane Einheiten nur, wenn der Athlet darum bittet, und nenne Datum und '
    'Inhalt, bevor du sie anlegst oder änderst. Gesperrte Einheiten lassen sich nicht ändern.')


class ToolError(Exception):
    """A tool call that cannot be answered; Claude sees the message and can correct itself."""


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def utc(value):
    return value.isoformat() + 'Z' if value else None


def compact(value):
    """JSON without empty fields, so tool results stay small."""
    if isinstance(value, dict):
        return {key: compact(item) for key, item in value.items() if item not in (None, '', [], {})}
    if isinstance(value, list):
        return [compact(item) for item in value]
    if isinstance(value, float):
        return round(value, 2)
    return value


def day(value, label):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ToolError(f'{label}: Bitte ein Datum im Format JJJJ-MM-TT angeben.') from None


def local_zone():
    return gettz(os.environ.get('TRAINHUB_TIMEZONE', 'Europe/Berlin')) or gettz('UTC')


def local_today():
    return datetime.now(local_zone()).date()


def local_date(value):
    """The athlete's calendar day of an activity: FIT times are UTC (with Z), manual entries local wall time."""
    moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return (moment.astimezone(local_zone()) if moment.tzinfo else moment).date().isoformat()


def timezone_name():
    return os.environ.get('TRAINHUB_TIMEZONE', 'Europe/Berlin')


# ─── Tool definitions ───

DATE = {'type': 'string', 'pattern': r'^\d{4}-\d{2}-\d{2}$', 'description': 'Datum im Format JJJJ-MM-TT'}
ID = {'type': 'string', 'pattern': r'^[A-Za-z0-9_-]{1,64}$'}
STEP = {'type': 'object', 'required': ['kind', 'intensity', 'duration', 'target'], 'properties': {
    'kind': {'const': 'step'},
    'name': {'type': 'string', 'maxLength': 80, 'description': 'Kurzer Schrittname, z. B. "4 min Schwelle"'},
    'intensity': {'enum': ['warmup', 'active', 'interval', 'recovery', 'cooldown']},
    'duration': {'type': 'object', 'required': ['type'], 'properties': {
        'type': {'enum': ['time', 'distance', 'open']},
        'value': {'type': 'number', 'description': 'Sekunden bei time, Meter bei distance; entfällt bei open (bis Lap-Taste)'}}},
    'target': {'type': 'object', 'required': ['type'], 'properties': {
        'type': {'enum': ['none', 'power', 'heart_rate', 'pace', 'speed', 'cadence']},
        'low': {'type': 'number'}, 'high': {'type': 'number'}},
        'description': 'Zielbereich low bis high: power in Watt, heart_rate in bpm, pace in Sekunden pro km '
                       '(low ist die schnellere Pace, z. B. 240 bis 250 für 4:00 bis 4:10), speed in km/h, '
                       'cadence in U/min. Beim Schwimmen nur none oder heart_rate.'}}}
REPEAT = {'type': 'object', 'required': ['kind', 'count', 'steps'], 'properties': {
    'kind': {'const': 'repeat'}, 'count': {'type': 'integer', 'minimum': 2, 'maximum': 99},
    'steps': {'type': 'array', 'minItems': 1, 'items': STEP}}}
WORKOUT = {'type': 'object', 'required': ['name', 'sport', 'date', 'steps'], 'properties': {
    'name': {'type': 'string', 'minLength': 1, 'maxLength': 80},
    'sport': {'enum': ['ride', 'run', 'swim']},
    'date': DATE,
    'notes': {'type': 'string', 'maxLength': 250, 'description': 'Hinweis aufs Gerät, z. B. zur Verpflegung'},
    'steps': {'type': 'array', 'minItems': 1, 'maxItems': 50, 'items': {'anyOf': [STEP, REPEAT]},
              'description': 'Höchstens 50 Schritte einschließlich der Wiederholungsblöcke'}}}

READ = {'readOnlyHint': True, 'openWorldHint': False}
WRITE = {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': False, 'openWorldHint': False}


def schema(properties=None, required=()):
    return {'type': 'object', 'properties': properties or {}, 'required': list(required), 'additionalProperties': False}


def register_mcp(app, db, user_id):
    class McpAccess(db.Model):
        """The personal token, the write permission and the pending approval code for the OAuth sign-in."""
        __tablename__ = 'mcp_access'
        user_id = db.Column(db.String(36), db.ForeignKey('user.id'), primary_key=True)
        token_hash = db.Column(db.String(64), nullable=True)
        token_created_at = db.Column(db.DateTime, nullable=True)
        token_used_at = db.Column(db.DateTime, nullable=True)
        last_client = db.Column(db.String(100), nullable=True)
        allow_write = db.Column(db.Boolean, nullable=False, default=False)
        pairing_hash = db.Column(db.String(64), nullable=True)
        pairing_expires_at = db.Column(db.DateTime, nullable=True)
        pairing_attempts = db.Column(db.Integer, nullable=False, default=0)

    class McpClient(db.Model):
        """An OAuth client that registered itself, e.g. claude.ai."""
        __tablename__ = 'mcp_client'
        id = db.Column(db.String(64), primary_key=True)
        name = db.Column(db.String(100), nullable=False)
        redirect_uris = db.Column(db.Text, nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class McpGrant(db.Model):
        """An authorization code, access or refresh token, stored by its SHA-256.

        A family is one approval: refreshing replaces its tokens, disconnecting deletes it."""
        __tablename__ = 'mcp_grant'
        id = db.Column(db.String(64), primary_key=True)
        kind = db.Column(db.String(10), nullable=False)  # code, access or refresh
        client_id = db.Column(db.String(64), nullable=False, index=True)
        family = db.Column(db.String(36), nullable=False, index=True)
        data = db.Column(db.Text, nullable=False, default='{}')
        expires_at = db.Column(db.DateTime, nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        used_at = db.Column(db.DateTime, nullable=True)

    app.extensions['mcp_models'] = (McpAccess, McpClient, McpGrant)

    def access(create=False):
        row = db.session.get(McpAccess, user_id)
        if row is None and create:
            row = McpAccess(user_id=user_id, allow_write=False, pairing_attempts=0)
            db.session.add(row)
        return row

    def base_url():
        """The address the client used; behind Tailscale serve or nginx the forwarded headers tell it."""
        proto = request.headers.get('X-Forwarded-Proto', '').split(',')[0].strip()
        host = request.headers.get('X-Forwarded-Host', '').split(',')[0].strip()
        proto = proto if proto in ('http', 'https') else request.scheme
        host = host if HOST.match(host) else request.host
        return f'{proto}://{host}'

    # ─── Internal API calls for the tools ───

    def internal(method, path, query=None, body=None):
        """Answer through the app's own route, with its validation and hooks, inside the current app context."""
        options = {'method': method, 'query_string': query or {}, 'base_url': 'http://localhost'}
        if body is not None:
            options['json'] = body
        with app.test_request_context(path, **options):
            try:
                response = app.full_dispatch_request()
            except Exception:  # an unexpected failure must not end the whole MCP request
                app.logger.exception('MCP tool request %s %s failed', method, path)
                db.session.rollback()
                raise ToolError('Training Plēnum konnte die Anfrage nicht beantworten. Details stehen im Log.') from None
        data = response.get_json(silent=True)
        if response.status_code >= 400:
            message = data.get('error') if isinstance(data, dict) else None
            raise ToolError(message or ('Nicht gefunden.' if response.status_code == 404 else f'Fehler {response.status_code}.'))
        return data

    def athlete():
        return internal('GET', '/api/user')

    # ─── Tools ───

    def training_overview(_):
        snapshot = internal('GET', '/api/athlete-snapshot', {'timezone': timezone_name()})
        reported = snapshot.get('selfReported') or {}
        since = (local_today() - timedelta(days=14)).isoformat()
        # The profile keeps months of check-ins and overrides; the recent ones carry what matters now.
        for key, field in (('checkIns', 'date'), ('dailyOverrides', 'date')):
            if isinstance(reported.get(key), list):
                reported[key] = [item for item in reported[key] if str(item.get(field, '')) >= since]
        if isinstance(reported.get('weeklyOverrides'), list):
            reported['weeklyOverrides'] = reported['weeklyOverrides'][-8:]
        snapshot.get('dataQuality', {}).pop('definitions', None)
        name = (athlete() or {}).get('name')
        return compact({'name': name, **snapshot})

    def list_activities(arguments):
        first = day(arguments['from'], 'from') if arguments.get('from') else None
        last = day(arguments['to'], 'to') if arguments.get('to') else None
        query = {'sport': arguments['sport']} if arguments.get('sport') else None
        items = []
        for activity in internal('GET', '/api/activities', query):
            local = local_date(activity['date'])
            if (first and local < first.isoformat()) or (last and local > last.isoformat()):
                continue
            items.append({'id': activity['id'], 'date': activity['date'], 'sport': activity['sport'], 'title': activity['title'],
                          'durationMin': activity['duration'], 'distanceKm': activity['distance'], 'hrAvg': activity['hrAvg'],
                          'hrMax': activity['hrMax'], 'powerAvg': activity['power'], 'elevationM': activity['elevation'],
                          'calories': activity['calories'], 'speedAvgKmh': activity['speedAvg'], 'notes': activity['notes'],
                          'origin': activity['origin']})
            if len(items) >= arguments.get('limit', 30):
                break
        return {'activities': compact(items), 'count': len(items)}

    def activity_analysis(activity, records, profile):
        """NP, TSS and zone minutes per session, as the dashboard counts them."""
        source = SimpleNamespace(date=activity['date'], sport=activity['sport'], duration=activity['duration'],
                                 distance=activity['distance'], elevation=activity['elevation'], calories=activity['calories'])
        ftp, max_hr = profile.get('ftp'), profile.get('maxHr')
        result = []
        for row in activity_summary(source, records, activity.get('fitDetails') or {}):
            entry = {'sport': row['sport'], 'start': row['date'], 'seconds': row['seconds'], 'normalizedPower': row['power']['np']}
            if ftp and row.get('tssFactor') is not None:
                entry['tss'] = row['tssFactor'] / ftp ** 2
            if max_hr and row['hr']['seconds']:
                entry['hrZoneMinutes'] = [round(s / 60, 1) for s in zones(row['hr']['histogram'], max_hr, HR_LIMITS)]
            if ftp and row['sport'] == 'ride' and row['power']['seconds']:
                entry['powerZoneMinutes'] = [round(s / 60, 1) for s in zones(row['power']['histogram'], ftp, POWER_LIMITS)]
            result.append(entry)
        return result

    def samples(records, count):
        """The recording in `count` equal slices, averaged per channel; never positions."""
        timed = [point for point in records if isinstance(point.get('time'), (int, float))]
        if not timed or not count:
            return []
        size = max(1, len(timed) / count)
        result = []
        for index in range(min(count, len(timed))):
            chunk = timed[int(index * size):int((index + 1) * size)]
            if not chunk:
                continue
            point = {'t': round(chunk[0]['time'])}
            for key in CHANNELS:
                values = [p[key] for p in chunk if isinstance(p.get(key), (int, float)) and not isinstance(p.get(key), bool)]
                if values:
                    point[key] = round(values[-1] if key == 'distance' else sum(values) / len(values), 1)
            result.append(point)
        return result

    def get_activity(arguments):
        activity = internal('GET', f'/api/activities/{arguments["id"]}')
        records = activity.pop('timeSeries', []) or []
        details = activity.get('fitDetails') or {}
        laps = [{key: lap.get(key) for key in ('startTime', 'timerSeconds', 'distanceKm', 'hrAvg', 'hrMax', 'power',
                                               'cadence', 'speedAvg', 'elevation')} for lap in details.get('laps', [])[:200]]
        result = {key: activity.get(key) for key in ('id', 'title', 'sport', 'date', 'duration', 'distance', 'hrAvg', 'hrMax',
                                                      'power', 'cadence', 'elevation', 'calories', 'speedAvg', 'tags', 'notes',
                                                      'origin', 'timerSeconds', 'elapsedSeconds')}
        result.update(units='duration min, distance km, speedAvg km/h, elevation m', laps=laps,
                      measurements=[m for m in details.get('measurements', []) if m != 'gps'],
                      analysis=activity_analysis(activity, records, athlete() or {}),
                      zones='HR-Zonen 1–5: <60/70/80/90/>90 % HFmax; Leistungszonen 1–7: <55/75/90/105/120/150/>150 % FTP')
        if arguments.get('samples'):
            result['samples'] = samples(records, arguments['samples'])
            result['sampleUnits'] = 't s seit Start, hr bpm, power W, speed km/h, cadence U/min, elevation m, distance m'
        return compact(result)

    def training_load(arguments):
        weeks = arguments.get('weeks', 12)
        sport = arguments.get('sport', 'all')
        today = local_today()
        first = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
        rows, fitness = [], None
        hours = lambda values: [round(v / 3600, 2) for v in values]  # noqa: E731
        for year in range(first.year, today.year + 1):
            data = internal('GET', '/api/analytics', {'year': str(year), 'sport': sport, 'timezone': timezone_name()})
            fitness = data.get('fitness')
            for week in data.get('weeks', []):
                if first.isoformat() <= week['key'] <= today.isoformat() and week['key'] not in {r['week'] for r in rows}:
                    rows.append({'week': week['key'], 'label': week['label'], 'activities': week['count'],
                                 'hours': round(week['seconds'] / 3600, 2) if week['seconds'] is not None else None,
                                 'distanceKm': week['distance'], 'elevationM': week['elevation'], 'tss': week['tss'],
                                 'hrZoneHours': hours(week['hrZones']), 'powerZoneHours': hours(week['powerZones'])})
        days = [d for d in (fitness or {}).get('days', []) if d['key'] >= first.isoformat()]
        weekly = [d for d in days if date.fromisoformat(d['key']).weekday() == 6 or d['key'] == today.isoformat()]
        return compact({'sport': sport, 'weeks': rows, 'fitness': {
            'current': (fitness or {}).get('value'), 'endOfWeek': [{'date': d['key'], 'ctl': d['value']} for d in weekly],
            'explanation': 'CTL: 42-Tage-Durchschnitt der Tagesbelastung (Leistungs-TSS, sonst Puls-TSS)'}})

    def best_efforts(arguments):
        data = internal('GET', '/api/best-efforts', {'sport': arguments['sport'], 'year': arguments.get('year', 'all'),
                                                     'timezone': timezone_name()})
        unit = 'Watt (Durchschnitt)' if arguments['sport'] == 'ride' else 'Sekunden'
        return compact({**data, 'unit': unit})

    def planned_workouts(arguments):
        today = local_today()
        first = day(arguments['from'], 'from') if arguments.get('from') else today
        last = day(arguments['to'], 'to') if arguments.get('to') else first + timedelta(days=13)
        if (last - first).days > 120:
            raise ToolError('Bitte höchstens 120 Tage auf einmal abfragen.')
        items = [w for w in internal('GET', '/api/workouts') if first.isoformat() <= w['date'] <= last.isoformat()]
        return {'from': first.isoformat(), 'to': last.isoformat(), 'workouts': items}

    def today(arguments):
        query = {'timezone': timezone_name(), **({'date': arguments['date']} if arguments.get('date') else {})}
        return compact(internal('GET', '/api/coach/today', query))

    def recovery(arguments):
        last = day(arguments['to'], 'to') if arguments.get('to') else local_today()
        first = day(arguments['from'], 'from') if arguments.get('from') else last - timedelta(days=13)
        return compact(internal('GET', '/api/whoop/days', {'from': first.isoformat(), 'to': last.isoformat()}))

    def create_workout(arguments):
        return internal('POST', '/api/workouts', body=arguments['workout'])

    def update_workout(arguments):
        return internal('PUT', f'/api/workouts/{arguments["id"]}', body=arguments['workout'])

    def delete_workout(arguments):
        internal('DELETE', f'/api/workouts/{arguments["id"]}')
        return {'deleted': arguments['id']}

    sports = {'type': 'string', 'enum': ['ride', 'run', 'swim', 'walking', 'hiking', 'multisport']}
    tools = [
        ('get_training_overview', 'Trainingsüberblick', READ, schema(), training_overview, False,
         'Kompakter Überblick über den Athleten: Profil mit FTP, HFmax und Gewicht, Umfang und Intensität der letzten '
         '7, 28 und 42 Tage, die letzten 365 Tage, Bestwerte, Ziele, Wettkämpfe, Verfügbarkeit, Beschwerden und die '
         'Check-ins der letzten 14 Tage. Der beste Einstieg für jede Frage zum Training.'),
        ('list_activities', 'Aktivitäten auflisten', READ,
         schema({'from': DATE, 'to': DATE, 'sport': sports,
                 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200, 'default': 30}}),
         list_activities, False,
         'Absolvierte Aktivitäten, neueste zuerst, mit Dauer (min), Distanz (km), Puls, Leistung, Höhenmetern und Notizen. '
         'Optional nach Zeitraum und Sportart gefiltert. Details zu einer Aktivität liefert get_activity.'),
        ('get_activity', 'Aktivität ansehen', READ,
         schema({'id': {**ID, 'description': 'ID aus list_activities'},
                 'samples': {'type': 'integer', 'minimum': 0, 'maximum': 500, 'default': 0,
                             'description': 'Anzahl gemittelter Messpunkte des Verlaufs (0 = keiner), z. B. 120 für Intervalle'}},
                ['id']),
         get_activity, False,
         'Eine Aktivität mit Runden, Normalized Power, TSS und Minuten je Puls- und Leistungszone. Mit samples zusätzlich '
         'der Verlauf von Puls, Leistung, Tempo, Kadenz und Höhe. GPS-Positionen werden nie übertragen.'),
        ('get_training_load', 'Wochenumfang & Fitness', READ,
         schema({'weeks': {'type': 'integer', 'minimum': 1, 'maximum': 104, 'default': 12}, 'sport': {**sports, 'enum': ['all', *sports['enum']]}}),
         training_load, False,
         'Wochenweise Stunden, Distanz, Höhenmeter, TSS und Stunden je Puls- und Leistungszone der letzten Wochen, dazu '
         'die Fitness (CTL) am Ende jeder Woche.'),
        ('get_best_efforts', 'Bestwerte', READ,
         schema({'sport': {'enum': ['ride', 'run']}, 'year': {'type': 'string', 'pattern': r'^(\d{4}|all)$', 'default': 'all'}}, ['sport']),
         best_efforts, False,
         'Bestwerte: Rad als höchste Durchschnittsleistung über 30 s bis 60 min, Laufen als schnellste Zeit über 400 m '
         'bis 21 km, für ein Jahr oder all (gesamte Historie).'),
        ('list_planned_workouts', 'Geplante Einheiten', READ, schema({'from': DATE, 'to': DATE}), planned_workouts, False,
         'Geplante Workouts im Kalender mit allen Schritten und Zielen; ohne Angaben die nächsten 14 Tage. locked heißt, '
         'die Einheit ist fixiert und darf nicht geändert werden.'),
        ('get_today', 'Heute', READ, schema({'date': DATE}), today, False,
         'Der Tag aus Sicht des AI Coachs: geplante Einheiten, Check-in, Ampel für die Tagesform, aktive Beschwerden, '
         'WHOOP-Erholung, Hinweise und die Einheiten der nächsten drei Tage.'),
        ('get_recovery', 'Erholung (WHOOP)', READ, schema({'from': DATE, 'to': DATE}), recovery, False,
         'Tageswerte vom WHOOP-Strap: Schlaf, nächtliche HRV (RMSSD), Ruhepuls, Readiness 0–100, Strain und Schlafschuld; '
         'ohne Angaben die letzten 14 Tage. Leer, wenn kein WHOOP verbunden ist.'),
        ('create_planned_workout', 'Einheit planen', WRITE, schema({'workout': WORKOUT}, ['workout']), create_workout, True,
         'Legt ein strukturiertes Workout im Kalender an. Ist Garmin Connect verbunden und das Senden aktiv, landet es auch '
         'im Garmin-Kalender. Watt- und Pulsziele aus FTP und HFmax von get_training_overview ableiten.'),
        ('update_planned_workout', 'Einheit ändern', WRITE,
         schema({'id': ID, 'workout': WORKOUT}, ['id', 'workout']), update_workout, True,
         'Ersetzt ein geplantes Workout vollständig (auch zum Verschieben: neues date). Gesperrte Einheiten sind ausgenommen.'),
        ('delete_planned_workout', 'Einheit löschen', {**WRITE, 'destructiveHint': True, 'idempotentHint': True},
         schema({'id': ID}, ['id']), delete_workout, True,
         'Löscht ein geplantes Workout aus dem Kalender. Gesperrte Einheiten sind ausgenommen.'),
    ]
    tools = {name: {'name': name, 'title': title, 'annotations': {'title': title, **hints}, 'inputSchema': input_schema,
                    'handler': handler, 'write': write, 'description': description,
                    'validator': Draft202012Validator(input_schema)}
             for name, title, hints, input_schema, handler, write, description in tools}

    def call_tool(params, allow_write):
        tool = tools.get(params.get('name'))
        if tool is None:
            raise LookupError(f'Unbekanntes Werkzeug: {params.get("name")}')
        arguments = params.get('arguments') or {}
        try:
            if tool['write'] and not allow_write:
                raise ToolError('Claude darf in Training Plēnum gerade nur lesen. Schreiben erlaubt der Athlet in '
                                'Training Plēnum unter „Claude & Fernzugriff“.')
            error = next(iter(sorted(tool['validator'].iter_errors(arguments), key=lambda e: list(e.absolute_path))), None)
            if error:
                where = '/'.join(str(part) for part in error.absolute_path)
                raise ToolError(f'Ungültige Argumente{f" bei {where}" if where else ""}: {error.message}')
            data = tool['handler'](arguments)
            return {'content': [{'type': 'text', 'text': json.dumps(data, ensure_ascii=False, separators=(',', ':'))}], 'isError': False}
        except ToolError as error:
            return {'content': [{'type': 'text', 'text': str(error)}], 'isError': True}

    # ─── JSON-RPC ───

    def rpc_error(identity, code, message):
        return {'jsonrpc': '2.0', 'id': identity, 'error': {'code': code, 'message': message}}

    def handle(message, caller):
        if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
            return rpc_error(message.get('id') if isinstance(message, dict) else None, -32600, 'Invalid Request')
        method = message.get('method')
        if 'id' not in message or not isinstance(method, str):
            return None  # a notification or a response to the server: nothing to answer
        identity, params = message['id'], message.get('params') or {}
        if not isinstance(params, dict):
            return rpc_error(identity, -32602, 'params muss ein Objekt sein.')
        row = access()
        allow_write = bool(row and row.allow_write)
        if method == 'initialize':
            requested = params.get('protocolVersion')
            client = ((params.get('clientInfo') or {}).get('name') or '')[:100]
            if caller[0] == 'token' and client and row:
                row.last_client = client
                db.session.commit()
            result = {'protocolVersion': requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                      'capabilities': {'tools': {'listChanged': False}},
                      'serverInfo': {'name': 'training-plenum', 'title': 'Training Plēnum', 'version': VERSION},
                      'instructions': INSTRUCTIONS}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': [{key: tool[key] for key in ('name', 'title', 'description', 'inputSchema', 'annotations')}
                                for tool in tools.values() if allow_write or not tool['write']]}
        elif method == 'tools/call':
            try:
                result = call_tool(params, allow_write)
            except LookupError as error:
                return rpc_error(identity, -32602, str(error))
        elif method in ('resources/list', 'resources/templates/list', 'prompts/list'):
            result = {{'resources/list': 'resources', 'resources/templates/list': 'resourceTemplates', 'prompts/list': 'prompts'}[method]: []}
        else:
            return rpc_error(identity, -32601, f'Method not found: {method}')
        return {'jsonrpc': '2.0', 'id': identity, 'result': result}

    def caller():
        """('token', access row) or ('oauth', grant) for a valid bearer token, else None."""
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer ') or not header[7:].strip():
            return None
        hashed = digest(header[7:].strip())
        now = datetime.utcnow()
        row = access()
        if row and row.token_hash and hmac.compare_digest(hashed, row.token_hash):
            if not row.token_used_at or now - row.token_used_at > USED_EVERY:
                row.token_used_at = now
                db.session.commit()
            return 'token', row
        grant = db.session.get(McpGrant, hashed)
        if grant and grant.kind == 'access' and grant.expires_at > now:
            if not grant.used_at or now - grant.used_at > USED_EVERY:
                grant.used_at = now
                db.session.commit()
            return 'oauth', grant
        return None

    def unauthorized(error=None):
        response = jsonify(error='Anmeldung erforderlich: Token aus Training Plēnum unter „Claude & Fernzugriff“.')
        response.status_code = 401
        metadata = f'{base_url()}/.well-known/oauth-protected-resource/mcp'
        response.headers['WWW-Authenticate'] = (f'Bearer error="{error}", resource_metadata="{metadata}"' if error
                                                else f'Bearer resource_metadata="{metadata}"')
        return response

    def foreign_origin():
        """Browsers send Origin; only the app's own pages may call (DNS rebinding, MCP transport spec)."""
        origin = (request.headers.get('Origin') or '').rstrip('/')
        return bool(origin) and origin not in allowed_origins() | {base_url()}

    @app.route('/mcp', methods=['POST'])
    def mcp_endpoint():
        if foreign_origin():
            return jsonify(error='Dieser Ursprung ist für MCP nicht freigegeben.'), 403
        who = caller()
        if who is None:
            return unauthorized('invalid_token' if request.headers.get('Authorization') else None)
        if (request.content_length or 0) > MAX_BODY:
            return jsonify(rpc_error(None, -32600, 'Die Anfrage ist zu groß.')), 413
        try:
            message = json.loads(request.get_data() or b'')
        except ValueError:
            return jsonify(rpc_error(None, -32700, 'Parse error')), 400
        if isinstance(message, list):  # batches (protocol 2025-03-26)
            replies = [reply for reply in (handle(item, who) for item in message) if reply is not None] if message else \
                [rpc_error(None, -32600, 'Invalid Request')]
        else:
            replies = handle(message, who)
        if not replies:
            return '', 202
        response = jsonify(replies)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.route('/mcp', methods=['GET', 'DELETE'])
    def mcp_stream():
        return jsonify(error='Dieser Server antwortet nur auf POST, ohne Event-Stream und ohne Sitzungen.'), 405, {'Allow': 'POST'}

    # ─── OAuth: discovery ───

    @app.route('/.well-known/oauth-protected-resource', methods=['GET'])
    @app.route('/.well-known/oauth-protected-resource/mcp', methods=['GET'])
    def protected_resource():
        base = base_url()
        return jsonify(resource=f'{base}/mcp', authorization_servers=[base], scopes_supported=['training'],
                       bearer_methods_supported=['header'], resource_name='Training Plēnum')

    @app.route('/.well-known/oauth-authorization-server', methods=['GET'])
    @app.route('/.well-known/oauth-authorization-server/mcp', methods=['GET'])
    def authorization_server():
        base = base_url()
        return jsonify(issuer=base, authorization_endpoint=f'{base}/oauth/authorize', token_endpoint=f'{base}/oauth/token',
                       registration_endpoint=f'{base}/oauth/register', response_types_supported=['code'],
                       grant_types_supported=['authorization_code', 'refresh_token'],
                       code_challenge_methods_supported=['S256'], token_endpoint_auth_methods_supported=['none'],
                       scopes_supported=['training'])

    def oauth_error(error, description, status=400):
        response = jsonify(error=error, error_description=description)
        response.status_code = status
        response.headers['Cache-Control'] = 'no-store'
        return response

    # ─── OAuth: client registration (RFC 7591) ───

    def valid_redirect(uri):
        try:
            parsed = urlparse(uri)
        except ValueError:
            return False
        if not isinstance(uri, str) or len(uri) > 500 or parsed.fragment or not parsed.hostname:
            return False
        return parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname in LOOPBACK)

    def redirect_matches(registered, given):
        if given in registered:
            return True
        # Native clients (Claude Code) redirect to a loopback port that changes per sign-in (RFC 8252 7.3).
        try:
            target = urlparse(given)
        except ValueError:
            return False
        if target.scheme != 'http' or target.hostname not in LOOPBACK:
            return False
        return any((u.scheme, u.hostname, u.path, u.query) == (target.scheme, target.hostname, target.path, target.query)
                   for u in map(urlparse, registered))

    @app.route('/oauth/register', methods=['POST'])
    def register_client():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return oauth_error('invalid_client_metadata', 'JSON-Objekt erwartet.')
        uris = data.get('redirect_uris')
        if not isinstance(uris, list) or not 1 <= len(uris) <= 10 or not all(valid_redirect(u) for u in uris):
            return oauth_error('invalid_redirect_uri', 'redirect_uris: 1 bis 10 HTTPS- oder Loopback-Adressen.')
        name = re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('client_name') or '')).strip()[:100] or 'Unbekannte App'
        if McpClient.query.count() >= MAX_CLIENTS:
            # Registrations nobody completed within a day make room; approved clients stay.
            active = {client for (client,) in db.session.query(McpGrant.client_id).distinct()}
            stale = [c for c in McpClient.query.order_by(McpClient.created_at).all()
                     if c.id not in active and c.created_at < datetime.utcnow() - timedelta(days=1)]
            if not stale:
                return oauth_error('invalid_client_metadata', 'Zu viele registrierte Apps. Bitte später erneut versuchen.', 429)
            for client in stale[:10]:
                db.session.delete(client)
        client = McpClient(id=secrets.token_urlsafe(24), name=name, redirect_uris=json.dumps(uris))
        db.session.add(client)
        db.session.commit()
        return jsonify(client_id=client.id, client_id_issued_at=int(client.created_at.timestamp()), client_name=name,
                       redirect_uris=uris, grant_types=['authorization_code', 'refresh_token'], response_types=['code'],
                       token_endpoint_auth_method='none'), 201

    # ─── OAuth: consent with the approval code ───

    def pairing_check(row, entered):
        """Whether `entered` is the pending approval code; wrong attempts use it up after PAIRING_ATTEMPTS."""
        if not row or not row.pairing_hash or not row.pairing_expires_at or row.pairing_expires_at < datetime.utcnow():
            return False, 'Es gibt keinen gültigen Freigabecode. Bitte in Training Plēnum einen neuen erzeugen.'
        normalized = re.sub(r'[^A-Z0-9]', '', (entered or '').upper())
        if normalized and hmac.compare_digest(digest(normalized), row.pairing_hash):
            row.pairing_hash = row.pairing_expires_at = None
            row.pairing_attempts = 0
            return True, None
        row.pairing_attempts = (row.pairing_attempts or 0) + 1
        if row.pairing_attempts >= PAIRING_ATTEMPTS:
            row.pairing_hash = row.pairing_expires_at = None
            row.pairing_attempts = 0
            return False, 'Der Code war mehrfach falsch und gilt nicht mehr. Bitte in Training Plēnum einen neuen erzeugen.'
        return False, f'Der Freigabecode stimmt nicht. Noch {PAIRING_ATTEMPTS - row.pairing_attempts} Versuche.'

    def authorize_request(values):
        """(client, params) of a valid sign-in request, or an error response; errors before the redirect URI is known
        are shown here instead of being sent to an unverified address."""
        client = db.session.get(McpClient, values.get('client_id') or '')
        if client is None:
            return None, consent_page(None, {}, 'Diese App ist nicht registriert. Bitte die Verbindung in Claude neu hinzufügen.', 400)
        registered = json.loads(client.redirect_uris)
        uri = values.get('redirect_uri') or (registered[0] if len(registered) == 1 else '')
        if not redirect_matches(registered, uri):
            return None, consent_page(None, {}, 'Die Weiterleitungsadresse passt nicht zu dieser App.', 400)
        params = {key: values.get(key, '') for key in ('client_id', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource')}
        params['redirect_uri'] = uri
        if values.get('response_type') != 'code':
            return None, back(uri, params['state'], error='unsupported_response_type')
        if params['code_challenge_method'] != 'S256' or not 43 <= len(params['code_challenge']) <= 128:
            return None, back(uri, params['state'], error='invalid_request', error_description='PKCE mit S256 erforderlich.')
        return client, params

    def back(uri, state, **values):
        if state:
            values['state'] = state
        return redirect(uri + ('&' if urlparse(uri).query else '?') + urlencode(values))

    def consent_page(client, params, error=None, status=200):
        row = access()
        level = 'lesen und geplante Einheiten anlegen, ändern und löschen' if row and row.allow_write else 'nur lesen'
        target = urlparse(params.get('redirect_uri', '')).hostname or ''
        hidden = ''.join(f'<input type="hidden" name="{key}" value="{html.escape(value)}">' for key, value in params.items())
        hidden += '<input type="hidden" name="response_type" value="code">'
        body = (f'<h1>{html.escape(client.name)} möchte auf Training Plēnum zugreifen</h1>'
                f'<p>Die App darf deine Trainingsdaten <strong>{level}</strong>. Danach geht es zurück zu '
                f'<strong>{html.escape(target)}</strong>.</p>'
                '<form method="post" action="/oauth/authorize">' + hidden +
                '<label for="code">Freigabecode</label>'
                '<input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" '
                'maxlength="12" placeholder="ABCD-EFGH" required autofocus>'
                '<p class="hint">Den Code zeigt Training Plēnum im Menü unter deinem Namen → <em>Claude &amp; Fernzugriff</em> '
                '→ <em>Freigabecode erzeugen</em>. Er gilt 10 Minuten und nur einmal.</p>'
                + (f'<p class="error" role="alert">{html.escape(error)}</p>' if error else '') +
                '<div class="actions"><button type="submit" name="action" value="allow">Erlauben</button>'
                '<button type="submit" name="action" value="deny" formnovalidate class="secondary">Ablehnen</button></div>'
                '</form>') if client else f'<h1>Verbindung nicht möglich</h1><p class="error" role="alert">{html.escape(error or "")}</p>'
        page = ('<!doctype html><html lang="de"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Training Plēnum · Claude verbinden</title>'
                '<style>:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--fg:#1e293b;--muted:#64748b;--line:#e2e8f0;--accent:#1e293b;--on:#fff;--danger:#b91c1c}'
                '@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#1e293b;--fg:#f1f5f9;--muted:#94a3b8;--line:#334155;--accent:#f1f5f9;--on:#0f172a;--danger:#fca5a5}}'
                'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}'
                'main{max-width:440px;margin:8vh auto;padding:28px 24px;background:var(--card);border:1px solid var(--line);border-radius:4px}'
                '.brand{font-size:13px;letter-spacing:.04em;color:var(--muted);margin:0 0 14px}h1{font-size:20px;line-height:1.3;margin:0 0 10px}'
                'label{display:block;font-weight:600;margin:18px 0 6px}input[name=code]{box-sizing:border-box;width:100%;font:600 22px/1.2 ui-monospace,monospace;'
                'letter-spacing:.12em;text-transform:uppercase;padding:10px 12px;border:1px solid var(--line);border-radius:3px;background:var(--bg);color:var(--fg)}'
                '.hint{font-size:13px;color:var(--muted)}.error{color:var(--danger);font-weight:600}.actions{display:flex;gap:10px;margin-top:18px}'
                'button{flex:1;font:600 15px system-ui,sans-serif;padding:11px;border-radius:3px;border:1px solid var(--accent);background:var(--accent);color:var(--on);cursor:pointer}'
                'button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}@media (max-width:480px){main{margin:0;min-height:100vh;border:0;border-radius:0}}</style>'
                f'</head><body><main><p class="brand">Training <em>Plēnum</em></p>{body}</main></body></html>')
        response = make_response(page, status)
        response.headers.update({'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                                 # same-origin keeps the Origin header of the form post and sends no Referer onwards.
                                 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
                                 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'"})
        return response

    @app.route('/oauth/authorize', methods=['GET', 'POST'])
    def authorize():
        values = request.args if request.method == 'GET' else request.form
        client, params = authorize_request(values)
        if client is None:
            return params
        if request.method == 'GET':
            return consent_page(client, params)
        origin = (request.headers.get('Origin') or '').rstrip('/')
        if origin and origin != base_url() and origin != 'null':
            return consent_page(None, {}, 'Diese Freigabe kam nicht von dieser Seite.', 403)
        if values.get('action') == 'deny':
            return back(params['redirect_uri'], params['state'], error='access_denied')
        row = access(create=True)
        approved, error = pairing_check(row, values.get('code'))
        db.session.commit()
        if not approved:
            return consent_page(client, params, error, 400)
        code = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        db.session.add(McpGrant(id=digest(code), kind='code', client_id=client.id, family=str(uuid.uuid4()),
                                expires_at=now + timedelta(seconds=CODE_SECONDS),
                                data=json.dumps({'redirectUri': params['redirect_uri'], 'challenge': params['code_challenge'],
                                                 'approvedAt': utc(now)})))
        db.session.commit()
        return back(params['redirect_uri'], params['state'], code=code)

    # ─── OAuth: tokens ───

    def issue(client_id, family, approved_at):
        now = datetime.utcnow()
        McpGrant.query.filter(McpGrant.expires_at < now).delete()
        access_token, refresh_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        data = json.dumps({'approvedAt': approved_at})
        db.session.add_all([
            McpGrant(id=digest(access_token), kind='access', client_id=client_id, family=family, data=data,
                     expires_at=now + timedelta(seconds=ACCESS_SECONDS)),
            McpGrant(id=digest(refresh_token), kind='refresh', client_id=client_id, family=family, data=data,
                     expires_at=now + timedelta(days=REFRESH_DAYS))])
        db.session.commit()
        response = jsonify(access_token=access_token, token_type='Bearer', expires_in=ACCESS_SECONDS,
                           refresh_token=refresh_token, scope='training')
        response.headers.update({'Cache-Control': 'no-store', 'Pragma': 'no-cache'})
        return response

    @app.route('/oauth/token', methods=['POST'])
    def token():
        values = request.form if request.form else (request.get_json(silent=True) or {})
        kind = values.get('grant_type')
        if kind not in ('authorization_code', 'refresh_token'):
            return oauth_error('unsupported_grant_type', 'authorization_code oder refresh_token.')
        secret = values.get('code' if kind == 'authorization_code' else 'refresh_token') or ''
        grant = db.session.get(McpGrant, digest(secret)) if secret else None
        expected = 'code' if kind == 'authorization_code' else 'refresh'
        if grant is None or grant.kind != expected or grant.expires_at < datetime.utcnow():
            return oauth_error('invalid_grant', 'Ungültig oder abgelaufen.')
        client_id = values.get('client_id')
        if (client_id or kind == 'authorization_code') and client_id != grant.client_id:
            return oauth_error('invalid_grant', 'Gehört zu einer anderen App.')
        data = json.loads(grant.data or '{}')
        if kind == 'authorization_code':
            db.session.delete(grant)  # single use, also when the checks below fail
            db.session.commit()
            verifier = values.get('code_verifier') or ''
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
            if not VERIFIER.match(verifier) or not hmac.compare_digest(challenge, data.get('challenge', '')):
                return oauth_error('invalid_grant', 'PKCE-Prüfung fehlgeschlagen.')
            if values.get('redirect_uri') and values['redirect_uri'] != data.get('redirectUri'):
                return oauth_error('invalid_grant', 'redirect_uri passt nicht.')
        else:
            # Rotation: the old refresh token and the family's access tokens end here.
            McpGrant.query.filter(McpGrant.family == grant.family, McpGrant.kind != 'code').delete()
        return issue(grant.client_id, grant.family, data.get('approvedAt'))

    # ─── UI routes (origin guard in coach_api.py) ───

    def connections():
        clients = {c.id: c.name for c in McpClient.query.all()}
        families = {}
        for grant in McpGrant.query.filter(McpGrant.kind == 'refresh').all():
            families.setdefault(grant.family, {'id': grant.family, 'client': clients.get(grant.client_id, 'Unbekannte App'),
                                                       'approvedAt': json.loads(grant.data or '{}').get('approvedAt'), 'lastUsedAt': None})
        for grant in McpGrant.query.filter(McpGrant.kind == 'access', McpGrant.used_at.isnot(None)).all():
            if grant.family in families:
                families[grant.family]['lastUsedAt'] = max(filter(None, [families[grant.family]['lastUsedAt'], utc(grant.used_at)]))
        return sorted(families.values(), key=lambda entry: entry['approvedAt'] or '', reverse=True)

    def status_body():
        row = access()
        pairing = row and row.pairing_hash and row.pairing_expires_at and row.pairing_expires_at > datetime.utcnow()
        return {'token': {'createdAt': utc(row.token_created_at), 'lastUsedAt': utc(row.token_used_at),
                          'lastClient': row.last_client} if row and row.token_hash else None,
                'allowWrite': bool(row and row.allow_write),
                'pairingExpiresAt': utc(row.pairing_expires_at) if pairing else None,
                'connections': connections(), 'tools': [{'name': t['name'], 'title': t['title'], 'write': t['write']} for t in tools.values()]}

    @app.route('/api/mcp', methods=['GET'])
    def mcp_status():
        return jsonify(status_body())

    @app.route('/api/mcp/token', methods=['POST', 'DELETE'])
    def mcp_token():
        row = access(create=True)
        if request.method == 'DELETE':
            row.token_hash = row.token_created_at = row.token_used_at = row.last_client = None
            db.session.commit()
            return jsonify(status_body())
        value = 'tp_' + secrets.token_urlsafe(32)
        row.token_hash, row.token_created_at = digest(value), datetime.utcnow()
        row.token_used_at = row.last_client = None
        db.session.commit()
        return jsonify(token=value, status=status_body()), 201

    @app.route('/api/mcp/settings', methods=['PUT'])
    def mcp_settings():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('allowWrite'), bool):
            return jsonify(error='allowWrite muss true oder false sein.'), 400
        access(create=True).allow_write = data['allowWrite']
        db.session.commit()
        return jsonify(status_body())

    @app.route('/api/mcp/pairing', methods=['POST'])
    def mcp_pairing():
        row = access(create=True)
        code = ''.join(secrets.choice(PAIRING_ALPHABET) for _ in range(8))
        row.pairing_hash, row.pairing_attempts = digest(code), 0
        row.pairing_expires_at = datetime.utcnow() + timedelta(minutes=PAIRING_MINUTES)
        db.session.commit()
        return jsonify(code=f'{code[:4]}-{code[4:]}', status=status_body()), 201

    @app.route('/api/mcp/connections', methods=['DELETE'])
    @app.route('/api/mcp/connections/<family>', methods=['DELETE'])
    def mcp_disconnect(family=None):
        query = McpGrant.query if family is None else McpGrant.query.filter_by(family=family)
        query.delete()
        if family is None:
            McpClient.query.delete()
        db.session.commit()
        return jsonify(status_body())
