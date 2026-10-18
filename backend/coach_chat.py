"""Coach chat: questions and plan changes in the athlete's own words.

The AI answers with a short reply and optionally a change: patches for worked-out weeks and lasting settings
(an exception for a period, a new availability window, the weekly maximum, an event or a threshold). TrainHub
checks the change with the same rules as every week patch and stores it as a proposal of kind chat; only the
athlete's confirmation applies it.
"""
import copy

from coach_domain import (DAY_NAMES, DAYS, EVENT_SCHEMA, EXCEPTION_SCHEMA, MAX_EVENTS, CoachError, complete_event, day_date, obj, text,
                          update_profile, week_start)

MAX_HISTORY = 20
MAX_MESSAGE = 1500
CHAT_SPORTS = ['ride', 'run', 'strength']
REF_SCHEMA = obj({'kind': {'enum': ['session', 'week']}, 'week': text(8), 'sessionId': text(80, nullable=True),
                  'label': text(160)})
MESSAGE_SCHEMA = obj({'message': text(MAX_MESSAGE), 'ref': {'anyOf': [{'type': 'null'}, REF_SCHEMA]}})
MESSAGE_SCHEMA['required'] = ['message']


def nullable(schema):
    return {'anyOf': [{'type': 'null'}, schema]}


# Strict structured output needs every property listed as required; optional fields are nullable instead.
SETTINGS_SCHEMA = obj({
    'exception': nullable(obj({**{key: EXCEPTION_SCHEMA['properties'][key] for key in ('from', 'to', 'maxMinutes', 'note')},
                               'kind': {'type': 'string', 'enum': ['unavailable', 'available']}})),
    'window': nullable(obj({'day': {'type': 'string', 'enum': DAYS}, 'kind': {'type': 'string', 'enum': ['available', 'unavailable']},
                            'allDay': {'type': 'boolean'},
                            'from': {'type': ['string', 'null'], 'pattern': r'^([01]\d|2[0-3]):[0-5]\d$'},
                            'to': {'type': ['string', 'null'], 'pattern': r'^(([01]\d|2[0-3]):[0-5]\d|24:00)$'},
                            'sports': {'type': 'array', 'maxItems': len(CHAT_SPORTS), 'items': {'type': 'string', 'enum': CHAT_SPORTS}}})),
    'maxWeeklyHours': {'type': ['number', 'null'], 'minimum': 0, 'maximum': 80},
    'event': nullable(obj({**copy.deepcopy(EVENT_SCHEMA['properties']),
                           'sport': {'type': 'string', 'enum': EVENT_SCHEMA['properties']['sport']['enum']},
                           'priority': {'type': 'string', 'enum': EVENT_SCHEMA['properties']['priority']['enum']},
                           'handling': {'type': ['string', 'null'], 'enum': EVENT_SCHEMA['properties']['handling']['enum']}})),
    'threshold': nullable(obj({'sport': {'type': 'string', 'enum': ['ride', 'run']}, 'ftp': {'type': ['number', 'null'], 'minimum': 50, 'maximum': 1000},
                               'paceSecPerKm': {'type': ['number', 'null'], 'minimum': 120, 'maximum': 900}})),
})


# The athlete's own hours for a span of plan weeks (numbered from 1 like the weekly chart), worked out or not yet.
WEEK_HOURS_SCHEMA = obj({'fromWeek': {'type': 'integer', 'minimum': 1, 'maximum': 520},
                         'toWeek': {'type': 'integer', 'minimum': 1, 'maximum': 520},
                         'hours': {'type': 'number', 'minimum': 0, 'maximum': 80}})


def response_schema(patch_schema):
    change = obj({'summary': text(200), 'weeks': {'type': 'array', 'maxItems': 3, 'items': patch_schema},
                  'settings': nullable(SETTINGS_SCHEMA), 'weekHours': nullable(WEEK_HOURS_SCHEMA)})
    return obj({'reply': text(2000), 'change': nullable(change)})


def short_date(value):
    day = day_date(value)
    return f'{day.day:02}.{day.month:02}.{day.year}'


def pace_label(seconds):
    return f'{int(seconds // 60)}:{round(seconds % 60):02} /km'


SPORT_NAMES = {'ride': 'Rad', 'run': 'Laufen', 'strength': 'Kraft'}
PRIORITY_NAMES = {'A': 'A-Event', 'B': 'B-Event', 'C': 'C-Event'}


