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

from coach_blocks import (BLOCK_TYPES, DELOAD_PHASES, SECONDARY_FOCUS, SELECTABLE, check_block, new_block,
                          suggested_rhythm)
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
# rebuildAll works every worked-out week out anew, also without a changed setting.
ADAPT_SCHEMA = obj({'changes': {'type': 'array', 'uniqueItems': True, 'items': {'enum': ADAPT_AREAS}},
                    'later': {'type': 'boolean'}, 'rebuildAll': {'type': 'boolean'}})
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
        # The rhythm comes from shape_volume over block boundaries.
        check_block(identity, phase['secondaryFocus'], phase['weeks'], start=start, profile=goal_profile(profile, goal),
                    rhythm_rules=False)
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


# --- Load/deload rhythm up to each A event ---------------------------------------------------------

# The taper the cycles leave room for when the athlete lets the coach decide.
DEFAULT_TAPER_WEEKS = 2


def cycle_lengths(weeks):
    """Cycles of three load weeks and one deload week filling weeks, counted backwards from the end, so the peak is the
    last load week before the final deload. Leftover weeks go to the start: one makes the first cycle 4:1, two the first
    two cycles (two 2:1 cycles in a short plan), three an extra 2:1 cycle. Each cycle ends with its deload week."""
    if weeks <= 0:
        return []
    count, rest = divmod(weeks, 4)
    if rest == 0:
        return [4] * count
    if rest == 3:
        return [3] + [4] * count
    if rest == 1:
        return [5] + [4] * (count - 1) if count else [1]
    return [5, 5] + [4] * (count - 2) if count >= 2 else [3, 3] if count else [2]


def frame_cycles(settings, profile):
    """Per A event of the plan the cycles before its taper in plan weeks from 1, as the starting point for the AI."""
    taper = settings.get('taperWeeks') or DEFAULT_TAPER_WEEKS
    result, start = [], 0
    for event, week in anchored_events(settings, profile):
        cycles = []
        for size in cycle_lengths(week - taper + 1 - start):
            cycles.append({'fromWeek': start + 1, 'toWeek': start + size, 'loadWeeks': size - 1, 'deloadWeek': start + size})
            start += size
        result.append({'event': event['title'], 'eventWeek': week + 1, 'taperWeeks': taper,
                       'peakWeek': cycles[-1]['deloadWeek'] - 1 if cycles and cycles[-1]['loadWeeks'] else None, 'cycles': cycles})
        start = week + 1
    return result


def align_frame(phases, settings, profile):
    """The phases of an AI frame on the cycles of cycle_lengths, so phase changes come after a deload week.

    Before each A event the phases with a rhythm cover whole cycles counted backwards from the taper; phases without one
    (taper, transition) keep their place and length. A stretch with more phases than cycles stays as the AI laid it out.
    Rhythm and hours of the weeks come from shape_volume afterwards."""
    spans, start = [], 0
    for phase in phases:
        spans.append((start, start + len(phase['weeks'])))
        start += len(phase['weeks'])
    entries = [(phase['blockType'], week) for phase in phases for week in phase['weeks']]
    result = copy.deepcopy(phases)
    rhythmic = lambda index: BLOCK_TYPES[phases[index]['blockType']]['rhythm']
    begin = 0
    for _, event_week in anchored_events(settings, profile):
        last = next((i for i, (low, high) in enumerate(spans) if low <= event_week < high), None)
        if last is None:
            continue
        indices = [i for i in range(last + 1) if spans[i][0] >= begin]
        while indices and not rhythmic(indices[0]):
            indices.pop(0)
        while indices and not rhythmic(indices[-1]):
            indices.pop()
        if indices and all(rhythmic(i) for i in indices):
            _align_stretch(result, [phases[i] for i in indices], indices, spans, entries)
        begin = spans[last][1]
    return result


