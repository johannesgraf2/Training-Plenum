import copy
import unittest
from datetime import date, datetime, timedelta

from coach_blocks import suggested_rhythm
from coach_domain import DAYS, CoachError, complete_profile, DEFAULT_PROFILE, complete_event, iso_week
from coach_plan import (check_frame, check_tests, deviation, due_week, frame_blocks, frame_hint, group_sessions, horizon,
                        plan_span, plan_weeks, reference_monday, required_tests)


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

    def test_hint_shows_the_usual_build_up_to_the_first_a_event(self):
        hint = frame_hint(self.settings, self.profile)
        self.assertEqual((hint['event'], hint['weeks'], sum(s['weeks'] for s in hint['segments'])), ('Rennen', 13, 13))


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


if __name__ == '__main__':
    unittest.main()
