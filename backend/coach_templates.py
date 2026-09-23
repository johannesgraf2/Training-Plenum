"""Deterministic sessions: AI chooses a template; TrainHub owns all arithmetic.

Cycling targets use FTP, running targets use maximum heart rate. Missing athlete
settings produce open targets. TSS is only a planned cycling estimate, calculated
with the existing 30-second normalized-power algorithm at target midpoints.
"""
import copy
import math
from datetime import date as Date

from analytics import sensor_summary
from workout_export import validate_workout


class TemplateError(ValueError):
    pass


def _steady(name, sport, duration, bounds, intensity, intensity_range):
    return {'name': name, 'sport': sport, 'kind': 'steady',
            'defaults': {'durationMin': duration, 'intensity': intensity},
            'params': {'durationMin': bounds, 'intensity': intensity_range}}


def _intervals(name, sport, intervals, work, recovery, intensity, intensity_range):
    return {'name': name, 'sport': sport, 'kind': 'intervals',
            'defaults': {'intervals': intervals, 'workMin': work, 'recoveryMin': recovery, 'intensity': intensity},
            'params': {'intervals': [2, 12], 'workMin': [1, 30], 'recoveryMin': [1, 15],
                       'intensity': intensity_range}}


TEMPLATES = {
    'bike_recovery': _steady('Regeneration Rad', 'ride', 45, [20, 90], .50, [.40, .55]),
    'bike_z2': _steady('Grundlagenausdauer Rad', 'ride', 90, [20, 240], .65, [.56, .75]),
    'bike_z2_short': _steady('Kurze Grundlage Rad', 'ride', 60, [20, 90], .65, [.56, .75]),
    'bike_z2_long': _steady('Lange Grundlage Rad', 'ride', 180, [90, 360], .65, [.56, .75]),
    'bike_tempo': _intervals('Tempo Rad', 'ride', 2, 20, 5, .83, [.76, .90]),
    'bike_sweetspot': _intervals('Sweetspot Rad', 'ride', 3, 12, 5, .90, [.88, .94]),
    'bike_threshold': _intervals('Schwelle Rad', 'ride', 3, 12, 6, .98, [.95, 1.05]),
    'bike_threshold_intervals': _intervals('Schwellenintervalle Rad', 'ride', 3, 12, 6, .98, [.95, 1.05]),
    'bike_vo2': _intervals('VO2-Intervalle Rad', 'ride', 5, 4, 4, 1.12, [1.06, 1.20]),
    'bike_long': _steady('Lange Ausfahrt', 'ride', 240, [90, 600], .65, [.56, .75]),
    'run_easy': _steady('Lockerer Lauf', 'run', 45, [15, 120], .70, [.60, .78]),
    'run_threshold': _intervals('Schwellenlauf', 'run', 3, 8, 3, .88, [.83, .92]),
    'run_long': _steady('Langer Lauf', 'run', 90, [45, 240], .72, [.60, .80]),
    'strength_general': {'name': 'Allgemeines Krafttraining', 'sport': 'strength', 'kind': 'strength',
                         'defaults': {'durationMin': 45}, 'params': {'durationMin': [10, 120]}},
    'rest': {'name': 'Ruhetag', 'sport': 'rest', 'kind': 'rest', 'defaults': {}, 'params': {}},
}

PARAM_NAMES = ('durationMin', 'intervals', 'workMin', 'recoveryMin', 'intensity')
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


def template_catalog():
    return [dict(id=key, name=value['name'], sport=value['sport'],
                 defaults=copy.deepcopy(value['defaults']), params=copy.deepcopy(value['params']),
                 intensityReference='ftp' if value['sport'] == 'ride' else 'maxHr' if value['sport'] == 'run' else None,
                 durationRule='10 min warmup + work + recoveries between intervals + 10 min cooldown'
                 if value['kind'] == 'intervals' and value['sport'] == 'ride' else
                 '10 min warmup + work + recoveries between intervals + 5 min cooldown'
                 if value['kind'] == 'intervals' else 'durationMin includes warmup and cooldown')
            for key, value in TEMPLATES.items()]


def _number(value, key, low, high, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high or (integer and value != int(value)):
        raise TemplateError(f'{key}: Erlaubt sind {low} bis {high}' + (' (ganze Zahlen).' if integer else '.'))
    return int(value) if integer else value


def render_session(template, params, date, ftp=None, max_hr=None):
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
    result = {'template': template, 'params': effective, 'date': date, 'sport': spec['sport'],
              'name': spec['name'], 'durationMin': effective.get('durationMin', 0),
              'estimatedTss': None, 'workout': None}
    if spec['kind'] in ('rest', 'strength'):
        return result

    def step(name, minutes, intensity, fraction):
        reference = ftp if spec['sport'] == 'ride' else max_hr
        target = {'type': 'none'}
        if reference is not None:
            margin = .02 if spec['sport'] == 'ride' else .025
            minimum = 1 if spec['sport'] == 'ride' else 30
            target = {'type': 'power' if spec['sport'] == 'ride' else 'heart_rate',
                      'low': max(minimum, round(reference * (fraction - margin))),
                      'high': max(minimum, min(3000 if spec['sport'] == 'ride' else 250,
                                               round(reference * (fraction + margin))))}
        return {'kind': 'step', 'name': name, 'duration': {'type': 'time', 'value': minutes * 60},
                'intensity': intensity, 'target': target}

    easy_fraction = .50 if spec['sport'] == 'ride' else .60
    warmup = 10 if spec['kind'] == 'intervals' or spec['sport'] == 'ride' else 5
    cooldown = 10 if spec['kind'] == 'intervals' and spec['sport'] == 'ride' else 5
    steps = [step('Aufwärmen', warmup, 'warmup', easy_fraction)]
    if spec['kind'] == 'steady':
        steps.append(step('Hauptteil', effective['durationMin'] - warmup - cooldown,
                          'active', effective['intensity']))
    else:
        for interval in range(effective['intervals']):
            steps.append(step(f'Intervall {interval + 1}', effective['workMin'], 'interval', effective['intensity']))
            if interval < effective['intervals'] - 1:
                steps.append(step('Erholung', effective['recoveryMin'], 'recovery', easy_fraction))
    steps.append(step('Abwärmen', cooldown, 'cooldown', easy_fraction))
    result['durationMin'] = sum(item['duration']['value'] for item in steps) / 60
    if result['durationMin'] > 600:
        raise TemplateError('Die Einheit darf einschließlich Pausen maximal 600 Minuten dauern.')
    result['workout'] = validate_workout({'version': 1, 'name': spec['name'], 'sport': spec['sport'],
                                           'date': date, 'steps': steps})
    if spec['sport'] == 'ride' and ftp is not None:
        # Synthetic planned points never enter observed activity data. Sampling
        # boundaries at <=30 s lets the shared analytics integrate exact durations.
        points, elapsed = [], 0
        for item in steps:
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
