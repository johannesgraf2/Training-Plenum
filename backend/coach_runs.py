"""Running plans: the week TrainHub lays out for a running goal.

A running week has a fixed shape, as in classic half-marathon and marathon plans: one key session (for example on
Tuesday), a long run at the weekend and short easy runs in between, one of them with strides or, close to the race,
with a block at race pace. TrainHub picks the days, the key session along a progression per block type and the
durations from the week's target hours; the AI takes the week over and changes it only for feedback, check-ins,
complaints or events. Week after week the structure stays the same and only the work grows, e.g. 3×8 → 3×10 → 3×12 min
at threshold.
"""
from itertools import combinations

from coach_blocks import DELOAD_PHASES
from coach_domain import DAYS
from coach_templates import PACE_SLOPE, PARAM_NAMES, THRESHOLD_HR_FRACTION

SUBTYPE_KM = {'5k': 5, '10k': 10, 'halfMarathon': 21.1, 'marathon': 42.2}
# Longest long run per race distance in minutes.
LONG_CAP = {'short': 90, 'half': 120, 'marathon': 180, 'ultra': 210}
# Share of the week's running time in the long run, by the number of run days.
LONG_SHARE = {1: 1, 2: .55, 3: .44, 4: .37, 5: .32, 6: .28, 7: .25}
LONG_MIN = 60          # A long run in a load week lasts at least an hour (from half-marathon distance on).
LONG_RISE = 15         # Most a load week's long run grows over the one before.
DELOAD_LONG = .8       # A deload week's long run against the last load week's.
TAPER_LONG = (.75, .6)  # Long runs of the taper weeks before race week against the longest long run.
EASY_MIN, EASY_MAX = 30, 60  # An easy run over an hour would be a second long run.
KEY_MAX = 90
RACE_WEEK_KEY = 45
KEY_WEIGHT = 1.4       # The key session is longer than an easy run.
MIN_DAY_MINUTES = 30
# Race intensity (fraction of maximum heart rate, the run intensity scale of the templates) per distance without a
# target time, and the most a target time may ask for.
RACE_INTENSITY = {'5k': (.95, .97), '10k': (.92, .94), 'half': (.88, .90), 'marathon': (.83, .86), 'ultra': (.78, .82)}
FARTLEK_INTENSITY, THRESHOLD_INTENSITY, VO2_INTENSITY = .87, .89, .95

# Key-session progressions: (intervals, work minutes, jogging minutes) per load week of the block.
FARTLEK = [(6, 2, 1), (5, 3, 1), (6, 3, 1), (5, 4, 1), (4, 5, 2), (5, 5, 2), (4, 6, 2), (3, 8, 2)]
THRESHOLD = [(3, 8, 2), (3, 10, 2), (3, 12, 2), (4, 10, 2), (2, 15, 3), (2, 18, 3), (2, 20, 3), (3, 15, 3)]
VO2 = [(5, 3, 2), (6, 3, 2), (5, 4, 2), (6, 4, 3), (5, 5, 3), (6, 5, 3)]
SPECIFIC = {
    'short': ('run_tempo', [(5, 3, 2), (4, 5, 2), (5, 5, 2), (3, 8, 2)]),
    'half': ('run_threshold', [(2, 15, 3), (3, 12, 2), (2, 20, 3), (3, 15, 3)]),
    'marathon': ('run_threshold', [(3, 10, 2), (4, 10, 2), (3, 12, 2), (2, 20, 3)]),
}
# The race-pace run beside the key session, and the race-pace blocks at the end of every other long run.
SPECIFIC_TEMPO = {'half': [(2, 8, 2), (2, 10, 2), (3, 8, 2), (2, 12, 2)],
                  'marathon': [(1, 20, 2), (1, 25, 2), (1, 30, 2), (1, 35, 2)]}
SPECIFIC_LONG = {'half': [(1, 15, 5), (1, 20, 5), (2, 12, 5), (1, 25, 5)],
                 'marathon': [(1, 30, 10), (2, 20, 10), (1, 45, 10), (2, 30, 10), (1, 60, 10)]}
TAPER_KEY = {'short': [(3, 5, 2), (3, 2, 2)], 'half': [(3, 8, 2), (3, 3, 2)], 'marathon': [(2, 15, 3), (3, 5, 2)]}


