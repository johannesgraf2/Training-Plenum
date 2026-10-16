"""Morning check-in, complaints and the daily traffic light.

All rules here are fixed and deterministic: the traffic light is calculated from the athlete's own answers,
the active complaints, today's plan and (optionally) the WHOOP band. The AI only sees the result as context.
"""
import uuid
from statistics import mean

from coach_domain import CoachError, day_date, num, obj, text, validate

# Answers on five steps, 1 = the first label, 5 = the last; alcohol has three steps from 0.
SCALES = {
    'wellbeing': ('Wohlbefinden', ['sehr schlecht', 'schlecht', 'ok', 'gut', 'ausgezeichnet']),
    'recovery': ('Erholung', ['erschöpft', 'müde', 'normal', 'erholt', 'frisch']),
    'stress': ('Stress', ['entspannt', 'eher ruhig', 'mittel', 'hoch', 'sehr gestresst']),
    'soreness': ('Muskelkater', ['keiner', 'leicht', 'mittel', 'stark', 'extrem']),
    'mood': ('Stimmung', ['negativ', 'gedrückt', 'neutral', 'gut', 'euphorisch']),
    'nutrition': ('Ernährung gestern', ['zu wenig', 'etwas wenig', 'passend', 'etwas viel', 'zu viel']),
}
ALCOHOL = ['nein', '1–2 Getränke', 'mehr']
# Check-ins before the morning check-in used these keys (1–5, higher = more).
LEGACY_KEYS = ('fatigue', 'motivation', 'stress', 'sleepQuality', 'soreness')

REGIONS = {'foot': 'Fuß', 'ankle': 'Knöchel', 'shin': 'Schienbein', 'calf': 'Wade', 'knee': 'Knie', 'thigh': 'Oberschenkel',
           'hip': 'Hüfte', 'back': 'Rücken', 'shoulder': 'Schulter', 'arm': 'Ellbogen/Hand'}
# Sports a complaint of the region rules out while it hurts; the back has no single sport, it lowers the load overall.
REGION_SPORTS = {'foot': ['run'], 'ankle': ['run'], 'shin': ['run'], 'calf': ['run'], 'knee': ['run', 'ride'],
                 'thigh': ['run'], 'hip': ['run'], 'back': [], 'shoulder': ['swim'], 'arm': ['swim']}
SIDES = {'left': 'links', 'right': 'rechts', 'both': 'beidseitig'}
TIMING = {'during': 'während der Belastung', 'outside': 'außerhalb der Belastung', 'both': 'während und außerhalb der Belastung'}
ONSET = {'immediate': 'sofort beim Start', 'during': 'im Verlauf', 'after': 'erst danach'}
IMPACT = {'normal': 'normal trainieren', 'adjust': 'anpassen', 'pause': 'pausieren'}
TRENDS = {'better': 'besser', 'same': 'gleich', 'worse': 'schlechter'}
SPORT_NOUNS = {'run': 'Laufen', 'ride': 'Radfahren', 'swim': 'Schwimmen'}

INJURY_SCHEMA = obj({'region': {'enum': list(REGIONS)}, 'side': {'enum': list(SIDES)}, 'pain': num(0, 10, integer=True),
                     'timing': {'enum': list(TIMING)}, 'onset': {'enum': list(ONSET)}, 'impact': {'enum': list(IMPACT)}})
UPDATE_SCHEMA = obj({'id': text(40), 'pain': num(0, 10, integer=True), 'trend': {'enum': [*TRENDS, None]}, 'healed': {'type': 'boolean'}})
CHECK_IN_V2_SCHEMA = obj({'date': text(10), **{key: num(1, 5, integer=True) for key in SCALES}, 'alcohol': num(0, 2, integer=True),
                          'notes': text(1000), 'newInjury': {'anyOf': [INJURY_SCHEMA, {'type': 'null'}]},
                          'injuryUpdates': {'type': 'array', 'maxItems': 10, 'items': UPDATE_SCHEMA}})
CHECK_IN_V2_SCHEMA['required'] = ['date', *SCALES, 'alcohol']
MAX_INJURIES = 30


def injury_label(injury):
    side = '' if injury['side'] == 'both' else f" {SIDES[injury['side']]}"
    return f"{REGIONS[injury['region']]}{side}"


def current_pain(injury):
    return injury['history'][-1]['pain'] if injury['history'] else 0


def active_injuries(injuries):
    return [i for i in injuries if i['status'] == 'active']


def severe(injury):
    """Pain that rules the affected sports out: strong, starting right with the load, or the athlete pauses."""
    return current_pain(injury) >= 5 or injury['impact'] == 'pause' or \
        (injury['onset'] == 'immediate' and injury['timing'] in ('during', 'both'))


def blocked_sports(injuries):
    """Sports the coach must not plan while a complaint is severe; the server enforces it on every plan change."""
    result = {}
    for injury in active_injuries(injuries):
        if severe(injury):
            for sport in REGION_SPORTS[injury['region']]:
                result.setdefault(sport, injury_label(injury))
    return result


def public_injury(injury):
    return {**injury, 'label': injury_label(injury), 'pain': current_pain(injury),
            'affectedSports': REGION_SPORTS[injury['region']], 'severe': injury['status'] == 'active' and severe(injury)}


