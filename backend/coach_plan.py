"""Plan with phases: the frame from the plan start to its end and the rolling horizon of worked-out weeks.

One AI call lays out the phases with their weekly targets; TrainHub stores them as blocks with source plan and
checks them with the block rules and an order per cycle up to each A event. Only the next weeks of the horizon (three
unless the athlete chooses more) get sessions. Later weeks stay outlined (phase and target hours) until rolling
replanning reaches them: after the weekly review, on Sunday evening or on request, depending on the athlete's replan mode.

The athlete may also change the phases by hand: move, lengthen, shorten, add or remove blocks and choose the taper
before an A event. Those edits follow fixed rules (edit_phases), no AI call is involved.
"""
import copy
import uuid
from datetime import timedelta

from coach_blocks import BLOCK_TYPES, SECONDARY_FOCUS, SELECTABLE, check_block, new_block, suggested_rhythm
from coach_domain import (BLOCK_WEEKS_SCHEMA, DAYS, HINWEISE_SCHEMA, CoachError, day_date, effective_availability, iso_week,
                          minutes_of, num, obj, preferred_hours, text, week_start)
from coach_season import dated, typical_season

HORIZON = 3
MAX_PHASES = 40
FRAME_RESPONSE_SCHEMA = obj({
    'phases': {'type': 'array', 'minItems': 1, 'maxItems': MAX_PHASES, 'items': obj({
        'blockType': {'type': 'string', 'enum': SELECTABLE},
        'secondaryFocus': {'type': ['string', 'null'], 'enum': [*SECONDARY_FOCUS, None]},
        'purpose': text(200), 'weeks': BLOCK_WEEKS_SCHEMA})},
    'rationale': text(400), 'hinweise': HINWEISE_SCHEMA})
# Order inside a cycle that ends with an A event: optional recovery after the previous event, base, intensity
# (Aufbau for short gaps between events), race-specific, taper. After the last A event the plan may go on with
# recovery and base up to its end.
PLAN_RANK = {'uebergang': 0, 'wiedereinstieg': 1, 'grundlage': 2, 'aufbau': 3, 'vo2max': 3, 'schwelle': 3,
             'wettkampfspezifisch': 4, 'taper': 5}
FINAL_TYPES = ('wettkampfspezifisch', 'taper')
# Tests for thresholds the athlete wants measured; they belong in the first plan week.
TESTS = {'ride': 'bike_ftp_test', 'run': 'run_test_30'}
TEST_NAMES = {'bike_ftp_test': 'den FTP-Test', 'run_test_30': 'den 30-min-Lauftest'}
REVIEW_REASONS = ['asPlanned', 'lackOfTime', 'sick', 'injured', 'tired', 'travel']
REVIEW_SCHEMA = obj({'missedSessions': {'type': 'array', 'maxItems': 21, 'items': text(80)},
                     'effort': num(1, 5, nullable=True, integer=True),
                     'reasons': {'type': 'array', 'uniqueItems': True, 'maxItems': len(REVIEW_REASONS), 'items': {'enum': REVIEW_REASONS}},
                     'note': text(1000)})
REVIEW_SCHEMA['required'] = ['missedSessions']
# Settings whose change may call for adapting the plan ("Soll ich deinen Plan anpassen?"); events and the plan
# end lay out the phases again.
# 'phases' follows a manual edit of the phases: only the worked-out weeks are checked, the phases stay as edited.
ADAPT_AREAS = ['availability', 'events', 'thresholds', 'sports', 'period', 'phases']
REFRAME_AREAS = {'events', 'period'}
ADAPT_SCHEMA = obj({'changes': {'type': 'array', 'minItems': 1, 'uniqueItems': True, 'items': {'enum': ADAPT_AREAS}},
                    'later': {'type': 'boolean'}})
ADAPT_SCHEMA['required'] = ['changes']


