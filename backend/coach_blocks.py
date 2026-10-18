"""Training blocks: a fixed catalog of block types and the rules TrainHub enforces.

The AI (or the athlete) picks a block type and an optional secondary focus; the
catalog owns lengths, the load/deload rhythm and which templates a week may use.
Block rules check the weekly outline, week rules check the templates of one
planned week. Deload weeks (phase recovery or taper) are exempt from minimums.
"""
import copy
import uuid
from datetime import timedelta

from coach_domain import (BLOCK_WEEKS_SCHEMA, HINWEISE_SCHEMA, CoachError, day_date, iso_week, obj, preferred_hours, text,
                          week_start)
from coach_templates import TEMPLATES, flat_steps

DELOAD_PHASES = {'recovery', 'taper'}
MAX_LOAD_STREAK = 3
# Quality sessions of a load week when the block type sets no maximum; a C race replaces one of them.
USUAL_QUALITY = 2
# Days after an event with only easy training, per handling.
EASY_DAYS_AFTER = {'miniTaper': 2, 'trainThrough': 2, 'replaceHard': 1, 'easy': 0}
SHORT_QUALITY_MINUTES = 75

_SPORT = {sport: {key for key, spec in TEMPLATES.items() if spec['sport'] == sport} for sport in ('ride', 'run')}
# Race-pace runs (also a long run with race-pace blocks) are tempo work: they count toward the quality and threshold-work
# limits.
_TEMPO = {'bike_tempo', 'bike_sweetspot', 'run_long_mp', 'run_tempo'}
_THRESHOLD = {'bike_threshold', 'bike_threshold_intervals', 'run_threshold'}
_VO2 = {'bike_vo2', 'bike_vo2_micro', 'run_vo2', 'run_vo2_short'}
GROUPS = {
    'easy': {'bike_recovery', 'bike_z2', 'bike_z2_short', 'bike_z2_long', 'bike_z2_sprints', 'bike_long', 'run_easy', 'run_long',
             'run_strides', 'run_hill_sprints', 'run_drills'},
    'tempo': _TEMPO,
    'threshold': _THRESHOLD,
    'thresholdWork': _TEMPO | _THRESHOLD,
    'vo2': _VO2,
    'sprint': {'bike_sit'},
    'quality': _TEMPO | _THRESHOLD | _VO2 | {'bike_sit'},
    # Threshold tests are hard but fit into every block; they do not count toward the quality limits.
    'test': {'bike_ftp_test', 'run_test_30'},
    'hard': _TEMPO | _THRESHOLD | _VO2 | {'bike_sit', 'bike_ftp_test', 'run_test_30'},
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
           ends_by_goal=False, deload_only=False, guidance='', selectable=True):
    return {'name': name, 'summary': summary, 'defaultWeeks': default, 'minWeeks': low, 'maxWeeks': high,
            'forbidden': list(forbidden), 'maxPerWeek': max_per_week or {}, 'minPerLoadWeek': min_per_load_week or {},
            'easyShare': easy_share, 'lastWeekDeload': last_week_deload, 'rhythm': rhythm, 'taperDrop': taper_drop,
            'maxPreferredShare': max_preferred_share, 'endsByGoal': ends_by_goal, 'deloadOnly': deload_only,
            'guidance': guidance, 'selectable': selectable}


