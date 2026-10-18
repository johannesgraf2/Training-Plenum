import unittest

from coach_blocks import EASY_RUNS, LONG_RUNS
from coach_runs import choose_days, distance_class, long_run_excess, race_intensity, run_week
from coach_templates import render_session

HALF = {'subtype': 'halfMarathon', 'distanceKm': 21.1, 'targetSeconds': 5990}  # 1:39:50
MARATHON = {'subtype': 'marathon', 'distanceKm': None, 'targetSeconds': None}
DAYS_FREE = {'tue': 90, 'wed': 60, 'thu': 90, 'sat': 120, 'sun': 150}
CYCLE = [{'phase': 'build'}, {'phase': 'build'}, {'phase': 'build'}, {'phase': 'recovery'}]


def block(block_type, hours=(3.75, 4, 4.25, 3.25), event=HALF, weeks=CYCLE, **extra):
    """The weeks of one block, each built on the long run of the weeks before."""
    result, previous = [], None
    for number, target in enumerate(hours, start=1):
        week = run_week(block_type, weeks, number, target, DAYS_FREE, training_days=3, long_days=['sun'], event=event,
                        threshold_pace=285, previous_long=previous, **extra)
        result.append(week)
        if weeks[number - 1]['phase'] != 'recovery':
            previous = by_role(week, 'long')['minutes']
    return result


def by_role(week, role):
    return next(s for s in week['sessions'] if s['role'] == role)


def shape(session):
    p = session['params']
    return session['template'], p['intervals'], p['workMin']


