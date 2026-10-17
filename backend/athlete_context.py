"""Compact, deterministic coaching context built exclusively from cached summaries.

Dates and rolling periods use the requested local timezone, including legacy
wall-time records. Period ends are inclusive. Calendar weeks run Monday-Sunday.
Capacity describes recorded training, never a physiological or medical limit.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median

from dateutil.tz import gettz

from analytics import HR_LIMITS, POWER_LIMITS, add, bucket, finish, utc, valid, zones
from best_efforts import TARGETS


SCHEMA_VERSION = 1


def _zone(value):
    resolved = gettz(value) if isinstance(value, str) else value
    if resolved is None:
        raise ValueError('Invalid timezone')
    return resolved


def _zone_name(value):
    if isinstance(value, str):
        return value
    name = getattr(value, 'key', None)
    filename = getattr(value, '_filename', '') or ''
    if name:
        return name
    # dateutil tzfile names otherwise contain machine-specific absolute paths.
    normalized = filename.replace('\\', '/')
    if '/zoneinfo/' in normalized:
        return normalized.split('/zoneinfo/', 1)[1]
    if normalized and not normalized.startswith('/') and ':' not in normalized:
        return normalized
    return str(value)


def _day(value, zone, is_utc=True):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    parsed = utc(value)
    return (parsed.astimezone(zone) if is_utc else parsed.replace(tzinfo=zone)).date()


def _threshold(value):
    return value if valid(value) and value > 0 else None


def _sensor(value, duration, heart_rate=False):
    """Cap recorded sensor time at timer time without manufacturing samples."""
    value = value if isinstance(value, dict) else {}
    histogram = {}
    for raw_value, seconds in (value.get('histogram') or {}).items():
        try:
            reading = float(raw_value)
        except (TypeError, ValueError):
            continue
        if valid(reading) and (not heart_rate or reading > 0) and valid(seconds):
            histogram[reading] = histogram.get(reading, 0) + seconds
    total = sum(histogram.values())
    reported = value.get('seconds')
    measured = min(total, reported) if valid(reported) else total
    if valid(duration):
        measured = min(measured, duration)
    if total > measured:
        histogram = {reading: seconds * measured / total for reading, seconds in histogram.items()}
    return {'histogram': histogram, 'seconds': measured, 'np': value.get('np')}


def _prepared(rows, zone):
    result, invalid_dates = [], 0
    for original in rows:
        try:
            local_date = _day(original['date'], zone, original.get('utc', True))
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            invalid_dates += 1
            continue
        row = dict(original)
        row['sport'] = original.get('sport') or 'unknown'
        row['hr'] = _sensor(original.get('hr'), row.get('seconds'), heart_rate=True)
        row['power'] = _sensor(original.get('power'), row.get('seconds'))
        # Reuse the cached analytics factor only under its original reliability
        # rule. The capped histogram is for durations/zones, not NP or TSS.
        raw_power_seconds = (original.get('power') or {}).get('seconds')
        duration = row.get('seconds')
        reliable = (valid(duration) and duration > 0 and valid(raw_power_seconds)
                    and .95 <= raw_power_seconds / duration <= 1.05
                    and row['power']['seconds'] / duration >= .95)
        if row['sport'] != 'ride' or not reliable:
            row['tssFactor'] = None
        result.append((local_date, row))
    return result, invalid_dates


def _activity_count(rows):
    identified = {row['activityId'] for row in rows if row.get('activityId') is not None}
    return len(identified) + sum(row.get('activityId') is None for row in rows)


def _coverage(rows, sensor):
    duration_rows = [row for row in rows if valid(row.get('seconds'))]
    duration = sum(row['seconds'] for row in duration_rows)
    measured = sum(min(row[sensor]['seconds'], row['seconds']) for row in duration_rows)
    missing = len(rows) - len(duration_rows)
    if not rows:
        reason = 'no_eligible_sessions'
    elif missing:
        reason = 'missing_training_duration'
    elif not duration:
        reason = 'no_positive_training_duration'
    elif not measured:
        reason = 'missing_sensor_data'
    elif measured < duration:
        reason = 'partial_sensor_coverage'
    else:
        reason = None
    return {'coverage': round(measured / duration, 4) if duration and not missing else None,
            'measuredSeconds': round(measured, 2), 'eligibleSeconds': round(duration, 2),
            'eligibleSessions': len(rows), 'missingDurationSessions': missing, 'reason': reason}


def _intensity(zone_seconds, split):
    if zone_seconds is None:
        return None
    seconds = [sum(zone_seconds[:split[0]]), sum(zone_seconds[split[0]:split[1]]),
               sum(zone_seconds[split[1]:])]
    denominator = sum(seconds)
    if not denominator:
        return None
    return {'denominator': 'measured_sensor_seconds', 'denominatorSeconds': round(denominator, 2),
            'low': {'seconds': round(seconds[0], 2), 'share': round(seconds[0] / denominator, 4)},
            'moderate': {'seconds': round(seconds[1], 2), 'share': round(seconds[1] / denominator, 4)},
            'high': {'seconds': round(seconds[2], 2), 'share': round(seconds[2] / denominator, 4)}}


def _summarize(dated, start, end, ftp, max_hr):
    rows = [row for day, row in dated if start <= day <= end]
    total = bucket('total')
    by_sport, sport_rows = {}, defaultdict(list)
    for row in rows:
        add(total, row, ftp, max_hr)
        add(by_sport.setdefault(row['sport'], bucket(row['sport'])), row, ftp, max_hr)
        sport_rows[row['sport']].append(row)
    finish(total)
    cycling = sport_rows.get('ride', [])
    cycling_eligible = [row for row in cycling if not valid(row.get('seconds')) or row['seconds'] > 0]
    if not cycling_eligible:
        tss, tss_reason = (0.0, None) if cycling else (None, 'no_cycling_activities')
    elif not ftp:
        tss, tss_reason = None, 'ftp_not_configured'
    elif any(not valid(row.get('seconds')) for row in cycling_eligible):
        tss, tss_reason = None, 'missing_cycling_duration'
    elif any(not valid(row.get('tssFactor')) for row in cycling_eligible):
        tss, tss_reason = None, 'insufficient_power_coverage_or_normalized_power'
    else:
        tss, tss_reason = round(sum(row['tssFactor'] / ftp ** 2 for row in cycling_eligible), 2), None
    power_coverage = _coverage(cycling, 'power')
    hr_coverage = _coverage(rows, 'hr')
    power_zones = total['powerZones'] if ftp and total['known']['power'] else None
    hr_zones = total['hrZones'] if max_hr and total['known']['hr'] else None
    total_seconds = total['seconds']
    quality = {
        'durationKnownSessions': total['known']['seconds'],
        'durationMissingSessions': len(rows) - total['known']['seconds'],
        'distanceMissingSessions': len(rows) - total['known']['distance'],
        'elevationMissingSessions': len(rows) - total['known']['elevation'],
        'cyclingPower': power_coverage, 'heartRate': hr_coverage,
        'powerZonesReason': ('ftp_not_configured' if not ftp else 'missing_cycling_power_data') if power_zones is None else None,
        'heartRateZonesReason': ('max_hr_not_configured' if not max_hr else 'missing_heart_rate_data') if hr_zones is None else None,
    }
    distribution = []
    for sport in sorted(by_sport):
        item = finish(by_sport[sport])
        distribution.append({'sport': sport, 'trainingHours': round(item['seconds'] / 3600, 2) if item['seconds'] is not None else None,
                             'activityCount': _activity_count(sport_rows[sport]), 'sessionCount': item['count'],
                             'durationShare': round((item['seconds'] or 0) / total_seconds, 4) if total_seconds else None})
    return {'start': start.isoformat(), 'end': end.isoformat(),
            'trainingHours': round(total_seconds / 3600, 2) if total_seconds is not None else None,
            'activityCount': _activity_count(rows), 'sessionCount': len(rows),
            'distanceKm': total['distance'], 'elevationM': total['elevation'],
            'cyclingTss': tss, 'cyclingTssReason': tss_reason,
            'sportDistribution': distribution, 'sportShareDenominator': 'known_training_seconds',
            'powerZonesSeconds': power_zones, 'heartRateZonesSeconds': hr_zones,
            'intensityDistribution': {'cyclingPower': _intensity(power_zones, (2, 3)),
                                      'heartRate': _intensity(hr_zones, (2, 3))},
            'dataQuality': quality}


def summarize_period(rows, zone, start, end, ftp=None, max_hr=None):
    """Aggregate an inclusive local date range, for snapshots and week feedback.