BLOCK_TYPES = {
    'wiedereinstieg': _block('Wiedereinstieg', 'Nach einer Pause behutsam Umfang und Routine aufbauen.', 3, 2, 4,
                             forbidden=('vo2', 'threshold', 'sprint'), max_per_week={'tempo': 1},
                             guidance='Start below recent volume and increase gradually, mostly easy endurance. Lengthen the '
                                      'longest easy ride week by week; short sprints inside easy rides (bike_z2_sprints) are fine.'),
    'grundlage': _block('Grundlage', 'Aerobe Basis mit viel lockerem Umfang.', 8, 6, 12,
                        forbidden=('vo2',), max_per_week={'quality': 1}, easy_share=.8,
                        guidance='Volume focus: easy endurance is the foundation. Progress the long easy ride across the block '
                                 '(for example 1:30 -> 2:00 -> 2:30 -> 3:00 h). At most one tempo, sweetspot or SIT session. '
                                 'Keep neuromuscular power with short sprints inside easy rides: in two of every four weeks '
                                 '(every other week, for example weeks 1, 3, 5 ...) exactly one easy ride of about 1:30 h is '
                                 'bike_z2_sprints with 6 s sprints, progressing across the block (for example 8x6 s -> 10x6 s -> '
                                 '12x6 s); the other weeks have no sprints. These sprint rides count as easy, not as quality.'),
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
                              'session. Runners do the same with run_vo2 (for example 5x3 -> 6x3 -> 5x4 -> 6x4 min) and '
                              'run_vo2_short (for example 2x8x30/30 -> 2x10x30/30 -> 3x6x60/60), with easy runs and the long '
                              'run in between; a VO2 session counts for the sport it is done in.'),
    'wettkampfspezifisch': _block('Wettkampfspezifisch', 'Wettkampfbelastungen üben und frisch am Start stehen.', 4, 2, 12,
                                  taper_drop=.3, ends_by_goal=True,
                                  guidance='Rehearse race demands with long rides at race intensity and race-like efforts '
                                           '(for example 4x16 min at tempo or threshold inside a long ride), then taper; keep short '
                                           'intense touches during the taper. The last week must end in the goal week. For ultra '
                                           'or multi-day goals (for example NorthCape 4000) progress back-to-back weekends instead of '
                                           'one ever longer ride: long easy rides on Saturday and Sunday (for example 5+4 h -> '
                                           '6+5 h -> 8+6 h, single rides up to 15 h), steady pacing and fueling as on race day, '
                                           'an easy or rest day after each pair.'),
    # Taper right before the goal: a short block after Wettkampfspezifisch, only lighter weeks.
    'taper': _block('Taper', 'Vor dem Wettkampf Umfang senken und frisch werden, kurze intensive Reize bleiben.', 1, 1, 3,
                    max_per_week={'quality': 2}, rhythm=False, max_preferred_share=.7, ends_by_goal=True, deload_only=True,
                    guidance='Every week has phase taper. Cut volume clearly below the weeks before (about 40-60 % less) '
                             'while keeping short race-pace or VO2 touches with full recovery (for example 3x3 min or '
                             'a few 30 s efforts) so the legs stay sharp; no long threshold work. The last week must end '
                             'in the goal week.'),
    'uebergang': _block('Übergang', 'Aktive Erholung nach der Saison oder einem Höhepunkt.', 2, 1, 4,
                        forbidden=('quality',), last_week_deload=False, rhythm=False, max_preferred_share=.6,
                        guidance='Only recovery, easy endurance, strength or rest; well below usual volume.'),
    # Former macro plans become custom blocks without type rules; it cannot be chosen for a new block.
    'custom': _block('Eigener Block', 'Aus einem früheren Makroplan übernommen.', None, 1, 52,
                     last_week_deload=False, rhythm=False, selectable=False),
}
# Running plans (run without ride among the goal sports) follow the week TrainHub lays out (coach_runs.run_week): one key
# session, a long run and short easy runs. The block minimums made for two hard rides per week then ask for one.
RUN_GUIDANCE = {
    'general': 'Running plan: runWeek is the week TrainHub lays out for it (days, the key session along its progression, '
               'the long run and the easy runs with their durations). One key session per week, the long run at the '
               'weekend as the longest run (with three run days about 40 % of the week), the other runs easy and short '
               '(30-60 min), one of them with strides, in base blocks with Lauf-ABC (run_drills) in turn and hill sprints '
               'only about every fourth week. The long run follows runWeek: it grows by at most 15 min per load week and '
               'never takes up hours the other runs cannot hold (the server rejects a longer one). No easy run is longer '
               'than 60 minutes or the long run. Deload weeks keep this shape with an easier key session and a shorter long '
               'run. Jogging recoveries: threshold 1-2 min, VO2 2-3 min. Strides (run_strides), Lauf-ABC (run_drills) and '
               'hill sprints (run_hill_sprints) are easy runs, not quality.',
    'wiedereinstieg': 'Easy runs only, strides from the second week; lengthen the long run gradually.',
    'grundlage': 'Key session: short reps just below threshold pace (run_threshold, for example 6x2 -> 5x3 -> 5x4 -> 4x5 min '
                 'with 1-2 min jog), so the threshold block can start at 3x8 min; one easy run with Lauf-ABC or strides in '
                 'turn, hill sprints about every fourth week; the long run grows week by week.',
    'aufbau': 'Key session alternating threshold (3x8 -> 3x10 min) and VO2 (5x3 -> 5x4 min).',
    'vo2max': 'Key session run_vo2 with 800-1000 m reps (about 3-4 min) and 2-3 min jog, progressing 5x3 -> 6x3 -> 5x4 -> '
              '6x4 min; deload weeks keep a shorter VO2 session.',
    'schwelle': 'Key session: threshold reps 3x8 -> 3x10 -> 3x12 min with 2 min jog, later 4x10 and 2x15 -> 2x20 min; '
                'progress time at threshold toward about 40 min, not pace.',
    'wettkampfspezifisch': 'Half marathon and marathon: key session long threshold reps; a second run with a race-pace '
                           'block (run_tempo) and every other long run with race-pace blocks at its end (run_long_mp). '
                           '5 and 10 km: key session reps at race pace (run_tempo), easy runs with strides. The last big '
                           'specific long run about 3 weeks before the race.',
    'taper': 'Volume falls clearly; the key session becomes short race-pace work (run_tempo, for example 3x8 min, in race '
             'week 3x3 min) plus strides; the long run shortens, in race week the race replaces it.',
    'uebergang': 'Easy runs, cross-training or rest only.',
}


