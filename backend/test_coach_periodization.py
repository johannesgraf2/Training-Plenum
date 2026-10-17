import copy
import unittest
from datetime import date, timedelta

from coach_domain import DEFAULT_PROFILE, DAYS, CoachError, complete_event, complete_profile, effective_availability, iso_week, threshold_pace, update_profile
from coach_periodization import edit_frame, initial_segments, periodized_blocks
from coach_plan import horizon, plan_weeks


class PeriodizationTests(unittest.TestCase):
    def setUp(self):
        self.profile = complete_profile(DEFAULT_PROFILE)
        self.profile['background'].update(weeklyHours=4, source='athlete')
        self.profile['availability'].update(defaultAvailability=dict.fromkeys(DAYS, 1440), absoluteMaxWeeklyHours=13, maxWeeklyHours=13)
        self.settings = {'startDate': '2026-10-19', 'endDate': '2027-01-10', 'replanMode': 'manual', 'taperWeeks': 1}
        self.profile['events'] = [complete_event({'title': 'Frankfurt Marathon', 'sport': 'run', 'startDate': '2027-01-10', 'priority': 'A'}, 'race')]
        self.segments = [self.segment('base', 'grundlage', '2026-10-19', 11), self.segment('taper', 'taper', '2027-01-04', 1)]

    @staticmethod
    def segment(identity, kind, start, weeks):
        return {'id': identity, 'blockType': kind, 'secondaryFocus': None, 'purpose': 'Fokus', 'startDate': start, 'weeks': weeks}

    def blocks(self, segments=None, settings=None):
        return periodized_blocks(segments or self.segments, settings or self.settings, self.profile, 'frame')

    def test_volume_starts_at_training_baseline_and_respects_weekly_and_daily_caps(self):
        original = copy.deepcopy(self.profile)
        blocks = self.blocks()
        self.assertEqual(blocks[0]['weeks'][0]['targetHours'], 4)
        self.assertLess(max(w['targetHours'] for b in blocks for w in b['weeks']), 13)
        self.assertEqual(self.profile, original)
        self.profile['availability']['maxWeeklyHours'] = 2
        self.assertTrue(all(w['targetHours'] <= 2 for b in self.blocks() for w in b['weeks']))
        self.profile['availability']['exceptions'] = [{'id': 'holiday', 'from': '2026-10-19', 'to': '2026-10-25',
                                                       'kind': 'unavailable', 'maxMinutes': None, 'note': ''}]
        self.assertEqual(self.blocks()[0]['weeks'][0]['targetHours'], 0)

    def test_three_load_weeks_are_anchored_backwards_from_one_or_two_taper_weeks(self):
        weeks = [w for b in self.blocks() for w in b['weeks']]
        self.assertEqual([w['phase'] for w in weeks[-5:]], ['recovery', 'base', 'base', 'base', 'taper'])
        settings = {**self.settings, 'taperWeeks': 2}
        segments = [self.segment('base', 'grundlage', '2026-10-19', 10), self.segment('taper', 'taper', '2026-12-28', 2)]
        weeks = [w for b in self.blocks(segments, settings) for w in b['weeks']]
        self.assertEqual([w['phase'] for w in weeks[-6:]], ['recovery', 'base', 'base', 'base', 'taper', 'taper'])
        self.assertLess(weeks[-1]['targetHours'], weeks[-2]['targetHours'])

    def test_conflicts_never_move_events_or_mutate_the_input(self):
        original = copy.deepcopy(self.segments)
        bad = copy.deepcopy(self.segments)
        bad[0]['weeks'] += 1
        with self.assertRaisesRegex(CoachError, 'Blockkonflikt'):
            self.blocks(bad)
        bad = copy.deepcopy(self.segments)
        bad[-1]['blockType'] = 'vo2max'
        with self.assertRaisesRegex(CoachError, 'Eventdatum bleibt fest'):
            self.blocks(bad)
        self.assertEqual(self.segments, original)
        self.assertEqual(self.profile['events'][0]['startDate'], '2027-01-10')

    def test_manual_blocks_can_exceed_old_type_limits_and_keep_workouts(self):
        settings = {**self.settings, 'endDate': '2027-10-17'}  # 52 weeks.
        self.profile['events'] = []
        long = [self.segment('base', 'vo2max', '2026-10-19', 52)]
        self.assertEqual(len(self.blocks(long, settings)[0]['weeks']), 52)
        plan = {'settings': settings, 'frame': {'id': 'frame', 'status': 'active', 'blockIds': ['base']},
                'blocks': self.blocks(long, settings), 'weeks': {'2026-W43': {'targetHours': 99, 'sessions': [{'id': 'locked', 'locked': True}], 'review': {'effort': 3}}}}
        request = {'revision': 1, 'taperWeeks': 1, 'phases': [self.segment('base', 'grundlage', '2026-10-19', 48),
                                                           self.segment(None, 'vo2max', '2027-09-20', 4)]}
        changed = edit_frame(plan, request, self.profile)
        self.assertEqual(changed, edit_frame(plan, request, self.profile))
        self.assertEqual(changed['weeks']['2026-W43']['sessions'], plan['weeks']['2026-W43']['sessions'])
        self.assertEqual(changed['weeks']['2026-W43']['review'], {'effort': 3})
        self.assertTrue(changed['weeks']['2026-W43']['needsReview'])
        self.assertEqual(changed['weeks']['2026-W43']['targetHours'], changed['blocks'][0]['weeks'][0]['targetHours'])
        self.assertEqual(plan['weeks']['2026-W43']['targetHours'], 99)

    def test_initial_frame_reserves_selected_taper_and_horizon_can_exceed_three(self):
        phases = [{'blockType': 'grundlage', 'secondaryFocus': None, 'purpose': 'Basis', 'weeks': [{}] * 8},
                  {'blockType': 'wettkampfspezifisch', 'secondaryFocus': None, 'purpose': 'Rennen', 'weeks': [{}] * 4}]
        settings = {**self.settings, 'taperWeeks': 2}
        segments = initial_segments(phases, settings, self.profile)
        self.assertEqual((segments[-1]['blockType'], segments[-1]['weeks'], segments[-1]['startDate']), ('taper', 2, '2026-12-28'))
        self.blocks(segments, settings)
        keys = plan_weeks(settings)
        self.assertEqual(horizon(keys, date(2026, 10, 17), 5), keys[:5])
        self.assertEqual(horizon(keys, date(2026, 10, 17), 10**30), keys)

    def test_multiple_event_cycles_each_keep_their_own_taper(self):
        self.settings['endDate'] = '2027-04-04'
        self.profile['events'].append(complete_event({'title': 'Ziel 2', 'sport': 'run', 'startDate': '2027-04-04', 'priority': 'A'}, 'race2'))
        phases = [{'blockType': 'grundlage', 'secondaryFocus': None, 'purpose': 'Basis', 'weeks': [{}] * 24}]
        blocks = self.blocks(initial_segments(phases, self.settings, self.profile))
        self.assertEqual([b['endDate'] for b in blocks if b['blockType'] == 'taper'], ['2027-01-10', '2027-04-04'])


