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
MAX_RUN_MINUTES = 240
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
    # Optional total duration: the intervals sit inside a longer easy ride or run (e.g. „12 km, darin 3 × 6 min“).
    if sport == 'ride':
        params.update(durationMin=[30, MAX_RIDE_MINUTES], cadence=[60, 120])
    else:
        params.update(durationMin=[20, MAX_RUN_MINUTES])
    return {'name': name, 'sport': sport, 'kind': 'intervals', 'fuel': fuel,
            'defaults': {'intervals': intervals, 'workMin': work, 'recoveryMin': recovery, 'intensity': intensity},
            'params': params}


def _micro(name, sets, reps, work, rest, intensity, intensity_range, *, sets_range, reps_range, work_range, rest_range,
           margin, hint, sport='ride', set_rest=5):
    """Short work/rest repeats in sets, e.g. 3×13×30/15; each set is one repeat block on the device."""
    params = {'sets': sets_range, 'reps': reps_range, 'workSec': work_range, 'restSec': rest_range, 'setRestMin': [2, 10],
              'intensity': intensity_range}
    params['durationMin'] = [30, MAX_RIDE_MINUTES] if sport == 'ride' else [20, MAX_RUN_MINUTES]
    if sport == 'ride':
        params['cadence'] = [60, 120]
    return {'name': name, 'sport': sport, 'kind': 'micro', 'fuel': 'hit', 'margin': margin, 'hint': hint,
            'defaults': {'sets': sets, 'reps': reps, 'workSec': work, 'restSec': rest, 'setRestMin': set_rest, 'intensity': intensity},
            'params': params}


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
    # Cruise intervals with short jogging breaks (90 s-2 min); one interval is a continuous tempo run.
    'run_threshold': {**_intervals('Schwellenlauf', 'run', 3, 8, 2, .88, [.83, .92]),
                      'hint': 'Threshold reps with 1-2 min jogging recovery, e.g. 3x6 -> 3x8 -> 3x10 min, 2-3 km reps (about 8-14 min), '
                              'or intervals 1 for a continuous tempo run of 15-30 min; set durationMin for the whole run.'},
    'run_long': _steady('Langer Lauf', 'run', 90, [45, MAX_RUN_MINUTES], .72, [.60, .80]),
    # A long run with marathon-pace blocks near its end, e.g. „30 km: 20 L + 8 MP + 2 L“; the easy running comes first.
    'run_long_mp': {'name': 'Langer Lauf mit Marathontempo', 'sport': 'run', 'kind': 'intervals', 'fuel': 'intense', 'embed': 'before',
                    'hint': 'Long run with marathon-pace (MP) blocks late in the run: intervals blocks of workMin at MP with '
                            'recoveryMin easy between, the rest easy before; progress MP time, e.g. 40 -> 50 -> 2x30 -> 80 min, '
                            'last big one about 3 weeks before the race.',
                    'defaults': {'durationMin': 150, 'intervals': 1, 'workMin': 40, 'recoveryMin': 10, 'intensity': .84},
                    'params': {'durationMin': [60, MAX_RUN_MINUTES], 'intervals': [1, 4], 'workMin': [10, 120], 'recoveryMin': [2, 20],
                               'intensity': [.80, .88]}},
    # Easy runs with short fast touches; they count as easy.
    'run_strides': {'name': 'Lockerer Lauf mit Steigerungen', 'sport': 'run', 'kind': 'sprints', 'fuel': 'easy', 'pick': 'Steigerung',
                    'hint': 'Easy run with 4-10 strides of 15-30 s (fast but relaxed, not a sprint), full easy jogging between.',
                    'defaults': {'durationMin': 50, 'intensity': .70, 'reps': 6, 'workSec': 20},
                    'params': {'durationMin': [30, 120], 'intensity': [.60, .78], 'reps': [4, 10], 'workSec': [10, 30]}},
    'run_hill_sprints': {'name': 'Lockerer Lauf mit Bergsprints', 'sport': 'run', 'kind': 'sprints', 'fuel': 'easy', 'pick': 'Bergsprint',
                         'hint': 'Easy run with 4-10 short controlled-fast hill sprints of 8-15 s, walk or jog down about 90 s; '
                                 'builds strength and running economy in base phases.',
                         'defaults': {'durationMin': 50, 'intensity': .70, 'reps': 6, 'workSec': 10},
                         'params': {'durationMin': [30, 120], 'intensity': [.60, .78], 'reps': [4, 10], 'workSec': [8, 15]}},
    # Running VO2max work: intensity .95 of max HR is about 7 % faster than threshold pace (3-5 km race pace).
    'run_vo2': {**_intervals('VO2-Intervalle Lauf', 'run', 5, 3, 2, .95, [.92, 1.0], fuel='hit'),
                'hint': 'Running VO2max intervals of 2-5 min (800-1000 m reps, about 3-4 min) with 2-3 min jogging recovery; '
                        'progress the number of reps, e.g. 5x3 -> 5x4 -> 6x4 min; 6x1 min with 2 min easy is a gentle fartlek. '
                        'Set durationMin for the whole run.'},
    'run_vo2_short': _micro('Kurze VO2-Intervalle Lauf', 2, 8, 30, 30, 1.0, [.95, 1.05],
                            sets_range=[1, 4], reps_range=[4, 15], work_range=[15, 90], rest_range=[15, 90], margin=.03,
                            sport='run', set_rest=3,
                            hint='Short running VO2max repeats with jogging rest, e.g. 30/30 or 60/60 in sets; progress reps per '
                                 'set (e.g. 2x8 -> 2x10 -> 3x8).'),
    'strength_general': {'name': 'Allgemeines Krafttraining', 'sport': 'strength', 'kind': 'strength', 'fuel': 'strength',
                         'defaults': {'durationMin': 45}, 'params': {'durationMin': [10, 120]}},
    'rest': {'name': 'Ruhetag', 'sport': 'rest', 'kind': 'rest', 'defaults': {}, 'params': {}},
    # Tests for a threshold the athlete wants measured („Testen lassen“); fixed protocols in the first plan week.
    'bike_ftp_test': {'name': 'FTP-Test Rad', 'sport': 'ride', 'kind': 'test', 'defaults': {}, 'params': {},
                      'hint': '20-minute FTP test on a rested day; plan it when requiredTests lists it.',
                      'protocol': [('Aufwärmen', 15, 'warmup', .50), ('Vorbelastung', 5, 'active', .85),
                                   ('Locker', 5, 'recovery', .50), ('Test: 20 min gleichmäßig maximal', 20, 'interval', None),
                                   ('Abwärmen', 10, 'cooldown', .50)],
                      'note': 'FTP ≈ 95 % der Durchschnittsleistung der 20 Testminuten. Ergebnis danach in den Einstellungen '
                              'eintragen. Vorher Kohlenhydrate essen.'},
    'run_test_30': {'name': '30-min-Lauftest', 'sport': 'run', 'kind': 'test', 'defaults': {}, 'params': {},
                    'hint': '30-minute run time trial on a rested day; plan it when requiredTests lists it.',
                    'protocol': [('Aufwärmen', 15, 'warmup', .60), ('Test: 30 min gleichmäßig maximal', 30, 'interval', None),
                                 ('Abwärmen', 10, 'cooldown', .60)],
                    'note': 'Schwellenpace ≈ Durchschnittspace der letzten 20 Testminuten. Ergebnis danach in den '
                            'Einstellungen eintragen.'},
}

