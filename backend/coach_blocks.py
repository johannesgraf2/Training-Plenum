"""Training blocks: a fixed catalog of block types and the rules TrainHub enforces.

The AI (or the athlete) picks a block type and an optional secondary focus; the
catalog owns lengths, the load/deload rhythm and which templates a week may use.
Block rules check the weekly outline, week rules check the templates of one
planned week. Deload weeks (phase recovery or taper) are exempt from minimums.
"""
import copy
import uuid
from datetime import timedelta

from coach_domain import CoachError, day_date, iso_week
from coach_templates import TEMPLATES

DELOAD_PHASES = {'recovery', 'taper'}
MAX_LOAD_STREAK = 3

_SPORT = {sport: {key for key, spec in TEMPLATES.items() if spec['sport'] == sport} for sport in ('ride', 'run')}
_TEMPO = {'bike_tempo', 'bike_sweetspot'}
_THRESHOLD = {'bike_threshold', 'bike_threshold_intervals', 'run_threshold'}
GROUPS = {
    'easy': {'bike_recovery', 'bike_z2', 'bike_z2_short', 'bike_z2_long', 'bike_long', 'run_easy', 'run_long'},
    'tempo': _TEMPO,
    'threshold': _THRESHOLD,
    'thresholdWork': _TEMPO | _THRESHOLD,
    'vo2': {'bike_vo2'},
    'quality': _TEMPO | _THRESHOLD | {'bike_vo2'},
    'strength': {'strength_general'},
    'ride': _SPORT['ride'],
    'run': _SPORT['run'],
}
GROUP_NAMES = {
    'tempo': 'Tempo-/Sweetspot-Einheit', 'threshold': 'Schwelleneinheit', 'thresholdWork': 'Schwellen-/Sweetspot-Einheit',
    'vo2': 'VO2max-Einheit', 'quality': 'Qualitätseinheit (Tempo, Sweetspot, Schwelle, VO2max)',
    'strength': 'Krafteinheit', 'ride': 'Radeinheit', 'run': 'Laufeinheit',
}


def _block(name, summary, default, low, high, *, forbidden=(), max_per_week=None, min_per_load_week=None,
           easy_share=None, last_week_deload=True, rhythm=True, taper_drop=None, max_preferred_share=None,
           ends_by_goal=False, guidance='', selectable=True):
    return {'name': name, 'summary': summary, 'defaultWeeks': default, 'minWeeks': low, 'maxWeeks': high,
            'forbidden': list(forbidden), 'maxPerWeek': max_per_week or {}, 'minPerLoadWeek': min_per_load_week or {},
            'easyShare': easy_share, 'lastWeekDeload': last_week_deload, 'rhythm': rhythm, 'taperDrop': taper_drop,
            'maxPreferredShare': max_preferred_share, 'endsByGoal': ends_by_goal, 'guidance': guidance,
            'selectable': selectable}


BLOCK_TYPES = {
    'wiedereinstieg': _block('Wiedereinstieg', 'Nach einer Pause behutsam Umfang und Routine aufbauen.', 3, 2, 4,
                             forbidden=('vo2', 'threshold'), max_per_week={'tempo': 1},
                             guidance='Start below recent volume, increase gradually, mostly easy endurance.'),
    'grundlage': _block('Grundlage', 'Aerobe Basis mit viel lockerem Umfang.', 8, 6, 12,
                        forbidden=('vo2',), max_per_week={'quality': 1}, easy_share=.8,
                        guidance='Volume focus, long easy sessions, at most one tempo or sweetspot session.'),
    'aufbau': _block('Aufbau', 'Umfang halten und die Intensität schrittweise steigern.', 6, 4, 8,
                     max_per_week={'vo2': 1}, min_per_load_week={'quality': 2},
                     guidance='Two quality sessions per load week, progress work duration across the block.'),
    'schwelle': _block('Schwelle', 'Leistung an der Schwelle verbessern.', 6, 4, 8,
                       max_per_week={'vo2': 1}, min_per_load_week={'thresholdWork': 2},
                       guidance='Two threshold or sweetspot sessions per load week, extend time in zone week by week.'),
    'vo2max': _block('VO2max', 'Maximale aerobe Leistung mit kurzen, harten Intervallen.', 4, 3, 6,
                     max_per_week={'thresholdWork': 1}, min_per_load_week={'vo2': 2},
                     guidance='Two VO2 sessions per load week, remaining time mostly easy; progress interval duration.'),
    'wettkampfspezifisch': _block('Wettkampfspezifisch', 'Wettkampfbelastungen üben und frisch am Start stehen.', 4, 2, 6,
                                  taper_drop=.3, ends_by_goal=True,
                                  guidance='Rehearse race demands, then taper; the last week must end by the goal date.'),
    'uebergang': _block('Übergang', 'Aktive Erholung nach der Saison oder einem Höhepunkt.', 2, 1, 4,
                        forbidden=('quality',), last_week_deload=False, rhythm=False, max_preferred_share=.6,
                        guidance='Only recovery, easy endurance, strength or rest; well below usual volume.'),
    # Former macro plans become custom blocks without type rules; it cannot be chosen for a new block.
    'custom': _block('Eigener Block', 'Aus einem früheren Makroplan übernommen.', None, 1, 52,
                     last_week_deload=False, rhythm=False, selectable=False),
}
SECONDARY_FOCUS = {
    'kraft': {'name': 'Kraft', 'group': 'strength'},
    'laufen': {'name': 'Laufen', 'group': 'run'},
    'radfahren': {'name': 'Radfahren', 'group': 'ride'},
}


