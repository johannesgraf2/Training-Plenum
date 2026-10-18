import copy
import unittest
from datetime import date, datetime, timedelta

from coach_blocks import new_block, suggested_rhythm
from coach_domain import DAYS, CoachError, complete_profile, DEFAULT_PROFILE, complete_event, iso_week
from coach_plan import (adopt_blocks, align_frame, check_frame, check_volume, cycle_lengths, frame_cycles, check_tests, cut_frame,
                        deviation, due_week, due_weeks, edit_phases, frame_blocks, frame_hint, group_sessions, horizon, outline_weeks,
                        plan_span, plan_weeks, reference_monday, replan_date, required_tests, shape_volume, week_kinds)


def phase(block_type, weeks, hours=6.0, secondary=None):
    phases = ['taper'] * weeks if block_type == 'taper' else \
        ['recovery' if deload else 'build' for deload in suggested_rhythm(weeks, block_type)]
    result = [{'week': i + 1, 'phase': p, 'targetHours': hours, 'focus': 'Fokus'} for i, p in enumerate(phases)]
    if block_type == 'wettkampfspezifisch':
        result[-1]['targetHours'] = round(hours * .6, 2)  # The taper drop of the last week.
    return {'blockType': block_type, 'secondaryFocus': secondary, 'purpose': 'Zweck', 'weeks': result}


class PlanFrameTests(unittest.TestCase):
    def setUp(self):
        self.profile = complete_profile(copy.deepcopy(DEFAULT_PROFILE))
        self.profile['availability'].update(defaultAvailability=dict.fromkeys(DAYS, 120), absoluteMaxWeeklyHours=10)
        # Monday 19.10.2026 to Sunday 31.01.2027: 15 weeks; the A event on Saturday 16.01.2027 lies in week 13.
        self.settings = {'startDate': '2026-10-19', 'endDate': '2027-01-31', 'replanMode': 'afterReview'}
        self.profile['events'] = [complete_event({'title': 'Rennen', 'sport': 'ride', 'startDate': '2027-01-16', 'priority': 'A'}, 'a')]
        self.phases = [phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 4), phase('uebergang', 2, 3)]

    def test_span_counts_weeks_up_to_the_week_of_the_plan_end(self):
        self.assertEqual(plan_span(self.settings), (date(2026, 10, 19), 15))
        self.assertEqual(plan_span({**self.settings, 'startDate': '2026-10-21'})[0], date(2026, 10, 19))
        self.assertEqual(plan_weeks(self.settings)[:2], ['2026-W43', '2026-W44'])

    def test_a_valid_frame_ends_a_race_cycle_in_the_event_week_and_goes_on_after_it(self):
        check_frame(self.phases, self.settings, self.profile)
        blocks = frame_blocks(self.phases, date(2026, 10, 19))
        self.assertEqual([(b['blockType'], b['startDate'], b['endDate'], b['source']) for b in blocks][2:],
                         [('wettkampfspezifisch', '2026-12-21', '2027-01-17', 'plan'), ('uebergang', '2027-01-18', '2027-01-31', 'plan')])
        self.assertEqual(blocks[0]['purpose'], 'Zweck')

    def test_frame_rules(self):
        cases = [
            ([phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 4)], 'ergeben 13 Wochen'),
            ([phase('grundlage', 6), phase('vo2max', 3), phase('schwelle', 4), phase('uebergang', 2, 3)], 'Woche des Events'),
            ([phase('vo2max', 3), phase('grundlage', 6), phase('wettkampfspezifisch', 4), phase('uebergang', 2, 3)], 'Reihenfolge'),
            ([phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 4), phase('wettkampfspezifisch', 2)],
             'nur vor einem A-Event'),
            ([phase('grundlage', 6, 15), phase('vo2max', 3), phase('wettkampfspezifisch', 4), phase('uebergang', 2, 3)],
             'verfügbare Zeit'),
            ([phase('grundlage', 5), phase('vo2max', 4), phase('wettkampfspezifisch', 4), phase('uebergang', 2, 3)], '6–12 Wochen'),
        ]
        for phases, message in cases:
            with self.subTest(message), self.assertRaisesRegex(CoachError, message):
                check_frame(phases, self.settings, self.profile)

    def test_an_exception_lowers_the_time_of_its_week(self):
        self.profile['availability']['exceptions'] = [{'id': 'urlaub', 'from': '2026-10-19', 'to': '2026-10-24',
                                                       'kind': 'unavailable', 'maxMinutes': None, 'note': 'Urlaub'}]
        with self.assertRaisesRegex(CoachError, 'Phase 1, Woche 1'):
            check_frame(self.phases, self.settings, self.profile)

    def test_without_an_a_event_there_is_no_race_phase(self):
        self.profile['events'] = []
        settings = {**self.settings, 'endDate': '2027-01-10'}  # 12 weeks
        check_frame([phase('grundlage', 8), phase('schwelle', 4)], settings, self.profile)
        self.assertIsNone(frame_hint(settings, self.profile))
        with self.assertRaisesRegex(CoachError, 'nur vor einem A-Event'):
            check_frame([phase('grundlage', 8), phase('wettkampfspezifisch', 4)], settings, self.profile)

    def test_a_chosen_taper_length_is_enforced(self):
        phases = [phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 3), phase('taper', 1, 4), phase('uebergang', 2, 3)]
        check_frame(phases, {**self.settings, 'taperWeeks': 1}, self.profile)
        with self.assertRaisesRegex(CoachError, 'Taper von 2 Wochen'):
            check_frame(phases, {**self.settings, 'taperWeeks': 2}, self.profile)
        with self.assertRaisesRegex(CoachError, 'Taper von 1 Woche'):
            check_frame(self.phases, {**self.settings, 'taperWeeks': 1}, self.profile)

    def test_hint_shows_the_usual_build_up_to_the_first_a_event(self):
        hint = frame_hint(self.settings, self.profile)
        self.assertEqual((hint['event'], hint['weeks'], sum(s['weeks'] for s in hint['segments'])), ('Rennen', 13, 13))
        # Running goals: a half marathon or marathon builds on a threshold block and ends with the taper; the base may be
        # shorter than in cycling.
        self.profile['goal']['sports'] = ['run']
        self.profile['events'][0].update(sport='run', subtype='halfMarathon')
        hint = frame_hint({**self.settings, 'taperWeeks': None}, self.profile)
        self.assertEqual([(s['blockType'], s['weeks']) for s in hint['segments']],
                         [('grundlage', 4), ('schwelle', 4), ('wettkampfspezifisch', 3), ('taper', 2)])
        long = {**self.settings, 'startDate': '2026-09-21'}  # 17 weeks
        self.assertEqual([(s['blockType'], s['weeks']) for s in frame_hint(long, self.profile)['segments']],
                         [('grundlage', 5), ('schwelle', 5), ('wettkampfspezifisch', 5), ('taper', 2)])
        self.profile['events'][0]['subtype'] = '10k'
        self.assertIn('vo2max', [s['blockType'] for s in frame_hint(self.settings, self.profile)['segments']])


