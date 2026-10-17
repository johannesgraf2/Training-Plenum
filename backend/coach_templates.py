"""Deterministic sessions: AI chooses a template; TrainHub owns all arithmetic.

Cycling targets use FTP. Running targets use the threshold pace when it is known,
otherwise maximum heart rate. Missing athlete settings produce open targets. TSS is only a planned cycling estimate, calculated
with the existing 30-second normalized-power algorithm at target midpoints.
"""
import copy
import math
from datetime import date as Date

from analytics import sensor_summary
from workout_export import validate_workout


class TemplateError(ValueError):
    pass


# Ultra rides such as NorthCape 4000 need training rides of up to 15 h.
MAX_RIDE_MINUTES = 900
# Running intensity stays a fraction of maximum heart rate; with a threshold pace it is converted linearly to a
# fraction of threshold speed, where 89 % of maximum heart rate is threshold pace.
THRESHOLD_HR_FRACTION = .89
PACE_SLOPE = 1.2


def _steady(name, sport, duration, bounds, intensity, intensity_range, fuel='easy'):
    return {'name': name, 'sport': sport, 'kind': 'steady', 'fuel': fuel,
            'defaults': {'durationMin': duration, 'intensity': intensity},
            'params': {'durationMin': bounds, 'intensity': intensity_range}}


def _intervals(name, sport, intervals, work, recovery, intensity, intensity_range, fuel='intense'):
    params = {'intervals': [2, 12], 'workMin': [1, 30], 'recoveryMin': [1, 15], 'intensity': intensity_range}
    if sport == 'ride':
        # Optional total duration: the intervals sit inside a longer easy ride.
        params.update(durationMin=[30, MAX_RIDE_MINUTES], cadence=[60, 120])
    return {'name': name, 'sport': sport, 'kind': 'intervals', 'fuel': fuel,
            'defaults': {'intervals': intervals, 'workMin': work, 'recoveryMin': recovery, 'intensity': intensity},
            'params': params}


def _micro(name, sets, reps, work, rest, intensity, intensity_range, *, sets_range, reps_range, work_range, rest_range,
           margin, hint):
    """Short work/rest repeats in sets, e.g. 3×13×30/15; each set is one repeat block on the device."""
    return {'name': name, 'sport': 'ride', 'kind': 'micro', 'fuel': 'hit', 'margin': margin, 'hint': hint,
            'defaults': {'sets': sets, 'reps': reps, 'workSec': work, 'restSec': rest, 'setRestMin': 5, 'intensity': intensity},
            'params': {'sets': sets_range, 'reps': reps_range, 'workSec': work_range, 'restSec': rest_range, 'setRestMin': [2, 10],
                       'intensity': intensity_range, 'cadence': [60, 120], 'durationMin': [30, MAX_RIDE_MINUTES]}}


TEMPLATES = {
    'bike_recovery': _steady('Regeneration Rad', 'ride', 45, [20, 90], .50, [.40, .55], fuel='recovery'),
    'bike_z2': _steady('Grundlagenausdauer Rad', 'ride', 90, [20, 240], .65, [.56, .75]),
    'bike_z2_short': _steady('Kurze Grundlage Rad', 'ride', 60, [20, 90], .65, [.56, .75]),
    'bike_z2_long': _steady('Lange Grundlage Rad', 'ride', 180, [90, MAX_RIDE_MINUTES], .65, [.56, .75]),
    'bike_z2_sprints': {'name': 'Grundlage mit Sprints', 'sport': 'ride', 'kind': 'sprints', 'fuel': 'easy',
                        'hint': 'Easy endurance ride with short maximal sprints spread evenly; keeps neuromuscular power in base phases.',
                        'defaults': {'durationMin': 120, 'intensity': .65, 'reps': 6, 'workSec': 10},
                        'params': {'durationMin': [45, 360], 'intensity': [.56, .75], 'reps': [2, 12], 'workSec': [6, 30]}},
    'bike_tempo': _intervals('Tempo Rad', 'ride', 2, 20, 5, .83, [.76, .90]),
    'bike_sweetspot': _intervals('Sweetspot Rad', 'ride', 3, 12, 5, .90, [.88, .94]),
    'bike_threshold': _intervals('Schwelle Rad', 'ride', 3, 12, 6, .98, [.95, 1.05]),
    'bike_threshold_intervals': _intervals('Schwellenintervalle Rad', 'ride', 3, 12, 6, .98, [.95, 1.05]),
    'bike_vo2': _intervals('VO2-Intervalle Rad', 'ride', 5, 4, 4, 1.12, [1.06, 1.20], fuel='hit'),
    'bike_vo2_micro': _micro('VO2-Mikrointervalle Rad', 3, 9, 30, 15, 1.30, [1.10, 1.50],
                             sets_range=[1, 5], reps_range=[4, 20], work_range=[15, 60], rest_range=[10, 60], margin=.05,
                             hint='VO2max micro intervals such as 30/15 or 40/20 in sets; progress reps per set (e.g. 3x9 -> 3x11 -> 3x13).'),
    'bike_sit': _micro('Sprintintervalle (SIT) Rad', 1, 6, 30, 240, 1.70, [1.30, 2.50],
                       sets_range=[1, 3], reps_range=[2, 12], work_range=[10, 60], rest_range=[120, 480], margin=.15,
                       hint='Sprint interval training: near-maximal efforts with long easy recovery (e.g. 4x30 s -> 6x30 s -> 8x30 s).'),
    'bike_long': _steady('Lange Ausfahrt', 'ride', 240, [90, MAX_RIDE_MINUTES], .65, [.56, .75]),
    'run_easy': _steady('Lockerer Lauf', 'run', 45, [15, 120], .70, [.60, .78]),
    'run_threshold': _intervals('Schwellenlauf', 'run', 3, 8, 3, .88, [.83, .92]),
    'run_long': _steady('Langer Lauf', 'run', 90, [45, 240], .72, [.60, .80]),
    'strength_general': {'name': 'Allgemeines Krafttraining', 'sport': 'strength', 'kind': 'strength', 'fuel': 'strength',
                         'defaults': {'durationMin': 45}, 'params': {'durationMin': [10, 120]}},
    'rest': {'name': 'Ruhetag', 'sport': 'rest', 'kind': 'rest', 'defaults': {}, 'params': {}},
}