def block_type(identity):
    if identity not in BLOCK_TYPES:
        raise CoachError('Unbekannter Blocktyp.')
    return BLOCK_TYPES[identity]


def rule_texts(identity):
    """German, human-readable rules; also shown to the AI as block guidance."""
    spec = block_type(identity)
    texts = [f"{spec['minWeeks']}–{spec['maxWeeks']} Wochen"]
    texts += [f"Keine {GROUP_NAMES[group]}" for group in spec['forbidden']]
    texts += [f"Höchstens {n}× {GROUP_NAMES[group]} pro Woche" for group, n in spec['maxPerWeek'].items()]
    texts += [f"Mindestens {n}× {GROUP_NAMES[group]} pro Belastungswoche" for group, n in spec['minPerLoadWeek'].items()]
    if spec['easyShare']:
        texts.append(f"Mindestens {round(spec['easyShare'] * 100)} % der Rad-/Laufzeit locker (Z1–2)")
    if spec['rhythm']:
        texts.append(f'Höchstens {MAX_LOAD_STREAK} Belastungswochen am Stück')
    if spec['lastWeekDeload']:
        texts.append('Letzte Woche Entlastung')
    if spec['taperDrop']:
        texts.append(f"Letzte Woche mindestens {round(spec['taperDrop'] * 100)} % weniger Umfang")
    if spec['maxPreferredShare']:
        texts.append(f"Höchstens {round(spec['maxPreferredShare'] * 100)} % des Wunschumfangs")
    if spec['endsByGoal']:
        texts.append('Endet spätestens am Zieldatum')
    return texts


def catalog():
    return {'blockTypes': [{'id': key, 'name': spec['name'], 'summary': spec['summary'], 'defaultWeeks': spec['defaultWeeks'],
                            'minWeeks': spec['minWeeks'], 'maxWeeks': spec['maxWeeks'], 'rules': rule_texts(key),
                            'suggestedRhythm': suggested_rhythm(spec['defaultWeeks'], key)}
                           for key, spec in BLOCK_TYPES.items() if spec['selectable']],
            'secondaryFocus': [{'id': key, 'name': value['name']} for key, value in SECONDARY_FOCUS.items()]}