def adapt_response_schema(patch, weeks=HORIZON):
    return obj({'adjustments': {'type': 'array', 'maxItems': max(weeks, HORIZON) + 1, 'items': patch}, 'hinweise': HINWEISE_SCHEMA})


# A week counts as strongly off plan below this share of the planned hours.
DEVIATION_SHARE = .6
# The replan modes shift the moment a new week is due: Sunday 18:00, or Monday 06:00 without a review.
SHIFT = {'sunday': timedelta(hours=6), 'afterReview': timedelta(hours=-6)}
GROUP_INTENSITY = {'easy': 'locker', 'moderate': 'mittel', 'hard': 'hart'}
GROUP_SPORTS = {'ride', 'run', 'swim'}  # Calendar workouts exist for these sports.


def a_events(profile):
    return sorted((e for e in profile['events'] if e['priority'] == 'A'), key=lambda e: (e['startDate'], e['id']))


def plan_span(settings):
    """Monday of the first plan week and the number of weeks up to the week of the plan end."""
    start, end = day_date(settings['startDate']), day_date(settings['endDate'])
    first = start - timedelta(days=start.weekday())
    return first, (end - first).days // 7 + 1


def plan_weeks(settings):
    first, total = plan_span(settings)
    return [iso_week(first + timedelta(weeks=index)) for index in range(total)]


def goal_profile(profile, event):
    """The profile with the next A event as goal date, so the block rules end race blocks in its week."""
    return {**profile, 'goal': {**profile['goal'], 'date': event['startDate'] if event else None}}


def check_frame(phases, settings, profile):
    """Block rules per phase, the order per cycle, race phases ending in each A-event week and the weekly time."""
    first, total = plan_span(settings)
    weeks = sum(len(phase['weeks']) for phase in phases)
    if weeks != total:
        raise CoachError(f'Die Phasen ergeben {weeks} Wochen, der Plan hat {total}.')
    events = a_events(profile)
    maximum = profile['availability']['absoluteMaxWeeklyHours']
    start, rank, previous, seen = first, -1, None, set()
    for index, phase in enumerate(phases, start=1):
        identity = phase['blockType']
        name = BLOCK_TYPES[identity]['name']
        if [w['week'] for w in phase['weeks']] != list(range(1, len(phase['weeks']) + 1)):
            raise CoachError(f'Phase {index}: Die Wochen müssen lückenlos ab 1 zählen.')
        end = start + timedelta(weeks=len(phase['weeks'])) - timedelta(days=1)
        goal = next((e for e in events if e['startDate'] >= start.isoformat()), None)
        if identity in FINAL_TYPES and goal is None:
            raise CoachError(f'Phase {index}: „{name}“ gibt es nur vor einem A-Event.')
        if PLAN_RANK[identity] < rank or (identity in seen and identity != previous):
            raise CoachError(f'Phase {index}: „{name}“ passt nicht in die Reihenfolge Erholung → Grundlage → '
                             'Aufbau/VO2max/Schwelle → Wettkampfspezifisch → Taper bis zum A-Event.')
        check_block(identity, phase['secondaryFocus'], phase['weeks'], start=start, profile=goal_profile(profile, goal))
        for item in phase['weeks']:
            monday = start + timedelta(weeks=item['week'] - 1)
            limits = [day['maxMinutes'] for day in effective_availability(profile, iso_week(monday)).values()]
            if maximum is None or None in limits:
                raise CoachError('Bitte Verfügbarkeiten und maximalen Wochenumfang vollständig speichern.')
            if item['targetHours'] > min(maximum, sum(limits) / 60) + 1e-9:
                raise CoachError(f'Phase {index}, Woche {item["week"]}: Die Zielstunden überschreiten die verfügbare Zeit.')
        inside = [e for e in events if start <= day_date(e['startDate']) <= end]
        if inside:
            if identity not in FINAL_TYPES or day_date(inside[0]['startDate']) < end - timedelta(days=6):
                raise CoachError(f'Phase {index}: Vor „{inside[0]["title"]}“ endet Wettkampfspezifisch oder Taper '
                                 'in der Woche des Events.')
            taper = settings.get('taperWeeks')
            if taper and (identity != 'taper' or len(phase['weeks']) != taper):
                raise CoachError(f'Phase {index}: Vor „{inside[0]["title"]}“ steht ein Taper von '
                                 f'{taper} {"Woche" if taper == 1 else "Wochen"}.')
            rank, previous, seen = -1, None, set()  # The next cycle starts after the event.
        else:
            rank, previous = PLAN_RANK[identity], identity
            seen.add(identity)
        start = end + timedelta(days=1)