EASY_RUNS = {'run_easy', 'run_strides', 'run_hill_sprints', 'run_drills'}
LONG_RUNS = {'run_long', 'run_long_mp'}
# An easy run lasts up to an hour; a longer one is the long run of its week (and is named so).
EASY_RUN_MINUTES = 60


def easy_runs_too_long(sessions):
    """Ids of easy runs over an hour in a running plan."""
    return {s['id'] for s in sessions if s['template'] in EASY_RUNS and (s['rendered']['durationMin'] or 0) > EASY_RUN_MINUTES + 0.01}


def runs_over_long_run(sessions):
    """Ids of runs (easy runs and key sessions) longer than the week's longest long run (none without a long run)."""
    longest = max((s['rendered']['durationMin'] or 0 for s in sessions if s['template'] in LONG_RUNS), default=None)
    if longest is None:
        return set()
    return {s['id'] for s in sessions if s['template'] in GROUPS['run'] - LONG_RUNS
            and (s['rendered']['durationMin'] or 0) > longest + 0.01}


def run_focus(sports):
    """Whether the plan is a running plan: run without ride among the goal sports."""
    return 'run' in sports and 'ride' not in sports


# Running plans may start with a shorter base, so a 14-week half-marathon plan still has room for a threshold block.
RUN_MIN_WEEKS = {'grundlage': 4}


def min_weeks(identity, sports=()):
    spec = block_type(identity)
    return RUN_MIN_WEEKS.get(identity, spec['minWeeks']) if run_focus(sports) else spec['minWeeks']


def block_guidance(identity, sports):
    spec = block_type(identity)
    if not run_focus(sports):
        return spec['guidance']
    return f"{RUN_GUIDANCE['general']} {RUN_GUIDANCE.get(identity, '')}".strip()


def minimum_per_load_week(spec, sports):
    return {group: min(n, 1) for group, n in spec['minPerLoadWeek'].items()} if run_focus(sports) else spec['minPerLoadWeek']


SECONDARY_FOCUS = {
    'kraft': {'name': 'Kraft', 'group': 'strength'},
    'laufen': {'name': 'Laufen', 'group': 'run'},
    'radfahren': {'name': 'Radfahren', 'group': 'ride'},
}


# Interval formats of the workout library (keyed by its family id) that a template can build. The athlete picks
# formats for a block; every session of that kind in the block then uses one of them, with these params fixed.
# The coach still decides repetitions, sets, intensity and progression.
_vo2 = lambda name, work, rest: {'name': name, 'blockTypes': ['vo2max'], 'template': 'bike_vo2',
                                 'params': {'workMin': work, 'recoveryMin': rest}}
_micro = lambda name, work, rest: {'name': name, 'blockTypes': ['vo2max'], 'template': 'bike_vo2_micro',
                                   'params': {'workSec': work, 'restSec': rest}}