def _align_stretch(result, stretch, indices, spans, entries):
    """Puts the phases of one stretch on whole cycles; a moved week keeps its outline only inside its own phase."""
    low, high = spans[indices[0]][0], spans[indices[-1]][1]
    sizes = cycle_lengths(high - low)
    if len(stretch) > len(sizes):
        return
    ends = [low + sum(sizes[:n + 1]) for n in range(len(sizes))]
    # Each boundary moves to the nearest cycle end that keeps the block length allowed, with a cycle left per later phase.
    chosen = []
    for n, phase in enumerate(stretch[:-1]):
        spec, first = BLOCK_TYPES[phase['blockType']], ends[chosen[-1]] if chosen else low
        options = range(chosen[-1] + 1 if chosen else 0, len(ends) - (len(stretch) - 1 - n))
        chosen.append(min(options, key=lambda c: (not spec['minWeeks'] <= ends[c] - first <= spec['maxWeeks'],
                                                  abs(ends[c] - spans[indices[n]][1]))))
    chosen.append(len(ends) - 1)
    start = low
    for n, phase in enumerate(stretch):
        identity, weeks = phase['blockType'], []
        for week in range(start, ends[chosen[n]]):
            source, entry = entries[week]
            same = source == identity
            weeks.append({'week': len(weeks) + 1, 'phase': entry['phase'] if same else LOAD_PHASES.get(identity, 'build'),
                          'targetHours': entry['targetHours'], 'focus': entry['focus'] if same else ''})
        result[indices[n]]['weeks'] = weeks
        start = ends[chosen[n]]


# --- Weekly volume: rhythm and hours up to each A event ----------------------------------------------

# Load weeks rise at most this much over the load week before; a cycle starts again at the level of the last one.
MAX_WEEKLY_RISE = 1.05
DELOAD_SHARE = .6
TAPER_STEP = .8
TRANSITION_SHARE = .5
VOLUME_SCALE = (.7, 1.3)
VOLUME_KINDS = ('load', 'deload')
# How far a worked-out week may miss the hours the athlete set for it.
ATHLETE_HOURS_TOLERANCE = .5


VOLUME_SCHEMA = obj({'scale': num(*VOLUME_SCALE), 'weeks': {'type': 'array', 'maxItems': 520, 'items': obj({
    'week': text(8), 'kind': {'enum': [None, *VOLUME_KINDS]}, 'hours': num(0, 80, True)})}})


def _hours_text(value):
    return f'{_below(value):g}'.replace('.', ',')


def check_volume(data, stored, settings, keep, defaults, caps):
    """The athlete's scale and own weeks, checked. Weeks that are over keep what they had; load or deload only where the
    rhythm runs (not in taper or transition weeks); own hours within the time of the week."""
    keys = plan_weeks(settings)
    weeks = {key: value for key, value in ((stored or {}).get('weeks') or {}).items() if key in keys[:keep]}
    for item in data['weeks']:
        if item['week'] not in keys:
            raise CoachError('Diese Woche gehört nicht zum Plan.')
        index = keys.index(item['week'])
        if index < keep or (item['kind'] is None and item['hours'] is None):
            continue
        if item['kind'] and defaults[index] not in VOLUME_KINDS:
            raise CoachError(f'Woche {index + 1}: Taper- und Übergangswochen bleiben, wie sie sind. Belastung oder Erholung '
                             'wählst du in den übrigen Phasen.')
        if item['hours'] is not None and item['hours'] > caps[index] + 1e-9:
            raise CoachError(f'Woche {index + 1}: Du hast höchstens {_hours_text(caps[index])} h Zeit.')
        weeks[item['week']] = {'kind': item['kind'], 'hours': item['hours']}
    return {**(stored or {}), 'scale': data['scale'], 'weeks': weeks}


def _quarter_hours(value):
    return max(0.0, int(value * 4 + .5) / 4)


def _below(value):
    """The quarter hour at or below value."""
    return max(0.0, int(value * 4 + 1e-9) / 4)


