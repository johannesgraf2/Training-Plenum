"""Season plan: the sequence of training blocks from now to the athlete's goal.

The AI proposes the sequence, the athlete may reorder or change it. TrainHub checks
that the blocks fill every week up to the goal week, that each block fits its type
and that the season ends with a race-specific block. Blocks that are already planned
stay fixed at the start. Only the next block is ever worked out in detail, through
the normal block flow; the season plan is a roadmap, not a commitment.
"""
import uuid
from datetime import timedelta

from coach_blocks import BLOCK_TYPES, SECONDARY_FOCUS, SELECTABLE, block_type
from coach_domain import HINWEISE_SCHEMA, CoachError, day_date, num, obj, text

MAX_SEGMENTS = 20
MAX_SEASON_WEEKS = 104
FINAL_TYPE = 'wettkampfspezifisch'
# Training philosophy for AI season plans: aerobic base, then raise the engine (VO2max) and lower VLamax
# at threshold, then race-specific. VO2max and Schwelle may swap. Aufbau and Übergang are no season stages.
SEASON_RANK = {'wiedereinstieg': 0, 'grundlage': 1, 'vo2max': 2, 'schwelle': 2, FINAL_TYPE: 3}
TYPICAL_SHARE = {'grundlage': .35, 'vo2max': .2, 'schwelle': .25, FINAL_TYPE: .2}

SEGMENT_SCHEMA = obj({
    'blockType': {'type': 'string', 'enum': SELECTABLE},
    'secondaryFocus': {'type': ['string', 'null'], 'enum': [*SECONDARY_FOCUS, None]},
    'weeks': num(1, 12, integer=True), 'purpose': text(200)})
SEASON_RESPONSE_SCHEMA = obj({
    'options': {'type': 'array', 'minItems': 1, 'maxItems': 3, 'items': obj({
        'id': text(40), 'recommended': {'type': 'boolean'}, 'rationale': text(400),
        'segments': {'type': 'array', 'minItems': 1, 'maxItems': MAX_SEGMENTS, 'items': SEGMENT_SCHEMA}})},
    'hinweise': HINWEISE_SCHEMA,
})
EDIT_SCHEMA = obj({'segments': {'type': 'array', 'minItems': 1, 'maxItems': MAX_SEGMENTS, 'items': SEGMENT_SCHEMA}})


def goal_monday(goal_date):
    goal = day_date(goal_date)
    return goal - timedelta(days=goal.weekday())


def _kept(blocks, today):
    """Current and upcoming blocks: they stay fixed at the start of the season."""
    return sorted((b for b in blocks if b['status'] != 'abandoned' and day_date(b['endDate']) >= today),
                  key=lambda b: b['startDate'])


def open_from(blocks, today):
    """First Monday that no current or upcoming block covers."""
    kept = _kept(blocks, today)
    return day_date(kept[-1]['endDate']) + timedelta(days=1) if kept else today + timedelta(days=(-today.weekday()) % 7)


def season_frame(blocks, goal_date, today):
    """Season start, the planned blocks that stay fixed and the weeks left for new blocks."""
    if not goal_date:
        raise CoachError('Für einen Saisonplan bitte ein Zieldatum im Athletenprofil speichern.')
    kept = _kept(blocks, today)
    fixed = [{'blockType': b['blockType'], 'secondaryFocus': b.get('secondaryFocus'), 'weeks': len(b['weeks']),
              'purpose': '', 'blockId': b['id']} for b in kept]
    start = day_date(kept[0]['startDate']) if kept else open_from(blocks, today)
    total = (goal_monday(goal_date) - start).days // 7 + 1
    if total > MAX_SEASON_WEEKS:
        raise CoachError(f'Ein Saisonplan reicht höchstens {MAX_SEASON_WEEKS} Wochen bis zum Ziel.')
    first_open = open_from(blocks, today)
    remaining = (goal_monday(goal_date) - first_open).days // 7 + 1
    if remaining < block_type(FINAL_TYPE)['minWeeks']:
        raise CoachError('Bis zum Ziel bleibt zu wenig Zeit für einen Saisonplan. Plane direkt einen wettkampfspezifischen Block.')
    return {'start': start, 'openFrom': first_open, 'totalWeeks': total, 'remainingWeeks': remaining, 'fixed': fixed}


def check_season(segments, frame, profile):
    """All season rules for the fixed blocks followed by the new ones."""
    fixed = frame['fixed']
    if len(segments) > len(fixed) + MAX_SEGMENTS:
        raise CoachError(f'Ein Saisonplan hat höchstens {MAX_SEGMENTS} neue Blöcke.')
    for index, segment in enumerate(segments[len(fixed):], start=len(fixed) + 1):
        identity = segment['blockType']
        if identity not in SELECTABLE:
            raise CoachError(f'Block {index}: Bitte einen Blocktyp aus dem Katalog wählen.')
        spec = BLOCK_TYPES[identity]
        if not spec['minWeeks'] <= segment['weeks'] <= spec['maxWeeks']:
            raise CoachError(f"Block {index}: „{spec['name']}“ dauert {spec['minWeeks']}–{spec['maxWeeks']} Wochen.")
        secondary = segment.get('secondaryFocus')
        if secondary is not None and secondary not in SECONDARY_FOCUS:
            raise CoachError(f'Block {index}: Unbekannter Nebenschwerpunkt.')
        if secondary == 'kraft' and not profile['preferences']['gymAvailability']:
            raise CoachError(f'Block {index}: Kraft als Nebenschwerpunkt benötigt die Krafttraining-Verfügbarkeit.')
    total = sum(segment['weeks'] for segment in segments)
    if total != frame['totalWeeks']:
        raise CoachError(f"Die Blöcke ergeben {total} Wochen, bis zur Zielwoche sind es {frame['totalWeeks']}.")
    if segments[-1]['blockType'] != FINAL_TYPE:
        raise CoachError('Der letzte Block vor dem Ziel ist wettkampfspezifisch.')