INTERVAL_FORMATS = {
    'ride-vo2-3': _vo2('VO2max 3 min', 3, 3),
    'ride-vo2-4': _vo2('VO2max 4 min', 4, 4),
    'ride-vo2-5': _vo2('VO2max 5 min', 5, 5),
    'ride-vo2-6': _vo2('VO2max 6 min', 6, 5),
    'ride-vo2-11': _micro('VO2max 1/1', 60, 60),
    'ride-vo2-3015': _micro('VO2max 30/15', 30, 15),
    'ride-vo2-4020': _micro('VO2max 40/20', 40, 20),
    'ride-vo2-4515': _micro('VO2max 45/15', 45, 15),
    'ride-vo2-2010': _micro('VO2max 20/10', 20, 10),
    'ride-vo2-1515': _micro('VO2max 15/15', 15, 15),
}


def interval_formats(identities):
    """The chosen formats as the AI sees them."""
    return [{'id': key, **{k: copy.deepcopy(INTERVAL_FORMATS[key][k]) for k in ('name', 'template', 'params')}} for key in identities]


def check_formats(identity, formats):
    if len(set(formats)) != len(formats) or any(identity not in INTERVAL_FORMATS.get(key, {}).get('blockTypes', ())
                                                for key in formats):
        raise CoachError('Bitte nur Intervallformen wählen, die zu diesem Blocktyp passen.')


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


def rule_texts(identity, sports=()):
    """German, human-readable rules; also shown to the AI as block guidance."""
    spec = block_type(identity)
    texts = [f"{min_weeks(identity, sports)}–{spec['maxWeeks']} Wochen"]
    texts += [f"Keine {GROUP_NAMES[group]}" for group in spec['forbidden']]
    texts += [f"Höchstens {n}× {GROUP_NAMES[group]} pro Woche" for group, n in spec['maxPerWeek'].items()]
    texts += [f"Mindestens {n}× {GROUP_NAMES[group]} pro Belastungswoche" for group, n in minimum_per_load_week(spec, sports).items()]
    if spec['easyShare']:
        texts.append(f"Mindestens {round(spec['easyShare'] * 100)} % der Rad-/Laufzeit locker (Z1–2)")
    if spec['rhythm']:
        texts.append(f'Höchstens {MAX_LOAD_STREAK} Belastungswochen am Stück')
    if spec['deloadOnly']:
        texts.append('Jede Woche Entlastung (Taper)')
    elif spec['lastWeekDeload']:
        texts.append('Letzte Woche Entlastung')
    if spec['taperDrop']:
        texts.append(f"Letzte Woche mindestens {round(spec['taperDrop'] * 100)} % weniger Umfang")
    if spec['maxPreferredShare']:
        texts.append(f"Höchstens {round(spec['maxPreferredShare'] * 100)} % des Wunschumfangs")
    if spec['endsByGoal']:
        texts.append('Endet spätestens in der Woche des Zieldatums')
    return texts


def catalog(sports=()):
    return {'blockTypes': [{'id': key, 'name': spec['name'], 'summary': spec['summary'], 'defaultWeeks': spec['defaultWeeks'],
                            'minWeeks': min_weeks(key, sports), 'maxWeeks': spec['maxWeeks'], 'endsByGoal': spec['endsByGoal'],
                            'rules': rule_texts(key, sports),
                            'suggestedRhythm': suggested_rhythm(spec['defaultWeeks'], key),
                            'rhythms': {str(n): suggested_rhythm(n, key) for n in range(min_weeks(key, sports), spec['maxWeeks'] + 1)},
                            'formats': [f for f, value in INTERVAL_FORMATS.items() if key in value['blockTypes']]}
                           for key, spec in BLOCK_TYPES.items() if spec['selectable']],
            'secondaryFocus': [{'id': key, 'name': value['name']} for key, value in SECONDARY_FOCUS.items()]}


