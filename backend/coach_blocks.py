"""Training blocks: a fixed catalog of block types and the rules TrainHub enforces.

The AI (or the athlete) picks a block type and an optional secondary focus; the
catalog owns lengths, the load/deload rhythm and which templates a week may use.
Block rules check the weekly outline, week rules check the templates of one
planned week. Deload weeks (phase recovery or taper) are exempt from minimums.
"""
import copy
import uuid
from datetime import timedelta

from coach_domain import BLOCK_WEEKS_SCHEMA, HINWEISE_SCHEMA, CoachError, day_date, iso_week, obj, text, week_start
from coach_templates import TEMPLATES, flat_steps

DELOAD_PHASES = {'recovery', 'taper'}
MAX_LOAD_STREAK = 3

_SPORT = {sport: {key for key, spec in TEMPLATES.items() if spec['sport'] == sport} for sport in ('ride', 'run')}
_TEMPO = {'bike_tempo', 'bike_sweetspot'}
_THRESHOLD = {'bike_threshold', 'bike_threshold_intervals', 'run_threshold'}
_VO2 = {'bike_vo2', 'bike_vo2_micro'}
GROUPS = {
    'easy': {'bike_recovery', 'bike_z2', 'bike_z2_short', 'bike_z2_long', 'bike_z2_sprints', 'bike_long', 'run_easy', 'run_long'},
    'tempo': _TEMPO,
    'threshold': _THRESHOLD,
    'thresholdWork': _TEMPO | _THRESHOLD,
    'vo2': _VO2,
    'sprint': {'bike_sit'},
    'quality': _TEMPO | _THRESHOLD | _VO2 | {'bike_sit'},
    'strength': {'strength_general'},
    'ride': _SPORT['ride'],
    'run': _SPORT['run'],
}
GROUP_NAMES = {
    'tempo': 'Tempo-/Sweetspot-Einheit', 'threshold': 'Schwelleneinheit', 'thresholdWork': 'Schwellen-/Sweetspot-Einheit',
    'vo2': 'VO2max-Einheit', 'sprint': 'Sprintintervall-Einheit (SIT)',
    'quality': 'Qualitätseinheit (Tempo, Sweetspot, Schwelle, VO2max, SIT)',
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
                             forbidden=('vo2', 'threshold', 'sprint'), max_per_week={'tempo': 1},
                             guidance='Start below recent volume and increase gradually, mostly easy endurance. Lengthen the '
                                      'longest easy ride week by week; short sprints inside easy rides (bike_z2_sprints) are fine.'),
    'grundlage': _block('Grundlage', 'Aerobe Basis mit viel lockerem Umfang.', 8, 6, 12,
                        forbidden=('vo2',), max_per_week={'quality': 1}, easy_share=.8,
                        guidance='Volume focus: easy endurance is the foundation. Progress the long easy ride across the block '
                                 '(for example 1:30 -> 2:00 -> 2:30 -> 3:00 h). At most one tempo, sweetspot or SIT session; '
                                 'keep neuromuscular power with sprints inside easy rides (bike_z2_sprints) or short SIT '
                                 '(4x30 s -> 6x30 s -> 8x30 s).'),
    'aufbau': _block('Aufbau', 'Umfang halten und die Intensität schrittweise steigern.', 6, 4, 12,
                     max_per_week={'vo2': 1}, min_per_load_week={'quality': 2},
                     guidance='Two quality sessions per load week plus a long easy ride. Progress work duration across the '
                              'block, for example sweetspot 3x12 -> 3x15 -> 2x20 min or VO2 4x4 -> 5x4 min; vary formats.'),
    'schwelle': _block('Schwelle', 'Leistung an der Schwelle verbessern.', 6, 4, 12,
                       max_per_week={'vo2': 1}, min_per_load_week={'thresholdWork': 2},
                       guidance='Two threshold or sweetspot sessions per load week plus a long easy ride. Extend time in zone '
                                'week by week (for example 3x10 -> 3x12 -> 3x15 -> 2x20 -> 4x16 min) rather than raising watts.'),
    'vo2max': _block('VO2max', 'Maximale aerobe Leistung mit kurzen, harten Intervallen.', 4, 3, 12,
                     max_per_week={'thresholdWork': 1}, min_per_load_week={'vo2': 2},
                     guidance='Concentrated VO2max stimulus on top of plenty of easy riding (1-3 h easy rides between the hard '
                              'days). Two VO2 sessions per load week, sometimes on nearby days. Progress accumulated time at high '
                              'oxygen uptake, not watts, along parallel chains: long intervals 5x3 -> 5x5 -> 5x6 or 6x5 min '
                              '(bike_vo2), micro intervals 3x9x30/15 -> 3x11x30/15 -> 3x13x30/15, later 3x10x40/20 '
                              '(bike_vo2_micro); vary formats (4x4, 5x5, 30/15, 40/20) week to week. High cadence (90-110 rpm) '
                              'suits VO2 work. Keep a short SIT or sprint touch every week or two. Deload weeks keep one short VO2 '
                              'session.'),
    'wettkampfspezifisch': _block('Wettkampfspezifisch', 'Wettkampfbelastungen üben und frisch am Start stehen.', 4, 2, 12,
                                  taper_drop=.3, ends_by_goal=True,
                                  guidance='Rehearse race demands with long rides at race intensity and race-like efforts '
                                           '(for example 4x16 min at tempo or threshold inside a long ride), then taper; keep short '
                                           'intense touches during the taper. The last week must end in the goal week.'),
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


