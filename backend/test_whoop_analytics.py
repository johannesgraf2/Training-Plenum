import unittest
from datetime import date, datetime, timedelta
from math import exp, log, sqrt

from dateutil.tz import gettz

import whoop_analytics as wa

ZONE = gettz('Europe/Berlin')
DAY = date(2026, 10, 14)


def at(day, hour, minute=0):
    return int(datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZONE).timestamp())


def synthetic_night(ectopic=True, off_wrist=True):
    """Awake and moving from 18:00, asleep 23:00-07:00 with a 5-min wake at 03:00, awake again until 12:00.

    Sleep HR is 52 with a 10-min dip to 48 at 04:00; R-R alternates 1000/1040 ms (RMSSD 40).
    From 09:00 to 11:00 the strap lies still on a table (no contact, no HR).
    """
    columns = {'ts': [], 'hr': [], 'gravity': [], 'contact': []}
    rr = []
    previous = DAY - timedelta(days=1)
    sleep_start, sleep_end = at(previous, 23), at(DAY, 7)
    wake_bout, dip = at(DAY, 3), at(DAY, 4)
    table = (at(DAY, 9), at(DAY, 11))
    for second in range(at(previous, 18), at(DAY, 12)):
        asleep = sleep_start <= second < sleep_end and not wake_bout <= second < wake_bout + 300
        lying = off_wrist and table[0] <= second < table[1]
        if lying:
            hr, gravity, contact = None, (0.0, 0.0, -1.0), 0
        elif asleep:
            hr = 48 if dip <= second < dip + 600 else 52
            gravity, contact = (0.0, 0.002 * (second % 2), 1.0), 1
        else:
            hr, gravity, contact = 75, (0.05 * (second % 3), 0.0, 0.98), 1
        columns['ts'].append(second)
        columns['hr'].append(hr)
        columns['gravity'].append(gravity)
        columns['contact'].append(contact)
        if asleep:
            rr.append((second, 0, 1000 if second % 2 else 1040))
    if ectopic:
        index = len(rr) // 2
        rr[index] = (rr[index][0], 0, 1500)
    columns['rr'] = rr
    return columns


class SleepAndHrvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = wa.nightly_metrics(DAY, ZONE, synthetic_night(), maximum=190)

    def test_sleep_window_spans_the_night_and_absorbs_the_short_wake(self):
        sleep = self.result['sleep']
        self.assertEqual(sleep['sessions'], 1)
        self.assertLessEqual(abs(sleep['start'] - at(DAY - timedelta(days=1), 23)), 600)
        self.assertLessEqual(abs(sleep['end'] - at(DAY, 7)), 600)
        self.assertTrue(440 <= sleep['minutes'] <= 480, sleep)
        self.assertLess(sleep['minutes'], sleep['inBedMinutes'])
        self.assertTrue(0.9 < sleep['efficiency'] < 1)

    def test_strap_on_the_table_is_not_sleep(self):
        self.assertEqual(self.result['sleep']['sessions'], 1)

    def test_hrv_matches_hand_calculation_despite_ectopic_beat(self):
        # |1000 - 1040| = 40 between every pair of neighbours -> RMSSD 40.
        self.assertEqual(self.result['hrv'], 40.0)
        self.assertGreater(self.result['hrvWindows'], 80)

    def test_resting_hr_is_the_lowest_five_minute_mean(self):
        self.assertEqual(self.result['rhr'], 48.0)

    def test_day_without_sleep_ending_on_it(self):
        result = wa.nightly_metrics(DAY - timedelta(days=1), ZONE, synthetic_night(), maximum=190)
        self.assertIsNone(result['sleep'])
        self.assertIsNone(result['hrv'])

    def test_rmssd_needs_twenty_clean_beats_and_skips_gaps(self):
        self.assertIsNone(wa.rmssd([(i, 1000) for i in range(19)]))
        beats = [(i, 1000 if i % 2 else 1060) for i in range(30)] + [(100 + i, 900 if i % 2 else 940) for i in range(30)]
        # 29 differences of 60 ms, then a 71 s gap (no difference), then 29 differences of 40 ms.
        self.assertAlmostEqual(wa.rmssd(beats), sqrt((29 * 60 ** 2 + 29 * 40 ** 2) / 58), places=6)

    def test_malik_drops_outliers_but_keeps_edge_beats(self):
        keep = wa.clean_beats([(0, 1500), (1, 1000), (2, 1000), (3, 2500), (4, 1000), (5, 1000), (6, 1700), (7, 250)])
        self.assertEqual(keep, [True, True, True, False, True, True, True, False])