Totals with some missing values are the known subtotal; dataQuality reports the
missing session counts. Cycling TSS is null unless *every* positive/unknown-
duration cycling session has the reliable factor computed by analytics.py.
"""
    zone = _zone(zone)
    start, end = _day(start, zone), _day(end, zone)
    if start > end:
        raise ValueError('Period start must be on or before end')
    dated, invalid_dates = _prepared(rows, zone)
    result = _summarize(dated, start, end, _threshold(ftp), _threshold(max_hr))
    result['dataQuality']['invalidDateSessionsExcluded'] = invalid_dates
    return result


def session_pattern(rows, zone, today, weeks=8):
    """How the athlete actually trains: sessions, training days and session length over recent complete weeks."""
    zone = _zone(zone)
    today = _day(today, zone)
    end = today - timedelta(days=today.weekday() + 1)
    start = end - timedelta(days=7 * weeks - 1)
    dated, _ = _prepared(rows, zone)
    chosen = [(day, row) for day, row in dated if start <= day <= end]
    sessions, days = defaultdict(int), defaultdict(set)
    for day, row in chosen:
        monday = day - timedelta(days=day.weekday())
        sessions[monday] += 1
        days[monday].add(day)
    mondays = [start + timedelta(weeks=i) for i in range(weeks)]
    minutes = [row['seconds'] / 60 for _, row in chosen if valid(row.get('seconds')) and row['seconds'] > 0]
    rides = [row['seconds'] / 60 for _, row in chosen
             if row['sport'] == 'ride' and valid(row.get('seconds')) and row['seconds'] > 0]
    rounded = lambda value: round(value) if value is not None else None
    return {'start': start.isoformat(), 'end': end.isoformat(), 'weeks': weeks,
            'sessionsPerWeekMedian': median(sessions[m] for m in mondays),
            'trainingDaysPerWeekMedian': median(len(days[m]) for m in mondays),
            'sessionMinutesMedian': rounded(median(minutes) if minutes else None),
            'rideMinutesMedian': rounded(median(rides) if rides else None),
            'longestSessionMinutes': rounded(max(minutes) if minutes else None),
            'sessionsUnder60MinShare': round(sum(m < 60 for m in minutes) / len(minutes), 2) if minutes else None,
            'definition': 'Complete Monday-Sunday weeks before the current week; weeks without activities count as zero.'}


def _weeks(dated, start, end):
    """Return every Monday-Sunday week entirely contained in the bounds."""
    monday = start + timedelta(days=(-start.weekday()) % 7)
    by_week = defaultdict(list)
    for day, row in dated:
        if start <= day <= end:
            by_week[day - timedelta(days=day.weekday())].append(row)
    result = []
    while monday + timedelta(days=6) <= end:
        rows = by_week[monday]
        hours = sum(row['seconds'] for row in rows if valid(row.get('seconds'))) / 3600
        missing = sum(not valid(row.get('seconds')) for row in rows)
        result.append({'start': monday, 'hours': hours if not missing else None, 'active': bool(rows)})
        monday += timedelta(days=7)
    return result


def _history(dated, today, ftp, max_hr):
    start = today - timedelta(days=364)
    summary = _summarize(dated, start, today, ftp, max_hr)
    current_monday = today - timedelta(days=today.weekday())
    weeks = _weeks(dated, start, current_monday - timedelta(days=1))
    values = [week['hours'] for week in weeks if week['hours'] is not None]
    complete = len(values) == len(weeks)
    return {'start': start.isoformat(), 'end': today.isoformat(),
            'trainingHours': summary['trainingHours'],
            'activityCount': summary['activityCount'],
            'activeWeeks': sum(week['active'] for week in weeks),
            'completeWeeks': len(weeks),
            'averageWeeklyHours': round(sum(values) / len(values), 2) if values and complete else None,
            'medianWeeklyHours': round(median(values), 2) if values and complete else None,
            'maxWeeklyHours': round(max(values), 2) if values and complete else None,
            'durationMissingSessions': summary['dataQuality']['durationMissingSessions'],
            'weeklyStatisticsReason': None if complete and values else 'missing_training_duration' if not complete else 'insufficient_complete_weeks',
            'weeklyStatisticsDefinition': 'Complete Monday-Sunday weeks inside this period, excluding the current week; weeks without recorded activities count as zero. TrainingHours includes all dates in the period.'}


def _capacity(dated, today):
    earliest = min((day for day, _ in dated), default=None)
    current_monday = today - timedelta(days=today.weekday())
    weeks = _weeks(dated, earliest, current_monday - timedelta(days=1)) if earliest else []
    result = {'historyStart': earliest.isoformat() if earliest else None,
              'completeWeeks': len(weeks), 'reasons': {},
              'definition': 'Maximum recorded hours across complete Monday-Sunday weeks from the first recorded activity date through the last completed week. Boundary partial weeks are excluded, zero weeks included, and windows with unknown durations excluded. This is observed training volume, not a safe or physiological capacity.'}
    for size, key in [(1, 'maxSingleWeekHours'), (4, 'max4WeekAverageHours'),
                      (6, 'max6WeekAverageHours'), (8, 'max8WeekAverageHours')]:
        candidates = []
        for index in range(len(weeks) - size + 1):
            window = weeks[index:index + size]
            if all(week['hours'] is not None for week in window):
                candidates.append(sum(week['hours'] for week in window) / size)
        result[key] = round(max(candidates), 2) if candidates else None
        if not candidates:
            result['reasons'][key] = 'insufficient_complete_weeks' if len(weeks) < size else 'missing_training_duration'
    if any(week['hours'] is None for week in weeks):
        result['incompleteDurationWeeksExcluded'] = sum(week['hours'] is None for week in weeks)
    return result


def _performance(efforts, zone, today):
    dated = []
    for effort in efforts:
        sport, target, value = effort.get('sport'), effort.get('target'), effort.get('value')
        if sport not in TARGETS or target not in TARGETS[sport] or not valid(value) or (sport == 'run' and value == 0):
            continue
        try:
            day = _day(effort['date'], zone, effort.get('utc', True))
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            continue
        if day <= today:
            dated.append((day, effort))
    result = {}
    for name, days in [('allTime', None), ('last365Days', 365), ('last90Days', 90)]:
        best = {}
        for day, effort in dated:
            if days and day < today - timedelta(days=days - 1):
                continue
            key = (effort['sport'], effort['target'])
            previous = best.get(key)
            better = previous is None or (effort['value'] > previous[1]['value'] if effort['sport'] == 'ride' else effort['value'] < previous[1]['value'])
            if better or (previous and effort['value'] == previous[1]['value'] and day > previous[0]):
                best[key] = (day, effort)
        result[name] = {'cycling': {}, 'running': {}}
        for (sport, target), (day, effort) in sorted(best.items()):
            label = (f'{target // 60}min' if target % 60 == 0 else f'{target}s') if sport == 'ride' else (f'{target // 1000}km' if target % 1000 == 0 else f'{target}m')
            result[name]['cycling' if sport == 'ride' else 'running'][label] = {
                'watts' if sport == 'ride' else 'durationSeconds': round(effort['value'], 2),
                'date': day.isoformat(), 'ageDays': (today - day).days,
                'activityId': effort.get('activityId')}
    return {'bestEfforts': result}


# Activity sports as the athlete profile names them; walking, hiking and unknown sports stay out.
PROFILE_SPORT = {'ride': 'ride', 'run': 'run', 'swim': 'swim', 'training': 'strength', 'strength': 'strength',
                 'strength_training': 'strength', 'cross_country_skiing': 'xcski', 'xcski': 'xcski'}
# A session counts as intervals with at least this much time at >= 90 % FTP or >= 80 % max HR.
INTERVAL_SECONDS = 10 * 60


def _hard_seconds(row, ftp, max_hr):
    """Seconds above threshold intensity by power (rides with FTP) or else heart rate; None without either."""
    power, hr = row.get('power') or {}, row.get('hr') or {}
    if ftp and row['sport'] == 'ride' and power.get('seconds'):
        return sum(zones(power['histogram'], ftp, POWER_LIMITS)[3:])
    if max_hr and hr.get('seconds'):
        return sum(zones(hr['histogram'], max_hr, HR_LIMITS)[3:])
    return None


def training_background(rows, zone, today, ftp=None, max_hr=None):
    """What the onboarding prefills: sports of the last 90 days, the main sport and weekly hours of the last 6 weeks,
    the strongest 4-week stretch and per sport the last interval session of the last 21 days."""
    zone = _zone(zone)
    today = _day(today, zone)
    dated = [(day, row) for day, row in _prepared(rows, zone)[0] if day <= today]
    since = lambda days: [(day, row) for day, row in dated if day >= today - timedelta(days=days - 1)]
    recent = sorted({PROFILE_SPORT[row['sport']] for _, row in since(90) if row['sport'] in PROFILE_SPORT})
    hours = defaultdict(float)
    for _, row in since(42):
        if valid(row.get('seconds')):
            hours[row['sport']] += row['seconds'] / 3600
    main = max((sport for sport in hours if sport in PROFILE_SPORT), key=lambda sport: hours[sport], default=None)
    intervals = {}
    for day, row in since(21):
        sport = PROFILE_SPORT.get(row['sport'])
        seconds = _hard_seconds(row, _threshold(ftp), _threshold(max_hr))
        if sport and seconds is not None and seconds >= INTERVAL_SECONDS and day.isoformat() > intervals.get(sport, ''):
            intervals[sport] = day.isoformat()
    capacity = _capacity(dated, today)
    return {'source': 'calculated', 'asOf': today.isoformat(), 'hasData': bool(dated), 'recentSports': recent,
            'mainSport': PROFILE_SPORT.get(main), 'weeklyHours': round(sum(hours.values()) / 6, 1) if hours else None,
            'best4WeekHours': capacity['max4WeekAverageHours'], 'intervals': intervals,
            'definition': 'Sports with activities in the last 90 days; main sport and weekly hours over the last 42 days; '
                          'intervals mean at least 10 min at >= 90 % FTP (rides) or >= 80 % max HR in the last 21 days.'}


RIEGEL_EXPONENT = 1.06


def run_threshold_pace(efforts, zone, today):
    """Threshold pace (s/km) as the predicted one-hour race pace from the best 5 km, 10 km or half-marathon
    efforts of the last 365 days (Riegel). The fastest prediction wins; None without such efforts."""
    best = _performance(efforts, _zone(zone), today)['bestEfforts']['last365Days']['running']
    result = None
    for label, distance in (('5km', 5), ('10km', 10), ('21km', 21)):
        effort = best.get(label)
        if not effort or not effort['durationSeconds']:
            continue
        hour_distance = distance * (3600 / effort['durationSeconds']) ** (1 / RIEGEL_EXPONENT)
        pace = round(3600 / hour_distance)
        if result is None or pace < result['paceSecPerKm']:
            result = {'source': 'calculated', 'paceSecPerKm': pace, 'basis': label, 'durationSeconds': effort['durationSeconds'],
                      'date': effort['date']}
    return result


def build_snapshot(rows, efforts, athlete, self_reported, zone, today=None):
    """Build the context from cached summary/effort dictionaries, without I/O.