def distance_class(event):
    """short (up to 10 km), half, marathon or ultra; None without an event."""
    if not event:
        return None
    km = event.get('distanceKm') or SUBTYPE_KM.get(event.get('subtype'))
    if km is None:
        return 'ultra' if event.get('subtype') == 'ultra' else 'half'
    return 'short' if km <= 12 else 'half' if km <= 25 else 'marathon' if km <= 45 else 'ultra'


def race_intensity(event, threshold_pace):
    """Race pace on the run intensity scale: from the target time and the threshold pace when both are known, else the
    usual value for the distance."""
    km = (event or {}).get('distanceKm') or SUBTYPE_KM.get((event or {}).get('subtype'))
    key = '5k' if km and km <= 6 else '10k' if km and km <= 12 else distance_class(event) or 'half'
    usual, fastest = RACE_INTENSITY[key]
    if km and event.get('targetSeconds') and threshold_pace:
        speed = threshold_pace / (event['targetSeconds'] / km)
        return round(min(fastest, max(.78, THRESHOLD_HR_FRACTION + (speed - 1) / PACE_SLOPE)), 3)
    return usual


def _round5(minutes):
    return int(minutes / 5 + .5) * 5


def _gap(a, b):
    """Days from a forward to b."""
    return (DAYS.index(b) - DAYS.index(a)) % 7 or 7


def _long_day(available, long_days):
    preferred = [d for d in available if d in long_days and available[d] >= LONG_MIN] or \
        [d for d in available if d in long_days]
    pool = preferred or list(available)
    return max(pool, key=lambda d: (available[d] >= LONG_MIN, d in ('sat', 'sun'), available[d], DAYS.index(d)))


def choose_days(available, count, long_days=(), rest_days=()):
    """The run days: the long day, the key day and the easy days, spread as evenly as possible.

    available maps usable days to their minutes. The key day is the first day at least two days after the long run."""
    count = min(count, len(available))
    if count <= 0:
        return None
    long = _long_day(available, long_days)
    others = [d for d in DAYS if d in available and d != long]

    def score(combo):
        chosen = sorted((long, *combo), key=DAYS.index)
        gaps = [_gap(a, b) for a, b in zip(chosen, chosen[1:] + chosen[:1])] if len(chosen) > 1 else [7]
        return (-sum(d in rest_days for d in combo), min(gaps), -sum(g * g for g in gaps))

    combo = max(combinations(others, count - 1), key=score, default=())
    if not combo:
        return {'long': long, 'key': None, 'easy': []}
    after = sorted(combo, key=lambda d: _gap(long, d))
    key = next((d for d in after if _gap(long, d) >= 2), after[-1])
    easy = [d for d in DAYS if d in combo and d != key]
    return {'long': long, 'key': key, 'easy': easy}


def _params(**values):
    return {**dict.fromkeys(PARAM_NAMES), **values}


def _intervals_session(template, step, intensity, minutes=None):
    intervals, work, rest = step
    return {'template': template,
            'params': _params(intervals=intervals, workMin=work, recoveryMin=rest, intensity=intensity, durationMin=minutes)}


def minimum_minutes(session):
    """Shortest duration of an interval session: warmup, work, jogging and cooldown (10 min after a long run's blocks)."""
    p = session['params']
    if p.get('intervals') is None:
        return p.get('durationMin') or 0
    cooldown = 10 if session['template'] == 'run_long_mp' else 5
    return 10 + p['intervals'] * p['workMin'] + (p['intervals'] - 1) * p['recoveryMin'] + cooldown + \
        (20 if session['template'] == 'run_long_mp' else 0)


def _step(chain, index):
    return chain[max(0, min(index, len(chain) - 1))]


def _easier(step):
    """A deload version of a key-session step: one repetition fewer, shorter repetitions from two down."""
    intervals, work, rest = step
    return (intervals - 1, work, rest) if intervals > 2 else (intervals, max(2, round(work * .6)), rest)