def week_kinds(types, settings, profile, chosen=None):
    """The kind of every plan week from its block type: load or deload in blocks with a rhythm, taper, transition
    (Übergang) or keep (own blocks from earlier plans keep their weeks).

    The default rhythm is 3:1, counted back from the end of each stretch of rhythm weeks (the week before the taper, the
    event week, the plan end) and running over block boundaries. chosen holds the athlete's own load or deload per week
    index; it wins and leaves the other weeks as they are."""
    events = {week for _, week in anchored_events(settings, profile)}
    kinds, runs, run = [None] * len(types), [], []
    for index, identity in enumerate(types):
        spec = BLOCK_TYPES[identity]
        if spec['rhythm']:
            run.append(index)
        else:
            kinds[index] = 'taper' if spec['deloadOnly'] else 'transition' if identity == 'uebergang' else 'keep'
        if run and (not spec['rhythm'] or index in events):
            runs.append(run)
            run = []
    if run:
        runs.append(run)
    for run in runs:
        position = 0
        for size in cycle_lengths(len(run)):
            for offset in range(size):
                kinds[run[position + offset]] = 'deload' if offset == size - 1 else 'load'
            position += size
    for index, kind in (chosen or {}).items():
        if kinds[index] in VOLUME_KINDS:
            kinds[index] = kind
    return kinds


def volume_curve(kinds, settings, profile, base, peak, caps):
    """Hours per plan week before the athlete's scale and own hours.

    Per stretch up to an A event (and after the last one up to the plan end) the first load week starts at the training
    base and the load weeks rise evenly, at most 5 % over the load week before, so the peak (the recommended peak week,
    within the time of that week) comes only with the last load week of the stretch. A load week after a deload starts
    again at the level of the last load week. Deloads take 60 % of the last load week, each taper week 80 % of the week
    before and a transition week half of the last level."""
    ends = sorted(week for _, week in anchored_events(settings, profile))
    stretches, low = [], 0
    for end in ends + [len(kinds) - 1]:
        if end >= low:
            stretches.append((low, end))
            low = end + 1
    result = [None] * len(kinds)
    for low, high in stretches:
        loads = [i for i in range(low, high + 1) if kinds[i] == 'load']
        rises = sum(1 for i in loads[1:] if kinds[i - 1] == 'load')
        target = min(peak, max(caps[i] for i in loads)) if loads and peak else base
        start = min(base, target)
        rate = min(MAX_WEEKLY_RISE, (target / start) ** (1 / rises)) if rises and start and target > start else 1
        level, previous = None, None
        for index in range(low, high + 1):
            kind = kinds[index]
            if kind == 'load':
                level = start if level is None else level * rate if kinds[index - 1] == 'load' else level
                hours = level
            elif kind == 'deload':
                hours = (level or start) * DELOAD_SHARE
            elif kind == 'taper':
                hours = (previous if previous is not None else level or start) * TAPER_STEP
            elif kind == 'transition':
                hours = (level or start) * TRANSITION_SHARE
            else:
                hours = None
            result[index] = previous = hours
    return result


def plan_volume(types, entries, settings, profile, caps, preferred, base, peak, volume=None, keep=0):
    """Kind, default kind, hours and suggested hours (without the athlete's own hours) of every plan week.

    volume holds the athlete's scale and own weeks ({week: {kind, hours}}); the first keep weeks are over and stay as
    they were, also for the rhythm the later weeks follow."""
    volume = volume or {}
    keys = plan_weeks(settings)
    own = {index: (volume.get('weeks') or {}).get(key) or {} for index, key in enumerate(keys)}
    defaults = week_kinds(types, settings, profile)
    past = {index: 'deload' if entries[index]['phase'] in DELOAD_PHASES else 'load' for index in range(min(keep, len(types)))}
    chosen = {**{index: item['kind'] for index, item in own.items() if item.get('kind')}, **past}
    kinds = week_kinds(types, settings, profile, chosen)
    curve = volume_curve(kinds, settings, profile, base, peak, caps)
    scale = volume.get('scale') or 1
    suggested, hours = [], []
    for index, kind in enumerate(kinds):
        if curve[index] is None:
            value = entries[index]['targetHours']
        else:
            value = _quarter_hours(curve[index] * scale)
            share = BLOCK_TYPES[types[index]]['maxPreferredShare']
            if share and preferred[index]:
                value = min(value, _below(preferred[index] * share))
        value = min(value, _below(caps[index]))
        suggested.append(value)
        athlete = own[index].get('hours')
        hours.append(entries[index]['targetHours'] if index < keep else
                     min(athlete, caps[index]) if athlete is not None else value)
    return {'kinds': kinds, 'defaults': defaults, 'hours': hours, 'suggested': suggested}