def suggested_rhythm(weeks, identity):
    """Load/deload pattern as booleans (True = deload): 3:1, shorter cycles for short blocks."""
    spec = block_type(identity)
    if spec['deloadOnly']:
        return [True] * weeks
    if not spec['rhythm']:
        return [False] * weeks
    cycles = -(-weeks // (MAX_LOAD_STREAK + 1))
    sizes = [weeks // cycles + (1 if i < weeks % cycles else 0) for i in range(cycles)]
    return [position == size - 1 for size in sizes for position in range(size)]


def check_choice(identity, secondary, weeks, *, start, profile):
    """An athlete's own block choice, checked before any paid provider call."""
    if identity not in SELECTABLE:
        raise CoachError('Bitte einen Blocktyp aus dem Katalog wählen.')
    spec, low = BLOCK_TYPES[identity], min_weeks(identity, profile['goal']['sports'])
    if not isinstance(weeks, int) or not low <= weeks <= spec['maxWeeks']:
        raise CoachError(f"Ein Block „{spec['name']}“ dauert {low}–{spec['maxWeeks']} Wochen.")
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


def check_block(identity, secondary, weeks, *, start, profile, max_streak=MAX_LOAD_STREAK, rhythm_rules=True):
    """Outline rules: length, rhythm, taper and volume caps. Raises CoachError.

    Without rhythm_rules the load/deload rhythm stays unchecked: the phases of a plan get it over block boundaries
    from the server, and the athlete may choose their own."""
    spec = block_type(identity)
    if secondary is not None and secondary not in SECONDARY_FOCUS:
        raise CoachError('Unbekannter Nebenschwerpunkt.')
    if secondary == 'kraft' and not profile['preferences']['gymAvailability']:
        raise CoachError('Kraft als Nebenschwerpunkt benötigt die hinterlegte Krafttraining-Verfügbarkeit.')
    if secondary == 'laufen' and 'run' not in profile['goal']['sports']:
        raise CoachError('Laufen als Nebenschwerpunkt braucht Laufen bei deinen Sportarten im Profil.')
    name, low = spec['name'], min_weeks(identity, profile['goal']['sports'])
    if not low <= len(weeks) <= spec['maxWeeks']:
        raise CoachError(f"Ein Block „{name}“ dauert {low}–{spec['maxWeeks']} Wochen.")
    in_goal_week = False
    if spec['endsByGoal']:
        goal = profile['goal']['date']
        if not goal:
            raise CoachError(f'Für einen Block „{name}“ bitte ein Zieldatum im Profil speichern.')
        goal_day = day_date(goal)
        # Blocks run Monday to Sunday, so an event on a Saturday still ends its block that week.
        last_day = start + timedelta(weeks=len(weeks)) - timedelta(days=1)
        if last_day > goal_day + timedelta(days=6 - goal_day.weekday()):
            raise CoachError(f'Der Block „{name}“ muss spätestens in der Woche des Zieldatums enden.')
        in_goal_week = last_day >= goal_day - timedelta(days=goal_day.weekday())
    deloads = [w['phase'] in DELOAD_PHASES for w in weeks]
    if spec['deloadOnly'] and not all(deloads):
        raise CoachError(f'Im Block „{name}“ ist jede Woche eine Entlastungswoche.')
    if rhythm_rules and spec['lastWeekDeload'] and not deloads[-1]:
        raise CoachError(f'Ein Block „{name}“ endet mit einer Entlastungswoche.')
    if rhythm_rules and spec['rhythm']:
        streak = 0
        for deload in deloads:
            streak = 0 if deload else streak + 1
            if streak > max_streak:
                raise CoachError(f'Nach höchstens {max_streak} Belastungswochen folgt eine Entlastungswoche.')
    # The taper of a race-specific block is its race week; before an own taper block it ends like any block.
    if spec['taperDrop'] and len(weeks) > 1 and in_goal_week:
        peak = max(w['targetHours'] for w in weeks[:-1])
        if weeks[-1]['targetHours'] > peak * (1 - spec['taperDrop']) + 1e-9:
            raise CoachError(f"Die letzte Woche braucht mindestens {round(spec['taperDrop'] * 100)} % weniger Umfang.")
    for w in weeks if spec['maxPreferredShare'] else []:
        preferred = preferred_hours(profile, start + timedelta(weeks=w['week'] - 1))
        if preferred is not None and w['targetHours'] > preferred * spec['maxPreferredShare'] + 1e-9:
            raise CoachError(f"Ein Block „{name}“ bleibt unter {round(spec['maxPreferredShare'] * 100)} % des Wunschumfangs.")


def check_week_rules(block, block_week, sessions, replaced=0, sports=()):
    """Template rules for one planned week of a block; replaced counts C races that replace a hard session, sports are the
    goal sports (a running plan needs one key session per week). Raises CoachError."""
    spec = block_type(block['blockType'])
    name = spec['name']
    templates = [s['template'] for s in sessions]
    count = lambda group: sum(t in GROUPS[group] for t in templates)
    deload = block_week['phase'] in DELOAD_PHASES
    if replaced:
        allowed = max(0, spec['maxPerWeek'].get('quality', USUAL_QUALITY) - replaced)
        if count('quality') > allowed:
            raise CoachError(f'Das C-Rennen ersetzt eine harte Einheit: höchstens {allowed}× {GROUP_NAMES["quality"]} in dieser Woche.')
    for group in spec['forbidden']:
        if count(group):
            raise CoachError(f'Im Block „{name}“ ist keine {GROUP_NAMES[group]} vorgesehen.')
    for group, maximum in spec['maxPerWeek'].items():
        if count(group) > maximum:
            raise CoachError(f'Im Block „{name}“ höchstens {maximum}× {GROUP_NAMES[group]} pro Woche.')
    if not deload:
        for group, minimum in minimum_per_load_week(spec, sports).items():
            if count(group) < minimum - replaced:
                raise CoachError(f'Im Block „{name}“ mindestens {minimum}× {GROUP_NAMES[group]} pro Belastungswoche.')
        focus = SECONDARY_FOCUS.get(block.get('secondaryFocus'))
        if focus and not count(focus['group']):
            raise CoachError(f"Der Nebenschwerpunkt {focus['name']} braucht mindestens eine {GROUP_NAMES[focus['group']]} pro Belastungswoche.")
    formats = [INTERVAL_FORMATS[key] for key in block.get('formats', [])]
    for template in {f['template'] for f in formats}:
        allowed = [f['params'] for f in formats if f['template'] == template]
        if any(s['template'] == template and not any(all(s['params'].get(k) == v for k, v in p.items()) for p in allowed)
               for s in sessions):
            raise CoachError(f"Im Block „{name}“ nur die gewählten Intervallformen: {', '.join(f['name'] for f in formats)}.")
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


def check_event_rules(events, sessions, changed):
    """Rules around events for the sessions of one week; only new or changed sessions (ids in changed) can fail."""
    def day(session):
        return day_date(session['rendered']['date'])
    for event in events:
        start, end, name = day_date(event['startDate']), day_date(event['endDate']), event['title']
        after = EASY_DAYS_AFTER.get(event['handling'], 0)
        for session in (s for s in sessions if s['id'] in changed and s['template'] != 'rest'):
            if start <= day(session) <= end:
                raise CoachError(f'Am Tag von „{name}“ plant der Coach keine weitere Einheit.')
            if event['handling'] == 'miniTaper' and day(session) == start - timedelta(days=1) \
                    and session['template'] in GROUPS['hard']:
                raise CoachError(f'Mini-Taper: am Tag vor „{name}“ keine harte Einheit.')
            if end < day(session) <= end + timedelta(days=after) and session['template'] not in GROUPS['easy']:
                raise CoachError(f'Nach „{name}“ {"einen Tag" if after == 1 else f"{after} Tage"} nur locker.')
        if event['handling'] == 'miniTaper':
            taper = [s for s in sessions if s['template'] in GROUPS['hard'] and start - timedelta(days=3) <= day(s) < start]
            if any(s['id'] in changed for s in taper) and \
                    (len(taper) > 1 or any((s['rendered']['durationMin'] or 0) > SHORT_QUALITY_MINUTES for s in taper)):
                raise CoachError(f'Mini-Taper: in den 3 Tagen vor „{name}“ höchstens eine kurze Qualitätseinheit '
                                 f'(bis {SHORT_QUALITY_MINUTES} min).')


# --- Stored blocks -------------------------------------------------------------------------

def _end(start, weeks):
    return (day_date(start) + timedelta(weeks=weeks) - timedelta(days=1)).isoformat()


def new_block(identity, secondary, start, weeks, source='aiRecommendation', key=None, formats=()):
    block = {'id': key or str(uuid.uuid4()), 'blockType': identity, 'secondaryFocus': secondary, 'status': 'active',
             'startDate': start, 'endDate': _end(start, len(weeks)), 'weeks': weeks, 'review': None, 'source': source}
    return block | ({'formats': list(formats)} if formats else {})


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