PARAM_NAMES = ('durationMin', 'intervals', 'workMin', 'recoveryMin', 'intensity',
               'sets', 'reps', 'workSec', 'restSec', 'setRestMin', 'cadence')
SESSION_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['id', 'day', 'template', 'params'],
    'properties': {
        'id': {'type': 'string', 'minLength': 1, 'maxLength': 80},
        'day': {'type': 'string', 'enum': ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']},
        'template': {'type': 'string', 'enum': list(TEMPLATES)},
        'params': {'type': 'object', 'additionalProperties': False, 'required': list(PARAM_NAMES),
                   'properties': {key: {'type': ['number' if key == 'intensity' else 'integer', 'null']}
                                  for key in PARAM_NAMES}},
    },
}
DURATION_RULES = {
    ('intervals', 'ride'): '10 min warmup + work + recoveries between intervals + 10 min cooldown',
    ('intervals', 'run'): '10 min warmup + work + recoveries between intervals + 5 min cooldown',
    ('micro', 'ride'): '10 min warmup + sets x reps x (workSec + restSec) + setRestMin between sets + 10 min cooldown',
    ('sprints', 'ride'): 'durationMin includes warmup and cooldown; reps sprints of workSec spread evenly through the easy part',
}
# Fueling follows the aim of the session: carbohydrates for hard work, optionally only water for short easy
# sessions, protein afterwards. General guidance, fixed per template type and duration.
FUELING = {
    'hit': 'Verpflegung (HIT): Vorher kohlenhydratreich essen und während der Einheit Kohlenhydrate zuführen (ca. 30–60 g/h). '
           'Danach Kohlenhydrate und Protein.',
    'intense': 'Verpflegung: Während der Einheit Kohlenhydrate zuführen (ca. 40–60 g/h). Danach Kohlenhydrate und Protein.',
    'easy': 'Verpflegung (LIT): Optional nur Wasser. Danach Protein.',
    'easy_long': 'Verpflegung (LIT): Wasser und etwas Kohlenhydrate (ca. 30 g/h). Danach Protein.',
    'long': 'Verpflegung (lange Einheit): Früh und regelmäßig essen und trinken (ca. 60–90 g Kohlenhydrate/h). '
            'Danach Kohlenhydrate und Protein.',
    'ultra': 'Verpflegung (ab 6 h): Von Beginn an stündlich 60–90 g Kohlenhydrate, auch feste Nahrung, dazu Salz und '
             'Flüssigkeit. Nachfüllstopps vorher planen. Danach Kohlenhydrate und Protein.',
    'recovery': 'Verpflegung: Wasser reicht. Danach eine normale Mahlzeit mit Protein.',
    'strength': 'Verpflegung: Danach Protein (ca. 20–30 g).',
}


def fueling(spec, minutes):
    kind = spec.get('fuel')
    if kind in ('easy', 'intense', 'hit') and minutes >= 360:
        kind = 'ultra'
    elif kind in ('easy', 'intense', 'hit') and minutes > 150:
        kind = 'long'
    elif kind == 'easy' and minutes > 90:
        kind = 'easy_long'
    return FUELING.get(kind)


EMBED_RULE = '; optional durationMin is the total and adds easy riding (65 % FTP), split before and after the hard part'
CADENCE_RULE = '; optional cadence (rpm) is shown with every hard part'


