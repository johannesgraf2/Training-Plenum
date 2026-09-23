"""Decode FIT activity files without inventing sensor values or sample intervals.

FIT date_time fields are UTC; timer time excludes pauses, elapsed time includes them.
See https://developer.garmin.com/fit/articles/file-types/activity.html
"""
import gzip
import hashlib
import zlib
from datetime import datetime, timedelta, timezone

from fitparse import FitFile, FitParseError

MAX_FIT_BYTES = 50 * 1024 * 1024
SPORTS = {'cycling': 'ride', 'running': 'run', 'swimming': 'swim'}


class FitImportError(ValueError):
    pass


def read_fit_bytes(path):
    opener = gzip.open if str(path).lower().endswith('.gz') else open
    try:
        with opener(path, 'rb') as source:
            content = source.read(MAX_FIT_BYTES + 1)
    except (OSError, EOFError, zlib.error) as exc:
        raise FitImportError('Die komprimierte FIT-Datei ist beschädigt oder unvollständig.') from exc
    if len(content) > MAX_FIT_BYTES:
        raise FitImportError('Die entpackte FIT-Datei darf höchstens 50 MB groß sein.')
    return content


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z') if value is not None else None


def preferred(values, enhanced, normal):
    value = values.get(enhanced)
    return value if value is not None else values.get(normal)


def summary(values):
    sport = str(values.get('sport', 'unknown'))
    speed = preferred(values, 'enhanced_avg_speed', 'avg_speed')
    distance = values.get('total_distance')
    return {
        'sport': SPORTS.get(sport, sport),
        'subSport': values.get('sub_sport'),
        'startTime': iso(values.get('start_time')),
        'timerSeconds': values.get('total_timer_time'),
        'elapsedSeconds': values.get('total_elapsed_time'),
        'distanceKm': distance / 1000 if distance is not None else None,
        'hrAvg': values.get('avg_heart_rate'),
        'hrMax': values.get('max_heart_rate'),
        'power': values.get('avg_power'),
        'cadence': values.get('avg_cadence'),
        'elevation': values.get('total_ascent'),
        'calories': values.get('total_calories'),
        'speedAvg': speed * 3.6 if speed is not None else None,
        'firstLapIndex': values.get('first_lap_index'),
        'lapCount': values.get('num_laps'),
    }


def complete_sum(sessions, key):
    values = [session[key] for session in sessions]
    return sum(values) if all(value is not None for value in values) else None


def parse_fit_file(path):
    content = read_fit_bytes(path)
    try:
        fit = FitFile(content, check_crc=True)
        # Fully decode before accepting a file, including its final CRC.
        messages = list(fit.get_messages())
    except (FitParseError, ValueError, TypeError, KeyError, IndexError) as exc:
        raise FitImportError('Ungültige oder beschädigte FIT-Datei. Bitte die Originaldatei erneut exportieren.') from exc

    file_ids = [message.get_values() for message in messages if message.name == 'file_id']
    if not file_ids or file_ids[0].get('type') not in ('activity', 4):
        raise FitImportError('Diese FIT-Datei enthält keine aufgezeichnete Aktivität (z. B. einen Trainingsplan oder eine Strecke).')
    raw_sessions = [message.get_values() for message in messages if message.name == 'session']
    if not raw_sessions or any(not isinstance(s.get('start_time'), datetime) for s in raw_sessions):
        raise FitImportError('Der FIT-Datei fehlt eine gültige Aktivitätszusammenfassung mit Startzeit.')
    raw_sessions.sort(key=lambda session: session['start_time'])
    sessions = [summary(session) for session in raw_sessions]
    start = raw_sessions[0]['start_time']
    records = []
    for message in messages:
        if message.name != 'record':
            continue
        values = message.get_values()
        timestamp = values.get('timestamp')
        point = {'timestamp': iso(timestamp), 'time': (timestamp - start).total_seconds() if timestamp else None}
        for source, target in [('heart_rate', 'hr'), ('power', 'power'), ('cadence', 'cadence'), ('distance', 'distance')]:
            if values.get(source) is not None:
                point[target] = values[source]
        speed = preferred(values, 'enhanced_speed', 'speed')
        altitude = preferred(values, 'enhanced_altitude', 'altitude')
        if speed is not None:
            point['speed'] = speed * 3.6
        if altitude is not None:
            point['elevation'] = altitude
        for source, target in [('position_lat', 'lat'), ('position_long', 'lng')]:
            if values.get(source) is not None:
                point[target] = values[source] * 180 / 2**31
        records.append(point)

    records.sort(key=lambda point: (point['time'] is None, point['time'] or 0))
    laps = [summary(message.get_values()) for message in messages if message.name == 'lap']
    timer = complete_sum(sessions, 'timerSeconds')
    elapsed = None
    if all(session.get('total_elapsed_time') is not None for session in raw_sessions):
        end = max(session['start_time'] + timedelta(seconds=session['total_elapsed_time']) for session in raw_sessions)
        elapsed = (end - start).total_seconds()
    single = sessions[0] if len(sessions) == 1 else {}
    measurements = [key for key in ('hr', 'power', 'speed', 'cadence', 'elevation', 'distance')
                    if any(point.get(key) is not None for point in records)]
    if any(point.get('lat') is not None and point.get('lng') is not None for point in records):
        measurements.append('gps')
    details = {
        'timerSeconds': timer, 'elapsedSeconds': elapsed,
        'sessions': sessions, 'laps': laps, 'measurements': measurements,
        'recordCount': len(records), 'timezone': 'UTC',
        'untimedRecordCount': sum(point['time'] is None for point in records),
    }
    return {
        'date': start,
        'sport': single.get('sport', 'multisport'),
        'duration': timer / 60 if timer is not None else None,
        'distance': complete_sum(sessions, 'distanceKm'),
        'hr_avg': single.get('hrAvg'), 'hr_max': single.get('hrMax'),
        'power_avg': single.get('power'), 'cadence_avg': single.get('cadence'),
        'speed_avg': single.get('speedAvg'),
        'elevation': complete_sum(sessions, 'elevation'),
        'calories': complete_sum(sessions, 'calories'),
        'fit_details': details,
        'content_hash': hashlib.sha256(content).hexdigest(),
    }, records