Rows follow analytics.activity_summary with optional activityId. Efforts are
{sport, target, value, date, utc, activityId}; target/value use best_efforts.py
units. Scope-level source tags apply to all descendants in their own section.
"""
    timezone_name, zone = _zone_name(zone), _zone(zone)
    today = _day(today, zone) if today is not None else datetime.now(zone).date()
    athlete = athlete or {}
    ftp, max_hr = _threshold(athlete.get('ftp')), _threshold(athlete.get('maxHr'))
    all_dated, invalid_dates = _prepared(rows, zone)
    dated = [(day, row) for day, row in all_dated if day <= today]
    periods = {f'last{days}Days': _summarize(dated, today - timedelta(days=days - 1), today, ftp, max_hr)
               for days in (7, 28, 42)}
    quality = periods['last42Days']['dataQuality']
    earliest = min((day for day, _ in dated), default=None)
    latest = max((day for day, _ in dated), default=None)
    return {
        'schemaVersion': SCHEMA_VERSION, 'asOf': today.isoformat(), 'timezone': timezone_name,
        'athlete': {**{key: athlete.get(key) for key in ('age', 'weight', 'sport', 'ftp', 'maxHr')}, 'source': 'athlete'},
        'observed': {'source': 'calculated', 'currentTraining': periods,
                     'performanceHistory': _performance(efforts, zone, today),
                     'trainingHistory': {'last365Days': _history(dated, today, ftp, max_hr)},
                     'observedTrainingCapacity': _capacity(dated, today)},
        'selfReported': {**(self_reported or {}), 'source': 'athlete'},
        'dataQuality': {
            'source': 'calculated',
            'cyclingPowerCoverageLast42Days': quality['cyclingPower']['coverage'],
            'heartRateCoverageLast42Days': quality['heartRate']['coverage'],
            'ftpConfigured': ftp is not None, 'maxHrConfigured': max_hr is not None,
            'firstRecordedDate': earliest.isoformat() if earliest else None,
            'lastRecordedDate': latest.isoformat() if latest else None,
            'recordedHistoryDays': (today - earliest).days + 1 if earliest else 0,
            'invalidDateSessionsExcluded': invalid_dates,
            'futureSessionsExcluded': len(all_dated) - len(dated),
            'durationMissingSessionsLast42Days': quality['durationMissingSessions'],
            'reasons': {key: value for key, value in {
                'cyclingPowerCoverageLast42Days': quality['cyclingPower']['reason'],
                'heartRateCoverageLast42Days': quality['heartRate']['reason'],
                'cyclingTssLast42Days': periods['last42Days']['cyclingTssReason'],
                'trainingHistory': 'less_than_365_days_recorded_history' if not earliest or earliest > today - timedelta(days=364) else None,
            }.items() if value},
            'definitions': {
                'sources': 'Source tags apply to all fields within their section; athlete profile and selfReported are user input, not measured facts.',
                'activityCount': 'Distinct activity IDs; rows without IDs count individually. Session count can exceed activity count for multisport.',
                'coverage': 'Measured seconds divided by eligible recorded timer seconds; each session is capped at its timer duration. Cycling power considers rides only; heart rate considers all sports. Null when any eligible duration is unknown.',
                'zones': 'Existing TrainHub zones use current configured FTP/max HR. Power: 55/75/90/105/120/150% FTP; HR: 60/70/80/90% max HR. Zone time is capped proportionally at timer duration.',
                'intensity': 'Cycling power: low Z1-2, moderate Z3, high Z4-7. HR: low Z1-2, moderate Z3, high Z4-5. Separate descriptive zone groups, not physiological threshold estimates; shares use measured sensor seconds.',
                'missingValues': 'Hours, distance and elevation are known subtotals when some sessions lack values. Zero weeks mean no recorded activities; absence of imports cannot prove absence of training.',
                'cyclingTss': 'Current FTP and cached normalized-power factor; every positive-duration ride must have 95-105% recorded power coverage and valid normalized power. Other sports never contribute.',
            },
        },
    }