def template_catalog():
    result = []
    for key, value in TEMPLATES.items():
        rule = DURATION_RULES.get((value['kind'], value['sport']), 'durationMin includes warmup and cooldown')
        if value['kind'] in ('intervals', 'micro') and 'durationMin' in value['params']:
            rule += EMBED_RULE + CADENCE_RULE
        item = dict(id=key, name=value['name'], sport=value['sport'],
                    defaults=copy.deepcopy(value['defaults']), params=copy.deepcopy(value['params']),
                    intensityReference='ftp' if value['sport'] == 'ride' else 'maxHr' if value['sport'] == 'run' else None,
                    durationRule=rule)
        if value['sport'] == 'run':
            item['targets'] = (f'with a threshold pace the server shows pace ranges; intensity {THRESHOLD_HR_FRACTION} '
                               'of max HR is threshold pace')
        if value.get('hint'):
            item['use'] = value['hint']
        result.append(item)
    return result


def flat_steps(steps):
    """Workout steps with repeat blocks expanded, in riding order."""
    for item in steps:
        if item['kind'] == 'repeat':
            for _ in range(item['count']):
                yield from item['steps']
        else:
            yield item


def _seconds(steps):
    return sum(item['duration']['value'] for item in flat_steps(steps))


def _label(template, spec, e):
    """Name with the structure, e.g. „VO2-Mikrointervalle Rad 3×13×30/15“."""
    if spec['kind'] == 'intervals':
        return f"{spec['name']} {e['intervals']}×{e['workMin']} min"
    if spec['kind'] == 'sprints':
        return f"{spec['name']} {e['reps']}×{e['workSec']} s"
    if spec['kind'] == 'micro':
        sets = f"{e['sets']}×" if e['sets'] > 1 else ''
        return f"{spec['name']} {sets}{e['reps']}×{e['workSec']} s" if template == 'bike_sit' \
            else f"{spec['name']} {sets}{e['reps']}×{e['workSec']}/{e['restSec']}"
    return spec['name']