SITUATIONS = {'nach_pause': 'Nach einer Pause', 'mitten_im_training': 'Mitten im Training', 'saison_vorbei': 'Saison vorbei'}
SELECTABLE = [key for key, spec in BLOCK_TYPES.items() if spec['selectable']]
BLOCK_RESPONSE_SCHEMA = obj({
    'options': {'type': 'array', 'minItems': 1, 'maxItems': 3, 'items': obj({
        'id': text(40), 'blockType': {'type': 'string', 'enum': SELECTABLE},
        'secondaryFocus': {'type': ['string', 'null'], 'enum': [*SECONDARY_FOCUS, None]},
        'recommended': {'type': 'boolean'}, 'rationale': text(400), 'weeks': BLOCK_WEEKS_SCHEMA})},
    'hinweise': HINWEISE_SCHEMA,
})


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
        texts.append('Endet spätestens in der Woche des Zieldatums')
    return texts


def catalog():
    return {'blockTypes': [{'id': key, 'name': spec['name'], 'summary': spec['summary'], 'defaultWeeks': spec['defaultWeeks'],
                            'minWeeks': spec['minWeeks'], 'maxWeeks': spec['maxWeeks'], 'rules': rule_texts(key),
                            'suggestedRhythm': suggested_rhythm(spec['defaultWeeks'], key),
                            'rhythms': {str(n): suggested_rhythm(n, key) for n in range(spec['minWeeks'], spec['maxWeeks'] + 1)}}
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


def check_choice(identity, secondary, weeks, *, start, profile):
    """An athlete's own block choice, checked before any paid provider call."""
    if identity not in SELECTABLE:
        raise CoachError('Bitte einen Blocktyp aus dem Katalog wählen.')
    spec = BLOCK_TYPES[identity]
    if not isinstance(weeks, int) or not spec['minWeeks'] <= weeks <= spec['maxWeeks']:
        raise CoachError(f"Ein Block „{spec['name']}“ dauert {spec['minWeeks']}–{spec['maxWeeks']} Wochen.")
    outline = [{'week': i + 1, 'phase': 'recovery' if deload else 'build', 'targetHours': 0, 'focus': ''}
               for i, deload in enumerate(suggested_rhythm(weeks, identity))]
    check_block(identity, secondary, outline, start=start, profile=profile)


def check_options(decision, mode, choice=None):
    """Shape of a block answer: 2–3 options with one recommendation, or exactly the chosen block."""
    options = decision['options']
    identities = [option['id'].strip() for option in options]
    if not all(identities) or len(set(identities)) != len(identities):
        raise CoachError('Die Optionen brauchen eindeutige IDs.')
    if mode == 'recommend':
        if not 2 <= len(options) <= 3:
            raise CoachError('Die AI muss zwei bis drei Optionen vorschlagen.')
        if sum(option['recommended'] for option in options) != 1:
            raise CoachError('Genau eine Option muss als Empfehlung markiert sein.')
    else:
        if len(options) != 1:
            raise CoachError('Für einen selbst gewählten Block wird genau eine Ausarbeitung erwartet.')
        option = options[0]
        if (option['blockType'], option['secondaryFocus'], len(option['weeks'])) !=                 (choice['blockType'], choice['secondaryFocus'], choice['weeks']):
            raise CoachError('Die AI-Antwort entspricht nicht dem gewählten Blocktyp, Nebenschwerpunkt oder der Länge.')
    for option in options:
        if [w['week'] for w in option['weeks']] != list(range(1, len(option['weeks']) + 1)):
            raise CoachError('Ein Trainingsblock muss alle Wochen lückenlos enthalten.')


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
        goal_day = day_date(goal)
        # Blocks run Monday to Sunday, so an event on a Saturday still ends its block that week.
        if start + timedelta(weeks=len(weeks)) - timedelta(days=1) > goal_day + timedelta(days=6 - goal_day.weekday()):
            raise CoachError('Der wettkampfspezifische Block muss spätestens in der Woche des Zieldatums enden.')
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
        endurance = [s for s in sessions if s['template'] in GROUPS['ride'] | GROUPS['run']]
        total = sum(s['rendered']['durationMin'] or 0 for s in endurance)
        # Only interval work is hard; warmup, recoveries and easy riding around the intervals count as easy.
        hard = sum(sum(step['duration']['value'] / 60 for step in flat_steps(s['rendered']['workout']['steps'])
                       if step['intensity'] == 'interval')
                   if s['rendered'].get('workout') else s['rendered']['durationMin'] or 0
                   for s in endurance if s['template'] not in GROUPS['easy'])
        if total and total - hard < total * spec['easyShare'] - 1e-9:
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
    """Returns blocks with the new range cleared; overlapping blocks end early as abandoned.

    Blocks that begin after the new range stay as they are, so a season can be laid out block by block."""
    end = start + timedelta(weeks=length) - timedelta(days=1)
    for week in sorted(planned_weeks):
        if iso_week(start) <= week <= iso_week(end):
            raise CoachError(f'In {week} ist bereits eine Woche geplant. Bitte einen Start nach dieser Woche wählen.')
    result = copy.deepcopy(blocks)
    replaced = []
    for block in result:
        first, last = day_date(block['startDate']), day_date(block['endDate'])
        if block['status'] == 'abandoned' or last < start or first > end:
            continue
        if any(end < week_start(week) <= last for week in planned_weeks):
            raise CoachError(f"Der Block überschneidet sich mit „{block_type(block['blockType'])['name']}“ "
                             f"ab {block['startDate']}, dort sind bereits Wochen geplant. Bitte diesen Block zuerst löschen.")
        block['status'] = 'abandoned'
        block['endDate'] = (start - timedelta(days=1)).isoformat()
        replaced.append(block['id'])
    return result, replaced


def public_blocks(blocks, today):
    return [{**block, 'status': block_status(block, today), 'typeName': block_type(block['blockType'])['name'],
             'secondaryName': SECONDARY_FOCUS.get(block.get('secondaryFocus'), {}).get('name')} for block in blocks]