class RhythmTests(unittest.TestCase):
    def setUp(self):
        self.profile = complete_profile(copy.deepcopy(DEFAULT_PROFILE))
        self.profile['availability'].update(defaultAvailability=dict.fromkeys(DAYS, 120), absoluteMaxWeeklyHours=10)
        # Monday 19.10.2026 to Sunday 07.03.2027: 20 weeks; the A event on Saturday 20.02.2027 lies in week 18.
        self.settings = {'startDate': '2026-10-19', 'endDate': '2027-03-07', 'replanMode': 'afterReview', 'taperWeeks': 2}
        self.profile['events'] = [complete_event({'title': 'Rennen', 'sport': 'ride', 'startDate': '2027-02-20', 'priority': 'A'}, 'a')]

    def test_cycles_count_back_from_the_end_and_put_leftover_weeks_first(self):
        self.assertEqual([cycle_lengths(n) for n in (0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14)],
                         [[], [1], [2], [3], [4], [3, 3], [3, 4], [5, 4], [5, 5], [4, 4, 4], [5, 4, 4], [5, 5, 4]])

    def test_the_ai_gets_the_cycles_up_to_the_taper_with_the_peak_three_weeks_before_the_event(self):
        [hint] = frame_cycles(self.settings, self.profile)
        self.assertEqual((hint['eventWeek'], hint['taperWeeks'], hint['peakWeek']), (18, 2, 15))
        self.assertEqual([(c['fromWeek'], c['deloadWeek']) for c in hint['cycles']], [(1, 4), (5, 8), (9, 12), (13, 16)])
        self.assertEqual(frame_cycles({**self.settings, 'taperWeeks': None}, self.profile)[0]['peakWeek'], 15)

    def test_phases_move_to_whole_cycles_so_the_rhythm_runs_over_block_boundaries(self):
        phases = [phase('grundlage', 7), phase('vo2max', 5), phase('wettkampfspezifisch', 4), phase('taper', 2, 3),
                  phase('uebergang', 2, 3)]
        check_frame(phases, self.settings, self.profile)
        aligned = shape_volume(align_frame(phases, self.settings, self.profile), self.settings, self.profile, [10] * 20,
                               [None] * 20, 5, 7)
        check_frame(aligned, self.settings, self.profile)
        self.assertEqual([(p['blockType'], len(p['weeks'])) for p in aligned],
                         [('grundlage', 8), ('vo2max', 4), ('wettkampfspezifisch', 4), ('taper', 2), ('uebergang', 2)])
        pattern = [''.join('D' if w['phase'] in ('recovery', 'taper') else 'L' for w in p['weeks']) for p in aligned[:3]]
        self.assertEqual(pattern, ['LLLDLLLD', 'LLLD', 'LLLD'])
        # Week 8 was a load week of the AI and becomes a deload; week 7 was a deload and becomes a load week.
        self.assertEqual([w['focus'] for w in aligned[0]['weeks'][6:]], ['', ''])

    def test_the_rhythm_runs_over_block_boundaries_that_are_off_the_cycles(self):
        # A 6-week block no longer gets two 2:1 cycles: 3:1 runs on from the week before the taper backwards.
        phases = [phase('grundlage', 6), phase('vo2max', 6), phase('wettkampfspezifisch', 4), phase('taper', 2, 3),
                  phase('uebergang', 2, 3)]
        shaped = shape_volume(phases, self.settings, self.profile, [10] * 20, [None] * 20, 5, 7)
        self.assertEqual(''.join('D' if w['phase'] in ('recovery', 'taper') else 'L' for p in shaped[:3] for w in p['weeks']),
                         'LLLDLLLDLLLDLLLD')

    def test_hours_rise_evenly_up_to_the_recommended_peak_in_the_last_load_week(self):
        phases = [phase('grundlage', 8), phase('vo2max', 4), phase('wettkampfspezifisch', 4), phase('taper', 2, 3),
                  phase('uebergang', 2, 3)]
        hours = lambda shaped: [w['targetHours'] for p in shaped for w in p['weeks']]
        # Load weeks rise evenly from the base (5 h) to the peak (7 h) in week 15; a cycle starts at the level of the last
        # load week, deloads take 60 % of it, the taper 80 % of the week before, the transition half of the base.
        self.assertEqual(hours(shape_volume(phases, self.settings, self.profile, [10] * 20, [None] * 20, 5, 7)),
                         [5, 5.25, 5.5, 3.25, 5.5, 5.75, 6, 3.5, 6, 6.25, 6.5, 3.75, 6.5, 6.75, 7, 4.25, 3.25, 2.75, 2.5, 2.5])
        # A long plan rises slower, never more than 5 % a week: the peak is reached once, at the end.
        steep = hours(shape_volume(phases, self.settings, self.profile, [10] * 20, [None] * 20, 5, 20))
        self.assertEqual((steep[0], steep[1], max(steep), steep.index(max(steep))), (5, 5.25, 7.5, 14))
        # The available time caps every week, the wished volume the taper; the curve goes on behind a short week.
        capped = hours(shape_volume(phases, self.settings, self.profile, [10] * 9 + [4] + [10] * 10, [6] * 20, 5, 7))
        self.assertEqual((capped[9], capped[10], capped[16]), (4, 6.5, 3.25))

    def test_the_athletes_own_weeks_and_scale_change_the_curve_from_there_on(self):
        phases = [phase('grundlage', 8), phase('vo2max', 4), phase('wettkampfspezifisch', 4), phase('taper', 2, 3),
                  phase('uebergang', 2, 3)]
        # Week 4 becomes a load week and week 5 the deload (a 4:1 cycle); week 8 gets own hours; all weeks 10 % more.
        volume = {'scale': 1.1, 'weeks': {'2026-W46': {'kind': 'load', 'hours': None}, '2026-W47': {'kind': 'deload', 'hours': None},
                                          '2026-W50': {'kind': None, 'hours': 9}}}
        shaped = shape_volume(phases, self.settings, self.profile, [10] * 20, [None] * 20, 5, 7, volume)
        weeks = [w for p in shaped for w in p['weeks']]
        self.assertEqual(''.join('D' if w['phase'] in ('recovery', 'taper') else 'L' for w in weeks[:16]), 'LLLLDLLDLLLDLLLD')
        self.assertEqual([w['targetHours'] for w in weeks[:9]], [5.5, 5.75, 6, 6.25, 3.75, 6.25, 6.5, 9, 6.5])
        # Weeks that are over keep their outline and rhythm.
        kept = shape_volume(phases, self.settings, self.profile, [10] * 20, [None] * 20, 5, 7, volume, keep=4)
        self.assertEqual([w for p in kept for w in p['weeks']][:4], [w for p in phases for w in p['weeks']][:4])

    def test_a_stretch_with_more_phases_than_cycles_stays(self):
        settings = {**self.settings, 'endDate': '2027-02-21'}  # 18 weeks, the event in the last one.
        phases = [phase('wiedereinstieg', 2), phase('grundlage', 6), phase('vo2max', 3), phase('schwelle', 4),
                  phase('wettkampfspezifisch', 3)]
        self.assertEqual(align_frame(phases, {**settings, 'taperWeeks': None}, self.profile), phases)

    def test_volume_edits_are_checked(self):
        keys = plan_weeks(self.settings)
        defaults = week_kinds(['grundlage'] * 16 + ['taper'] * 2 + ['uebergang'] * 2, self.settings, self.profile)
        check = lambda *weeks: check_volume({'scale': 1, 'weeks': [{'week': w, 'kind': k, 'hours': h} for w, k, h in weeks]},
                                            {'weeks': {keys[0]: {'kind': 'deload', 'hours': None}}}, self.settings, 2, defaults,
                                            [10] * 20)
        with self.assertRaisesRegex(CoachError, 'Woche 17: Taper'):
            check((keys[16], 'load', None))
        with self.assertRaisesRegex(CoachError, 'Woche 3: Du hast höchstens 10 h Zeit'):
            check((keys[2], None, 10.5))
        with self.assertRaisesRegex(CoachError, 'nicht zum Plan'):
            check(('2030-W01', 'load', None))
        # Weeks that are over keep what they had; empty entries go.
        self.assertEqual(check((keys[0], 'load', None), (keys[2], 'deload', 4), (keys[3], None, None))['weeks'],
                         {keys[0]: {'kind': 'deload', 'hours': None}, keys[2]: {'kind': 'deload', 'hours': 4}})