def frame_blocks(phases, first):
    """The phases as consecutive blocks with source plan."""
    blocks, start = [], first
    for phase in phases:
        block = new_block(phase['blockType'], phase['secondaryFocus'], start.isoformat(), copy.deepcopy(phase['weeks']),
                          source='plan')
        blocks.append({**block, 'purpose': phase['purpose']})
        start += timedelta(weeks=len(phase['weeks']))
    return blocks


def cut_frame(blocks, frame_ids, start):
    """The phases before start: later ones go, the one running over start ends the week before."""
    result, kept = [], []
    for block in blocks:
        if block['id'] not in frame_ids or day_date(block['startDate']) < start <= day_date(block['endDate']):
            if block['id'] in frame_ids:
                weeks = (start - day_date(block['startDate'])).days // 7
                block = {**block, 'weeks': copy.deepcopy(block['weeks'][:weeks]), 'endDate': (start - timedelta(days=1)).isoformat()}
                kept.append(block['id'])
            result.append(block)
        elif day_date(block['endDate']) < start:
            result.append(block)
            kept.append(block['id'])
    return result, kept


# Phase of a load week per block type, for season blocks that never got their own outline.
LOAD_PHASES = {'wiedereinstieg': 'base', 'grundlage': 'base', 'uebergang': 'recovery', 'aufbau': 'build', 'vo2max': 'build',
               'schwelle': 'build', 'wettkampfspezifisch': 'peak', 'taper': 'taper', 'custom': 'build'}


def adopt_blocks(plan, profile, today):
    """Plans from before the phases: running and upcoming blocks and the open blocks of the season plan become the
    phases of a plan, with settings from the season start up to the end of the last block. The season plan stays as
    data for its former endpoints.

    Deterministic, so unsaved reads stay stable; saved in this shape with the next change. Plans that already had a
    frame (also an ended one) and plans without a current or upcoming block stay as they are: a season plan whose
    first block was never created starts with the onboarding."""
    if plan.get('frame'):
        return plan
    live = sorted((b for b in plan['blocks'] if b['status'] != 'abandoned'), key=lambda b: b['startDate'])
    ahead = [b for b in live if day_date(b['endDate']) >= today]
    if not ahead:
        return plan
    season = dated(plan.get('season'))
    start = min(ahead[0]['startDate'], season[0]['startDate']) if season else ahead[0]['startDate']
    phases = [b for b in live if b['endDate'] >= start]
    end = phases[-1]['endDate']
    result = copy.deepcopy(plan)
    recent = [w['targetHours'] for b in phases for w in b['weeks'] if w.get('targetHours')]
    fallback = round(sum(recent) / len(recent) * 2) / 2 if recent else 5.0
    for segment in season:
        if segment['startDate'] <= end:
            continue
        monday = day_date(segment['startDate'])
        weeks = []
        for index, deload in enumerate(suggested_rhythm(segment['weeks'], segment['blockType'])):
            hours = preferred_hours(profile, monday + timedelta(weeks=index)) or fallback
            phase = 'taper' if segment['blockType'] == 'taper' else 'recovery' if deload else LOAD_PHASES.get(segment['blockType'], 'build')
            weeks.append({'week': index + 1, 'phase': phase, 'targetHours': round(hours * (.7 if deload else 1) * 2) / 2,
                          'focus': segment.get('purpose') or ''})
        block = new_block(segment['blockType'], segment.get('secondaryFocus'), segment['startDate'], weeks, source='plan',
                          key=f"season-{segment['startDate']}")
        block['purpose'] = segment.get('purpose') or ''
        result['blocks'].append(block)
        phases.append(block)
        end = block['endDate']
    start = phases[0]['startDate']
    identities = [b['id'] for b in phases]
    previous = result.get('settings') or {}
    result['settings'] = {'startDate': start, 'endDate': end, 'replanMode': previous.get('replanMode', 'afterReview'),
                          'createdAt': previous.get('createdAt') or start}
    result['frame'] = {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f"trainhub-adopted:{':'.join(identities)}")), 'status': 'active',
                       'startDate': start, 'endDate': end, 'source': 'adopted',
                       'rationale': (plan.get('season') or {}).get('rationale', ''), 'hinweise': [], 'blockIds': identities,
                       'createdAt': start}
    return result


