"""Training summaries from recorded durations, never from sample counts.

Power TSS uses duration(hours) * (NP/FTP)^2 * 100. NP is the fourth root
of the mean fourth power of complete 30-second rolling averages (1 Hz).
See https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power
"""
import math
from bisect import bisect_left
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

VERSION = 2
POWER_LIMITS = [.55, .75, .90, 1.05, 1.20, 1.50]
HR_LIMITS = [.60, .70, .80, .90]


def valid(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def utc(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)


def intervals(records, key, start, end):
    """Hold a reading until the next timestamp, but never across missing data/gaps."""
    previous_end = -math.inf
    for point, following in zip(records, records[1:]):
        t, next_t, value = point.get('time'), following.get('time'), point.get(key)
        if not all(valid(v) for v in (t, next_t, value)) or (key == 'hr' and value == 0):
            continue
        if not 0 < next_t - t <= 30:
            continue
        if t < start or t >= end or t < previous_end:
            continue
        left, right = max(t, start), min(next_t, end)
        if right > left:
            yield left, right, value
            previous_end = right


def sensor_summary(records, key, start, end):
    histogram = defaultdict(float)
    rolling = deque()
    rolling_sum = fourth_sum = 0.0
    windows = 0
    previous_end = None
    bin_duration = bin_energy = 0.0
    for left, right, value in intervals(records, key, start, end):
        histogram[value] += right - left
        if key != 'power':
            continue
        if previous_end is None or abs(left - previous_end) > 1e-6:
            rolling.clear()
            rolling_sum = bin_duration = bin_energy = 0.0
        remaining = right - left
        while remaining > 1e-7:
            step = min(1 - bin_duration, remaining)
            bin_duration += step
            bin_energy += step * value
            remaining -= step
            if bin_duration >= 1 - 1e-7:
                rolling.append(bin_energy)
                rolling_sum += bin_energy
                if len(rolling) > 30:
                    rolling_sum -= rolling.popleft()
                if len(rolling) == 30:
                    fourth_sum += (max(0, rolling_sum) / 30) ** 4
                    windows += 1
                bin_duration = bin_energy = 0.0
        previous_end = right
    return {'histogram': dict(histogram), 'seconds': sum(histogram.values()),
            'np': (fourth_sum / windows) ** .25 if windows else None}


def activity_summary(activity, records, details):
    """One row per sport session; multisport totals must not be counted twice."""
    origin = utc(activity.date)
    sessions = details.get('sessions', [])
    if len(sessions) > 1:
        source = sessions
    else:
        source = [{'sport': activity.sport, 'startTime': origin.isoformat(),
                   'timerSeconds': details.get('timerSeconds') if details.get('timerSeconds') is not None
                   else activity.duration * 60 if valid(activity.duration) else None,
                   'elapsedSeconds': details.get('elapsedSeconds'), 'distanceKm': activity.distance,
                   'elevation': activity.elevation, 'calories': activity.calories}]
    result = []
    for session in source:
        date = utc(session.get('startTime') or origin)
        start = (date - origin).total_seconds()
        end = start + session['elapsedSeconds'] if valid(session.get('elapsedSeconds')) else math.inf
        hr = sensor_summary(records, 'hr', start, end)
        power = sensor_summary(records, 'power', start, end)
        duration = session.get('timerSeconds')
        # Incomplete streams cannot supply a whole-session TSS. Small timestamp
        # rounding differences (up to 5%) are tolerated and disclosed in the UI.
        complete = valid(duration) and duration > 0 and .95 <= power['seconds'] / duration <= 1.05
        factor = duration / 3600 * power['np'] ** 2 * 100 if complete and power['np'] is not None and session.get('sport') == 'ride' else None
        result.append({'date': date.isoformat(), 'utc': bool(details), 'sport': session.get('sport', activity.sport),
                       'seconds': duration, 'distance': session.get('distanceKm'),
                       'elevation': session.get('elevation'), 'calories': session.get('calories'),
                       'hr': hr, 'power': power, 'tssFactor': factor})
    return result


def zones(histogram, threshold, limits):
    totals = [0.0] * (len(limits) + 1)
    if threshold:
        for value, seconds in histogram.items():
            totals[bisect_left(limits, float(value) / threshold)] += seconds
    return totals


def bucket(key):
    return {'key': key, 'count': 0, 'seconds': 0, 'distance': 0, 'elevation': 0,
            'calories': 0, 'tss': 0, 'hrZones': [0.0] * 5, 'powerZones': [0.0] * 7,
            'known': {name: 0 for name in ('seconds', 'distance', 'elevation', 'calories', 'tss', 'hr', 'power')}}


def add(target, row, ftp, max_hr):
    target['count'] += 1
    for key in ('seconds', 'distance', 'elevation', 'calories'):
        if valid(row.get(key)):
            target[key] += row[key]
            target['known'][key] += 1
    if ftp and valid(row.get('tssFactor')):
        target['tss'] += row['tssFactor'] / ftp ** 2
        target['known']['tss'] += 1
    for key, threshold, limits in [('hr', max_hr, HR_LIMITS), ('power', ftp, POWER_LIMITS)]:
        # Cycling FTP cannot classify running-power measurements.
        if key == 'power' and row['sport'] != 'ride':
            continue
        if threshold and row[key]['seconds'] > 0:
            target['known'][key] += 1
            target[key + 'Zones'] = [a + b for a, b in zip(target[key + 'Zones'], zones(row[key]['histogram'], threshold, limits))]


def finish(target):
    for key in ('seconds', 'distance', 'elevation', 'calories', 'tss'):
        target[key] = round(target[key], 2) if target['known'][key] or not target['count'] else None
    for key in ('hrZones', 'powerZones'):
        target[key] = [round(value, 2) for value in target[key]]
    return target


def aggregate(rows, year, zone, ftp=None, max_hr=None, sport='all', today=None):
    today = today or datetime.now(zone).date()
    dated = []
    for row in rows:
        parsed = utc(row['date'])
        # Legacy manual dates are local wall times, matching the existing UI.
        local = parsed.astimezone(zone) if row['utc'] else parsed.replace(tzinfo=zone)
        dated.append((local.date(), row))
    years = sorted({date.year for date, _ in dated}, reverse=True)
    annual = {}
    share = {}
    total = bucket('total')
    selected = []
    for date, row in dated:
        if row['sport'] == 'ride':
            target = annual.setdefault(date.year, bucket(str(date.year)))
            add(target, row, ftp, max_hr)
        if year != 'all' and date.year != int(year):
            continue
        add(share.setdefault(row['sport'], bucket(row['sport'])), row, ftp, max_hr)
        if sport == 'all' or row['sport'] == sport:
            selected.append((date, row))
            add(total, row, ftp, max_hr)
    if year == 'all':
        start = min((date for date, _ in selected), default=today)
        end = max((date for date, _ in selected), default=today)
        if start <= today:
            end = max(end, today)
    else:
        selected_year = int(year)
        start = datetime(selected_year, 1, 1).date()
        end = datetime(selected_year, 12, 31).date()
    first_monday = start - timedelta(days=start.weekday())
    last_monday = end - timedelta(days=end.weekday())
    weeks = {}
    monday = first_monday
    while monday <= last_monday:
        key = monday.isoformat()
        weeks[key] = {**bucket(key), 'label': f'KW {monday.isocalendar().week:02}',
                      'end': (monday + timedelta(days=6)).isoformat(),
                      'days': [bucket((monday + timedelta(days=d)).isoformat()) for d in range(7)]}
        monday += timedelta(days=7)
    for date, row in selected:
        key = (date - timedelta(days=date.weekday())).isoformat()
        if key in weeks:
            add(weeks[key], row, ftp, max_hr)
            add(weeks[key]['days'][date.weekday()], row, ftp, max_hr)
    for week in weeks.values():
        week['future'] = week['key'] > today.isoformat() and not week['count']
        for day in week['days']:
            day['future'] = day['key'] > today.isoformat() and not day['count']
        week['days'] = [finish(day) for day in week['days']]
        finish(week)
    return {'year': year, 'years': years, 'sport': sport, 'timezone': str(zone),
            'settings': {'ftp': ftp, 'maxHr': max_hr}, 'totals': finish(total),
            'sportShare': [finish(row) for row in share.values()],
            'cyclingYears': [finish(annual[y]) for y in sorted(annual)], 'weeks': list(weeks.values())}