class RollingTests(unittest.TestCase):
    weeks = [iso_week(date(2026, 10, 19) + timedelta(weeks=i)) for i in range(10)]

    def test_creation_works_out_three_weeks_from_the_start_or_the_running_week(self):
        self.assertEqual(horizon(self.weeks, date(2026, 10, 16)), self.weeks[:3])
        self.assertEqual(horizon(self.weeks, date(2026, 11, 4)), self.weeks[2:5])
        self.assertEqual(horizon(self.weeks, date(2027, 6, 1)), [])

    def test_sunday_mode_moves_on_at_sunday_18_00(self):
        planned = set(self.weeks[:3])
        before = reference_monday('sunday', datetime(2026, 10, 25, 17, 59), planned, set())
        self.assertIsNone(due_week(self.weeks, planned, before, date(2026, 10, 25)))
        after = reference_monday('sunday', datetime(2026, 10, 25, 18, 0), planned, set())
        self.assertEqual(due_week(self.weeks, planned, after, date(2026, 10, 25)), self.weeks[3])
        # The first app start later in the week catches up.
        tuesday = reference_monday('sunday', datetime(2026, 10, 27, 9, 0), planned, set())
        self.assertEqual(due_week(self.weeks, planned, tuesday, date(2026, 10, 27)), self.weeks[3])

    def test_after_review_mode_moves_on_with_the_review_or_on_monday_06_00(self):
        planned = set(self.weeks[:3])
        reference = lambda moment, reviewed=(): reference_monday('afterReview', moment, planned, set(reviewed))
        sunday = datetime(2026, 10, 25, 20, 0)
        self.assertIsNone(due_week(self.weeks, planned, reference(sunday), sunday.date()))
        self.assertEqual(due_week(self.weeks, planned, reference(sunday, [self.weeks[0]]), sunday.date()), self.weeks[3])
        early = datetime(2026, 10, 26, 5, 59)
        self.assertIsNone(due_week(self.weeks, planned, reference(early), early.date()))
        late = datetime(2026, 10, 26, 6, 0)
        self.assertEqual(due_week(self.weeks, planned, reference(late), late.date()), self.weeks[3])
        # Right after the plan start there is no earlier week whose review could be missing.
        self.assertEqual(reference_monday('afterReview', datetime(2026, 10, 19, 3, 0), planned, set()), date(2026, 10, 19))
        self.assertIsNone(reference_monday('manual', late, planned, set()))

    def test_a_longer_horizon_works_out_more_weeks_and_replans_earlier(self):
        self.assertEqual(horizon(self.weeks, date(2026, 10, 16), 5), self.weeks[:5])
        monday = date(2026, 10, 19)
        self.assertEqual(due_weeks(self.weeks, set(self.weeks[:3]), monday + timedelta(weeks=1), monday, 6), self.weeks[3:7])
        self.assertEqual(due_week(self.weeks, set(self.weeks[:3]), monday + timedelta(weeks=1), monday, 6), self.weeks[3])
        self.assertEqual(replan_date(date(2026, 11, 9)), date(2026, 10, 25))
        self.assertEqual(replan_date(date(2026, 11, 9), 5), date(2026, 10, 11))

    def test_a_missing_running_week_comes_first_and_the_plan_end_limits(self):
        monday = date(2026, 11, 2)
        self.assertEqual(due_week(self.weeks, {self.weeks[3]}, monday + timedelta(weeks=1), monday), self.weeks[2])
        self.assertIsNone(due_week(self.weeks, set(self.weeks[8:]), date(2026, 12, 21), date(2026, 12, 21)))

    def test_strong_deviation(self):
        self.assertEqual(deviation({'reasons': ['travel', 'sick']}, 8, 7), 'sick')
        self.assertEqual(deviation(None, 8, 4.5), 'lessTraining')
        self.assertIsNone(deviation({'reasons': ['lackOfTime']}, 8, 5))
        self.assertIsNone(deviation(None, None, 0))


