"""Weekly hours the coach recommends for the goal: a minimum, the average week and the peak week.

One AI call weighs the A event (kind, distance, climbing, finishing or a target time), the weeks up to it and the
training so far; fixed guard rails keep its answer plausible. Without an AI answer fixed rules give the numbers. The
peak week sets the top of the plan's volume curve (coach_plan.volume_curve); the time the athlete has caps it.
"""
import hashlib
import json

from coach_domain import day_date, num, obj, text

RECOMMENDATION_SCHEMA = obj({'minHours': num(1, 40), 'averageHours': num(1, 40), 'peakHours': num(1, 40),
                             'rationale': text(400)})
# Hours per week to finish an event of this kind well; a target time asks for more.
EVENT_MINIMUM = {
    'ride': {'criterium': 5, 'cyclocross': 5, 'timeTrial': 5, 'crossCountry': 5, 'roadRace': 6, 'granFondo': 6,
             'xcMarathon': 6, 'gravel': 6, 'ultra': 10},
    'run': {'5k': 3, '10k': 3.5, 'halfMarathon': 4, 'marathon': 5, 'trail': 5, 'ultra': 7},
    'triathlon': {'sprint': 5, 'olympic': 7, 'middle': 9, 'long': 12},
    'duathlon': {'sprint': 4, 'standard': 6},
    'xcski': {'classic': 5, 'skating': 5, 'marathon': 6},
    'hyrox': {'open': 5, 'pro': 6, 'doubles': 4, 'relay': 4},
}
DEFAULT_MINIMUM = 4
TARGET_TIME_SHARE = 1.25  # More volume for a target time than for finishing.
AVERAGE_SHARE = 1.1       # The average week over the minimum when finishing.
PEAK_SHARE = 1.25         # The peak week over the average week.
# Most the peak week may lie over the training so far, also when the AI suggests more.
MAX_PEAK_OVER_BASE = 1.6


def _half(value):
    return round(value * 2) / 2


def goal_event(profile, today):
    """The next A event from today on, else the last one."""
    events = sorted((e for e in profile['events'] if e['priority'] == 'A'), key=lambda e: (e['startDate'], e['id']))
    return next((e for e in events if e['endDate'] >= today.isoformat()), events[-1] if events else None)


def recommendation_input(profile, today, recent_hours):
    """What the recommendation depends on: the A event, the weeks up to it and the training so far."""
    event = goal_event(profile, today)
    background = profile['background']
    return {
        'event': {'title': event['title'], 'sport': event['sport'], 'subtype': event['subtype'], 'startDate': event['startDate'],
                  'distanceKm': event['distanceKm'], 'elevationM': event['elevationM'],
                  'goal': 'finish' if event['targetSeconds'] is None else 'targetTime', 'targetSeconds': event['targetSeconds'],
                  'weeksToGo': max(0, (day_date(event['startDate']) - today).days // 7),
                  'athleteWish': event['description']} if event else None,
        'goal': {'type': profile['goal']['type'], 'sports': profile['goal']['sports']},
        'trainingBase': {'type': background['type'], 'weeklyHours': background['weeklyHours'], 'intervals': background['intervals']},
        'recentWeeklyHours': recent_hours,
    }


def input_key(data):
    """Stable key of the input, so a stored AI answer is only reused while nothing it depends on changed."""
    stable = {**data, 'event': {k: v for k, v in data['event'].items() if k != 'weeksToGo'} if data['event'] else None}
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()[:16]


def base_hours(data):
    """The training so far: the athlete's typical week, else the recent average."""
    return data['trainingBase']['weeklyHours'] or data['recentWeeklyHours'] or None


def rule_recommendation(data):
    """Fixed rules: the minimum of the event kind, more for a target time, never below the training so far."""
    event = data['event']
    minimum = EVENT_MINIMUM.get(event['sport'], {}).get(event['subtype'], DEFAULT_MINIMUM) if event else None
    base = base_hours(data)
    if minimum is None:
        minimum = base or DEFAULT_MINIMUM
    average = minimum * (TARGET_TIME_SHARE if event and event['goal'] == 'targetTime' else AVERAGE_SHARE)
    average = max(average, base or 0)
    return guarded({'minHours': minimum, 'averageHours': average, 'peakHours': average * PEAK_SHARE,
                    'rationale': 'Richtwert aus Eventart, Ziel und deinem bisherigen Umfang.'}, data, 'rules')


def guarded(decision, data, source):
    """Minimum ≤ average ≤ peak in half hours, the peak at most 60 % over the training so far (when known)."""
    minimum, average, peak = (_half(value) for value in sorted([decision['minHours'], decision['averageHours'],
                                                                 decision['peakHours']]))
    base = base_hours(data)
    if base:
        peak = min(peak, max(int(base * MAX_PEAK_OVER_BASE * 2) / 2, minimum))
        average = min(average, peak)
    return {'minHours': minimum, 'averageHours': average, 'peakHours': peak, 'rationale': decision['rationale'].strip(),
            'source': source}


INSTRUCTIONS = (
    'Volume task: recommend the weekly training hours for the athlete\'s A event. minHours is the least weekly volume to '
    'reach event.goal (finish, or event.targetSeconds as target time) well prepared, averageHours the usual week over the '
    'plan and peakHours the biggest week shortly before the taper. Weigh event kind, distance, elevation, the target time '
    'against the distance, weeksToGo and the training so far (trainingBase.weeklyHours, recentWeeklyHours): build from it, '
    'never more than sensible for the athlete. rationale is one or two short German sentences for the athlete.'
)