def shape_volume(phases, settings, profile, caps, preferred, base, peak, volume=None, keep=0):
    """Copies of the consecutive phases from the plan start (frame phases or blocks) with the kind and target hours of
    plan_volume in every week from index keep on. A week whose kind changes keeps no focus of its former kind."""
    types = [phase['blockType'] for phase in phases for _ in phase['weeks']]
    entries = [week for phase in phases for week in phase['weeks']]
    shape = plan_volume(types, entries, settings, profile, caps, preferred, base, peak, volume, keep)
    result, index = copy.deepcopy(phases), 0
    for phase in result:
        for week in phase['weeks']:
            kind = shape['kinds'][index]
            if index >= keep and kind != 'keep':
                was_deload = week['phase'] in DELOAD_PHASES
                name = 'taper' if kind == 'taper' else 'recovery' if kind in ('deload', 'transition') else \
                    week['phase'] if not was_deload else LOAD_PHASES.get(phase['blockType'], 'build')
                week.update(phase=name, targetHours=shape['hours'][index],
                            focus=week['focus'] if was_deload == (name in DELOAD_PHASES) else '')
            index += 1
    return result


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
TAPER_SHARES = {1: [.55], 2: [.7, .5], 3: [.75, .6, .45]}


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


def edit_phases(plan, profile, data, today, caps, base_hours, shape=None):
    """Applies the athlete's own phase list, deterministic and without AI.

    Every plan week needs exactly one phase; weeks before the running week stay as they were. New or resized phases get
    an outline from fixed rules; shape(blocks, keep) then puts the rhythm and hours of the whole plan on them (see
    shape_volume), so the 3:1 rhythm runs over the new block boundaries. The phase that ends in an A-event week stays
    fixed to the event and, with taperWeeks, is a taper of that length. caps(monday) gives the available hours of a week,
    base_hours the volume for a new phase without neighbours. Returns (blocks, frame block ids, changed weeks)."""
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
        block = new_block(phase['blockType'], previous.get('secondaryFocus') if same else None, monday.isoformat(), weeks_out,
                          source='athlete', key=identity, formats=previous.get('formats', ()) if same else ())
        block.update(purpose=previous.get('purpose', '') if same else '', review=previous.get('review') if same else None)
        blocks.append(block)
    shaped = shape(blocks, current) if shape else blocks
    for block, phase in zip(shaped, phases):
        previous = old.get(phase['id'])
        if previous and previous['blockType'] == block['blockType'] and previous['weeks'] == block['weeks'] \
                and previous['startDate'] == block['startDate']:
            block['source'] = previous['source']
    blocks = shaped
    changed = outline_changes(old.values(), blocks, settings)
    others = [b for b in plan['blocks'] if b['id'] not in frame['blockIds']]
    return others + blocks, [b['id'] for b in blocks], changed


def outline_changes(before, after, settings):
    """The plan weeks whose phase, kind or target hours differ between two lists of blocks."""
    first, total = plan_span(settings)
    return [iso_week(first + timedelta(weeks=n)) for n in range(total)
            if _outline_at(before, first + timedelta(weeks=n)) != _outline_at(after, first + timedelta(weeks=n))]


def _outline_at(blocks, monday):
    for block in blocks:
        start = day_date(block['startDate'])
        if start <= monday <= day_date(block['endDate']):
            week = block['weeks'][(monday - start).days // 7] if (monday - start).days // 7 < len(block['weeks']) else {}
            return block['blockType'], week.get('phase'), week.get('targetHours')
    return None
