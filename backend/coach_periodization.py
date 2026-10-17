"""Deterministic frame edits and weekly volume, independent of the AI provider.

The event date and plan span are fixed. Edits must tile that span; conflicts are
reported rather than silently moving neighbouring blocks or races. The load
rhythm is anchored backwards from each A-event taper, across block boundaries.
"""
import copy
import math
import uuid
from datetime import timedelta

from coach_blocks import BLOCK_TYPES, SECONDARY_FOCUS
from coach_domain import CoachError, day_date, effective_availability, iso_week, obj, text, validate
from coach_plan import LOAD_PHASES, a_events, plan_span

EDIT_FRAME_SCHEMA = obj({
    'revision': {'type': 'integer', 'minimum': 0},
    'taperWeeks': {'type': 'integer', 'enum': [1, 2]},
    'phases': {'type': 'array', 'minItems': 1, 'items': obj({
        'id': text(80, True), 'blockType': {'enum': list(BLOCK_TYPES)},
        'secondaryFocus': {'enum': [None, *SECONDARY_FOCUS]}, 'purpose': text(200),
        'startDate': text(10), 'weeks': {'type': 'integer', 'minimum': 1}})}})


def initial_segments(phases, settings, profile):
    """Keep the proposed block order, reserving the selected taper at every A event."""
    first, total = plan_span(settings)
    slots = [copy.deepcopy({k: phase[k] for k in ('blockType', 'secondaryFocus', 'purpose')})
             for phase in phases for _ in phase['weeks']]
    if len(slots) != total:
        raise CoachError('Die Phasen müssen den gesamten Planzeitraum abdecken.')
    count = settings.get('taperWeeks', 1)
    for slot in slots:
        if slot['blockType'] == 'taper':
            slot['blockType'] = 'wettkampfspezifisch'
    for event in a_events(profile):
        end = (day_date(event['startDate']) - first).days // 7
        if not 0 <= end < total:
            continue
        start = end - count + 1
        if start < 0:
            raise CoachError('Vor dem A-Event ist nicht genug Zeit für den gewählten Taper.')
        for index in range(start, end + 1):
            slots[index] = {'blockType': 'taper', 'secondaryFocus': None, 'purpose': f"Frisch zu {event['title']}"}
    result = []
    for index, slot in enumerate(slots):
        if result and all(result[-1][key] == slot[key] for key in slot):
            result[-1]['weeks'] += 1
        else:
            result.append({**slot, 'id': None, 'startDate': (first + timedelta(weeks=index)).isoformat(), 'weeks': 1})
    return result


