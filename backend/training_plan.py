"""Transparent four-week cycling planning from recent completed training.

Volume is a conservative heuristic, not a physiological readiness assessment.
Interval structure: https://www.trainingpeaks.com/blog/cycling-interval-training-101/
Recovery: https://www.britishcycling.org.uk/knowledge/article/izn20130108-sportive-r-r--maximise-your-post-ride-recovery-0
"""
import math
import re
from datetime import date, datetime, timedelta, timezone
from statistics import median

from workout_export import WorkoutError, number, validate_workout


def calendar_date(value, label='Datum'):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise WorkoutError(f'{label}: Bitte YYYY-MM-DD verwenden.')
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise WorkoutError(f'{label}: Ungültiges Datum.') from exc


def date_range(start, end):
    start, end = calendar_date(start, 'Von'), calendar_date(end, 'Bis')
    if end < start:
        raise WorkoutError('Das Enddatum muss am oder nach dem Startdatum liegen.')
    return start.isoformat(), end.isoformat()


def history_summary(activities, zone, as_of):
    """Six complete local weeks, retaining empty weeks and all sports' load."""
    week_end = as_of - timedelta(days=as_of.weekday())
    beginning = week_end - timedelta(weeks=6)
    weeks = [{'start': (beginning + timedelta(weeks=i)).isoformat(), 'cyclingMinutes': 0,
              'otherMinutes': 0, 'rideDays': set(), 'rides': 0} for i in range(6)]
    latest = None
    for activity in activities:
        details = activity.get('details') or {}
        sessions = details.get('sessions', [])
        if len(sessions) <= 1:
            sessions = [{'sport': activity['sport'], 'startTime': activity['date'],
                         'timerSeconds': details.get('timerSeconds') if details.get('timerSeconds') is not None
                         else (activity.get('duration') or 0) * 60}]
        for session in sessions:
            value = session.get('timerSeconds')
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                continue
            stamp = datetime.fromisoformat(session['startTime'].replace('Z', '+00:00'))
            if details:
                stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp
                stamp = stamp.astimezone(zone)
            day = stamp.date()
            cycling = session.get('sport') == 'ride'
            if cycling and day < as_of:
                latest = max(latest, day) if latest else day
            if not beginning <= day < week_end:
                continue
            week = weeks[(day - beginning).days // 7]
            week['cyclingMinutes' if cycling else 'otherMinutes'] += value / 60
            if cycling:
                week['rides'] += 1
                week['rideDays'].add(day)
    for week in weeks:
        week['rideDays'] = len(week['rideDays'])
        for key in ('cyclingMinutes', 'otherMinutes'):
            week[key] = round(week[key], 1)
    typical = median(w['cyclingMinutes'] for w in weeks) / 60
    recent = sum(w['cyclingMinutes'] for w in weeks[-2:]) / 120
    baseline = min(typical, recent, 8)
    eligible = baseline >= 3 and latest is not None and (as_of - latest).days <= 21
    warnings = []
    if any(w['cyclingMinutes'] / 60 > max(typical * 1.75, 10) for w in weeks):
        warnings.append('Einzelne sehr lange Wochen erhöhen die Empfehlung nicht: Grundlage ist der Median, begrenzt durch die letzten zwei vollen Wochen.')
    if any(w['otherMinutes'] >= 60 for w in weeks[-2:]):
        warnings.append('Zusätzliche Lauf- oder andere Einheiten sind vorhanden. Harte Einheiten anderer Sportarten während dieses Blocks ersetzen, nicht zusätzlich einplanen.')
    if not eligible:
        warnings.append('Für diesen VO₂max-Block fehlen mindestens 3 h regelmäßiges Radtraining pro Woche oder aktuelle Fahrten (letzte 21 Tage). Zuerst die Grundlage und Historie aktualisieren.')
    return {'from': beginning.isoformat(), 'through': (week_end - timedelta(days=1)).isoformat(),
            'asOf': as_of.isoformat(), 'lastRide': latest.isoformat() if latest else None,
            'weeks': weeks, 'medianHours': round(typical, 2), 'recentHours': round(recent, 2),
            'recommendedHours': math.floor(baseline * 4) / 4, 'eligible': eligible, 'warnings': warnings}


def minutes(workout):
    return sum(sum(s['duration']['value'] for s in block['steps']) * block['count']
               if block['kind'] == 'repeat' else block['duration']['value'] for block in workout['steps']) / 60


def make_block(data, history, profile_ftp, today):
    if not isinstance(data, dict):
        raise WorkoutError('Bitte die Block-Einstellungen übergeben.')
    start = calendar_date(data.get('startDate'))
    if start < today or start > today + timedelta(days=366):
        raise WorkoutError('Der Block muss innerhalb der nächsten 12 Monate beginnen.')
    if not history['eligible']:
        raise WorkoutError(history['warnings'][-1])
    ftp = number(data.get('ftp', profile_ftp), 'Aktuelle FTP', 1, 1000)
    requested = data.get('weeklyHours', history['recommendedHours'])
    hours = number(requested, 'Wochenstunden', 3, 12)
    warnings = list(history['warnings'])
    if hours > history['recommendedHours']:
        warnings.append(f'Deine gewählten {hours:g} h liegen über der konservativen Empfehlung von '
                        f'{history["recommendedHours"]:g} h aus der Radhistorie. Andere Sporteinheiten ersetzen; '
                        'bei Müdigkeit den Umfang reduzieren.')
    if (start - today).days > 28:
        warnings.append('Der Start liegt mehr als vier Wochen in der Zukunft. Historie und FTP vor dem Start erneut prüfen.')

    def step(name, intensity, duration, low, high):
        return {'kind': 'step', 'name': name, 'intensity': intensity,
                'duration': {'type': 'time', 'value': duration * 60},
                'target': {'type': 'power', 'low': max(1, round(ftp * low)), 'high': max(1, round(ftp * high))}}

    def workout(day, name, steps):
        return validate_workout({'version': 1, 'name': name, 'date': day.isoformat(), 'sport': 'ride', 'steps': steps})

    def intervals(day, count, duration):
        return workout(day, f'VO2max {count} x {duration} min', [
            step('Einrollen', 'warmup', 10, .45, .55), step('Aufwaermen', 'warmup', 5, .65, .75),
            {'kind': 'repeat', 'count': count, 'steps': [
                step('Kontrolliert hart', 'interval', duration, 1.10, 1.15),
                step('Locker rollen', 'recovery', duration, .45, .55)]},
            step('Ausrollen', 'cooldown', 10, .40, .50)])

    def endurance(day, duration, easy=False):
        return workout(day, f'{"Erholung" if easy else "Grundlage"} {duration} min', [
            step('Einrollen', 'warmup', 5, .45, .55),
            step('Locker und gleichmaessig', 'recovery' if easy else 'active', duration - 10,
                 .45 if easy else .60, .55 if easy else .70),
            step('Ausrollen', 'cooldown', 5, .40, .50)])

    workouts, weeks, rest = [], [], []
    for index, (count, length, factor) in enumerate([(4, 3, .90), (5, 3, .95), (4, 4, 1), (3, 3, .65)]):
        first = start + timedelta(weeks=index)
        days = [first + timedelta(days=i) for i in range(7)]
        hard_days = [d for d in days if d.weekday() in (1, 3)]
        hard = [intervals(d, count, length) for d in hard_days[:1 if index == 3 else 2]]
        if index == 3:
            hard.append(endurance(hard_days[1], 30, easy=True))
        remaining = max(60, round(hours * 60 * factor) - sum(minutes(w) for w in hard))
        saturday = int(remaining * .60 // 5 * 5)
        sunday = int(remaining - saturday)
        weekly = hard + [endurance(d, saturday if d.weekday() == 5 else sunday) for d in days if d.weekday() in (5, 6)]
        workouts.extend(weekly)
        rest.extend(d.isoformat() for d in days if d.weekday() in (0, 2, 4))
        weeks.append({'week': index + 1, 'from': first.isoformat(), 'through': days[-1].isoformat(),
                      'phase': 'Entlastung' if index == 3 else 'Aufbau',
                      'minutes': sum(minutes(w) for w in weekly), 'intervalMinutes': count * length * (1 if index == 3 else 2)})
    return {'startDate': start.isoformat(), 'endDate': (start + timedelta(days=27)).isoformat(),
            'ftp': ftp, 'weeklyHours': hours, 'history': history, 'weeks': weeks,
            'warnings': warnings, 'restDays': sorted(rest), 'workouts': sorted(workouts, key=lambda w: w['date']),
            'guidance': 'Di/Do Intervalle, Sa/So Grundlage; Mo/Mi/Fr frei. In Woche 4 nur ein Intervalltraining. '
                        '110–115 % FTP sind ein Startbereich, kein gemessener VO₂max-Wert. Kontrolliert hart (8–9/10), '
                        'nicht sprinten. Bei nicht haltbarer Leistung reduzieren oder die Einheit locker fahren. '
                        'Jede Wiederholung enthält die angegebene Erholung.'}