def apply_settings(profile, settings, identity, today):
    """The profile with the settings of a chat change, the FTP for the athlete settings and German lines for the card.

    Everything is checked with the rules of the settings editors; a broken setting raises CoachError."""
    changes, lines, ftp, events = {}, [], None, None
    availability = profile['availability']
    item = settings.get('exception')
    if item:
        if day_date(item['to']) < today:
            raise CoachError('Eine Ausnahme muss heute oder später enden.')
        exception = {'id': f'chat-{identity}', **item, 'note': item['note'].strip()}
        changes.setdefault('availability', {})['exceptions'] = availability['exceptions'] + [exception]
        what = 'nicht verfügbar' if item['kind'] == 'unavailable' else f"höchstens {item['maxMinutes']} min pro Tag"
        span = short_date(item['from']) if item['from'] == item['to'] else f"{short_date(item['from'])}–{short_date(item['to'])}"
        lines.append(f'Ausnahme {span}: {what}' + (f" · {exception['note']}" if exception['note'] else ''))
    item = settings.get('window')
    if item:
        sports = {'ride': {'indoor': True, 'outdoor': True}, 'run': {'treadmill': False, 'outdoor': True},
                  'strength': {'equipment': []}}
        chosen = [s for s in CHAT_SPORTS if s in item['sports']] if item['kind'] == 'available' else []
        window = {'id': f'chat-{identity}', **{key: item[key] for key in ('day', 'kind', 'allDay', 'from', 'to')},
                  'sports': {s: sports[s] for s in chosen}, 'group': None}
        changes.setdefault('availability', {})['windows'] = availability['windows'] + [window]
        time = 'ganzer Tag' if item['allDay'] else f"{item['from']}–{item['to']}"
        what = ', '.join(SPORT_NAMES[s] for s in chosen) if item['kind'] == 'available' else 'nicht verfügbar'
        lines.append(f"Neues Zeitfenster: {DAY_NAMES[item['day']]} {time} · {what or 'verfügbar'}")
    if settings.get('maxWeeklyHours') is not None:
        changes.setdefault('availability', {})['maxWeeklyHours'] = settings['maxWeeklyHours']
        if not availability['windows'] and not (changes.get('availability') or {}).get('windows'):
            changes['availability']['absoluteMaxWeeklyHours'] = settings['maxWeeklyHours']
        lines.append(f"Höchstens {settings['maxWeeklyHours']:g} h pro Woche")
    item = settings.get('event')
    if item:
        if len(profile['events']) >= MAX_EVENTS:
            raise CoachError(f'Höchstens {MAX_EVENTS} Events.')
        event = complete_event(item, f'chat-{identity}')
        if event['endDate'] < today.isoformat():
            raise CoachError('Ein neues Event liegt heute oder später.')
        events = sorted(profile['events'] + [event], key=lambda e: (e['startDate'], e['endDate'], e['id']))
        lines.append(f"Neues {PRIORITY_NAMES[event['priority']]}: {event['title']} am {short_date(event['startDate'])}")
    item = settings.get('threshold')
    if item:
        if item['sport'] == 'ride':
            if item['ftp'] is None:
                raise CoachError('Für eine neue FTP fehlt der Wert.')
            ftp = round(item['ftp'])
            changes['thresholds'] = {'ride': {'source': 'athlete'}}
            lines.append(f'FTP: {ftp} W')
        else:
            if item['paceSecPerKm'] is None:
                raise CoachError('Für eine neue Schwellenpace fehlt der Wert.')
            changes['thresholds'] = {'run': {'source': 'athlete', 'paceSecPerKm': item['paceSecPerKm'], 'basis': None}}
            lines.append(f"Schwellenpace: {pace_label(item['paceSecPerKm'])}")
    if not lines:
        return profile, [], None
    result = update_profile(profile, changes)
    if events is not None:
        result['events'] = events  # Events have their own endpoints, outside the profile fields.
    return result, lines, ftp


def week_lines(before, after):
    """What a week patch changes, as short German lines for the card."""
    name = lambda s: s['rendered']['name']
    minutes = lambda s: round(s['rendered']['durationMin'] or 0)
    old = {s['id']: s for s in before['sessions']}
    new = {s['id']: s for s in after['sessions']}
    lines = []
    for identity, session in new.items():
        previous = old.get(identity)
        day = DAY_NAMES[session['day']]
        if previous is None:
            lines.append(f'{day} + {name(session)} ({minutes(session)} min)')
        elif previous['day'] != session['day']:
            lines.append(f"{name(previous)}: {DAY_NAMES[previous['day']]} → {day}")
        elif (previous['template'], previous['params']) != (session['template'], session['params']):
            same = name(previous) == name(session)
            lines.append(f'{day} {name(previous)} {minutes(previous)} min → '
                         f'{"" if same else name(session) + " "}{minutes(session)} min')
    lines += [f"{DAY_NAMES[s['day']]} {name(s)} entfällt" for identity, s in old.items() if identity not in new]
    return lines


def compact_session(session):
    return {'id': session['id'], 'day': session['day'], 'date': session['rendered']['date'], 'template': session['template'],
            'name': session['rendered']['name'], 'durationMin': session['rendered']['durationMin'],
            'params': {key: value for key, value in session['params'].items() if value is not None},
            'locked': session.get('locked', False), 'manuallyEdited': session.get('manuallyEdited', False)}


def check_ref(ref, weeks):
    """The reference chip of a message: a worked-out week or one of its sessions."""
    if ref is None:
        return None
    week_start(ref['week'])
    if ref['kind'] == 'session':
        sessions = (weeks.get(ref['week']) or {}).get('sessions', [])
        session = next((s for s in sessions if s['id'] == ref['sessionId']), None)
        if session is None:
            raise CoachError('Die Einheit des Bezugs gibt es nicht mehr.')
        return {**ref, 'session': compact_session(session)}
    return {**ref, 'sessionId': None}