def suggested_rhythm(weeks, identity):
    """Load/deload pattern as booleans (True = deload): 3:1, shorter cycles for short blocks."""
    spec = block_type(identity)
    if not spec['rhythm']:
        return [False] * weeks
    cycles = -(-weeks // (MAX_LOAD_STREAK + 1))
    sizes = [weeks // cycles + (1 if i < weeks % cycles else 0) for i in range(cycles)]
    return [position == size - 1 for size in sizes for position in range(size)]


def check_block(identity, secondary, weeks, *, start, profile):
    """Outline rules: length, rhythm, taper and volume caps. Raises CoachError."""
    spec = block_type(identity)
    if secondary is not None and secondary not in SECONDARY_FOCUS:
        raise CoachError('Unbekannter Nebenschwerpunkt.')
    if secondary == 'kraft' and not profile['preferences']['gymAvailability']:
        raise CoachError('Kraft als Nebenschwerpunkt benötigt die hinterlegte Krafttraining-Verfügbarkeit.')
    name = spec['name']
    if not spec['minWeeks'] <= len(weeks) <= spec['maxWeeks']:
        raise CoachError(f"Ein Block „{name}“ dauert {spec['minWeeks']}–{spec['maxWeeks']} Wochen.")
    if spec['endsByGoal']:
        goal = profile['goal']['date']
        if not goal:
            raise CoachError('Für einen wettkampfspezifischen Block bitte ein Zieldatum im Profil speichern.')
        if start + timedelta(weeks=len(weeks)) - timedelta(days=1) > day_date(goal):
            raise CoachError('Der wettkampfspezifische Block muss spätestens am Zieldatum enden.')
    deloads = [w['phase'] in DELOAD_PHASES for w in weeks]
    if spec['lastWeekDeload'] and not deloads[-1]:
        raise CoachError(f'Ein Block „{name}“ endet mit einer Entlastungswoche.')
    if spec['rhythm']:
        streak = 0
        for deload in deloads:
            streak = 0 if deload else streak + 1
            if streak > MAX_LOAD_STREAK:
                raise CoachError(f'Nach höchstens {MAX_LOAD_STREAK} Belastungswochen folgt eine Entlastungswoche.')
    if spec['taperDrop'] and len(weeks) > 1:
        peak = max(w['targetHours'] for w in weeks[:-1])
        if weeks[-1]['targetHours'] > peak * (1 - spec['taperDrop']) + 1e-9:
            raise CoachError(f"Die letzte Woche braucht mindestens {round(spec['taperDrop'] * 100)} % weniger Umfang.")
    preferred = profile['availability']['preferredWeeklyHours']
    if spec['maxPreferredShare'] and preferred is not None and \
            any(w['targetHours'] > preferred * spec['maxPreferredShare'] + 1e-9 for w in weeks):
        raise CoachError(f"Ein Block „{name}“ bleibt unter {round(spec['maxPreferredShare'] * 100)} % des Wunschumfangs.")


def check_week_rules(block, block_week, sessions):
    """Template rules for one planned week of a block. Raises CoachError."""
    spec = block_type(block['blockType'])
    name = spec['name']
    templates = [s['template'] for s in sessions]
    count = lambda group: sum(t in GROUPS[group] for t in templates)
    deload = block_week['phase'] in DELOAD_PHASES
    for group in spec['forbidden']:
        if count(group):
            raise CoachError(f'Im Block „{name}“ ist keine {GROUP_NAMES[group]} vorgesehen.')
    for group, maximum in spec['maxPerWeek'].items():
        if count(group) > maximum:
            raise CoachError(f'Im Block „{name}“ höchstens {maximum}× {GROUP_NAMES[group]} pro Woche.')
    if not deload:
        for group, minimum in spec['minPerLoadWeek'].items():
            if count(group) < minimum:
                raise CoachError(f'Im Block „{name}“ mindestens {minimum}× {GROUP_NAMES[group]} pro Belastungswoche.')
        focus = SECONDARY_FOCUS.get(block.get('secondaryFocus'))
        if focus and not count(focus['group']):
            raise CoachError(f"Der Nebenschwerpunkt {focus['name']} braucht mindestens eine {GROUP_NAMES[focus['group']]} pro Belastungswoche.")
    if spec['easyShare']:
        minutes = [(s['template'], s['rendered']['durationMin'] or 0) for s in sessions if s['template'] in GROUPS['ride'] | GROUPS['run']]
        total = sum(m for _, m in minutes)
        if total and sum(m for t, m in minutes if t in GROUPS['easy']) < total * spec['easyShare'] - 1e-9:
            raise CoachError(f"Im Block „{name}“ sind mindestens {round(spec['easyShare'] * 100)} % der Rad-/Laufzeit locker.")


# --- Stored blocks -------------------------------------------------------------------------

def _end(start, weeks):
    return (day_date(start) + timedelta(weeks=weeks) - timedelta(days=1)).isoformat()


def new_block(identity, secondary, start, weeks, source='aiRecommendation', key=None):
    return {'id': key or str(uuid.uuid4()), 'blockType': identity, 'secondaryFocus': secondary, 'status': 'active',
            'startDate': start, 'endDate': _end(start, len(weeks)), 'weeks': weeks, 'review': None, 'source': source}


def migrate_plan(plan):
    """Former single macro plan → list of blocks. Deterministic, so unsaved reads stay stable."""
    result = copy.deepcopy(plan)
    if 'blocks' not in result:
        macro = result.pop('macroPlan', None)
        result['blocks'] = []
        if macro and macro.get('weeks'):
            weeks = [{key: w[key] for key in ('week', 'phase', 'targetHours', 'focus')} for w in macro['weeks']]
            result['blocks'].append(new_block('custom', None, macro['startDate'], weeks,
                                               macro.get('source', 'aiRecommendation'), key=f"custom-{macro['startDate']}"))
    result.pop('macroPlan', None)
    return result


def block_status(block, today):
    if block['status'] == 'abandoned':
        return 'abandoned'
    return 'completed' if day_date(block['endDate']) < today else 'active'


def block_for_week(blocks, monday):
    """The block that owned this calendar week, including the run-time of a later abandoned block."""
    for block in blocks:
        if day_date(block['startDate']) <= monday <= day_date(block['endDate']):
            return block, (monday - day_date(block['startDate'])).days // 7 + 1
    return None, None


def place_block(blocks, planned_weeks, start, length):
    """Returns blocks with the new range cleared; overlapping blocks end early as abandoned."""
    end = start + timedelta(weeks=length) - timedelta(days=1)
    for week in sorted(planned_weeks):
        if iso_week(start) <= week <= iso_week(end):
            raise CoachError(f'In {week} ist bereits eine Woche geplant. Bitte einen Start nach dieser Woche wählen.')
    result = copy.deepcopy(blocks)
    replaced = []
    for block in result:
        if block['status'] != 'abandoned' and day_date(block['endDate']) >= start:
            block['status'] = 'abandoned'
            block['endDate'] = (start - timedelta(days=1)).isoformat()
            replaced.append(block['id'])
    return result, replaced


def public_blocks(blocks, today):
    return [{**block, 'status': block_status(block, today), 'typeName': block_type(block['blockType'])['name'],
             'secondaryName': SECONDARY_FOCUS.get(block.get('secondaryFocus'), {}).get('name')} for block in blocks]
