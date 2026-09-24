"""Versioned athlete inputs and deterministic constraints for coach proposals."""
import copy
import json
import re
from datetime import date, timedelta

from jsonschema import Draft202012Validator

DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']


class CoachError(ValueError):
    pass


def obj(properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def text(maximum=500, nullable=False):
    return {'type': ['string', 'null'] if nullable else 'string', 'maxLength': maximum}


def num(low, high, nullable=False, integer=False):
    kind = 'integer' if integer else 'number'
    return {'type': [kind, 'null'] if nullable else kind, 'minimum': low, 'maximum': high}


def validate(value, schema):
    try:
        json.dumps(value, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise CoachError('Bitte gültige JSON-Werte verwenden.') from exc
    errors = sorted(Draft202012Validator(schema).iter_errors(value), key=lambda e: str(list(e.path)))
    if errors:
        path = '.'.join(str(p) for p in errors[0].path) or 'Anfrage'
        raise CoachError(f'{path}: Daten entsprechen nicht dem erwarteten Schema.')
    return value


def day_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise CoachError('Datum muss YYYY-MM-DD entsprechen.')
    try:
        result = date.fromisoformat(value)
    except ValueError as exc:
        raise CoachError('Ungültiges Datum.') from exc
    if not 1970 <= result.year <= 9998:
        raise CoachError('Datum außerhalb des unterstützten Bereichs.')
    return result


def week_start(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-W\d{2}', value):
        raise CoachError('Woche muss YYYY-Www entsprechen.')
    if not 1970 <= int(value[:4]) <= 9998:
        raise CoachError('Kalenderwoche außerhalb des unterstützten Bereichs.')
    try:
        return date.fromisocalendar(int(value[:4]), int(value[-2:]), 1)
    except ValueError as exc:
        raise CoachError('Ungültige Kalenderwoche.') from exc


def iso_week(value):
    year, week, _ = value.isocalendar()
    return f'{year:04}-W{week:02}'


DEFAULT_PROFILE = {
    'goal': {'type': 'general_endurance', 'name': '', 'date': None, 'target': None},
    'availability': {'preferredWeeklyHours': None, 'absoluteMaxWeeklyHours': None,
                     'defaultAvailability': dict.fromkeys(DAYS)},
    'preferences': {'preferredRestDay': None, 'preferredLongSessionDay': None,
                    'indoorPreference': 'neutral', 'outdoorPreference': 'neutral', 'gymAvailability': False},
    'limitations': {'notes': ''}, 'currentState': {'notes': ''},
    'weeklyOverrides': [], 'dailyOverrides': [], 'checkIns': [],
}
PROFILE_SCHEMA = obj({
    'goal': obj({'type': text(80), 'name': text(200), 'date': text(10, True), 'target': text(300, True)}),
    'availability': obj({'preferredWeeklyHours': num(0, 80, True), 'absoluteMaxWeeklyHours': num(0, 80, True),
                         'defaultAvailability': obj({day: num(0, 1440, True, True) for day in DAYS})}),
    'preferences': obj({'preferredRestDay': {'enum': [None, *DAYS]}, 'preferredLongSessionDay': {'enum': [None, *DAYS]},
                        'indoorPreference': {'enum': ['neutral', 'prefer', 'avoid']},
                        'outdoorPreference': {'enum': ['neutral', 'prefer', 'avoid']}, 'gymAvailability': {'type': 'boolean'}}),
    'limitations': obj({'notes': text(1500)}), 'currentState': obj({'notes': text(1500)}),
})


def update_profile(current, changes):
    if not isinstance(changes, dict) or set(changes) - set(PROFILE_SCHEMA['properties']):
        raise CoachError('Unbekannte Profilfelder. Overrides und Check-ins separat speichern.')
    result = copy.deepcopy(current)
    for key, value in changes.items():
        result[key] = value
    validate({key: result[key] for key in PROFILE_SCHEMA['properties']}, PROFILE_SCHEMA)
    if result['goal']['date']:
        day_date(result['goal']['date'])
    preferred, maximum = (result['availability'][key] for key in ('preferredWeeklyHours', 'absoluteMaxWeeklyHours'))
    if preferred is not None and maximum is not None and preferred > maximum:
        raise CoachError('Der gewünschte Umfang darf das absolute Zeitmaximum nicht überschreiten.')
    return result


OVERRIDE_SCHEMA = obj({'available': {'type': 'boolean'}, 'maxMinutes': num(0, 1440, integer=True), 'preferLong': {'type': 'boolean'}})
OVERRIDE_SCHEMA['required'] = []
WEEK_OVERRIDE_SCHEMA = obj({'overrides': obj({day: OVERRIDE_SCHEMA for day in DAYS}), 'note': text(1000)})
WEEK_OVERRIDE_SCHEMA['properties']['overrides']['required'] = []
DAILY_SCHEMA = obj({'available': {'type': 'boolean'}, 'maxMinutes': num(0, 1440, integer=True),
                    'action': {'enum': ['normal', 'skip', 'reduce']}, 'note': text(1000)})
DAILY_SCHEMA['required'] = []
CHECK_IN_SCHEMA = obj({'date': text(10), **{key: num(1, 5, integer=True) for key in
                       ['fatigue', 'motivation', 'stress', 'sleepQuality', 'soreness']}, 'notes': text(1000)})


def effective_availability(profile, week):
    monday = week_start(week)
    result = {day: {'maxMinutes': value, 'preferLong': day == profile['preferences']['preferredLongSessionDay']}
              for day, value in profile['availability']['defaultAvailability'].items()}
    override = next((o for o in profile['weeklyOverrides'] if o['week'] == week), {})
    for day, item in override.get('overrides', {}).items():
        result[day].update(item)
        if item.get('available') is False:
            result[day]['maxMinutes'] = 0
    for index, day in enumerate(DAYS):
        stamp = (monday + timedelta(days=index)).isoformat()
        item = next((o for o in profile['dailyOverrides'] if o['date'] == stamp), {})
        result[day].update({k: v for k, v in item.items() if k != 'date'})
        # A daily override supersedes the weekly level, including availability.
        if item.get('available') is True and 'maxMinutes' not in item and result[day].get('available') is True:
            result[day]['maxMinutes'] = profile['availability']['defaultAvailability'][day]
        if item.get('available') is False or item.get('action') == 'skip':
            result[day]['maxMinutes'] = 0
        result[day]['available'] = result[day]['maxMinutes'] is not None and result[day]['maxMinutes'] > 0
        result[day]['date'] = stamp
    return result


BLOCK_WEEKS_SCHEMA = {'type': 'array', 'minItems': 1, 'maxItems': 12, 'items': obj({
    'week': num(1, 12, integer=True), 'phase': {'enum': ['base', 'build', 'peak', 'taper', 'recovery']},
    'targetHours': num(0, 80), 'focus': text(160)})}
# Concerns the AI may raise for the athlete; they never block or change a plan.
HINWEISE_SCHEMA = {'type': 'array', 'maxItems': 5, 'items': text(300)}


def response_schemas(session_schema):
    week = obj({'week': text(8), 'targetHours': num(0, 80), 'focus': text(160),
                'sessions': {'type': 'array', 'maxItems': 21, 'items': session_schema}, 'hinweise': HINWEISE_SCHEMA})
    operation = obj({'op': {'enum': ['add', 'replace', 'remove']}, 'sessionId': text(80),
                     'session': {'anyOf': [session_schema, {'type': 'null'}]}})
    patch = obj({'week': text(8), 'targetHours': num(0, 80), 'focus': text(160),
                 'operations': {'type': 'array', 'maxItems': 21, 'items': operation}, 'hinweise': HINWEISE_SCHEMA})
    return {'week': week, 'patch': patch}


def apply_patch(before, patch):
    result = copy.deepcopy(before)
    sessions = {item['id']: item for item in result['sessions']}
    touched = set()
    for change in patch['operations']:
        identity, operation, item = change['sessionId'], change['op'], change['session']
        if identity in touched:
            raise CoachError('Jede Einheit darf in einem Patch nur einmal geändert werden.')
        touched.add(identity)
        if operation != 'add' and identity not in sessions:
            raise CoachError('Patch verweist auf eine unbekannte Einheit.')
        if identity in sessions and sessions[identity].get('locked'):
            raise CoachError('Gesperrte Einheiten dürfen nicht verändert werden.')
        if operation == 'remove':
            if item is not None:
                raise CoachError('Eine Löschung darf keine neue Einheit enthalten.')
            del sessions[identity]
        else:
            if not item or item['id'] != identity or (operation == 'add' and identity in sessions):
                raise CoachError('Ungültige Einheit-ID im Patch.')
            sessions[identity] = item
    result.update(targetHours=patch['targetHours'], focus=patch['focus'], sessions=list(sessions.values()))
    return result