class ProfileReferenceTests(unittest.TestCase):
    def test_ten_km_reference_is_persisted_but_never_used_as_measured_threshold(self):
        profile = update_profile(DEFAULT_PROFILE, {'thresholds': {'run': {'source': 'athlete', 'paceSecPerKm': 270, 'basis': None, 'referenceType': 'tenKm'}}})
        self.assertEqual(profile['thresholds']['run']['referenceType'], 'tenKm')
        self.assertIsNone(threshold_pace(profile))
        profile = update_profile(profile, {'thresholds': {'run': {'source': 'athlete', 'paceSecPerKm': 280, 'basis': None, 'referenceType': 'threshold'}}})
        self.assertEqual(threshold_pace(profile), 280)

    def test_legacy_days_migrate_and_new_preferences_leave_availability_intact(self):
        old = copy.deepcopy(DEFAULT_PROFILE)
        old['availability'].pop('restDays'); old['availability'].pop('longDays')
        old['availability'].update(restDay='mon', longDay='sat', defaultAvailability=dict.fromkeys(DAYS, 60))
        profile = complete_profile(old)
        self.assertEqual(profile['availability']['restDays'], ['mon'])
        profile = update_profile(profile, {'availability': {'restDays': ['mon', 'fri'], 'longDays': ['sat', 'sun']}})
        limits = effective_availability(profile, '2026-W43')
        self.assertEqual([day for day in DAYS if limits[day]['preferRest']], ['mon', 'fri'])
        self.assertEqual([day for day in DAYS if limits[day]['preferLong']], ['sat', 'sun'])
        self.assertEqual(limits['mon']['maxMinutes'], 60)
        self.assertEqual(profile['availability']['restDay'], 'mon')
        cleared = update_profile(profile, {'availability': {'restDays': [], 'longDays': []}})
        limits = effective_availability(cleared, '2026-W43')
        self.assertFalse(any(day['preferRest'] or day['preferLong'] for day in limits.values()))