TEMPLATES['run_threshold']['params']['intervals'] = [1, 12]  # One interval is a continuous tempo run.

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
    ('micro', 'run'): '10 min warmup + sets x reps x (workSec + restSec) + setRestMin between sets + 5 min cooldown',
    ('sprints', 'ride'): 'durationMin includes warmup and cooldown; reps sprints of workSec spread evenly through the easy part',
    ('sprints', 'run'): 'durationMin includes warmup and cooldown; reps of workSec spread evenly through the easy part',
    ('test', 'ride'): 'fixed 55 min protocol including warmup and cooldown; all params null',
    ('test', 'run'): 'fixed 55 min protocol including warmup and cooldown; all params null',
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


EMBED_RULE = {'ride': '; optional durationMin is the total and adds easy riding (65 % FTP), split before and after the hard part',
              'run': '; optional durationMin is the total run and adds easy running, split before and after the hard part'}
CADENCE_RULE = '; optional cadence (rpm) is shown with every hard part'


def template_catalog():
    result = []
    for key, value in TEMPLATES.items():
        rule = DURATION_RULES.get((value['kind'], value['sport']), 'durationMin includes warmup and cooldown')
        if value.get('embed') == 'before':
            rule = 'durationMin is the whole run: easy running first, then intervals blocks of workMin with recoveryMin easy ' \
                   'between, then 10 min easy'
        elif value['kind'] in ('intervals', 'micro') and 'durationMin' in value['params']:
            rule += EMBED_RULE[value['sport']] + (CADENCE_RULE if value['sport'] == 'ride' else '')
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
        return f"{spec['name']} {e['workMin']} min" if e['intervals'] == 1 else f"{spec['name']} {e['intervals']}×{e['workMin']} min"
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
        if fraction is None:
            pass  # A test effort is open: it measures the threshold.
        elif spec['sport'] == 'run' and threshold_pace is not None:
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
    # Easy riding or running around the hard part of a longer session.
    easy_name, easy_steady = ('Grundlage', .65) if spec['sport'] == 'ride' else ('Locker', .70)
    long_mp = spec.get('embed') == 'before'
    hard = spec['kind'] in ('intervals', 'micro')
    warmup = 10 if hard or spec['sport'] == 'ride' else 5
    cooldown = 10 if hard and (spec['sport'] == 'ride' or long_mp) else 5
    cadence = f" · {effective['cadence']} U/min" if effective.get('cadence') else ''
    if spec['kind'] == 'test':
        steps = [step(label, minutes * 60, intensity, fraction) for label, minutes, intensity, fraction in spec['protocol']]
        result['durationMin'] = _seconds(steps) / 60
        result['notes'] = spec['note']
        result['workout'] = validate_workout({'version': 1, 'name': name, 'sport': spec['sport'],
                                               'date': date, 'steps': steps, 'notes': result['notes']})
        if spec['sport'] == 'ride' and ftp is not None:
            result['estimatedTss'] = planned_tss(steps, ftp)
        return result
    steps = [step('Aufwärmen', warmup * 60, 'warmup', easy_fraction)]
    if spec['kind'] == 'steady':
        steps.append(step('Hauptteil', (effective['durationMin'] - warmup - cooldown) * 60,
                          'active', effective['intensity']))
    elif spec['kind'] == 'intervals':
        work_name = 'Marathontempo' if long_mp else 'Tempo' if effective['intervals'] == 1 else 'Intervall'
        for interval in range(effective['intervals']):
            number = f' {interval + 1}' if effective['intervals'] > 1 else ''
            steps.append(step(f'{work_name}{number}{cadence}', effective['workMin'] * 60, 'interval', effective['intensity']))
            if interval < effective['intervals'] - 1:
                steps.append(step(easy_name if long_mp else 'Erholung', effective['recoveryMin'] * 60,
                                  'active' if long_mp else 'recovery', easy_steady if long_mp else easy_fraction))
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
        # Strides and hill sprints go by feel: a pace or heart rate target means nothing over 10-30 s.
        fast = (spec.get('pick', 'Sprint'), 2.0 if spec['sport'] == 'ride' else None)
        steps.append({'kind': 'repeat', 'count': effective['reps'], 'steps': [
            step(easy_name, chunk, 'active', effective['intensity']),
            step(fast[0], effective['workSec'], 'interval', fast[1], .5)]})
        steps.append(step(easy_name, main - chunk * effective['reps'], 'active', effective['intensity']))
    steps.append(step('Abwärmen', cooldown * 60, 'cooldown', easy_fraction))
    if hard and 'durationMin' in effective:
        extra = effective['durationMin'] * 60 - _seconds(steps)
        if extra < 0:
            raise TemplateError('Die Gesamtdauer ist kürzer als Aufwärmen, Belastung und Abwärmen.')
        before = extra if long_mp else extra // 120 * 60
        if extra - before:
            steps.insert(-1, step(easy_name, extra - before, 'active', easy_steady))
        if before:
            steps.insert(1, step(easy_name, before, 'active', easy_steady))
    result['durationMin'] = _seconds(steps) / 60
    if result['durationMin'] > MAX_RIDE_MINUTES:
        raise TemplateError(f'Die Einheit darf einschließlich Pausen maximal {MAX_RIDE_MINUTES} Minuten dauern.')
    result['notes'] = fueling(spec, result['durationMin'])
    result['workout'] = validate_workout({'version': 1, 'name': name, 'sport': spec['sport'],
                                           'date': date, 'steps': steps, 'notes': result['notes']})
    if spec['sport'] == 'ride' and ftp is not None:
        result['estimatedTss'] = planned_tss(steps, ftp)
    return result


def planned_tss(steps, ftp):
    """Planned TSS at the target midpoints; an open test effort counts as FTP."""
    # Synthetic planned points never enter observed activity data. Sampling
    # boundaries at <=30 s lets the shared analytics integrate exact durations.
    points, elapsed = [], 0
    for item in flat_steps(steps):
        target = item['target']
        watts = (target['low'] + target['high']) / 2 if target['type'] != 'none' else ftp
        stop = elapsed + item['duration']['value']
        while elapsed < stop:
            points.append({'time': elapsed, 'power': watts})
            elapsed = min(elapsed + 30, stop)
    points.append({'time': elapsed})
    planned = sensor_summary(points, 'power', 0, elapsed)
    return round(elapsed / 3600 * (planned['np'] / ftp) ** 2 * 100, 1)
