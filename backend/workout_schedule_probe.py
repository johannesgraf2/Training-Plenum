"""Offline USB scheduling experiment. Does not access a device or the app database.

Uses FIT File Types rev 2.2, section 14, and the current Garmin SDK profile.
Binary validation is not evidence of Edge firmware compatibility.
"""
import argparse
import hashlib
import io
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from fitparse import FitFile
from garmin_fit_sdk import Decoder, Encoder, Profile, Stream
from workout_export import WorkoutError, export_workout, validate_workout

FIT_LOCAL_EPOCH = datetime(1989, 12, 31)
IDENTITY_FIELDS = ('manufacturer', 'product', 'serial_number', 'time_created')


def scheduled_midnight(day):
    # FIT local_date_time is wall-clock seconds, not a UTC instant. Applying
    # Windows/server timezone or DST here would move the workout to another day.
    local_midnight = datetime.combine(date.fromisoformat(day), datetime.min.time())
    value = int((local_midnight - FIT_LOCAL_EPOCH).total_seconds())
    if not 0x10000000 <= value < 0xFFFFFFFF:
        raise WorkoutError('Trainingsdatum liegt außerhalb des FIT-Datumsbereichs.')
    return value


def decode_checked(content):
    if not Decoder(Stream.from_byte_array(bytearray(content))).check_integrity():
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Prüfsumme oder Dateigröße.')
    messages, errors = Decoder(Stream.from_byte_array(bytearray(content))).read(
        convert_datetimes_to_dates=False, expand_sub_fields=False)
    if errors:
        raise RuntimeError('FIT-Datei konnte nicht vollständig gelesen werden.')
    # An independent parser verifies every message and the CRC as well.
    list(FitFile(content, check_crc=True).get_messages())
    return messages


def validate_pair(workout_content, schedule_content, day):
    workout = decode_checked(workout_content)
    schedule = decode_checked(schedule_content)
    if (len(workout.get('file_id_mesgs', [])) != 1
            or workout['file_id_mesgs'][0].get('type') != 'workout'
            or len(schedule.get('file_id_mesgs', [])) != 1
            or schedule['file_id_mesgs'][0].get('type') != 'schedules'
            or len(schedule.get('schedule_mesgs', [])) != 1):
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Dateitypen oder Termine.')
    identity = workout['file_id_mesgs'][0]
    entry = schedule['schedule_mesgs'][0]
    if any(key not in identity or entry.get(key) != identity[key] for key in IDENTITY_FIELDS):
        raise RuntimeError('Termin verweist nicht auf die mitgelieferte Workout-Datei.')
    if (entry.get('type') != 'workout' or entry.get('completed') != 0
            or entry.get('scheduled_time') != scheduled_midnight(day)):
        raise RuntimeError('FIT-Prüfung fehlgeschlagen: Trainingsdatum oder Status.')
    return entry


def build_pair(data):
    workout = validate_workout(data)
    scheduled_time = scheduled_midnight(workout['date'])
    workout_content = export_workout(workout)
    # Read the identity from THESE bytes. Calling export_workout twice may yield
    # a new time_created, leaving the schedule pointing at a different file.
    identity = decode_checked(workout_content)['file_id_mesgs'][0]
    encoder = Encoder()
    encoder.on_mesg(Profile['mesg_num']['FILE_ID'], {**identity, 'type': 'schedules'})
    encoder.on_mesg(Profile['mesg_num']['SCHEDULE'], {
        **{key: identity[key] for key in IDENTITY_FIELDS},
        'completed': 0, 'type': 'workout', 'scheduled_time': scheduled_time,
    })
    schedule_content = bytes(encoder.close())
    validate_pair(workout_content, schedule_content, workout['date'])
    return workout_content, schedule_content


def probe_workout(day):
    display_day = date.fromisoformat(day).strftime('%d.%m.')
    return {'version': 1, 'name': f'TrainHub USB {display_day}', 'sport': 'ride', 'date': day,
            'steps': [{'kind': 'step', 'name': 'USB-Kalendertest', 'intensity': 'active',
                       'duration': {'type': 'time', 'value': 300}, 'target': {'type': 'none'}}]}