class StrainTests(unittest.TestCase):
    def test_edwards_trimp_and_scale(self):
        # One hour at 85 % HRR (zone weight 4) -> TRIMP 240.
        ts = list(range(3600))
        hr = [round(50 + 0.85 * 140)] * 3600
        result = wa.strain(ts, hr, maximum=190, resting=50)
        self.assertAlmostEqual(result['trimp'], 240.0, places=0)
        self.assertEqual(result['strain'], round(21 * log(241) / log(7201), 1))

    def test_needs_enough_samples_and_a_heart_rate_reserve(self):
        self.assertIsNone(wa.strain(list(range(500)), [120] * 500, maximum=190))
        self.assertIsNone(wa.strain(list(range(700)), [120] * 700, maximum=40, resting=50))
        self.assertEqual(wa.hr_max(None, 30), 187.0)
        self.assertEqual(wa.hr_max(191, 30), 191.0)


class ScoreTests(unittest.TestCase):
    def nights(self, count, **overrides):
        days = {DAY + timedelta(days=i): {'hrv': 60.0, 'rhr': 50.0, 'sleep': {'minutes': 480}} for i in range(count)}
        for offset, values in overrides.items():
            days[DAY + timedelta(days=int(offset))] = values
        return days

    def test_calibration_tiers(self):
        scores = wa.score_days(self.nights(16))
        ordered = [scores[day] for day in sorted(scores)]
        self.assertEqual([s['confidence'] for s in ordered[:4]], ['calibrating'] * 4)
        self.assertTrue(all(s['readiness'] is None for s in ordered[:4]))
        self.assertEqual(ordered[4]['confidence'], 'provisional')
        self.assertEqual(ordered[14]['confidence'], 'solid')
        self.assertEqual(ordered[3]['nights'], 4)

    def test_neutral_night_scores_yellow_near_the_documented_value(self):
        score = wa.score_days(self.nights(5))[DAY + timedelta(days=4)]
        mean_z = 0.15 * ((1 - 0.85) / 0.12) / 0.9
        self.assertEqual(score['readiness'], round(100 / (1 + exp(-1.6 * (mean_z + 0.2)))))
        self.assertEqual(score['band'], 'yellow')

    def test_bad_night_is_red_and_does_not_drag_the_baseline(self):
        days = self.nights(8, **{'6': {'hrv': 30.0, 'rhr': 60.0, 'sleep': {'minutes': 300}}})
        scores = wa.score_days(days)
        bad = scores[DAY + timedelta(days=6)]
        self.assertEqual(bad['band'], 'red')
        self.assertLess(bad['readiness'], 5)
        # HRV 30 is more than 5 spreads below 60: ignored, so the next baseline is unchanged.
        self.assertEqual(scores[DAY + timedelta(days=7)]['hrvBaseline']['mean'], 60.0)

    def test_missing_hrv_falls_back_to_rhr_and_sleep(self):
        scores = wa.score_days(self.nights(6, **{'5': {'hrv': None, 'rhr': 50.0, 'sleep': {'minutes': 480}}}))
        self.assertIsNotNone(scores[DAY + timedelta(days=5)]['readiness'])
        nothing = wa.score_days(self.nights(6, **{'5': {'hrv': None, 'rhr': None, 'sleep': {'minutes': 480}}}))
        self.assertIsNone(nothing[DAY + timedelta(days=5)]['readiness'])

    def test_baseline_rejects_values_outside_limits(self):
        baseline = wa.Baseline('rhr')
        self.assertFalse(baseline.add(25))
        self.assertFalse(baseline.add(None))
        self.assertTrue(baseline.add(50))
        self.assertEqual(baseline.snapshot()['spread'], 2)

    def test_sleep_debt_recurrence(self):
        minutes = {DAY: 480, DAY + timedelta(days=1): 480, DAY + timedelta(days=2): 360, DAY + timedelta(days=3): 480}
        self.assertEqual(wa.sleep_debt(minutes, DAY + timedelta(days=2)), 66)
        self.assertEqual(wa.sleep_debt(minutes, DAY + timedelta(days=3)), 36)
        self.assertEqual(wa.sleep_debt({DAY: 470}, DAY), 0)  # under 10 min counts as none


if __name__ == '__main__':
    unittest.main()
