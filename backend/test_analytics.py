import unittest
from datetime import date, datetime
from types import SimpleNamespace
from dateutil.tz import gettz
from analytics import activity_summary, aggregate, fitness, sensor_summary, zones, POWER_LIMITS, HR_LIMITS


def summary(points=None, **kwargs):
    activity = SimpleNamespace(date=datetime(2026, 1, 1, 12), sport='ride', duration=60,
                               distance=40, elevation=500, calories=600)
    for key, value in kwargs.items():
        setattr(activity, key, value)
    points = points if points is not None else [{'time': t, 'power': 200, 'hr': 140} for t in range(3601)]
    return activity_summary(activity, points, {})


def report(rows, year='2026', **kwargs):
    return aggregate(rows, year, gettz('Europe/Berlin'), ftp=200, max_hr=200, today=date(2026, 1, 15), **kwargs)


class AnalyticsTests(unittest.TestCase):
    def test_current_year_includes_every_week_through_december(self):
        result = report(summary([]))
        self.assertEqual(len(result['weeks']), 53)
        self.assertEqual(result['weeks'][0]['key'], '2025-12-29')
        self.assertEqual(result['weeks'][-1]['key'], '2026-12-28')
        self.assertEqual(result['weeks'][-1]['end'], '2027-01-03')
        self.assertFalse(result['weeks'][2]['future'])
        self.assertTrue(result['weeks'][3]['future'])
        self.assertFalse(result['weeks'][2]['days'][3]['future'])
        self.assertTrue(result['weeks'][2]['days'][4]['future'])
        self.assertEqual(sum(week['seconds'] or 0 for week in result['weeks']), result['totals']['seconds'])
        empty = report([], year='2024')
        self.assertEqual(empty['weeks'][0]['key'], '2024-01-01')
        self.assertEqual(empty['weeks'][-1]['key'], '2024-12-30')
        self.assertFalse(any(week['future'] for week in empty['weeks']))

    def test_one_hour_at_ftp_is_100_tss_and_exact_zone_time(self):
        rows = summary()
        result = report(rows)
        self.assertAlmostEqual(result['totals']['tss'], 100)
        self.assertEqual(result['totals']['powerZones'], [0, 0, 0, 3600, 0, 0, 0])
        self.assertEqual(result['totals']['hrZones'], [0, 3600, 0, 0, 0])
        self.assertEqual(result['weeks'][0]['key'], '2025-12-29')
        self.assertEqual(result['weeks'][0]['days'][3]['tss'], 100)
        self.assertEqual(result['weeks'][1]['tss'], 0)

    def test_sensor_intervals_use_time_not_counts_and_preserve_zero(self):
        points = [{'time': 0, 'power': 0, 'hr': 0}, {'time': 10, 'power': 200, 'hr': 120},
                  {'time': 30}, {'time': 40, 'power': 300}, {'time': 100, 'power': 500}]
        power = sensor_summary(points, 'power', 0, 100)
        self.assertEqual(power['histogram'], {0: 10, 200: 20})
        self.assertEqual(power['seconds'], 30)
        self.assertAlmostEqual(power['np'], 4000 / 30)
        self.assertEqual(sensor_summary(points, 'hr', 0, 100)['seconds'], 20)

    def test_power_windows_do_not_cross_gaps_or_missing_data(self):
        for points in [
            [{'time': 0, 'power': 200}, {'time': 20}, {'time': 21, 'power': 200}, {'time': 40}],
            [{'time': 0, 'power': 200}, {'time': 20, 'power': 200}, {'time': 100, 'power': 200}, {'time': 120}],
        ]:
            self.assertIsNone(sensor_summary(points, 'power', 0, 200)['np'])

    def test_session_start_never_uses_previous_sports_reading(self):
        points = [{'time': 55, 'power': 200}, {'time': 65, 'power': 400}, {'time': 75, 'power': 400}]
        self.assertEqual(sensor_summary(points, 'power', 60, 75)['histogram'], {400: 10})
        backwards = [{'time': 0, 'power': 100}, {'time': 20, 'power': 100}, {'time': 10, 'power': 100}, {'time': 30, 'power': 100}]
        self.assertEqual(sensor_summary(backwards, 'power', 0, 30)['seconds'], 20)

    def test_variable_power_np_matches_independent_reference(self):
        powers = [0] * 30 + [400] * 30 + [200] * 60
        points = [{'time': i, 'power': p} for i, p in enumerate(powers + [0])]
        expected = (sum((sum(powers[i:i + 30]) / 30) ** 4 for i in range(len(powers) - 29)) / (len(powers) - 29)) ** .25
        self.assertAlmostEqual(sensor_summary(points, 'power', 0, 120)['np'], expected)

    def test_missing_summary_is_null_not_zero_and_no_tss_from_average(self):
        result = report(summary([], calories=None, elevation=None))
        self.assertIsNone(result['totals']['calories'])
        self.assertIsNone(result['cyclingYears'][0]['elevation'])
        self.assertIsNone(result['weeks'][0]['tss'])
        self.assertEqual(result['weeks'][0]['known']['tss'], 0)
        self.assertEqual(result['weeks'][1]['calories'], 0)
        partial = report(summary() + summary([], calories=None))['totals']
        self.assertEqual(partial['calories'], 600)
        self.assertEqual(partial['known']['calories'], 1)
        self.assertEqual(partial['count'], 2)

    def test_incomplete_power_and_running_power_do_not_supply_cycling_tss(self):
        short = [{'time': t, 'power': 200} for t in range(3001)]
        self.assertIsNone(report(summary(short))['totals']['tss'])
        running = report(summary(sport='run'))
        self.assertIsNone(running['totals']['tss'])
        self.assertEqual(sum(running['totals']['powerZones']), 0)

    def test_zone_boundaries_and_noninteger_values(self):
        self.assertEqual(zones({'110': 1, '110.01': 2, '150': 3, '300.01': 4}, 200, POWER_LIMITS), [1, 5, 0, 0, 0, 0, 4])
        self.assertEqual(zones({'120': 1, '180': 2, '181': 3}, 200, HR_LIMITS), [1, 0, 0, 2, 3])

    def test_local_year_week_dst_and_legacy_wall_time(self):
        rows = summary([], date=datetime(2025, 12, 31, 23, 30))
        rows[0]['utc'] = True
        result = report(rows)
        self.assertEqual(result['totals']['count'], 1)
        self.assertEqual(result['weeks'][0]['days'][3]['count'], 1)
        rows[0]['utc'] = False
        self.assertEqual(report(rows)['totals']['count'], 0)
        rows = summary([], date=datetime(2026, 3, 29, 22, 30))
        rows[0]['utc'] = True
        result = aggregate(rows, '2026', gettz('Europe/Berlin'), today=date(2026, 4, 1))
        self.assertEqual(next(w for w in result['weeks'] if w['count'])['key'], '2026-03-30')

    def test_multisport_splits_time_and_annual_totals_once(self):
        activity = SimpleNamespace(date=datetime(2026, 1, 1, 12), sport='multisport')
        details = {'sessions': [
            {'sport': 'ride', 'startTime': '2026-01-01T12:00:00Z', 'elapsedSeconds': 60, 'timerSeconds': 60, 'distanceKm': 1, 'elevation': 5, 'calories': 10},
            {'sport': 'run', 'startTime': '2026-01-01T12:01:00Z', 'elapsedSeconds': 60, 'timerSeconds': 60, 'distanceKm': .2, 'elevation': 1, 'calories': 5},
        ]}
        points = [{'time': t, 'power': 200 if t < 60 else 400, 'hr': 140} for t in range(121)]
        rows = activity_summary(activity, points, details)
        result = report(rows)
        self.assertEqual([r['seconds'] for r in result['sportShare']], [60, 60])
        self.assertEqual(result['cyclingYears'][0]['distance'], 1)
        self.assertEqual(sum(result['totals']['powerZones']), 60)
        self.assertEqual(report(rows, sport='run')['totals']['distance'], .2)

    def test_all_years_include_only_years_with_cycling(self):
        rows = summary([], date=datetime(2022, 1, 1)) + summary([], date=datetime(2024, 1, 1)) + summary([], sport='run')
        result = report(rows, year='all')
        self.assertEqual([r['key'] for r in result['cyclingYears']], ['2022', '2024'])
        self.assertEqual(result['years'], [2026, 2024, 2022])


    def test_fitness_is_42_day_weighted_load_from_power_or_heart_rate(self):
        zone = gettz('Europe/Berlin')
        result = fitness(summary(), zone, ftp=200, max_hr=200, today=date(2026, 1, 1))
        self.assertEqual(len(result['days']), 730)
        self.assertEqual(result['days'][-1], {'key': '2026-01-01', 'value': round(100 / 42, 1), 'fatigue': round(100 / 7, 1),
                                              'form': 0, 'load': 100})
        self.assertEqual((result['fatigue'], result['form'], result['fatigueWindow']), (round(100 / 7, 1), 0, 7))
        self.assertEqual(result['days'][0]['value'], 0)
        self.assertEqual(result['activities'], {'power': 1, 'hr': 0, 'missing': 0})
        later = fitness(summary(), zone, ftp=200, max_hr=200, today=date(2026, 2, 12))
        self.assertAlmostEqual(later['value'], round(100 / 42 * (41 / 42) ** 42, 1))
        # The day after the ride starts with fitness minus fatigue of the ride day.
        self.assertEqual(later['days'][-42]['form'], round(100 / 42 - 100 / 7, 1))
        self.assertAlmostEqual(later['fatigue'], round(100 / 7 * (6 / 7) ** 42, 1))
        # Without FTP the same ride counts via heart rate: 140 bpm / 180 bpm threshold for one hour.
        by_hr = fitness(summary(), zone, max_hr=200, today=date(2026, 1, 1))
        self.assertEqual(by_hr['activities'], {'power': 0, 'hr': 1, 'missing': 0})
        self.assertAlmostEqual(by_hr['days'][-1]['load'], round((140 / 180) ** 2 * 100, 1))
        self.assertEqual(by_hr['thresholdHr'], 180)

    def test_fitness_skips_future_and_unmeasured_activities(self):
        zone = gettz('Europe/Berlin')
        rows = summary([]) + summary(date=datetime(2026, 3, 1))
        result = fitness(rows, zone, ftp=200, max_hr=200, today=date(2026, 1, 15))
        self.assertIsNone(result['value'])
        self.assertEqual(result['days'], [])
        self.assertEqual(result['activities']['missing'], 1)
        self.assertIsNone(fitness(summary(), zone, today=date(2026, 1, 15))['value'])


if __name__ == '__main__':
    unittest.main()