def record_check_in(profile, data, today):
    """Validates a morning check-in, updates the complaints and stores it; returns the stored check-in."""
    validate(data, CHECK_IN_V2_SCHEMA)
    stamp = day_date(data['date'])
    if stamp > today:
        raise CoachError('Ein Check-in lässt sich nicht für einen kommenden Tag speichern.')
    injuries = profile.setdefault('injuries', [])
    by_id = {i['id']: i for i in injuries}
    for update in data.get('injuryUpdates', []):
        injury = by_id.get(update['id'])
        if injury is None or injury['status'] != 'active':
            raise CoachError('Diese Beschwerde ist nicht mehr aktiv.')
        entry = {'date': data['date'], 'pain': 0 if update['healed'] else update['pain'], 'trend': update['trend']}
        injury['history'] = [h for h in injury['history'] if h['date'] != data['date']] + [entry]
        if update['healed']:
            injury.update(status='healed', endDate=data['date'])
    if data.get('newInjury'):
        item = data['newInjury']
        injuries.append({'id': uuid.uuid4().hex[:12], 'source': 'athlete', 'region': item['region'], 'side': item['side'],
                         'timing': item['timing'], 'onset': item['onset'], 'impact': item['impact'], 'startDate': data['date'],
                         'status': 'active', 'endDate': None, 'history': [{'date': data['date'], 'pain': item['pain'], 'trend': None}]})
    # Healed complaints stay as history; the oldest healed ones go first.
    while len(injuries) > MAX_INJURIES:
        oldest = next((i for i in injuries if i['status'] == 'healed'), injuries[0])
        injuries.remove(oldest)
    check_in = {'version': 2, 'source': 'athlete', 'date': data['date'], **{key: data[key] for key in SCALES},
                'alcohol': data['alcohol'], 'notes': data.get('notes', '').strip()}
    profile['checkIns'] = sorted([c for c in profile.get('checkIns', []) if c['date'] != data['date']] + [check_in],
                                 key=lambda c: c['date'])[-120:]
    return check_in


def heal(profile, identity, today):
    injury = next((i for i in profile.get('injuries', []) if i['id'] == identity), None)
    if injury is None:
        raise CoachError('Beschwerde nicht gefunden.')
    if injury['status'] == 'active':
        injury['history'] = [h for h in injury['history'] if h['date'] != today.isoformat()] + \
            [{'date': today.isoformat(), 'pain': 0, 'trend': 'better'}]
        injury.update(status='healed', endDate=today.isoformat())
    return injury


def readiness(check_in, injuries, sessions, whoop_band=None):
    """The traffic light for the day: green, yellow or red with the reasons, from fixed rules.

    sessions are today's planned sessions as {sport, hard, durationMin}."""
    hard = any(s['hard'] for s in sessions)
    long = any((s.get('durationMin') or 0) >= 90 for s in sessions)
    red, yellow, notes = [], [], []
    if check_in:
        c = check_in
        if c['wellbeing'] == 1:
            red.append('Wohlbefinden sehr schlecht')
        elif c['wellbeing'] == 2:
            yellow.append('Wohlbefinden schlecht')
        if c['recovery'] == 1:
            yellow.append('Du fühlst dich erschöpft')
        elif c['recovery'] == 2 and hard:
            yellow.append('Müde vor einer harten Einheit')
        if c['stress'] == 5:
            yellow.append('Sehr hoher Stress')
        elif c['stress'] == 4 and hard:
            yellow.append('Hoher Stress vor einer harten Einheit')
        if c['soreness'] == 5:
            yellow.append('Extremer Muskelkater')
        elif c['soreness'] == 4 and hard:
            yellow.append('Starker Muskelkater vor einer harten Einheit')
        if c['nutrition'] == 1 and (hard or long):
            yellow.append('Gestern zu wenig gegessen vor einer fordernden Einheit')
        elif c['nutrition'] <= 2:
            notes.append('Heute auf genug Kohlenhydrate achten.')
        if c['alcohol'] == 2:
            yellow.append('Alkohol gestern')
        elif c['alcohol'] == 1 and hard:
            yellow.append('Alkohol gestern vor einer harten Einheit')
        if c['mood'] == 1:
            notes.append('Stimmung negativ – locker bleiben ist heute völlig in Ordnung.')
    if whoop_band == 'red':
        yellow.append('WHOOP-Readiness im roten Bereich')
    affected = set()
    for injury in active_injuries(injuries):
        label, pain = injury_label(injury), current_pain(injury)
        if severe(injury):
            extra = ', setzt sofort bei Belastung ein' if injury['onset'] == 'immediate' and injury['timing'] in ('during', 'both') else ''
            red.append(f'{label}: Schmerz {pain}/10{extra}')
            affected.update(REGION_SPORTS[injury['region']])
        elif pain >= 3 or injury['impact'] == 'adjust':
            yellow.append(f'{label}: Schmerz {pain}/10')
            affected.update(REGION_SPORTS[injury['region']])
        else:
            notes.append(f'{label}: {pain}/10 – weiter beobachten.')
    if len(yellow) >= 3:
        red.append('Mehrere Warnsignale zusammen')
    level = 'red' if red else 'yellow' if yellow else 'green'
    return {'source': 'calculated', 'level': level, 'reasons': red + yellow, 'notes': notes,
            'affectedSports': sorted(affected), 'checkedIn': check_in is not None}


def check_in_averages(check_ins):
    """Means of the answered scales over a period, for old and new check-ins alike."""
    if not check_ins:
        return None
    keys = [*SCALES, 'alcohol', *[k for k in LEGACY_KEYS if k not in SCALES]]
    result = {}
    for key in keys:
        values = [c[key] for c in check_ins if isinstance(c.get(key), (int, float))]
        if values:
            result[key] = round(mean(values), 1)
    return result