class PlanExtrasTests(unittest.TestCase):
    def setUp(self):
        self.profile = complete_profile(copy.deepcopy(DEFAULT_PROFILE))
        self.profile['goal']['sports'] = ['ride', 'run']
        group = {'sport': 'ride', 'intensity': 'hard', 'note': 'Vereinsausfahrt ' + 'ä' * 200}
        self.profile['availability'].update(defaultAvailability=dict.fromkeys(DAYS, 120), windows=[
            {'id': 'mi', 'day': 'wed', 'kind': 'available', 'allDay': False, 'from': '18:00', 'to': '20:00',
             'sports': {'ride': {'indoor': False, 'outdoor': True}}, 'group': group}])

    def test_group_sessions_become_fixed_workouts_with_a_stable_id(self):
        first, second = group_sessions(self.profile, '2026-W44', date(2026, 10, 26)), group_sessions(self.profile, '2026-W44', date(2026, 10, 26))
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]['id'], second[0]['id'])
        workout = first[0]['workout']
        self.assertEqual((workout['date'], workout['steps'][0]['duration']['value'], workout['steps'][0]['intensity']),
                         ('2026-10-28', 7200, 'interval'))
        self.assertLessEqual(len(workout['notes'].encode()), 250)
        self.assertNotEqual(group_sessions(self.profile, '2026-W45', date(2026, 10, 26))[0]['id'], first[0]['id'])

    def test_group_sessions_skip_past_days_events_and_short_exceptions(self):
        self.assertEqual(group_sessions(self.profile, '2026-W44', date(2026, 10, 29)), [])
        self.profile['events'] = [complete_event({'title': 'C', 'sport': 'ride', 'startDate': '2026-10-28', 'priority': 'C'}, 'c')]
        self.assertEqual(group_sessions(self.profile, '2026-W44', date(2026, 10, 26)), [])
        self.profile['events'] = []
        self.profile['availability']['exceptions'] = [{'id': 'x', 'from': '2026-10-28', 'to': '2026-10-28', 'kind': 'available',
                                                       'maxMinutes': 60, 'note': ''}]
        self.assertEqual(group_sessions(self.profile, '2026-W44', date(2026, 10, 26)), [])

    def test_requested_tests_belong_in_the_first_week(self):
        self.assertEqual(required_tests(self.profile), [])
        self.profile['thresholds'] = {'ride': {'source': 'test'}, 'run': {'source': 'test', 'paceSecPerKm': None, 'basis': None}}
        self.assertEqual(required_tests(self.profile), ['bike_ftp_test', 'run_test_30'])
        with self.assertRaisesRegex(CoachError, 'den 30-min-Lauftest'):
            check_tests([{'template': 'bike_ftp_test'}], required_tests(self.profile))
        check_tests([{'template': 'run_test_30'}, {'template': 'bike_ftp_test'}], required_tests(self.profile))