def build_probe_zip(day):
    workout = probe_workout(day)
    workout_content, schedule_content = build_pair(workout)
    exported_name = decode_checked(workout_content)['workout_mesgs'][0]['wkt_name']
    entry = validate_pair(workout_content, schedule_content, day)
    prefix = f'trainhub-usb-{day}'
    names = (f'{prefix}-workout.fit', f'{prefix}-schedule.fit')
    report = {
        'status': 'binary_validated_device_not_tested', 'intended_device': 'Garmin Edge 1050',
        'workout_name': exported_name, 'scheduled_local_date': day,
        'scheduled_local_time': '00:00:00', 'schedule_message': entry,
        'checks': ['Garmin SDK decode + CRC', 'fitparse decode + CRC',
                   'all four workout identity fields match', 'local calendar date matches'],
        'files': {name: {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                  for name, content in zip(names, (workout_content, schedule_content))},
    }
    instructions = f'''TrainHub USB-Kalendertest – Edge 1050

Status: Dateiformat und Verknüpfung geprüft. Noch NICHT am Edge 1050 getestet.
Workout: {exported_name}, Radfahren, 5 Minuten ohne Leistungsziel.
Geplanter Tag: {day}. Der Kalendertag wird als lokale Mitternacht gespeichert.
Du musst das Workout nicht fahren; prüfe nur, ob es am richtigen Tag erscheint.

1. Edge per USB anschließen. Vor dem Versuch vorhandene Trainings-/Planungsdateien
   (insbesondere GARMIN/Workouts und vorhandene Schedule-Dateien) auf dem PC sichern.
   Es ist noch ungeprüft, ob der Edge Termine ergänzt oder einen Zeitplan ersetzt.
2. ZIP auf dem PC entpacken. Zuerst NUR {names[0]}
   in GARMIN/NewFiles kopieren. Gerät sicher trennen und verarbeiten lassen.
   Unter Training > Trainings/Workouts nach "{exported_name}" suchen.
3. Erst wenn das Workout vorhanden ist: erneut per USB verbinden und
   {names[1]} in GARMIN/NewFiles kopieren. Sicher trennen.
   Dies ist der zu prüfende Importweg, keine bestätigte Garmin-Kompatibilität.
   Keine vorhandene schedule.fit ersetzen und nicht in Coach-Ordner kopieren.
4. Am Edge Training > Kalendersymbol bzw. Wochentage > {day} öffnen.
   Erfolg: Das Testworkout steht genau an diesem Tag und seine Schritte lassen sich öffnen.
5. Ergebnis zuerst vor einer erneuten Garmin-Connect-Synchronisierung notieren,
   danach prüfen, ob der Eintrag auch nach Synchronisierung erhalten bleibt.
   Ein lokaler USB-Termin bedeutet nicht automatisch einen Eintrag in Garmin Connect.
6. Falls nur das Workout, aber kein Kalendereintrag erscheint: Versuch beenden.
   Nicht versuchsweise Systemdateien ersetzen. Für die Auswertung Modell, Firmware,
   Ergebnis des Workout-Imports und Ergebnis des Kalendertests festhalten.

Wichtig: Beide FIT-Dateien stammen aus EINEM Export und gehören zusammen.
Nicht mit einer separat neu heruntergeladenen Workout-Datei kombinieren.

Technische Einzelheiten und Quellen: GARMIN-USB-SCHEDULE.md im Projekt.
validation.json enthält Dateiprüfungen, Referenz und Datum, keine Gerätebestätigung.
'''
    buffer = io.BytesIO()
    with ZipFile(buffer, 'w', ZIP_DEFLATED) as archive:
        archive.writestr(names[0], workout_content)
        archive.writestr(names[1], schedule_content)
        archive.writestr('ANLEITUNG.txt', instructions)
        archive.writestr('validation.json', json.dumps(report, ensure_ascii=False, indent=2))
    return buffer.getvalue(), report


def main():
    parser = argparse.ArgumentParser(description='Erstellt ein lokales USB-Testpaket; schreibt NICHT auf Garmin-Geräte.')
    parser.add_argument('--date', default=(date.today() + timedelta(days=1)).isoformat())
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        content, report = build_probe_zip(args.date)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Never replace an earlier test package: its matching pair may be on a device.
        with args.output.open('xb') as target:
            target.write(content)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps({'output': str(args.output.resolve()), **report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