def periodized_blocks(segments, settings, profile, frame_id, baseline=None):
    """Build stable dated blocks and capped weekly targets from a validated tiling.

    Starting volume is the athlete's typical past week, or the measured average.
    Load weeks grow by 5% of that baseline, recovery is 70%, taper is 60/45%.
    Availability is only a ceiling, never the starting volume.
    """
    first, total = plan_span(settings)
    ordered = sorted(copy.deepcopy(segments), key=lambda s: s['startDate'])
    cursor = first
    ids = set()
    for segment in ordered:
        start = day_date(segment['startDate'])
        if start != cursor or start.weekday() != 0:
            raise CoachError(f'Blockkonflikt: Ab {cursor.isoformat()} müssen die Blöcke lückenlos ohne Überlappung anschließen.')
        identity = segment['blockType']
        if identity not in BLOCK_TYPES:
            raise CoachError('Unbekannter Blocktyp.')
        secondary = segment.get('secondaryFocus')
        if secondary == 'kraft' and not profile['preferences']['gymAvailability']:
            raise CoachError('Kraft als Nebenschwerpunkt benötigt Krafttraining-Verfügbarkeit.')
        if secondary == 'laufen' and 'run' not in profile['goal']['sports']:
            raise CoachError('Laufen als Nebenschwerpunkt benötigt Laufen im Plan.')
        if (cursor - first).days // 7 + segment['weeks'] > total:
            raise CoachError('Blockkonflikt: Der Block reicht über das feste Planende hinaus.')
        cursor += timedelta(weeks=segment['weeks'])
        key = segment.get('id') or str(uuid.uuid5(uuid.NAMESPACE_URL,
                                                f"trainhub-frame:{frame_id}:{start}:{identity}"))
        if key in ids:
            raise CoachError('Jeder Block braucht eine eigene ID.')
        ids.add(key)
        segment['id'] = key
    if cursor != first + timedelta(weeks=total):
        raise CoachError('Blockkonflikt: Die Blöcke müssen genau bis zum festen Planende reichen.')
    slots = [segment for segment in ordered for _ in range(segment['weeks'])]
    tapers = []
    for event in a_events(profile):
        event_index = (day_date(event['startDate']) - first).days // 7
        if not 0 <= event_index < total:
            continue
        count = settings.get('taperWeeks', 1)
        start = event_index - count + 1
        if start < 0 or any(slots[i]['blockType'] != 'taper' for i in range(start, event_index + 1)):
            raise CoachError(f"Blockkonflikt: Vor {event['title']} sind {count} Taperwochen erforderlich. Das Eventdatum bleibt fest.")
        if start and slots[start - 1]['blockType'] == 'taper':
            raise CoachError(f"Blockkonflikt: Der Taper vor {event['title']} muss genau {count} Wochen dauern.")
        if tapers and start <= tapers[-1][1]:
            raise CoachError('Blockkonflikt: Die Taperphasen der A-Events überlappen sich.')
        tapers.append((start, event_index, event))
    for index, slot in enumerate(slots):
        if slot['blockType'] == 'taper' and not any(start <= index <= end for start, end, _ in tapers):
            raise CoachError('Blockkonflikt: Ein Taper muss unmittelbar am A-Event liegen.')
    past_hours = profile['background']['weeklyHours']
    baseline = past_hours if past_hours is not None else baseline
    if baseline is None:
        # Compatibility for profiles predating the background question.
        baseline = profile['availability']['preferredWeeklyHours']
    baseline = max(1.0, float(baseline if baseline is not None else 3.0))
    maximum = profile['availability']['absoluteMaxWeeklyHours']
    if maximum is None:
        raise CoachError('Bitte zuerst das verfügbare Zeitbudget speichern.')
    load_count, result, index = 0, [], 0
    for segment in ordered:
        weeks = []
        for number in range(segment['weeks']):
            monday = first + timedelta(weeks=index)
            limits = effective_availability(profile, iso_week(monday))
            if any(day['maxMinutes'] is None for day in limits.values()):
                raise CoachError('Bitte zuerst die Tagesverfügbarkeiten speichern.')
            available = sum(day['maxMinutes'] for day in limits.values()
                            if settings['startDate'] <= day['date'] <= settings['endDate']) / 60
            cap = min(maximum, profile['availability']['maxWeeklyHours'] if profile['availability']['maxWeeklyHours'] is not None else maximum,
                      available)
            taper = next(((start, end, event) for start, end, event in tapers if start <= index <= end), None)
            next_taper = next((start for start, _, _ in tapers if start > index), None)
            recovery = segment['blockType'] == 'uebergang' or (not taper and
                        ((next_taper - index) % 4 == 0 if next_taper is not None else index % 4 == 3))
            phase = 'taper' if taper else 'recovery' if recovery else LOAD_PHASES[segment['blockType']]
            factor = (.45 if index == taper[1] else .6) if taper else .7 if recovery else 1
            target = math.floor(min(cap, baseline * (1 + .05 * load_count) * factor) * 4 + 1e-9) / 4
            weeks.append({'week': number + 1, 'phase': phase, 'targetHours': target, 'focus': segment['purpose']})
            if not taper and not recovery:
                load_count += 1
            index += 1
        start = day_date(segment['startDate'])
        result.append({**segment, 'weeks': weeks, 'endDate': (start + timedelta(weeks=len(weeks), days=-1)).isoformat(),
                       'source': 'athlete', 'status': 'active', 'review': None})
    return result


def edit_frame(plan, data, profile):
    validate(data, EDIT_FRAME_SCHEMA)
    frame = plan.get('frame')
    if not frame or frame['status'] != 'active':
        raise CoachError('Es gibt keinen aktiven Plan.')
    existing = {block['id'] for block in plan['blocks'] if block['id'] in frame['blockIds']}
    if any(s['id'] and s['id'] not in existing for s in data['phases']):
        raise CoachError('Die Änderung verweist auf einen unbekannten Block.')
    settings = {**plan['settings'], 'taperWeeks': data['taperWeeks']}
    blocks = periodized_blocks(data['phases'], settings, profile, frame['id'])
    previous = {b['id']: b for b in plan['blocks']}
    for block in blocks:
        old = previous.get(block['id'])
        if old and old['blockType'] == block['blockType']:
            for key in ('formats', 'review'):
                if key in old:
                    block[key] = copy.deepcopy(old[key])
    result = copy.deepcopy(plan)
    result['blocks'] = [b for b in result['blocks'] if b['id'] not in existing] + blocks
    result['settings'] = settings
    result['frame'].update(blockIds=[b['id'] for b in blocks], source='athlete')
    outlines = {iso_week(day_date(b['startDate']) + timedelta(weeks=i)): w for b in blocks for i, w in enumerate(b['weeks'])}
    for key, worked in result['weeks'].items():
        outline = outlines.get(key)
        if outline:
            worked.update(targetHours=outline['targetHours'], focus=outline['focus'], needsReview=True)
    return result