class AdoptionTests(unittest.TestCase):
    def setUp(self):
        self.profile = complete_profile(copy.deepcopy(DEFAULT_PROFILE))
        self.phases = [phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 4), phase('uebergang', 2, 3)]

    def test_new_phases_cut_the_running_one_and_drop_the_later_ones(self):
        blocks = frame_blocks(self.phases, date(2026, 10, 19))
        other = new_block('grundlage', None, '2026-01-05', [{'week': 1, 'phase': 'build', 'targetHours': 4, 'focus': ''}], key='old')
        result, kept = cut_frame([other, *blocks], {b['id'] for b in blocks}, date(2026, 11, 16))
        self.assertEqual(kept, [blocks[0]['id']])
        self.assertEqual([(b['id'], b['endDate'], len(b['weeks'])) for b in result],
                         [('old', other['endDate'], 1), (blocks[0]['id'], '2026-11-15', 4)])
        # Cutting at the start of a phase keeps the phases before it whole.
        _, kept = cut_frame(blocks, {b['id'] for b in blocks}, date(2026, 11, 30))
        self.assertEqual(kept, [blocks[0]['id']])

    def test_blocks_and_season_from_before_the_phases_become_a_plan(self):
        weeks = lambda count: [{'week': i + 1, 'phase': 'build', 'targetHours': 6, 'focus': 'Basis'} for i in range(count)]
        done = new_block('wiedereinstieg', None, '2026-09-21', weeks(2), key='done')
        running = new_block('grundlage', None, '2026-10-05', weeks(6), key='running')
        dropped = {**new_block('vo2max', None, '2026-11-16', weeks(3), key='dropped'), 'status': 'abandoned'}
        season = {'id': 's', 'startDate': '2026-09-21', 'goalDate': '2027-01-09', 'rationale': 'Erst Basis.', 'source': 'aiRecommendation',
                  'segments': [{'blockType': 'wiedereinstieg', 'secondaryFocus': None, 'weeks': 2, 'purpose': ''},
                               {'blockType': 'grundlage', 'secondaryFocus': None, 'weeks': 6, 'purpose': ''},
                               {'blockType': 'vo2max', 'secondaryFocus': None, 'weeks': 4, 'purpose': 'Motor.'},
                               {'blockType': 'wettkampfspezifisch', 'secondaryFocus': None, 'weeks': 4, 'purpose': 'Rennen.'}]}
        self.profile['availability']['preferredWeeklyHours'] = 7
        plan = {'blocks': [done, running, dropped], 'weeks': {}, 'season': season}
        adopted = adopt_blocks(plan, self.profile, date(2026, 10, 17))
        self.assertEqual(adopted, adopt_blocks(plan, self.profile, date(2026, 10, 17)))  # Deterministic reads.
        frame = adopted['frame']
        self.assertEqual((frame['status'], frame['source'], frame['startDate'], frame['endDate'], frame['rationale']),
                         ('active', 'adopted', '2026-09-21', '2027-01-10', 'Erst Basis.'))
        self.assertEqual(frame['blockIds'], ['done', 'running', 'season-2026-11-16', 'season-2026-12-14'])
        self.assertEqual((adopted['settings']['startDate'], adopted['settings']['endDate'], adopted['settings']['replanMode']),
                         ('2026-09-21', '2027-01-10', 'afterReview'))
        vo2 = adopted['blocks'][3]
        self.assertEqual((vo2['source'], vo2['purpose'], [w['phase'] for w in vo2['weeks']], [w['targetHours'] for w in vo2['weeks']]),
                         ('plan', 'Motor.', ['build', 'build', 'build', 'recovery'], [7, 7, 7, 5]))
        self.assertEqual(adopted['season'], season)  # Stays for the former endpoints.
        self.assertNotIn('frame', plan)
        # Without a running or upcoming block, and once a plan exists or ended, nothing changes.
        self.assertIs(adopt_blocks(plan, self.profile, date(2027, 2, 1)), plan)
        self.assertNotIn('frame', adopt_blocks({'blocks': [], 'weeks': {}, 'season': season}, self.profile, date(2026, 10, 17)))
        ended = {**plan, 'frame': {**frame, 'status': 'ended'}}
        self.assertIs(adopt_blocks(ended, self.profile, date(2026, 10, 17)), ended)


