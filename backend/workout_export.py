"""Sport-independent workout model and Garmin SDK export.

Model units: seconds, metres, seconds/km, km/h, bpm, watts and rpm.
FIT dynamic fields must be supplied as raw main fields: the SDK encoder
intentionally ignores subfields. See Garmin's workout file specification.
"""
import hashlib
import json
import math
import re
from datetime import date, datetime, timezone

from garmin_fit_sdk import Decoder, Encoder, Profile, Stream


class WorkoutError(ValueError):
    pass


INTENSITIES = {'warmup', 'active', 'interval', 'recovery', 'cooldown'}
LIMITS = {'pace': (60, 3600), 'speed': (0.1, 150), 'heart_rate': (30, 250),
          'power': (1, 3000), 'cadence': (1, 250)}
MAX_STEPS = 50


def number(value, label, low, high, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkoutError(f'{label}: Bitte eine gültige Zahl eingeben.')
    if not low <= value <= high or not math.isfinite(value) or (integer and value != int(value)):
        raise WorkoutError(f'{label}: Erlaubt sind {low} bis {high}' + (' (ganze Zahlen).' if integer else '.'))
    return int(value) if integer else value


def short_text(value, label, limit, required=False):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        raise WorkoutError(f'{label}: Bitte gültigen Text eingeben.')
    value = value.strip()
    try:
        size = len(value.encode('utf-8'))
    except UnicodeError as exc:
        raise WorkoutError(f'{label}: Bitte gültigen Text eingeben.') from exc
    if (required and not value) or size > limit:
        raise WorkoutError(f'{label}: Bitte {"1–" if required else "maximal "}{limit} Zeichen verwenden (Umlaute zählen doppelt).')
    return value


def validate_workout(data):
    if not isinstance(data, dict):
        raise WorkoutError('Bitte ein Workout übergeben.')
    if data.get('version', 1) != 1:
        raise WorkoutError('Diese Workout-Version wird nicht unterstützt.')
    sport = data.get('sport')
    if sport not in ('run', 'ride'):
        raise WorkoutError('Bitte Laufen oder Radfahren auswählen.')
    day = data.get('date')
    if not isinstance(day, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise WorkoutError('Bitte ein gültiges Trainingsdatum auswählen.')
    try:
        date.fromisoformat(day)
    except ValueError as exc:
        raise WorkoutError('Bitte ein gültiges Trainingsdatum auswählen.') from exc

    def step(item):
        if not isinstance(item, dict) or item.get('kind') != 'step':
            raise WorkoutError('Wiederholungsblöcke dürfen nur einzelne Schritte enthalten.')
        intensity = item.get('intensity')
        if not isinstance(intensity, str) or intensity not in INTENSITIES:
            raise WorkoutError('Bitte eine gültige Intensität auswählen.')
        duration = item.get('duration')
        if not isinstance(duration, dict) or duration.get('type') not in ('time', 'distance', 'open'):
            raise WorkoutError('Bitte Zeit, Distanz oder Lap-Taste als Dauer wählen.')
        duration = dict(duration)
        if duration['type'] == 'open':
            duration = {'type': 'open'}
        else:
            maximum = 86400 if duration['type'] == 'time' else 1000000
            duration = {'type': duration['type'], 'value': number(duration.get('value'), 'Schrittdauer / Distanz', 1, maximum)}
        target = item.get('target')
        if not isinstance(target, dict) or target.get('type') not in ('none', *LIMITS):
            raise WorkoutError('Bitte ein gültiges Trainingsziel auswählen.')
        kind = target['type']
        if kind == 'none':
            target = {'type': 'none'}
        else:
            bounds = LIMITS[kind]
            lower = number(target.get('low'), 'Zielbereich von', *bounds, integer=kind in ('heart_rate', 'power', 'cadence'))
            upper = number(target.get('high'), 'Zielbereich bis', *bounds, integer=kind in ('heart_rate', 'power', 'cadence'))
            if lower > upper:
                raise WorkoutError('Zielbereich: Der erste Wert muss kleiner oder gleich dem zweiten sein; Pace z. B. 4:00 bis 4:10.')
            target = {'type': kind, 'low': lower, 'high': upper}
        return {'kind': 'step', 'name': short_text(item.get('name', ''), 'Schrittname', 80),
                'intensity': intensity, 'duration': duration, 'target': target}

    blocks = data.get('steps')
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= MAX_STEPS:
        raise WorkoutError('Bitte 1 bis 50 Schritte anlegen.')
    steps = []
    count = 0
    for block in blocks:
        if isinstance(block, dict) and block.get('kind') == 'repeat':
            children = block.get('steps')
            if not isinstance(children, list) or not 1 <= len(children) < MAX_STEPS:
                raise WorkoutError('Ein Wiederholungsblock braucht mindestens einen Schritt (maximal 49).')
            repetitions = number(block.get('count'), 'Wiederholungen', 2, 99, integer=True)
            steps.append({'kind': 'repeat', 'count': repetitions, 'steps': [step(child) for child in children]})
            count += len(children) + 1
        else:
            steps.append(step(block))
            count += 1
    if count > MAX_STEPS:
        raise WorkoutError('Maximal 50 FIT-Schritte, einschließlich Wiederholungsmarkern, sind möglich.')
    result = {'version': 1, 'name': short_text(data.get('name'), 'Workout-Name', 80, required=True),
              'sport': sport, 'date': day, 'steps': steps}
    # Free text such as fueling advice; a FIT string field holds at most 250 bytes here.
    notes = short_text(data.get('notes') or '', 'Hinweis', 250)
    if notes:
        result['notes'] = notes
    return result


def workout_messages(workout):
    messages = []

    def append_step(step):
        duration, target = step['duration'], step['target']
        kind = target['type']
        message = {'message_index': len(messages), 'wkt_step_name': step['name'] or step['intensity'],
                   'intensity': step['intensity'], 'duration_type': duration['type'],
                   'duration_value': round(duration.get('value', 0) * {'time': 1000, 'distance': 100, 'open': 0}[duration['type']]),
                   'target_type': {'none': 'open', 'pace': 'speed'}.get(kind, kind), 'target_value': 0}
        if kind != 'none':
            low, high = target['low'], target['high']
            if kind == 'pace':
                low, high = 1000000 / high, 1000000 / low  # pace reverses the speed range
            elif kind == 'speed':
                low, high = low / 3.6 * 1000, high / 3.6 * 1000
            elif kind in ('heart_rate', 'power'):
                offset = 100 if kind == 'heart_rate' else 1000
                low, high = low + offset, high + offset
            message.update(custom_target_value_low=round(low), custom_target_value_high=round(high))
        messages.append(message)

    for block in workout['steps']:
        if block['kind'] == 'repeat':
            start = len(messages)
            for step in block['steps']:
                append_step(step)
            messages.append({'message_index': len(messages), 'duration_type': 'repeat_until_steps_cmplt',
                             'duration_value': start, 'target_type': 'open', 'target_value': block['count']})
        else:
            append_step(block)
    return messages


def garmin_workout_name(workout):
    day = date.fromisoformat(workout['date'])
    return f"{day.day:02d}.{day.month:02d}.{day.year:04d} · {workout['name']}"


def export_workout(data):
    workout = validate_workout(data)
    steps = workout_messages(workout)
    encoder = Encoder()
    # Stable identity for the same workout; different content gets a different identity.
    serial = int.from_bytes(hashlib.sha256(json.dumps(workout, sort_keys=True).encode()).digest()[:4], 'little') or 1
    encoder.on_mesg(Profile['mesg_num']['FILE_ID'], {
        'type': 'workout', 'manufacturer': 'development', 'product': 1,
        'serial_number': serial, 'time_created': datetime.now(timezone.utc),
    })
    # Prefix the actual on-device name, not just the downloaded filename.
    header = {'wkt_name': garmin_workout_name(workout), 'sport': 'running' if workout['sport'] == 'run' else 'cycling',
              'num_valid_steps': len(steps)}
    if workout.get('notes'):
        header['wkt_description'] = workout['notes']
    encoder.on_mesg(Profile['mesg_num']['WORKOUT'], header)
    for step in steps:
        encoder.on_mesg(Profile['mesg_num']['WORKOUT_STEP'], step)
    content = bytes(encoder.close())
    validate_fit(content, header, steps)
    return content


def validate_fit(content, expected_header, expected_steps):
    """Read every exported file back with CRC and semantic checks before serving it."""
    decoder = Decoder(Stream.from_byte_array(bytearray(content)))
    if not decoder.check_integrity():
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Prüfsumme oder Dateigröße.')
    messages, errors = Decoder(Stream.from_byte_array(bytearray(content))).read(expand_sub_fields=False)
    if errors or len(messages.get('file_id_mesgs', [])) != 1 or messages['file_id_mesgs'][0].get('type') != 'workout':
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Dateityp.')
    headers = messages.get('workout_mesgs', [])
    steps = messages.get('workout_step_mesgs', [])
    if len(headers) != 1 or any(headers[0].get(k) != v for k, v in expected_header.items()) or len(steps) != len(expected_steps):
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Workout-Zusammenfassung.')
    for actual, expected in zip(steps, expected_steps):
        if any(actual.get(k) != v for k, v in expected.items()):
            raise RuntimeError('FIT-Prüfung fehlgeschlagen: Schritte oder Zielwerte.')