def typical_season(weeks, after=None):
    """Grundlage → VO2max → Schwelle → Wettkampfspezifisch with lengths filling exactly `weeks`.

    `after` is the last fixed block: stages before it are skipped unless the rest cannot fill the season. Short
    seasons drop stages from the front; seasons beyond every maximum get further base blocks."""
    rank = SEASON_RANK.get(after, -1)
    types = [t for t in TYPICAL_SHARE
             if SEASON_RANK[t] > rank or (SEASON_RANK[t] == rank and (t != after or t == 'grundlage'))]
    if not types or sum(BLOCK_TYPES[t]['maxWeeks'] for t in types) < weeks and 'grundlage' not in types:
        types = list(TYPICAL_SHARE)
    while len(types) > 1 and sum(BLOCK_TYPES[t]['minWeeks'] for t in types) > weeks:
        types.pop(0)
    share = sum(TYPICAL_SHARE[t] for t in types)
    low, high = (lambda t: BLOCK_TYPES[t]['minWeeks']), (lambda t: BLOCK_TYPES[t]['maxWeeks'])
    lengths = {t: min(max(round(weeks * TYPICAL_SHARE[t] / share), low(t)), high(t)) for t in types}
    while (diff := weeks - sum(lengths.values())) != 0:
        step = 1 if diff > 0 else -1
        candidates = [t for t in types if low(t) <= lengths[t] + step <= high(t)]
        if not candidates:
            break
        # Grow the stage furthest below its share, shrink the one furthest above.
        pick = (min if step > 0 else max)(candidates, key=lambda t: lengths[t] / TYPICAL_SHARE[t])
        lengths[pick] += step
    segments = [{'blockType': t, 'weeks': lengths[t]} for t in types]
    if diff > 0 and types[0] == 'grundlage':  # Every stage at its maximum: the base grows by further blocks.
        base = lengths['grundlage'] + diff
        count = -(-base // high('grundlage'))
        segments[:1] = [{'blockType': 'grundlage', 'weeks': base // count + (1 if i < base % count else 0)} for i in range(count)]
    return segments


def check_order(segments):
    """Order rules for the new blocks of AI season plans; the athlete may still arrange blocks freely."""
    seen, rank, previous = set(), -1, None
    for index, segment in enumerate(segments, start=1):
        identity = segment['blockType']
        name = BLOCK_TYPES[identity]['name']
        if identity not in SEASON_RANK:
            raise CoachError(f'Block {index}: „{name}“ gehört nicht in einen Saisonplan '
                             '(Grundlage → VO2max/Schwelle → Wettkampfspezifisch).')
        if SEASON_RANK[identity] < rank:
            raise CoachError(f'Block {index}: „{name}“ nach „{BLOCK_TYPES[previous]["name"]}“ – die Reihenfolge ist '
                             'Grundlage → VO2max/Schwelle → Wettkampfspezifisch.')
        if identity in seen and identity != previous:
            raise CoachError(f'Block {index}: „{name}“ kommt zweimal vor.')
        seen.add(identity)
        rank, previous = SEASON_RANK[identity], identity


def with_fixed(segments, frame):
    return [dict(item) for item in frame['fixed']] + \
        [{key: segment.get(key) for key in ('blockType', 'secondaryFocus', 'weeks', 'purpose')} for segment in segments]


def check_options(decision):
    options = decision['options']
    identities = [option['id'].strip() for option in options]
    if not all(identities) or len(set(identities)) != len(identities):
        raise CoachError('Die Optionen brauchen eindeutige IDs.')
    if not 2 <= len(options) <= 3:
        raise CoachError('Die AI muss zwei bis drei Saisonpläne vorschlagen.')
    if sum(option['recommended'] for option in options) != 1:
        raise CoachError('Genau ein Saisonplan muss als Empfehlung markiert sein.')


def new_season(segments, frame, goal_date, rationale, source):
    return {'id': str(uuid.uuid4()), 'goalDate': goal_date, 'startDate': frame['start'].isoformat(),
            'rationale': rationale, 'source': source, 'segments': segments}


def dated(season):
    """Segments with start and end dates; the season is consecutive from its start."""
    if not season:
        return []
    start, result = day_date(season['startDate']), []
    for segment in season['segments']:
        end = start + timedelta(weeks=segment['weeks']) - timedelta(days=1)
        result.append({**segment, 'startDate': start.isoformat(), 'endDate': end.isoformat(),
                       'typeName': BLOCK_TYPES[segment['blockType']]['name'],
                       'secondaryName': SECONDARY_FOCUS.get(segment.get('secondaryFocus'), {}).get('name')})
        start = end + timedelta(days=1)
    return result


def public_season(season, blocks, goal_date, today):
    """The stored season with dates and whether it still fits the planned blocks and the goal."""
    if not season:
        return None
    segments = dated(season)
    first_open = open_from(blocks, today)
    editable = [s for s in segments if day_date(s['startDate']) >= first_open]
    remaining = (goal_monday(goal_date) - first_open).days // 7 + 1 if goal_date else None
    aligned = bool(editable) and editable[0]['startDate'] == first_open.isoformat() and \
        sum(s['weeks'] for s in editable) == remaining
    return {**season, 'segments': segments, 'openFrom': first_open.isoformat(), 'remainingWeeks': remaining,
            'goalChanged': goal_date != season['goalDate'], 'aligned': aligned and goal_date == season['goalDate']}