def frame_hint(settings, profile):
    """The usual build-up up to the first A event in the plan, as a starting point for the AI."""
    first, total = plan_span(settings)
    event = next((e for e in a_events(profile) if e['startDate'] >= first.isoformat()), None)
    if event is None:
        return None
    weeks = min(total, (day_date(event['startDate']) - first).days // 7 + 1)
    return {'event': event['title'], 'weeks': weeks, 'segments': typical_season(weeks)}


def horizon_weeks(settings):
    """How many weeks ahead get sessions; three unless the athlete chose otherwise."""
    return (settings or {}).get('horizonWeeks') or HORIZON


def horizon(weeks, today, count=HORIZON):
    """The weeks plan creation works out: count weeks from the plan start or the running week, whichever is later."""
    current = iso_week(today - timedelta(days=today.weekday()))
    return [week for week in weeks if week >= current][:count]


def reference_monday(mode, now, planned, reviewed):
    """First of the three weeks that should be worked out at this moment; None when only the athlete triggers it.

    Sunday mode moves on from Sunday 18:00. After-review mode moves on with the review of a week, without it on
    Monday 06:00; a week without plan has no review to wait for."""
    if mode not in SHIFT:
        return None
    moment = now + SHIFT[mode]
    monday = moment.date() - timedelta(days=moment.weekday())
    current = now.date() - timedelta(days=now.weekday())
    while mode == 'afterReview' and monday <= current and (iso_week(monday) in reviewed or iso_week(monday) not in planned):
        monday += timedelta(weeks=1)
    return monday


def due_weeks(weeks, planned, reference, today, count=HORIZON):
    """The outlined weeks to work out so the count weeks from reference are ready, in order; a missing running week first."""
    current = today - timedelta(days=today.weekday())
    wanted = {iso_week(current)} | {iso_week(reference + timedelta(weeks=index)) for index in range(count)}
    return [week for week in sorted(wanted) if week >= iso_week(current) and week in weeks and week not in planned]


def due_week(weeks, planned, reference, today, count=HORIZON):
    """The next outlined week to work out so the count weeks from reference are ready; a missing running week first."""
    return next(iter(due_weeks(weeks, planned, reference, today, count)), None)


def replan_date(monday, count=HORIZON):
    """Rolling replanning reaches a week on the Sunday evening before the first week of its horizon."""
    return monday - timedelta(weeks=count - 1, days=1)


def required_tests(profile):
    return [TESTS[sport] for sport in TESTS
            if sport in profile['goal']['sports'] and (profile['thresholds'].get(sport) or {}).get('source') == 'test']


def check_tests(sessions, tests):
    missing = [test for test in tests if not any(s['template'] == test for s in sessions)]
    if missing:
        raise CoachError(f'Die erste Planwoche braucht {" und ".join(TEST_NAMES[t] for t in missing)}, '
                         'weil „Testen lassen“ gewählt ist.')


def deviation(review, planned_hours, completed_hours):
    """Why a finished week was strongly off plan (sick, injured, far less training), or None."""
    reasons = set((review or {}).get('reasons', []))
    for reason in ('sick', 'injured'):
        if reason in reasons:
            return reason
    if planned_hours and completed_hours is not None and completed_hours < planned_hours * DEVIATION_SHARE:
        return 'lessTraining'
    return None


def group_sessions(profile, week, first_day):
    """Group sessions of the availability windows in this week, as fixed calendar workouts.

    Skipped before first_day, on event days, for sports without calendar workouts and where an exception
    leaves less time than the session takes."""
    monday = week_start(week)
    limits = effective_availability(profile, week)
    event_days = {(day_date(e['startDate']) + timedelta(days=n)).isoformat() for e in profile['events']
                  for n in range((day_date(e['endDate']) - day_date(e['startDate'])).days + 1)}
    result = []
    for window in profile['availability']['windows']:
        group = window['group']
        if not group or window['kind'] != 'available' or group['sport'] not in GROUP_SPORTS:
            continue
        day = monday + timedelta(days=DAYS.index(window['day']))
        minutes = minutes_of(window['to']) - minutes_of(window['from'])
        if day < first_day or day.isoformat() in event_days or (limits[window['day']]['maxMinutes'] or 0) < minutes:
            continue
        note = group['note'].strip()
        notes = f"Fester Termin {window['from']}–{window['to']} Uhr · {GROUP_INTENSITY[group['intensity']]}" + (f' · {note}' if note else '')
        result.append({
            # Stable per window and day, so planning a week twice never doubles the session.
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f"trainhub-group:{window['id']}:{day.isoformat()}")),
            'workout': {'version': 1, 'name': 'Gruppentraining', 'sport': group['sport'], 'date': day.isoformat(),
                        # A FIT note holds at most 250 bytes.
                        'notes': notes.encode('utf-8')[:250].decode('utf-8', 'ignore').strip(),
                        'steps': [{'kind': 'step', 'name': 'Gruppentraining', 'duration': {'type': 'time', 'value': minutes * 60},
                                   'intensity': 'interval' if group['intensity'] == 'hard' else 'active', 'target': {'type': 'none'}}]},
            'group': {'sport': group['sport'], 'intensity': group['intensity'], 'note': note,
                      'from': window['from'], 'to': window['to']}})
    return result


