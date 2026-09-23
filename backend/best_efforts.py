"""Best continuous efforts from recorded elapsed time, never activity averages.

Power is held until the next sample (time-weighted, including recorded zeros).
Distance crossings are interpolated linearly; elapsed time includes pauses.
Missing values, reversed time/distance and gaps over 30 s split a recording.
"""
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
from math import isfinite

VERSION = 1
TARGETS = {'ride': (30, 60, 180, 300, 600, 1200, 3600), 'run': (400, 1000, 5000, 10000, 21000)}
MAX_GAP = 30


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def segments(records, key):
    current = []
    for record in records:
        time, value = record.get('time'), record.get(key)
        if not finite(time) or not finite(value) or time < 0 or value < 0:
            if current:
                yield current
            current = []
            continue
        if current and (not 0 < time - current[-1][0] <= MAX_GAP or
                        (key == 'distance' and value < current[-1][1])):
            yield current
            current = []
        current.append((time, value))
    if current:
        yield current


def power_efforts(records):
    best = {}
    for segment in segments(records, 'power'):
        if len(segment) < 2:
            continue
        times, powers = zip(*segment)
        energy = [0]
        for i in range(1, len(times)):
            energy.append(energy[-1] + powers[i - 1] * (times[i] - times[i - 1]))

        def integral(time):
            i = bisect_right(times, time) - 1
            return energy[i] + powers[i] * (time - times[i])

        for duration in TARGETS['ride']:
            if times[-1] - times[0] < duration:
                continue
            # For piecewise constant power, maxima occur when either window edge
            # meets a sample. Include both edges, also for irregular recordings.
            for candidates in (times, (time - duration for time in times)):
                for start in candidates:
                    end = start + duration
                    if start < times[0] or end > times[-1]:
                        continue
                    average = (integral(end) - integral(start)) / duration
                    if duration not in best or average > best[duration]['value']:
                        best[duration] = {'target': duration, 'value': average, 'startSeconds': start, 'endSeconds': end}
    return list(best.values())


def running_efforts(records):
    best = {}
    for segment in segments(records, 'distance'):
        if len(segment) < 2:
            continue
        times, distances = zip(*segment)

        def crossing(distance, start=False):
            # At a stationary plateau, start after waiting and finish before it.
            i = bisect_right(distances, distance) - 1 if start else bisect_left(distances, distance)
            if distances[i] == distance:
                return times[i]
            if not start:
                i -= 1
            fraction = (distance - distances[i]) / (distances[i + 1] - distances[i])
            return times[i] + fraction * (times[i + 1] - times[i])

        for distance in TARGETS['run']:
            if distances[-1] - distances[0] < distance:
                continue
            for candidates in (distances, (value - distance for value in distances)):
                for start_distance in candidates:
                    end_distance = start_distance + distance
                    if start_distance < distances[0] or end_distance > distances[-1]:
                        continue
                    start, end = crossing(start_distance, start=True), crossing(end_distance)
                    duration = end - start
                    if duration > 0 and (distance not in best or duration < best[distance]['value']):
                        best[distance] = {'target': distance, 'value': duration, 'startSeconds': start, 'endSeconds': end}
    return list(best.values())


def utc_date(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    return date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date.astimezone(timezone.utc)


def activity_efforts(records, sport, details, activity_date):
    groups = []
    sessions = details.get('sessions', [])
    if len(sessions) > 1 or sport == 'multisport':
        origin = utc_date(activity_date)
        for session in sessions:
            if session.get('sport') not in TARGETS or not session.get('startTime') or not finite(session.get('elapsedSeconds')):
                continue
            start = (utc_date(session['startTime']) - origin).total_seconds()
            end = start + session['elapsedSeconds']
            groups.append((session['sport'], [r for r in records if finite(r.get('time')) and start <= r['time'] < end]))
    elif sport in TARGETS:
        groups.append((sport, records))
    result = {'ride': {}, 'run': {}}
    for session_sport, points in groups:
        efforts = power_efforts(points) if session_sport == 'ride' else running_efforts(points)
        for effort in efforts:
            previous = result[session_sport].get(effort['target'])
            if previous is None or (effort['value'] > previous['value'] if session_sport == 'ride' else effort['value'] < previous['value']):
                result[session_sport][effort['target']] = effort
    return {sport: list(efforts.values()) for sport, efforts in result.items()}