def key_session(block_type, load_index, deload, distance, race, *, taper_index=None, intervals_known=True):
    """The key session of the week, or None (Wiedereinstieg, Übergang)."""
    index = load_index - 1
    pick = (lambda chain: _easier(_step(chain, index))) if deload else (lambda chain: _step(chain, index))
    if block_type == 'taper':
        chain = TAPER_KEY['short' if distance == 'short' else 'marathon' if distance in ('marathon', 'ultra') else 'half']
        return _intervals_session('run_tempo', _step(chain, taper_index or 0), race)
    if block_type == 'grundlage':
        if not intervals_known and load_index <= 2 and not deload:
            return {'template': 'run_hill_sprints', 'params': _params(reps=6, workSec=10)}
        return _intervals_session('run_threshold', pick(FARTLEK), FARTLEK_INTENSITY)
    if block_type == 'schwelle':
        return _intervals_session('run_threshold', pick(THRESHOLD), THRESHOLD_INTENSITY)
    if block_type == 'vo2max':
        return _intervals_session('run_vo2', pick(VO2), VO2_INTENSITY)
    if block_type == 'aufbau':
        if load_index % 2:
            index = load_index // 2
            step = _step(THRESHOLD, index)
            return _intervals_session('run_threshold', _easier(step) if deload else step, THRESHOLD_INTENSITY)
        index = load_index // 2 - 1
        step = _step(VO2, index)
        return _intervals_session('run_vo2', _easier(step) if deload else step, VO2_INTENSITY)
    if block_type == 'wettkampfspezifisch':
        template, chain = SPECIFIC['marathon' if distance in ('marathon', 'ultra') else distance or 'half']
        return _intervals_session(template, pick(chain), race if template == 'run_tempo' else THRESHOLD_INTENSITY)
    return None


def run_week(block_type, block_weeks, number, target_hours, available, *, training_days=None, long_days=(), rest_days=(),
             event=None, race_day=None, threshold_pace=None, previous_long=None, longest_long=None, intervals_known=True):
    """The week pattern of a running plan: sessions in the schema of a week answer plus each session's role.

    block_weeks are the block's weeks (phase per week), number the week in the block, available the usable days with
    their minutes (no elapsed, event or fixed-session days), training_days the run days the athlete wants, race_day the day
    of the A event when it falls in this week, previous_long the last load week's long run and longest_long the longest
    long run so far (minutes). None for blocks without a running pattern."""
    if block_type == 'custom':
        return None
    phase = block_weeks[number - 1]['phase']
    deload = phase in DELOAD_PHASES and block_type != 'taper'
    load_index = max(1, sum(w['phase'] not in DELOAD_PHASES for w in block_weeks[:number]))
    distance = distance_class(event)
    race = race_intensity(event, threshold_pace)
    total = round(target_hours * 60)
    if race_day:
        # Race week: nothing on and after the race day, a rest day before it; the race replaces the long run.
        before = DAYS.index(race_day) - 1
        available = {d: m for d, m in available.items() if DAYS.index(d) < before}
    available = {d: m for d, m in available.items() if m >= MIN_DAY_MINUTES}
    count = training_days or min(len(available), 4)
    if race_day:
        count = min(count - 1, 3) if training_days else min(count, 2)  # The race is a run day of its own.
    # Race week has the short race-pace session of the taper, whatever block it belongs to.
    key = key_session('taper' if race_day else block_type, load_index, deload, distance, race,
                      taper_index=1 if race_day else 0, intervals_known=intervals_known)
    cap = LONG_CAP.get(distance, 120)
    for days in range(count, 0, -1):
        chosen = choose_days(available, days, long_days, rest_days)
        if chosen is None:
            return None
        if race_day:
            # The key session as early as possible, the easy runs closer to the race.
            ordered = [d for d in DAYS if d in (chosen['long'], chosen['key'], *chosen['easy'])]
            chosen = {'long': None, 'key': ordered[0] if key else None, 'easy': ordered[1:] if key else ordered}
        elif key is None and chosen['key']:
            chosen = {**chosen, 'key': None, 'easy': sorted([*chosen['easy'], chosen['key']], key=DAYS.index)}
        sessions = _durations(chosen, key, total, days, available, cap=cap, deload=deload, block_type=block_type,
                              distance=distance, race=race, load_index=load_index, number=number,
                              previous_long=previous_long, longest_long=longest_long, race_week=bool(race_day))
        if sessions is not None:
            return {'sessions': sessions, 'totalHours': round(sum(s['minutes'] for s in sessions) / 60, 2),
                    'racePaceIntensity': race if distance else None}
    return None