if __name__ == '__main__':
    unittest.main()


class PhaseEditTests(unittest.TestCase):
    """Moving, lengthening, adding blocks and the taper by hand: fixed rules, same input gives the same plan."""

    def setUp(self):
        self.profile = complete_profile(copy.deepcopy(DEFAULT_PROFILE))
        self.profile['availability'].update(defaultAvailability=dict.fromkeys(DAYS, 120), absoluteMaxWeeklyHours=10)
        self.profile['events'] = [complete_event({'title': 'Rennen', 'sport': 'ride', 'startDate': '2027-01-16', 'priority': 'A'}, 'a')]
        settings = {'startDate': '2026-10-19', 'endDate': '2027-01-31', 'replanMode': 'afterReview'}
        phases = [phase('grundlage', 6), phase('vo2max', 3), phase('wettkampfspezifisch', 3), phase('taper', 1, 3),
                  phase('uebergang', 2, 3)]
        check_frame(phases, settings, self.profile)
        blocks = frame_blocks(phases, date(2026, 10, 19))
        self.plan = {'settings': settings, 'blocks': blocks, 'weeks': {},
                     'frame': {'id': 'frame', 'status': 'active', 'blockIds': [b['id'] for b in blocks]}}
        self.ids = [b['id'] for b in blocks]

    def edit(self, items, taper=None, today=date(2026, 10, 16), shape=None):
        data = {'phases': [{'id': i, 'blockType': t, 'weeks': w} for i, t, w in items], 'taperWeeks': taper}
        return edit_phases(self.plan, self.profile, data, today, lambda monday: 10, 5.0, shape)

    def test_an_added_block_keeps_the_rhythm_running_over_the_blocks(self):
        # Regression: an added block used to restart the rhythm per block (2:1 in a 6-week block).
        settings = self.plan['settings']
        shape = lambda blocks, keep: shape_volume(blocks, settings, self.profile, [10] * 15, [None] * 15, 5, 7, None, keep)
        items = self.items(grundlage=3, vo2max=3)
        items.insert(1, (None, 'schwelle', 3))
        blocks, _, changed = self.edit(items, shape=shape)
        self.assertEqual([(b['blockType'], len(b['weeks'])) for b in blocks][:4],
                         [('grundlage', 3), ('schwelle', 3), ('vo2max', 3), ('wettkampfspezifisch', 3)])
        rhythm = ''.join('D' if w['phase'] in ('recovery', 'taper') else 'L' for b in blocks[:4] for w in b['weeks'])
        self.assertEqual(rhythm, 'LLLDLLLDLLLD')
        self.assertTrue(all(b['source'] == 'athlete' for b in blocks[:2]))
        self.assertIn('2026-W43', changed)

    def items(self, **lengths):
        types = ['grundlage', 'vo2max', 'wettkampfspezifisch', 'taper', 'uebergang']
        default = [6, 3, 3, 1, 2]
        return [(i, t, lengths.get(t, w)) for i, t, w in zip(self.ids, types, default)]

    def test_an_unchanged_list_keeps_every_block(self):
        blocks, identities, changed = self.edit(self.items())
        self.assertEqual(identities, self.ids)
        self.assertEqual([b['weeks'] for b in blocks], [b['weeks'] for b in self.plan['blocks']])
        self.assertEqual(changed, [])

    def test_lengthening_needs_room_and_moves_the_following_blocks(self):
        with self.assertRaisesRegex(CoachError, '1 Woche länger als der Plan'):
            self.edit(self.items(grundlage=7))
        with self.assertRaisesRegex(CoachError, '1 Woche bleibt ohne Block'):
            self.edit(self.items(vo2max=2))
        blocks, _, changed = self.edit(self.items(grundlage=7, vo2max=2))
        self.assertEqual([(b['blockType'], b['startDate'], len(b['weeks'])) for b in blocks][:3],
                         [('grundlage', '2026-10-19', 7), ('vo2max', '2026-12-07', 2), ('wettkampfspezifisch', '2026-12-21', 3)])
        # Resized blocks follow the 3:1 rhythm; the race block in front of the taper keeps its weeks.
        self.assertEqual([w['phase'] for w in blocks[0]['weeks']], ['base', 'base', 'base', 'recovery', 'base', 'base', 'recovery'])
        self.assertEqual(blocks[2]['weeks'], self.plan['blocks'][2]['weeks'])
        self.assertEqual(blocks[0]['source'], 'athlete')
        self.assertEqual(changed[0], '2026-W43')

    def test_own_blocks_get_a_rule_outline_and_a_stable_id(self):
        items = self.items(grundlage=4)
        items.insert(1, (None, 'vo2max', 2))
        first, _, _ = self.edit(items)
        again, _, _ = self.edit(items)
        self.assertEqual(first, again)
        added = first[1]
        self.assertEqual((added['blockType'], added['startDate'], [w['phase'] for w in added['weeks']]),
                         ('vo2max', '2026-11-16', ['build', 'recovery']))
        # A new block takes the volume of its neighbour: 6 h, the deload at 65 %.
        self.assertEqual([w['targetHours'] for w in added['weeks']], [6.0, 3.5])

    def test_the_block_before_the_event_stays_at_the_event(self):
        with self.assertRaisesRegex(CoachError, 'Datum'):
            self.edit([(self.ids[0], 'grundlage', 6), (self.ids[1], 'vo2max', 3), (self.ids[2], 'wettkampfspezifisch', 3),
                       (self.ids[4], 'uebergang', 2), (self.ids[3], 'taper', 1)])
        with self.assertRaisesRegex(CoachError, 'nur vor einem A-Event'):
            self.edit(self.items()[:4] + [(self.ids[4], 'wettkampfspezifisch', 2)])

    def test_the_taper_length_builds_the_plan_backwards_from_the_event(self):
        with self.assertRaisesRegex(CoachError, 'Taper von 2 Wochen'):
            self.edit(self.items(), taper=2)
        blocks, _, _ = self.edit(self.items(wettkampfspezifisch=2, taper=2), taper=2)
        taper = blocks[3]
        self.assertEqual((taper['startDate'], taper['endDate']), ('2027-01-04', '2027-01-17'))
        self.assertEqual([(w['phase'], w['targetHours']) for w in taper['weeks']], [('taper', 4.0), ('taper', 3.0)])

    def test_weeks_that_are_over_stay(self):
        today = date(2026, 11, 11)  # Week 4 of the plan runs.
        with self.assertRaisesRegex(CoachError, 'Vergangene Wochen'):
            self.edit(self.items(grundlage=2, vo2max=7), today=today)
        blocks, _, _ = self.edit(self.items(grundlage=4, vo2max=5), today=today)
        self.assertEqual(blocks[0]['weeks'][:3], self.plan['blocks'][0]['weeks'][:3])

    def test_outline_follows_fixed_rules_within_the_time(self):
        weeks = outline_weeks('grundlage', 4, 8, [10, 10, 8.2, 10])
        self.assertEqual([(w['week'], w['phase'], w['targetHours']) for w in weeks],
                         [(1, 'base', 8.0), (2, 'base', 8.0), (3, 'base', 8.0), (4, 'recovery', 4.5)])
        self.assertEqual([w['targetHours'] for w in outline_weeks('taper', 3, 10, [10] * 3)], [7.5, 6.0, 4.5])
        self.assertEqual([w['targetHours'] for w in outline_weeks('taper', 1, 10, [10], preferred=8)], [5.5])