class RunWeekTests(unittest.TestCase):
    def test_three_run_days_key_session_on_tuesday_easy_thursday_long_sunday(self):
        self.assertEqual(choose_days(DAYS_FREE, 3, ['sun']), {'long': 'sun', 'key': 'tue', 'easy': ['thu']})
        self.assertEqual(choose_days(DAYS_FREE, 4, ['sun']), {'long': 'sun', 'key': 'tue', 'easy': ['thu', 'sat']})
        # Without a long day the weekend day with the most time takes the long run; preferred rest days stay free.
        self.assertEqual(choose_days({d: 90 for d in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')}, 3, rest_days=['mon', 'fri']),
                         {'long': 'sun', 'key': 'tue', 'easy': ['thu']})

    def test_threshold_block_progresses_the_key_session_week_by_week(self):
        weeks = block('schwelle')
        self.assertEqual([shape(by_role(w, 'key')) for w in weeks],
                         [('run_threshold', 3, 8), ('run_threshold', 3, 10), ('run_threshold', 3, 12), ('run_threshold', 2, 12)])
        for week in weeks:
            self.assertEqual([s['day'] for s in week['sessions']], ['tue', 'thu', 'sun'])
            long, easy = by_role(week, 'long'), by_role(week, 'easy')
            self.assertEqual(easy['template'], 'run_strides')
            self.assertLessEqual(easy['minutes'], 60)
            self.assertLess(easy['minutes'], long['minutes'])
            self.assertAlmostEqual(week['totalHours'] * 60, sum(s['minutes'] for s in week['sessions']), delta=1)
        loads = [by_role(w, 'long')['minutes'] for w in weeks]
        self.assertTrue(all(m >= 60 for m in loads[:3]) and loads[0] < loads[1] < loads[2])
        self.assertLessEqual(loads[3], loads[2] * .8)  # The deload week shortens the long run.
        # Every session renders: the key session sits inside a longer run.
        key = by_role(weeks[1], 'key')
        rendered = render_session(key['template'], key['params'], '2026-10-20', max_hr=190, threshold_pace=285)
        self.assertEqual((rendered['name'], rendered['durationMin']), ('Schwellenlauf 3×10 min', key['minutes']))
        self.assertEqual(render_session('run_long', by_role(weeks[0], 'long')['params'], '2026-10-25')['name'], 'Langer Lauf')

    def test_base_block_has_short_reps_as_key_session_lauf_abc_strides_and_rare_hill_sprints(self):
        weeks = block('grundlage')
        self.assertEqual([shape(by_role(w, 'key')) for w in weeks[:3]],
                         [('run_threshold', 6, 2), ('run_threshold', 5, 3), ('run_threshold', 6, 3)])
        # Technique (Lauf-ABC) and strides in turn; hill sprints only about every fourth week, not in a deload week.
        self.assertEqual([by_role(w, 'easy')['template'] for w in weeks], ['run_drills', 'run_strides', 'run_drills', 'run_strides'])
        long = block('grundlage', hours=(4,) * 8, weeks=[{'phase': 'build'}] * 8)
        self.assertEqual([n for n, w in enumerate(long, start=1) if by_role(w, 'easy')['template'] == 'run_hill_sprints'], [4, 8])
        # Without interval experience the first week starts with hill sprints instead, and only that week has them.
        first, second = block('grundlage', intervals_known=False)[:2]
        self.assertEqual((by_role(first, 'key')['template'], by_role(first, 'easy')['template']), ('run_hill_sprints', 'run_drills'))
        self.assertEqual(by_role(second, 'key')['template'], 'run_threshold')

    def test_the_long_run_starts_moderately_and_grows_step_by_step(self):
        # 6 h in four run days would put 2:15 h into the first long run; it starts at 1:40 h and grows by 15 min.
        days = {'tue': 180, 'thu': 180, 'fri': 180, 'sun': 180}
        weeks, previous = [], None
        for number in range(1, 5):
            week = run_week('grundlage', [{'phase': 'build'}] * 4, number, 6.1, days, training_days=4, long_days=['sun'],
                            event=MARATHON, previous_long=previous, longest_long=previous)
            weeks.append(week)
            previous = by_role(week, 'long')['minutes']
        self.assertEqual([by_role(w, 'long')['minutes'] for w in weeks], [100, 115, 130, 135])
        self.assertTrue(all(s['minutes'] <= 60 for w in weeks for s in w['sessions'] if s['role'] == 'easy'))
        # The key session is never longer than the long run, and a short long run grows by about a fifth.
        short, previous = [], None
        for number in range(1, 4):
            short.append(run_week('grundlage', [{'phase': 'build'}] * 4, number, 5.5, days, training_days=4, long_days=['sun'],
                                  event=MARATHON, recent_long=40, intervals_known=False, previous_long=previous,
                                  longest_long=previous))
            previous = by_role(short[-1], 'long')['minutes']
        self.assertEqual([by_role(w, 'long')['minutes'] for w in short], [50, 60, 70])
        self.assertTrue(all(by_role(w, 'key')['minutes'] <= by_role(w, 'long')['minutes'] for w in short))
        # With the longest run of the last weeks known, the first long run lies a little beyond it.
        first = lambda recent: by_role(run_week('grundlage', [{'phase': 'build'}] * 4, 1, 6.1, days, training_days=4,
                                                long_days=['sun'], event=MARATHON, recent_long=recent), 'long')['minutes']
        self.assertEqual([first(None), first(0), first(40), first(72), first(150)], [100, 45, 50, 80, 135])  # 135: share of 6.1 h
        # The coach may lengthen the laid-out long run a little, not fill the week's hours with it.
        rendered = lambda minutes: [{'template': 'run_long', 'rendered': {'durationMin': minutes}}]
        self.assertIsNone(long_run_excess(rendered(110), weeks[0]))
        self.assertIn('vorgesehen sind 100 min', long_run_excess(rendered(155), weeks[0]))

    def test_race_specific_weeks_add_race_pace(self):
        weeks = block('wettkampfspezifisch')
        tempo = by_role(weeks[0], 'easy')
        self.assertEqual(shape(tempo), ('run_tempo', 2, 8))
        self.assertEqual(tempo['params']['intensity'], race_intensity(HALF, 285))
        rendered = render_session('run_tempo', tempo['params'], '2026-10-22', threshold_pace=285)
        pace = next(s for s in rendered['workout']['steps'] if s['name'] == 'Renntempo 1')['target']
        self.assertTrue(pace['low'] < 284 < pace['high'])  # The goal pace of 1:39:50.
        self.assertEqual([by_role(w, 'long')['template'] for w in weeks], ['run_long', 'run_long_mp', 'run_long', 'run_long'])
        self.assertEqual(by_role(weeks[3], 'easy')['template'], 'run_strides')  # Deload: no race pace.
        marathon = block('wettkampfspezifisch', hours=(5, 5.25, 5.5, 4), event=MARATHON)
        self.assertEqual(shape(by_role(marathon[0], 'easy')), ('run_tempo', 1, 20))
        self.assertEqual(by_role(marathon[1], 'long')['params']['intensity'], .83)

    def test_race_week_ends_before_the_race(self):
        taper = [{'phase': 'taper'}, {'phase': 'taper'}]
        week = run_week('taper', taper, 2, 1.75, DAYS_FREE, training_days=3, long_days=['sun'], event=HALF,
                        threshold_pace=285, race_day='sun', longest_long=110)
        # The race is the third run day: a short race-pace session early in the week, an easy run with strides later.
        self.assertEqual([(s['day'], s['template']) for s in week['sessions']], [('tue', 'run_tempo'), ('thu', 'run_strides')])
        self.assertEqual(shape(week['sessions'][0]), ('run_tempo', 3, 3))
        self.assertFalse(any(s['template'] in LONG_RUNS for s in week['sessions']))
        # Also when the race week closes the race-specific block.
        week = run_week('wettkampfspezifisch', CYCLE, 4, 2, DAYS_FREE, training_days=3, long_days=['sun'], event=HALF,
                        threshold_pace=285, race_day='sun', longest_long=110)
        self.assertEqual(shape(week['sessions'][0]), ('run_tempo', 3, 3))
        before = run_week('taper', taper, 1, 2.75, DAYS_FREE, training_days=3, long_days=['sun'], event=HALF,
                          threshold_pace=285, longest_long=110)
        self.assertLessEqual(by_role(before, 'long')['minutes'], 110 * .75)

    def test_little_time_means_fewer_runs_rather_than_tiny_ones(self):
        week = run_week('schwelle', CYCLE, 1, 1.75, DAYS_FREE, training_days=3, long_days=['sun'], event=HALF)
        self.assertEqual([s['role'] for s in week['sessions']], ['key', 'long'])
        self.assertTrue(all(s['minutes'] >= 30 for s in week['sessions']))
        # Five run days: easy runs stay at most an hour, the long run stays the longest.
        free = {d: 120 for d in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')}
        many = run_week('schwelle', CYCLE, 2, 6, free, training_days=5, long_days=['sun'], event=MARATHON)
        easy = [s for s in many['sessions'] if s['template'] in EASY_RUNS]
        self.assertEqual(len(many['sessions']), 5)
        self.assertTrue(all(s['minutes'] <= 60 for s in easy))
        self.assertEqual(max(many['sessions'], key=lambda s: s['minutes'])['role'], 'long')

    def test_race_pace_and_distance(self):
        self.assertEqual([distance_class(e) for e in (None, {'subtype': '10k'}, HALF, MARATHON, {'distanceKm': 100})],
                         [None, 'short', 'half', 'marathon', 'ultra'])
        self.assertEqual(race_intensity(MARATHON, 285), .83)  # No target time: the usual marathon intensity.
        # A target faster than threshold pace over a marathon is capped at the hardest plausible marathon intensity.
        self.assertEqual(race_intensity({'subtype': 'marathon', 'distanceKm': 42.2, 'targetSeconds': 42.2 * 270}, 285), .86)


if __name__ == '__main__':
    unittest.main()
