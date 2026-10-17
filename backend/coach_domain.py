"""Versioned athlete inputs and deterministic constraints for coach proposals."""
import copy
import json
import re
from datetime import date, timedelta

from jsonschema import Draft202012Validator

DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
DAY_NAMES = dict(zip(DAYS, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']))


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


SPORTS = ['ride', 'run', 'swim']
# Sports the athlete trains regularly; stage 1 plans ride, run and strength, the others stay open for stage 2.
PROFILE_SPORTS = ['ride', 'run', 'strength', 'swim', 'xcski', 'hyrox']
# Primary metric per sport, the first one is the default.
METRICS = {'ride': ['power', 'heart_rate'], 'run': ['pace', 'heart_rate', 'power'], 'swim': ['pace', 'rpe'],
           'strength': ['rpe'], 'xcski': ['heart_rate'], 'hyrox': ['heart_rate', 'rpe']}
# Where a threshold comes from; 'test' means the coach plans a test in the first plan week.
THRESHOLD_SOURCES = ['athlete', 'calculated', 'test']
# Without an event the goal is vo2max, threshold or fitness; event and performance stay for earlier profiles.
GOAL_TYPES = ['event', 'performance', 'fitness', 'vo2max', 'threshold']
# Goal types of earlier profiles, before the goal became sport-neutral.
GOAL_ALIASES = {'cycling_event': 'event', 'running_event': 'event', 'marathon': 'event', 'ftp': 'performance',
                'endurance': 'fitness', 'general_endurance': 'fitness'}
LEGACY_PREFERENCES = ('indoorPreference', 'outdoorPreference', 'trainingEnvironment')
CLOCK = r'^([01]\d|2[0-3]):[0-5]\d$'
WINDOW_END = r'^(([01]\d|2[0-3]):[0-5]\d|24:00)$'


def clock(pattern=CLOCK):
    return {'type': ['string', 'null'], 'pattern': pattern}


def flags(*names):
    return obj({name: {'type': 'boolean'} for name in names})


EQUIPMENT = ['studio', 'dumbbells', 'kettlebell', 'bodyweight']
# Options per sport inside an availability window, e.g. indoor trainer or outdoors for rides.
SPORT_OPTIONS = {
    'ride': flags('indoor', 'outdoor'), 'run': flags('treadmill', 'outdoor'), 'swim': flags('pool', 'openWater'),
    'strength': obj({'equipment': {'type': 'array', 'uniqueItems': True, 'items': {'enum': EQUIPMENT}}}),
    'xcski': flags('rollerski', 'snow'),
    'hyrox': obj({'equipment': {'type': 'array', 'uniqueItems': True, 'items': {'enum': EQUIPMENT}}}),
}
WINDOW_SCHEMA = obj({
    'id': text(80), 'day': {'enum': DAYS}, 'kind': {'enum': ['available', 'unavailable']}, 'allDay': {'type': 'boolean'},
    'from': clock(), 'to': clock(WINDOW_END), 'sports': {**obj(SPORT_OPTIONS), 'required': []},
    # A fixed group session the coach plans around, e.g. a club ride.
    'group': {'anyOf': [{'type': 'null'}, obj({'sport': {'enum': PROFILE_SPORTS},
                                                'intensity': {'enum': ['easy', 'moderate', 'hard']}, 'note': text(300)})]}})
# One-off changes such as holidays, travel or illness; per day either unavailable or available for maxMinutes.
EXCEPTION_SCHEMA = obj({'id': text(80), 'from': text(10), 'to': text(10), 'kind': {'enum': ['unavailable', 'available']},
                        'maxMinutes': num(0, 1440, True, True), 'note': text(1000)})
THRESHOLD_SCHEMA = {**obj({sport: obj({'source': {'enum': [None, *THRESHOLD_SOURCES]}}) for sport in PROFILE_SPORTS}),
                    'required': []}
# Threshold pace in seconds per km; FTP and maximum heart rate stay in the athlete settings.
# A 10 km pace the athlete knows is stored as such, never as a measured threshold pace; how it maps to zones is open.
THRESHOLD_SCHEMA['properties']['run'] = {**obj({'source': {'enum': [None, *THRESHOLD_SOURCES]},
                                                'paceSecPerKm': num(120, 900, True), 'basis': text(120, True),
                                                'tenKPaceSecPerKm': num(120, 900, True)}),
                                         'required': ['source', 'paceSecPerKm', 'basis']}
# What the athlete did recently (onboarding B1), confirmed from the data or answered without data.
BACKGROUND_TYPES = ['ride', 'run', 'swim', 'triShort', 'triLong', 'duathlon', 'hyrox', 'xcski', 'other']
BACKGROUND_SCHEMA = obj({'type': {'enum': [None, *BACKGROUND_TYPES]}, 'weeklyHours': num(0, 80, True),
                         'intervals': {**obj({sport: {'type': 'boolean'} for sport in PROFILE_SPORTS}), 'required': []},
                         'source': {'enum': [None, 'calculated', 'athlete']}})
# Onboarding steps the athlete has finished; the wizard resumes at the first open one. 'created' follows the plan creation.
ONBOARDING_STEPS = ['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'period', 'availability',
                    'ready', 'created']
DEFAULT_PROFILE = {
    'goal': {'type': 'fitness', 'sports': ['ride'], 'name': '', 'date': None, 'target': None},
    'sports': ['ride'], 'metrics': {'ride': 'power', 'run': 'pace'}, 'thresholds': {},
    'availability': {'preferredWeeklyHours': None, 'indoorWeeklyHours': None, 'absoluteMaxWeeklyHours': None,
                     'outdoorMonths': [], 'defaultAvailability': dict.fromkeys(DAYS), 'trainingDaysPerWeek': None,
                     'noConsecutiveRestDays': False, 'minRideMinutes': {'indoor': None, 'outdoor': None},
                     'windows': [], 'exceptions': [], 'maxWeeklyHours': None, 'restDay': None, 'longDay': None,
                     'restDays': [], 'longDays': []},
    'preferences': {'preferredRestDay': None, 'preferredLongSessionDay': None, 'gymAvailability': False, 'dailyCheckIn': True},
    'limitations': {'notes': ''}, 'currentState': {'notes': ''},
    'background': {'type': None, 'weeklyHours': None, 'intervals': {}, 'source': None}, 'onboarding': {'completed': []},
    'weeklyOverrides': [], 'dailyOverrides': [], 'checkIns': [], 'injuries': [], 'events': [],
}
PROFILE_SCHEMA = obj({
    'goal': obj({'type': {'enum': GOAL_TYPES},
                 'sports': {'type': 'array', 'minItems': 1, 'uniqueItems': True, 'items': {'enum': SPORTS}},
                 'name': text(200), 'date': text(10, True), 'target': text(300, True)}),
    'sports': {'type': 'array', 'uniqueItems': True, 'maxItems': len(PROFILE_SPORTS), 'items': {'enum': PROFILE_SPORTS}},
    'metrics': {**obj({sport: {'enum': choices} for sport, choices in METRICS.items()}), 'required': []},
    'thresholds': THRESHOLD_SCHEMA,
    'availability': obj({'preferredWeeklyHours': num(0, 80, True), 'indoorWeeklyHours': num(0, 80, True),
                         'absoluteMaxWeeklyHours': num(0, 80, True),
                         'outdoorMonths': {'type': 'array', 'uniqueItems': True, 'items': num(1, 12, integer=True)},
                         'defaultAvailability': obj({day: num(0, 1440, True, True) for day in DAYS}),
                         'trainingDaysPerWeek': num(1, 7, True, True), 'noConsecutiveRestDays': {'type': 'boolean'},
                         'minRideMinutes': obj({place: num(0, 600, True, True) for place in ('indoor', 'outdoor')}),
                         'windows': {'type': 'array', 'maxItems': 70, 'items': WINDOW_SCHEMA},
                         'exceptions': {'type': 'array', 'maxItems': 100, 'items': EXCEPTION_SCHEMA},
                         'maxWeeklyHours': num(0, 80, True), 'restDay': {'enum': [None, *DAYS]}, 'longDay': {'enum': [None, *DAYS]},
                         # Preferred rest days are alternatives, long days are days a long session may go on; both are wishes.
                         'restDays': {'type': 'array', 'uniqueItems': True, 'items': {'enum': DAYS}},
                         'longDays': {'type': 'array', 'uniqueItems': True, 'items': {'enum': DAYS}}}),
    'preferences': obj({'preferredRestDay': {'enum': [None, *DAYS]}, 'preferredLongSessionDay': {'enum': [None, *DAYS]},
                        'gymAvailability': {'type': 'boolean'}, 'dailyCheckIn': {'type': 'boolean'}}),
    'limitations': obj({'notes': text(1500)}), 'currentState': obj({'notes': text(1500)}),
    'background': BACKGROUND_SCHEMA,
    'onboarding': obj({'completed': {'type': 'array', 'uniqueItems': True, 'items': {'enum': ONBOARDING_STEPS}}}),
})


def complete_profile(value):
    """Stored profiles predate later fields; fill them with their defaults and move replaced ones over."""
    result = copy.deepcopy(value)
    stored_goal = result.get('goal', {})
    old_type = stored_goal.get('type')
    result['goal'] = {**copy.deepcopy(DEFAULT_PROFILE['goal']), **stored_goal}
    result['goal']['type'] = GOAL_ALIASES.get(old_type, old_type if old_type in GOAL_TYPES else 'fitness')
    if 'sports' not in stored_goal and old_type in ('marathon', 'running_event'):
        result['goal']['sports'] = ['run']
    preferences = result.get('preferences', {})
    if 'outdoorMonths' not in result.get('availability', {}) and preferences.get('trainingEnvironment') == 'outdoor':
        result.setdefault('availability', {})['outdoorMonths'] = list(range(1, 13))
    result['preferences'] = {key: value for key, value in preferences.items() if key not in LEGACY_PREFERENCES}
    stored_availability = result.get('availability', {})
    for many, one in (('restDays', 'restDay'), ('longDays', 'longDay')):
        if many not in stored_availability and stored_availability.get(one):
            stored_availability[many] = [stored_availability[one]]
    for section in ('availability', 'preferences', 'background', 'onboarding'):
        result[section] = {**copy.deepcopy(DEFAULT_PROFILE[section]), **result.get(section, {})}
    for key in ('weeklyOverrides', 'dailyOverrides', 'checkIns', 'injuries'):
        result.setdefault(key, [])
    if 'sports' not in result:
        result['sports'] = list(result['goal']['sports']) + (['strength'] if result['preferences']['gymAvailability'] else [])
    result['metrics'] = {**DEFAULT_PROFILE['metrics'], **result.get('metrics', {})}
    result.setdefault('thresholds', {})
    if 'events' not in result:
        # A named goal date of earlier profiles becomes the A event; the stable id keeps unsaved reads equal.
        goal = result['goal']
        result['events'] = [complete_event({
            'title': goal['name'].strip(), 'sport': next((s for s in goal['sports'] if s in EVENT_SUBTYPES), 'other'),
            'startDate': goal['date'], 'priority': 'A', 'description': goal['target'] or ''}, f"goal-{goal['date']}")] \
            if goal['date'] and goal['name'].strip() else []
    return result


def week_season(profile, monday):
    """'outdoor' or 'indoor' by the athlete's outdoor months, None without a split; the Thursday decides like ISO weeks."""
    months = profile['availability']['outdoorMonths']
    if not months:
        return None
    return 'outdoor' if (monday + timedelta(days=3)).month in months else 'indoor'


def preferred_hours(profile, monday):
    """The wished weekly volume for the week starting on monday; the indoor months may have their own."""
    availability = profile['availability']
    if week_season(profile, monday) == 'indoor' and availability['indoorWeeklyHours'] is not None:
        return availability['indoorWeeklyHours']
    return availability['preferredWeeklyHours']


def min_ride_minutes(profile, monday):
    """The athlete's minimum for a normal ride in that week's season; without a split the shorter one applies."""
    values = profile['availability']['minRideMinutes']
    season = week_season(profile, monday)
    if season:
        return values[season] or None
    return min((v for v in values.values() if v), default=None)


def threshold_pace(profile):
    """Threshold pace for run targets; None when heart rate is the primary metric or no pace is known."""
    if profile['metrics'].get('run') == 'heart_rate':
        return None
    return (profile['thresholds'].get('run') or {}).get('paceSecPerKm')


def ten_k_pace(profile):
    """The 10 km pace the athlete entered instead of a threshold pace, or None; it is no threshold pace."""
    return (profile['thresholds'].get('run') or {}).get('tenKPaceSecPerKm')


def onboarded(profile, plan_active=False):
    """Sports, background and goal are set up (or a plan runs from before the onboarding); only then the daily check-in asks."""
    return plan_active or {'sports', 'background', 'goal'} <= set(profile['onboarding']['completed'])


def rest_day_pairs(training_days, limits, elapsed=()):
    """Neighbouring days of one week that both stay without training although one of them could still get it."""
    rest = [day not in training_days for day in DAYS]
    open_day = [limits[day]['maxMinutes'] and day not in elapsed for day in DAYS]
    return {(DAYS[i], DAYS[i + 1]) for i in range(6) if rest[i] and rest[i + 1] and (open_day[i] or open_day[i + 1])}


def forced_rest_pairs(minutes):
    """Neighbouring days of the usual week without any time, Sunday and Monday included: two rest days in a row there."""
    return [(day, DAYS[(index + 1) % 7]) for index, day in enumerate(DAYS)
            if minutes.get(day) == 0 and minutes.get(DAYS[(index + 1) % 7]) == 0]


def update_profile(current, changes):
    if not isinstance(changes, dict) or set(changes) - set(PROFILE_SCHEMA['properties']):
        raise CoachError('Unbekannte Profilfelder. Overrides und Check-ins separat speichern.')
    result = complete_profile(current)
    availability_changes = changes.get('availability') if isinstance(changes.get('availability'), dict) else {}
    for many, one in (('restDays', 'restDay'), ('longDays', 'longDay')):
        # Clients with a single day still work: it becomes the list, the list keeps its first day as the single one.
        if one in availability_changes and many not in availability_changes:
            availability_changes = {**availability_changes, many: [availability_changes[one]] if availability_changes[one] else []}
        elif many in availability_changes and isinstance(availability_changes[many], list):
            ordered = sorted(availability_changes[many], key=lambda d: DAYS.index(d) if d in DAYS else len(DAYS))
            availability_changes = {**availability_changes, many: ordered, one: ordered[0] if ordered else None}
    if availability_changes:
        changes = {**changes, 'availability': availability_changes}
    for key, value in changes.items():
        # Clients that predate a field keep its stored value.
        result[key] = {**result[key], **value} if key in ('goal', 'availability', 'preferences', 'metrics', 'thresholds',
                                                           'background', 'onboarding') \
            and isinstance(value, dict) else value
    if isinstance(result['goal'], dict):
        result['goal']['type'] = GOAL_ALIASES.get(result['goal'].get('type'), result['goal'].get('type'))
    validate({key: result[key] for key in PROFILE_SCHEMA['properties']}, PROFILE_SCHEMA)
    if result['goal']['date']:
        day_date(result['goal']['date'])
    run = result['thresholds'].get('run')
    if run and run['source'] in ('athlete', 'calculated') and run['paceSecPerKm'] is None \
            and (run['source'] == 'calculated' or run.get('tenKPaceSecPerKm') is None):
        raise CoachError('Bitte eine Schwellenpace oder 10-km-Pace eintragen oder „Testen lassen“ wählen.')
    availability = result['availability']
    availability['outdoorMonths'] = sorted(availability['outdoorMonths'])
    check_windows(availability['windows'])
    check_exceptions(availability['exceptions'])
    if availability['windows']:
        # The windows decide the minutes per day; week checks keep working on defaultAvailability.
        availability['defaultAvailability'] = window_minutes(availability['windows'])
        total = sum(availability['defaultAvailability'].values()) / 60
        maximum = availability['maxWeeklyHours']
        availability['absoluteMaxWeeklyHours'] = round(min(total if maximum is None else maximum, 80), 2)
        result['preferences']['preferredRestDay'] = availability['restDay']
        result['preferences']['preferredLongSessionDay'] = availability['longDay']
    maximum = availability['absoluteMaxWeeklyHours']
    if maximum is not None and any(availability[key] is not None and availability[key] > maximum
                                   for key in ('preferredWeeklyHours', 'indoorWeeklyHours')):
        raise CoachError('Der gewünschte Umfang darf das absolute Zeitmaximum nicht überschreiten.')
    if availability['noConsecutiveRestDays'] and (availability['trainingDaysPerWeek'] or 7) < 3:
        raise CoachError('Mit weniger als 3 Trainingstagen lassen sich zwei Ruhetage hintereinander nicht vermeiden.')
    forced = forced_rest_pairs(availability['defaultAvailability'])
    if availability['noConsecutiveRestDays'] and forced:
        # Days without time come first: the rule cannot be set, and new days without time lift it.
        if availability_changes.get('noConsecutiveRestDays'):
            names = ' und '.join(DAY_NAMES[day] for day in forced[0])
            raise CoachError(f'An {names} hast du keine Zeit, zwei Ruhetage hintereinander lassen sich nicht vermeiden.')
        availability['noConsecutiveRestDays'] = False
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
    long_days = set(profile['availability'].get('longDays', [])) | {profile['preferences']['preferredLongSessionDay']}
    result = {day: {'maxMinutes': value, 'preferLong': day in long_days}
              for day, value in profile['availability']['defaultAvailability'].items()}
    override = next((o for o in profile['weeklyOverrides'] if o['week'] == week), {})
    for day, item in override.get('overrides', {}).items():
        result[day].update(item)
        if item.get('available') is False:
            result[day]['maxMinutes'] = 0
    for index, day in enumerate(DAYS):
        stamp = (monday + timedelta(days=index)).isoformat()
        # Exceptions act as daily overrides; a daily override that sets the time of that day wins.
        item = next((o for o in profile['dailyOverrides'] if o['date'] == stamp), {})
        if not {'available', 'maxMinutes', 'action'} & set(item):
            item = {**exception_override(profile, stamp), **item}
        result[day].update({k: v for k, v in item.items() if k not in ('date', 'exception')})
        if item.get('exception'):
            result[day]['exception'] = item['exception']
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
    # The patch's notes replace the week's, so no note speaks of a session that is gone.
    result.update(targetHours=patch['targetHours'], focus=patch['focus'], sessions=list(sessions.values()),
                  hinweise=[h.strip() for h in patch.get('hinweise', []) if h.strip()])
    return result


# --- Availability windows and exceptions ----------------------------------------------------

def minutes_of(value):
    hours, minutes = value.split(':')
    return int(hours) * 60 + int(minutes)


def check_windows(windows):
    if len({w['id'] for w in windows}) != len(windows):
        raise CoachError('Jedes Zeitfenster braucht eine eigene ID.')
    for window in windows:
        if window['allDay']:
            window['from'] = window['to'] = None
        elif window['from'] is None or window['to'] is None or minutes_of(window['to']) <= minutes_of(window['from']):
            raise CoachError('Ein Zeitfenster braucht eine Startzeit vor dem Ende oder „Den ganzen Tag“.')
        if window['kind'] == 'unavailable' and (window['sports'] or window['group']):
            raise CoachError('Ein Zeitfenster „Nicht verfügbar“ hat keine Sportarten und kein Gruppentraining.')
        group = window['group']
        if group and (window['allDay'] or group['sport'] not in window['sports']):
            raise CoachError('Gruppentraining braucht eine feste Uhrzeit und eine Sportart dieses Zeitfensters.')


def window_minutes(windows):
    """Minutes per weekday: the union of available windows without the unavailable ones."""
    result = {}
    for day in DAYS:
        free, blocked = set(), set()
        for window in (w for w in windows if w['day'] == day):
            span = range(0, 1440) if window['allDay'] else range(minutes_of(window['from']), minutes_of(window['to']))
            (free if window['kind'] == 'available' else blocked).update(span)
        result[day] = len(free - blocked)
    return result


def check_exceptions(exceptions):
    if len({e['id'] for e in exceptions}) != len(exceptions):
        raise CoachError('Jede Ausnahme braucht eine eigene ID.')
    for item in exceptions:
        if day_date(item['to']) < day_date(item['from']):
            raise CoachError('Eine Ausnahme endet nicht vor ihrem Beginn.')
        if item['kind'] == 'available' and item['maxMinutes'] is None:
            raise CoachError('Für eine Ausnahme „Verfügbar“ bitte die Minuten pro Tag angeben.')
        if item['kind'] == 'unavailable':
            item['maxMinutes'] = None
    exceptions.sort(key=lambda e: (e['from'], e['to']))


def exception_override(profile, stamp):
    """The latest exception covering that day as a daily override, or {}."""
    item = next((e for e in reversed(profile['availability'].get('exceptions', [])) if e['from'] <= stamp <= e['to']), None)
    if item is None:
        return {}
    override = {'available': False} if item['kind'] == 'unavailable' else {'maxMinutes': item['maxMinutes']}
    return {**override, 'exception': {'id': item['id'], 'note': item['note']}}


# --- Events -------------------------------------------------------------------------------------

EVENT_SUBTYPES = {
    'ride': ['criterium', 'cyclocross', 'timeTrial', 'crossCountry', 'roadRace', 'granFondo', 'xcMarathon', 'gravel', 'ultra', 'custom'],
    'run': ['5k', '10k', 'halfMarathon', 'marathon', 'trail', 'ultra', 'custom'],
    'swim': ['pool', 'openWater', 'custom'],
    'xcski': ['classic', 'skating', 'marathon', 'custom'],
    'hyrox': ['open', 'pro', 'doubles', 'relay'],
    'triathlon': ['sprint', 'olympic', 'middle', 'long', 'custom'],
    'duathlon': ['sprint', 'standard', 'custom'],
    'other': ['custom'],
}
# How the coach treats B and C events; the first one is the default. A events get a full taper from the plan.
HANDLING = {'A': [None], 'B': ['miniTaper', 'trainThrough'], 'C': ['replaceHard', 'easy']}
MAX_EVENTS = 50
EVENT_SCHEMA = obj({
    'title': text(200), 'sport': {'enum': list(EVENT_SUBTYPES)}, 'subtype': text(40, True),
    'startDate': text(10), 'endDate': text(10, True), 'allDay': {'type': 'boolean'}, 'time': clock(),
    'location': text(200, True), 'priority': {'enum': list(HANDLING)},
    'handling': {'enum': [None, *{h for options in HANDLING.values() for h in options if h}]},
    'distanceKm': num(0, 10000, True), 'targetSeconds': num(1, 60 * 86400, True, True), 'elevationM': num(0, 100000, True),
    'description': text(1500)})
EVENT_SCHEMA['required'] = ['title', 'sport', 'startDate', 'priority']
EVENT_DEFAULTS = {'subtype': None, 'endDate': None, 'allDay': True, 'time': None, 'location': None, 'handling': None,
                  'distanceKm': None, 'targetSeconds': None, 'elevationM': None, 'description': ''}


def complete_event(value, identity):
    """A validated event with its id; missing optional fields get their defaults."""
    event = {'id': identity, **EVENT_DEFAULTS, **validate(value, EVENT_SCHEMA)}
    event['title'] = event['title'].strip()
    if not event['title']:
        raise CoachError('Bitte einen Titel für das Event eingeben.')
    start = day_date(event['startDate'])
    end = day_date(event['endDate'] or event['startDate'])
    if end < start:
        raise CoachError('Das Enddatum darf nicht vor dem Start liegen.')
    if (end - start).days > 60:
        raise CoachError('Ein Event dauert höchstens 60 Tage.')
    event['endDate'] = end.isoformat()
    if event['subtype'] is not None and event['subtype'] not in EVENT_SUBTYPES[event['sport']]:
        raise CoachError('Dieser Untertyp passt nicht zur Sportart des Events.')
    if event['handling'] is None:
        event['handling'] = HANDLING[event['priority']][0]
    if event['handling'] not in HANDLING[event['priority']]:
        raise CoachError('Diese Option passt nicht zur Priorität des Events.')
    if event['allDay']:
        event['time'] = None
    elif event['time'] is None:
        raise CoachError('Bitte eine Uhrzeit angeben oder „Ganzer Tag“ wählen.')
    return event


def week_events(profile, week):
    """Events on days of this week as week entries of kind event, not as workouts."""
    monday = week_start(week)
    sunday = (monday + timedelta(days=6)).isoformat()
    return [{'kind': 'event', **{key: e[key] for key in ('id', 'title', 'sport', 'subtype', 'priority', 'handling',
                                                         'startDate', 'endDate', 'allDay', 'time')}}
            for e in profile['events'] if e['startDate'] <= sunday and e['endDate'] >= monday.isoformat()]


# --- Plan settings ------------------------------------------------------------------------------

# horizonWeeks: how many weeks ahead get sessions (no upper limit besides the plan); taperWeeks: the taper before each
# A event, None lets the coach decide.
DEFAULT_HORIZON = 3
PLAN_SETTINGS_SCHEMA = {**obj({'startDate': text(10), 'endDate': text(10), 'replanMode': {'enum': ['afterReview', 'sunday', 'manual']},
                               'horizonWeeks': num(1, 520, integer=True), 'taperWeeks': num(1, 3, True, True)}),
                        'required': ['startDate', 'endDate', 'replanMode']}


def plan_settings(value, previous, now):
    """Validated plan settings; createdAt stays from the first save, horizon and taper stay unless given."""
    data = validate(value, PLAN_SETTINGS_SCHEMA)
    if day_date(data['endDate']) <= day_date(data['startDate']):
        raise CoachError('Das Planende muss nach dem Planstart liegen.')
    previous = previous or {}
    return {'horizonWeeks': previous.get('horizonWeeks', DEFAULT_HORIZON), 'taperWeeks': previous.get('taperWeeks'),
            **data, 'createdAt': previous.get('createdAt') or now}