# --- Manual phase edits ---------------------------------------------------------------------

PHASE_EDIT_SCHEMA = obj({
    'phases': {'type': 'array', 'minItems': 1, 'maxItems': 520, 'items': obj({
        'id': text(80, True), 'blockType': {'type': 'string', 'enum': SELECTABLE}, 'weeks': num(1, 520, integer=True)})},
    'taperWeeks': num(1, 3, True, True)})
# Volume of the load weeks in a cycle relative to the block's level, the deload week and the taper weeks before the event.
LOAD_STEPS = (1, 1.05, 1.1)
DELOAD_SHARE = .65
TAPER_SHARES = {1: [.55], 2: [.7, .5], 3: [.75, .6, .45]}
TRANSITION_SHARE = .5


def _half_hours(value):
    return max(0.0, int(value * 2 + 1e-9) / 2)


def outline_weeks(identity, length, level, caps, preferred=None):
    """Phase and target hours of a block, from fixed rules: the 3:1 rhythm of the catalog, load weeks rising inside a
    cycle, deload at 65 %, the taper falling towards the event. caps holds the available hours per week."""
    spec = BLOCK_TYPES[identity]
    rhythm = suggested_rhythm(length, identity)
    weeks, position = [], 0
    for index, deload in enumerate(rhythm):
        if identity == 'taper':
            shares = TAPER_SHARES.get(length) or [max(.4, .75 - .1 * i) for i in range(length)]
            hours, phase = level * shares[index], 'taper'
        elif identity == 'uebergang':
            hours, phase = level * TRANSITION_SHARE, 'recovery'
        elif deload:
            hours, phase, position = level * DELOAD_SHARE, 'recovery', 0
        else:
            hours, phase = level * LOAD_STEPS[min(position, len(LOAD_STEPS) - 1)], LOAD_PHASES.get(identity, 'build')
            position += 1
        if spec['maxPreferredShare'] and preferred:
            hours = min(hours, preferred * spec['maxPreferredShare'])
        weeks.append({'week': index + 1, 'phase': phase, 'targetHours': _half_hours(min(hours, caps[index])), 'focus': ''})
    return weeks


