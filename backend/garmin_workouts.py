"""Planned workouts as Garmin Connect workout JSON (the format behind its workout editor).

Mirrors workout_messages() in workout_export.py: same steps, targets and repeats, but
in Garmin Connect's units (seconds, metres, m/s) instead of FIT encodings.
"""
import hashlib
import json

from workout_export import garmin_workout_name

SPORTS = {'run': (1, 'running'), 'ride': (2, 'cycling'), 'swim': (4, 'swimming')}
STEP_TYPES = {'warmup': (1, 'warmup'), 'cooldown': (2, 'cooldown'), 'active': (3, 'interval'),
              'interval': (3, 'interval'), 'recovery': (4, 'recovery'), 'rest': (5, 'rest')}
END_CONDITIONS = {'open': (1, 'lap.button'), 'time': (2, 'time'), 'distance': (3, 'distance')}
TARGETS = {'none': (1, 'no.target'), 'power': (2, 'power.zone'), 'cadence': (3, 'cadence'),
           'heart_rate': (4, 'heart.rate.zone'), 'speed': (5, 'speed.zone'), 'pace': (6, 'pace.zone')}
POOL = {'poolLength': 25.0, 'poolLengthUnit': {'unitId': 1, 'unitKey': 'meter', 'factor': 100.0}}


def sport_type(sport):
    sport_id, key = SPORTS[sport]
    return {'sportTypeId': sport_id, 'sportTypeKey': key}


def target_values(target):
    kind, low, high = target['type'], target.get('low'), target.get('high')
    if kind == 'pace':
        return 1000 / high, 1000 / low  # s/km to m/s; the slower pace is the lower limit
    if kind == 'speed':
        return low / 3.6, high / 3.6
    return low, high


def executable(step, order, sport, group=None):
    duration, target = step['duration'], step['target']
    # Same rule as the FIT export: a timed pause without target in the pool is a rest step.
    rest = sport == 'swim' and step['intensity'] == 'recovery' and duration['type'] == 'time' and target['type'] == 'none'
    step_id, step_key = STEP_TYPES['rest' if rest else step['intensity']]
    end_id, end_key = END_CONDITIONS[duration['type']]
    target_id, target_key = TARGETS[target['type']]
    body = {'type': 'ExecutableStepDTO', 'stepOrder': order,
            'stepType': {'stepTypeId': step_id, 'stepTypeKey': step_key},
            'endCondition': {'conditionTypeId': end_id, 'conditionTypeKey': end_key},
            'targetType': {'workoutTargetTypeId': target_id, 'workoutTargetTypeKey': target_key}}
    if duration['type'] != 'open':
        body['endConditionValue'] = float(duration['value'])
    if target['type'] != 'none':
        low, high = target_values(target)
        body['targetValueOne'], body['targetValueTwo'] = round(low, 4), round(high, 4)
    if step['name']:
        body['description'] = step['name']
    if group is not None:
        body['childStepId'] = group
    return body


def estimated_seconds(steps):
    total = 0
    for block in steps:
        children = block['steps'] if block['kind'] == 'repeat' else [block]
        seconds = sum(child['duration']['value'] for child in children if child['duration']['type'] == 'time')
        total += seconds * (block['count'] if block['kind'] == 'repeat' else 1)
    return int(total)


def garmin_workout(workout):
    """Convert a validated workout (validate_workout) into an upload body."""
    sport = workout['sport']
    order, groups, steps = 0, 0, []
    for block in workout['steps']:
        order += 1
        if block['kind'] == 'repeat':
            groups += 1
            group = {'type': 'RepeatGroupDTO', 'stepOrder': order, 'childStepId': groups,
                     'stepType': {'stepTypeId': 6, 'stepTypeKey': 'repeat'}, 'numberOfIterations': block['count'],
                     'endCondition': {'conditionTypeId': 7, 'conditionTypeKey': 'iterations'},
                     'endConditionValue': float(block['count']), 'smartRepeat': False, 'workoutSteps': []}
            for child in block['steps']:
                order += 1
                group['workoutSteps'].append(executable(child, order, sport, groups))
            steps.append(group)
        else:
            steps.append(executable(block, order, sport))
    body = {'workoutName': garmin_workout_name(workout), 'sportType': sport_type(sport),
            'estimatedDurationInSecs': estimated_seconds(workout['steps']),
            'workoutSegments': [{'segmentOrder': 1, 'sportType': sport_type(sport), 'workoutSteps': steps}]}
    if workout.get('notes'):
        body['description'] = workout['notes']
    if sport == 'swim':
        body.update(POOL)
    return body


def fingerprint(body, day):
    """Changes whenever the workout or its calendar day changes."""
    return hashlib.sha256(json.dumps([body, day], sort_keys=True).encode()).hexdigest()