def _number(value, key, low, high, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high or (integer and value != int(value)):
        raise TemplateError(f'{key}: Erlaubt sind {low} bis {high}' + (' (ganze Zahlen).' if integer else '.'))
    return int(value) if integer else value


def pace_range(threshold_pace, fraction, margin):
    """Pace range in s/km (faster first) for a fraction of maximum heart rate."""
    speed = max(.5, 1 + (fraction - THRESHOLD_HR_FRACTION) * PACE_SLOPE)
    return (min(3600, max(60, round(threshold_pace / (speed + margin)))),
            min(3600, max(60, round(threshold_pace / (speed - margin)))))


def render_session(template, params, date, ftp=None, max_hr=None, threshold_pace=None):
    if not isinstance(template, str) or template not in TEMPLATES:
        raise TemplateError('Unbekanntes Workout-Template.')
    spec = TEMPLATES[template]
    if params is None:
        params = {}
    if not isinstance(params, dict) or set(params) - set(PARAM_NAMES):
        raise TemplateError('Unbekannte oder ungültige Template-Parameter.')
    # Strict provider schemas require all keys; null means omit/use the default.
    supplied = {key: value for key, value in params.items() if value is not None}
    if set(supplied) - set(spec['params']):
        raise TemplateError('Dieser Parameter ist für das ausgewählte Template nicht erlaubt.')
    effective = {**spec['defaults'], **supplied}
    for key, value in effective.items():
        effective[key] = _number(value, key, *spec['params'][key], integer=key != 'intensity')
    if not isinstance(date, str):
        raise TemplateError('Bitte ein gültiges Trainingsdatum auswählen.')
    try:
        if Date.fromisoformat(date).isoformat() != date:
            raise ValueError()
    except ValueError:
        raise TemplateError('Bitte ein gültiges Trainingsdatum auswählen.') from None
    if ftp is not None:
        ftp = _number(ftp, 'FTP', 1, 1000)
    if max_hr is not None:
        max_hr = _number(max_hr, 'Maximale Herzfrequenz', 30, 250)
    if threshold_pace is not None:
        threshold_pace = _number(threshold_pace, 'Schwellenpace', 120, 900)
    name = _label(template, spec, effective)
    result = {'template': template, 'params': effective, 'date': date, 'sport': spec['sport'],
              'name': name, 'durationMin': effective.get('durationMin', 0),
              'estimatedTss': None, 'workout': None}
    if spec['kind'] in ('rest', 'strength'):
        result['notes'] = fueling(spec, result['durationMin'])
        return result

    def step(name, seconds, intensity, fraction, margin=None):
        reference = ftp if spec['sport'] == 'ride' else max_hr
        target = {'type': 'none'}
        if spec['sport'] == 'run' and threshold_pace is not None:
            low, high = pace_range(threshold_pace, fraction, margin or .025)
            target = {'type': 'pace', 'low': low, 'high': high}
        elif reference is not None:
            margin = margin or (.02 if spec['sport'] == 'ride' else .025)
            minimum = 1 if spec['sport'] == 'ride' else 30
            target = {'type': 'power' if spec['sport'] == 'ride' else 'heart_rate',
                      'low': max(minimum, round(reference * (fraction - margin))),
                      'high': max(minimum, min(3000 if spec['sport'] == 'ride' else 250,
                                               round(reference * (fraction + margin))))}
        return {'kind': 'step', 'name': name, 'duration': {'type': 'time', 'value': seconds},
                'intensity': intensity, 'target': target}

    easy_fraction = .50 if spec['sport'] == 'ride' else .60
    hard = spec['kind'] in ('intervals', 'micro')
    warmup = 10 if hard or spec['sport'] == 'ride' else 5
    cooldown = 10 if hard and spec['sport'] == 'ride' else 5
    cadence = f" · {effective['cadence']} U/min" if effective.get('cadence') else ''
    steps = [step('Aufwärmen', warmup * 60, 'warmup', easy_fraction)]
    if spec['kind'] == 'steady':
        steps.append(step('Hauptteil', (effective['durationMin'] - warmup - cooldown) * 60,
                          'active', effective['intensity']))
    elif spec['kind'] == 'intervals':
        for interval in range(effective['intervals']):
            steps.append(step(f'Intervall {interval + 1}{cadence}', effective['workMin'] * 60, 'interval', effective['intensity']))
            if interval < effective['intervals'] - 1:
                steps.append(step('Erholung', effective['recoveryMin'] * 60, 'recovery', easy_fraction))
    elif spec['kind'] == 'micro':
        for number in range(effective['sets']):
            prefix = f'Satz {number + 1} · ' if effective['sets'] > 1 else ''
            steps.append({'kind': 'repeat', 'count': effective['reps'], 'steps': [
                step(f'{prefix}Hart{cadence}', effective['workSec'], 'interval', effective['intensity'], spec['margin']),
                step(f'{prefix}Locker', effective['restSec'], 'recovery', easy_fraction)]})
            if number < effective['sets'] - 1:
                steps.append(step('Satzpause', effective['setRestMin'] * 60, 'recovery', easy_fraction))
    else:  # sprints: easy riding with maximal sprints spread evenly
        # Parameter bounds leave at least 90 s of easy riding between sprints.
        main = (effective['durationMin'] - warmup - cooldown) * 60 - effective['reps'] * effective['workSec']
        chunk = main // (effective['reps'] + 1)
        steps.append({'kind': 'repeat', 'count': effective['reps'], 'steps': [
            step('Grundlage', chunk, 'active', effective['intensity']),
            step('Sprint', effective['workSec'], 'interval', 2.0, .5)]})
        steps.append(step('Grundlage', main - chunk * effective['reps'], 'active', effective['intensity']))
    steps.append(step('Abwärmen', cooldown * 60, 'cooldown', easy_fraction))
    if hard and 'durationMin' in effective:
        extra = effective['durationMin'] * 60 - _seconds(steps)
        if extra < 0:
            raise TemplateError('Die Gesamtdauer ist kürzer als Aufwärmen, Belastung und Abwärmen.')
        before = extra // 120 * 60
        if extra - before:
            steps.insert(-1, step('Grundlage', extra - before, 'active', .65))
        if before:
            steps.insert(1, step('Grundlage', before, 'active', .65))
    result['durationMin'] = _seconds(steps) / 60
    if result['durationMin'] > MAX_RIDE_MINUTES:
        raise TemplateError(f'Die Einheit darf einschließlich Pausen maximal {MAX_RIDE_MINUTES} Minuten dauern.')
    result['notes'] = fueling(spec, result['durationMin'])
    result['workout'] = validate_workout({'version': 1, 'name': name, 'sport': spec['sport'],
                                           'date': date, 'steps': steps, 'notes': result['notes']})
    if spec['sport'] == 'ride' and ftp is not None:
        # Synthetic planned points never enter observed activity data. Sampling
        # boundaries at <=30 s lets the shared analytics integrate exact durations.
        points, elapsed = [], 0
        for item in flat_steps(steps):
            target = item['target']
            watts = (target['low'] + target['high']) / 2
            stop = elapsed + item['duration']['value']
            while elapsed < stop:
                points.append({'time': elapsed, 'power': watts})
                elapsed = min(elapsed + 30, stop)
        points.append({'time': elapsed})
        planned = sensor_summary(points, 'power', 0, elapsed)
        result['estimatedTss'] = round(elapsed / 3600 * (planned['np'] / ftp) ** 2 * 100, 1)
    return result