def _level(block):
    """The usual load-week volume of a block (its deload and taper weeks left out)."""
    load = [w['targetHours'] for w in block['weeks'] if w['phase'] not in ('recovery', 'taper') and w['targetHours']]
    hours = load or [w['targetHours'] for w in block['weeks'] if w['targetHours']]
    return max(hours) if hours else None


def anchored_events(settings, profile):
    """A events inside the plan with the index of their plan week; the phase before each one ends in that week."""
    first, total = plan_span(settings)
    return [(event, (day_date(event['startDate']) - first).days // 7) for event in a_events(profile)
            if 0 <= (day_date(event['startDate']) - first).days // 7 < total]


def edit_phases(plan, profile, data, today, caps, base_hours):
    """Applies the athlete's own phase list, deterministic and without AI.

    Every plan week needs exactly one phase; weeks before the running week stay as they were. Unchanged phases keep
    their weeks (also when moved), new or resized ones get an outline from fixed rules. The phase that ends in an A-event
    week stays fixed to the event and, with taperWeeks, is a taper of that length. caps(monday) gives the available hours
    of a week, base_hours the volume for a new phase without neighbours. Returns (blocks, frame block ids, changed weeks)."""
    settings, frame = plan['settings'], plan['frame']
    first, total = plan_span(settings)
    phases = data['phases']
    weeks = sum(p['weeks'] for p in phases)
    if weeks != total:
        missing = total - weeks
        raise CoachError(f'{missing} {"Woche bleibt" if missing == 1 else "Wochen bleiben"} ohne Block. Bitte einen Block '
                         'verlängern oder hinzufügen.' if missing > 0 else
                         f'Die Blöcke sind {-missing} {"Woche" if missing == -1 else "Wochen"} länger als der Plan. '
                         'Bitte einen Block verkürzen oder entfernen.')
    old = {b['id']: b for b in plan['blocks'] if b['id'] in frame['blockIds']}
    current = max(0, min(total, (today - timedelta(days=today.weekday()) - first).days // 7))

    def owners(items):
        """Per plan week the owning phase id and its week number."""
        result = []
        for item in items:
            result += [(item['id'], number) for number in range(1, len(item['weeks']) + 1)] if 'startDate' in item \
                else [(item['id'], number) for number in range(1, item['weeks'] + 1)]
        return result

    before = owners(sorted(old.values(), key=lambda b: b['startDate']))
    after = owners(phases)
    if before[:current] != after[:current]:
        raise CoachError('Vergangene Wochen bleiben, wie sie waren. Bitte nur die Blöcke ab dieser Woche ändern.')
    seen = [p['id'] for p in phases if p['id']]
    if len(seen) != len(set(seen)) or any(identity not in old for identity in seen):
        raise CoachError('Ein Block kommt doppelt vor oder gehört nicht zu diesem Plan.')
    taper = data.get('taperWeeks')
    starts, start = [], 0
    for phase in phases:
        starts.append(start)
        start += phase['weeks']
    for event, week in anchored_events(settings, profile):
        index = next(i for i, s in enumerate(starts) if s <= week < s + phases[i]['weeks'])
        phase = phases[index]
        if starts[index] + phase['weeks'] - 1 != week or phase['blockType'] not in FINAL_TYPES:
            raise CoachError(f'Vor „{event["title"]}“ endet ein Taper oder Wettkampfspezifisch in der Woche des Events; '
                             'das Event bleibt an seinem Datum.')
        if taper and (phase['blockType'] != 'taper' or phase['weeks'] != taper):
            raise CoachError(f'Vor „{event["title"]}“ steht ein Taper von {taper} {"Woche" if taper == 1 else "Wochen"}.')
    for index, phase in enumerate(phases):
        if phase['blockType'] in FINAL_TYPES and not any(starts[index] <= week for _, week in anchored_events(settings, profile)):
            raise CoachError(f'„{BLOCK_TYPES[phase["blockType"]]["name"]}“ gibt es nur vor einem A-Event.')
    # Outlines: kept phases keep their weeks, others follow the rules; the level comes from the phase itself or its neighbours.
    blocks, levels = [], {}
    for index, phase in enumerate(phases):
        previous = old.get(phase['id'])
        if previous and previous['blockType'] == phase['blockType']:
            levels[index] = _level(previous)
    for index, phase in enumerate(phases):
        monday = first + timedelta(weeks=starts[index])
        week_caps = [caps(monday + timedelta(weeks=n)) for n in range(phase['weeks'])]
        previous = old.get(phase['id'])
        same = previous and previous['blockType'] == phase['blockType']
        if same and len(previous['weeks']) == phase['weeks']:
            weeks_out = [{**w, 'targetHours': _half_hours(min(w['targetHours'], week_caps[n]))} if w['targetHours'] > week_caps[n] else
                         dict(w) for n, w in enumerate(previous['weeks'])]
        else:
            neighbours = [levels.get(i) for i in (index - 1, index + 1) if 0 <= i < len(phases)]
            level = levels.get(index) if phase['blockType'] != 'taper' else next((n for n in neighbours if n), None)
            level = level or next((n for n in neighbours if n), None) or base_hours
            weeks_out = outline_weeks(phase['blockType'], phase['weeks'], level, week_caps, preferred_hours(profile, monday))
            if same:
                # Weeks that are already over keep their outline.
                elapsed = max(0, min(phase['weeks'], current - starts[index]))
                weeks_out[:elapsed] = [dict(w) for w in previous['weeks'][:elapsed]]
            levels.setdefault(index, _level({'weeks': weeks_out}))
        identity = phase['id'] or str(uuid.uuid5(uuid.NAMESPACE_URL, f"trainhub-phase:{frame['id']}:{monday.isoformat()}:"
                                                                     f"{phase['blockType']}:{phase['weeks']}"))
        kept = same and previous['weeks'] == weeks_out and previous['startDate'] == monday.isoformat()
        block = new_block(phase['blockType'], previous.get('secondaryFocus') if same else None, monday.isoformat(), weeks_out,
                          source=previous['source'] if kept else 'athlete', key=identity,
                          formats=previous.get('formats', ()) if same else ())
        block.update(purpose=previous.get('purpose', '') if same else '', review=previous.get('review') if same else None)
        blocks.append(block)
    changed = [iso_week(first + timedelta(weeks=n)) for n in range(total)
               if _outline_at(old.values(), first + timedelta(weeks=n)) != _outline_at(blocks, first + timedelta(weeks=n))]
    others = [b for b in plan['blocks'] if b['id'] not in frame['blockIds']]
    return others + blocks, [b['id'] for b in blocks], changed


def _outline_at(blocks, monday):
    for block in blocks:
        start = day_date(block['startDate'])
        if start <= monday <= day_date(block['endDate']):
            week = block['weeks'][(monday - start).days // 7] if (monday - start).days // 7 < len(block['weeks']) else {}
            return block['blockType'], week.get('phase'), week.get('targetHours')
    return None
