import copy
import unittest
from datetime import date

from coach_blocks import new_block
from coach_domain import DEFAULT_PROFILE, CoachError
from coach_season import check_options, check_season, dated, new_season, public_season, season_frame, with_fixed

TODAY = date(2026, 9, 23)  # Wednesday
GOAL = '2027-01-31'  # Sunday; 18 weeks from Monday 2026-09-28


def block(identity='grundlage', start='2026-09-28', weeks=6, status='active'):
    outline = [{'week': i + 1, 'phase': 'base', 'targetHours': 6, 'focus': ''} for i in range(weeks)]
    return {**new_block(identity, None, start, outline), 'status': status}


def segment(identity, weeks, secondary=None):
    return {'blockType': identity, 'secondaryFocus': secondary, 'weeks': weeks, 'purpose': 'Warum dieser Block.'}


def profile(gym=False):
    value = copy.deepcopy(DEFAULT_PROFILE)
    value['preferences']['gymAvailability'] = gym
    return value


class FrameTests(unittest.TestCase):
    def test_without_blocks_the_season_starts_next_monday(self):
        frame = season_frame([], GOAL, TODAY)
        self.assertEqual((frame['start'].isoformat(), frame['openFrom'].isoformat()), ('2026-09-28', '2026-09-28'))
        self.assertEqual((frame['totalWeeks'], frame['remainingWeeks'], frame['fixed']), (18, 18, []))

    def test_current_and_upcoming_blocks_stay_fixed_ended_and_abandoned_ones_do_not(self):
        blocks = [block('uebergang', '2026-08-31', 2), block('vo2max', '2026-09-14', 4, status='abandoned'), block()]
        frame = season_frame(blocks, GOAL, TODAY)
        self.assertEqual([item['blockType'] for item in frame['fixed']], ['grundlage'])
        self.assertEqual(frame['fixed'][0]['blockId'], blocks[-1]['id'])
        self.assertEqual((frame['openFrom'].isoformat(), frame['remainingWeeks'], frame['totalWeeks']), ('2026-11-09', 12, 18))

    def test_goal_must_exist_leave_room_and_stay_within_two_years(self):
        with self.assertRaisesRegex(CoachError, 'Zieldatum'):
            season_frame([], None, TODAY)
        with self.assertRaisesRegex(CoachError, 'zu wenig Zeit'):
            season_frame([], '2026-09-30', TODAY)
        with self.assertRaisesRegex(CoachError, 'höchstens 104 Wochen'):
            season_frame([], '2028-12-31', TODAY)


class RuleTests(unittest.TestCase):
    def setUp(self):
        self.frame = season_frame([block()], GOAL, TODAY)

    def test_blocks_fill_every_week_and_end_race_specific(self):
        good = with_fixed([segment('aufbau', 4), segment('vo2max', 4), segment('wettkampfspezifisch', 4)], self.frame)
        check_season(good, self.frame, profile())
        with self.assertRaisesRegex(CoachError, 'ergeben 17 Wochen, bis zur Zielwoche sind es 18'):
            check_season(with_fixed([segment('aufbau', 4), segment('vo2max', 3), segment('wettkampfspezifisch', 4)], self.frame),
                         self.frame, profile())
        with self.assertRaisesRegex(CoachError, 'letzte Block'):
            check_season(with_fixed([segment('aufbau', 4), segment('wettkampfspezifisch', 4), segment('vo2max', 4)], self.frame),
                         self.frame, profile())

    def test_each_new_block_fits_its_type(self):
        with self.assertRaisesRegex(CoachError, 'Block 3: „VO2max“ dauert 3–6 Wochen'):
            check_season(with_fixed([segment('aufbau', 4), segment('vo2max', 8)], self.frame), self.frame, profile())
        with self.assertRaisesRegex(CoachError, 'Block 2: .*Krafttraining'):
            check_season(with_fixed([segment('aufbau', 8, 'kraft'), segment('wettkampfspezifisch', 4)], self.frame), self.frame, profile())
        check_season(with_fixed([segment('aufbau', 8, 'kraft'), segment('wettkampfspezifisch', 4)], self.frame), self.frame, profile(gym=True))

    def test_options_need_two_or_three_plans_and_one_recommendation(self):
        plan = lambda identity, recommended: {'id': identity, 'recommended': recommended, 'rationale': '', 'segments': []}
        check_options({'options': [plan('a', True), plan('b', False)]})
        for options in ([plan('a', True)], [plan('a', True), plan('b', True)], [plan('a', True), plan('a', False)]):
            with self.assertRaises(CoachError):
                check_options({'options': options})


class PublicSeasonTests(unittest.TestCase):
    def test_dates_are_consecutive_and_fit_is_reported(self):
        blocks = [block()]
        frame = season_frame(blocks, GOAL, TODAY)
        segments = with_fixed([segment('aufbau', 4), segment('vo2max', 4), segment('wettkampfspezifisch', 4)], frame)
        season = new_season(segments, frame, GOAL, 'Grundlage, dann Intensität.', 'aiRecommendation')
        self.assertEqual([(s['startDate'], s['endDate']) for s in dated(season)],
                         [('2026-09-28', '2026-11-08'), ('2026-11-09', '2026-12-06'), ('2026-12-07', '2027-01-03'),
                          ('2027-01-04', '2027-01-31')])
        result = public_season(season, blocks, GOAL, TODAY)
        self.assertTrue(result['aligned'])
        self.assertEqual((result['openFrom'], result['remainingWeeks'], result['segments'][1]['typeName']), ('2026-11-09', 12, 'Aufbau'))
        moved = public_season(season, blocks, '2027-02-07', TODAY)
        self.assertTrue(moved['goalChanged'])
        self.assertFalse(moved['aligned'])
        # The athlete planned a longer next block than the season foresaw.
        self.assertFalse(public_season(season, [*blocks, block('aufbau', '2026-11-09', 5)], GOAL, TODAY)['aligned'])
        self.assertIsNone(public_season(None, blocks, GOAL, TODAY))


if __name__ == '__main__':
    unittest.main()