def _durations(chosen, key, total, days, available, *, cap, deload, block_type, distance, race, load_index, number,
               previous_long, longest_long, race_week):
    """Sessions with durations, or None when the easy runs would get too short for this many run days."""
    result = []
    long_minutes = 0
    if chosen['long']:
        long_minutes = _round5(total * LONG_SHARE[min(days, 7)])
        if not deload and block_type not in ('taper', 'uebergang', 'wiedereinstieg') and distance in ('half', 'marathon', 'ultra') \
                and total >= 2 * LONG_MIN:
            long_minutes = max(long_minutes, LONG_MIN)
        if previous_long:
            long_minutes = min(long_minutes, _round5(previous_long * DELOAD_LONG) if deload else previous_long + LONG_RISE)
        if block_type == 'taper' and longest_long:
            long_minutes = min(long_minutes, _round5(longest_long * TAPER_LONG[min(number, len(TAPER_LONG)) - 1]))
        if block_type == 'uebergang':
            long_minutes = min(long_minutes, 60)
        long_minutes = max(EASY_MIN, min(long_minutes, cap, available[chosen['long']]))
    rest = total - long_minutes
    easy_days = list(chosen['easy'])
    key_minutes = 0
    if chosen['key'] and key:
        floor = -(-minimum_minutes(key) // 5) * 5
        share = rest if not easy_days else rest * KEY_WEIGHT / (KEY_WEIGHT + len(easy_days))
        key_minutes = max(floor, min(_round5(share), RACE_WEEK_KEY if race_week else KEY_MAX, available[chosen['key']]))
        if floor > available[chosen['key']]:
            return None
    easy_limit = EASY_MAX
    if long_minutes:
        easy_limit = min(easy_limit, max(EASY_MIN, long_minutes - 10))
    easy_minutes = _round5((total - long_minutes - key_minutes) / len(easy_days)) if easy_days else 0
    if easy_days and easy_minutes < EASY_MIN and days > 1:
        return None
    easy_minutes = max(EASY_MIN, min(easy_minutes, easy_limit)) if easy_days else 0
    if race_week:
        easy_minutes = EASY_MIN

    specific = block_type == 'wettkampfspezifisch' and not deload and not race_week and distance in ('half', 'marathon', 'ultra')
    tempo_chain = SPECIFIC_TEMPO.get('marathon' if distance == 'ultra' else distance)
    # The special easy day (strides, hill sprints or the race-pace run) lies furthest from the key and the long run.
    anchors = [d for d in (chosen['key'], chosen['long']) if d]
    special = max(easy_days, key=lambda d: (min((min(_gap(a, d), _gap(d, a)) for a in anchors), default=0),
                                            -DAYS.index(d)), default=None)
    if race_week:
        special = easy_days[-1] if easy_days else None
    for day in DAYS:
        if day == chosen['long']:
            session = {'template': 'run_long' if long_minutes >= 45 else 'run_easy',
                       'params': _params(durationMin=long_minutes)}
            if specific and load_index % 2 == 0 and SPECIFIC_LONG.get('marathon' if distance == 'ultra' else distance):
                chain = SPECIFIC_LONG['marathon' if distance == 'ultra' else distance]
                session = _intervals_session('run_long_mp', _step(chain, load_index // 2 - 1), min(race, .92), long_minutes)
                session['params']['durationMin'] = max(long_minutes, minimum_minutes(session))
            result.append({'id': 'long', 'role': 'long', 'day': day, **session})
        elif day == chosen['key'] and key:
            session = {'template': key['template'], 'params': {**key['params'], 'durationMin': key_minutes}}
            if key['template'] == 'run_hill_sprints':  # Counts as an easy run.
                session['params']['durationMin'] = max(EASY_MIN, min(key_minutes, EASY_MAX))
            result.append({'id': 'key', 'role': 'key', 'day': day, **session})
        elif day in easy_days:
            minutes = min(easy_minutes, available[day])
            session = {'template': 'run_easy', 'params': _params(durationMin=minutes)}
            if day == special and specific and tempo_chain:
                session = _intervals_session('run_tempo', _step(tempo_chain, load_index - 1), race)
                session['params']['durationMin'] = max(minutes, minimum_minutes(session))
            elif day == special and block_type != 'uebergang' and not (block_type == 'wiedereinstieg' and number == 1):
                hills = block_type in ('grundlage', 'wiedereinstieg') and number % 2 == 1 and not race_week
                session = {'template': 'run_hill_sprints' if hills else 'run_strides',
                           'params': _params(durationMin=max(EASY_MIN, minutes), reps=4 if deload or race_week else 6,
                                             workSec=10 if hills else 20)}
            result.append({'id': f'easy-{day}', 'role': 'easy', 'day': day, **session})
    for session in result:
        session['minutes'] = session['params']['durationMin']
    return result
