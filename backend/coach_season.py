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
