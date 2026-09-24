import copy
import json
import unittest
from datetime import date, timedelta

from dateutil.tz import gettz

from athlete_context import build_snapshot, session_pattern, summarize_period


TODAY = date(2026, 9, 23)
ATHLETE = {'age': 34, 'weight': 70, 'sport': 'ride', 'ftp': 200, 'maxHr': 200}


def row(day='2026-09-23', hours=1, sport='ride', activity_id=None, power_fraction=1, hr_fraction=1):
    seconds = hours * 3600 if hours is not None else None
    measured = seconds if seconds is not None else 1800
    return {'date': day, 'utc': True, 'sport': sport, 'seconds': seconds,
            'distance': 30 if sport == 'ride' else 10, 'elevation': 100,
            'calories': 500, 'activityId': activity_id,
            'power': {'histogram': {'200': measured * power_fraction},
                      'seconds': measured * power_fraction, 'np': 200},
            'hr': {'histogram': {'140': measured * hr_fraction},
                   'seconds': measured * hr_fraction, 'np': None},
            'tssFactor': seconds / 3600 * 200 ** 2 * 100 if seconds is not None and sport == 'ride' else None}


def snapshot(rows, efforts=None, athlete=None, today=TODAY, reported=None):
    return build_snapshot(rows, efforts or [], ATHLETE if athlete is None else athlete,
                          reported or {}, 'Europe/Berlin', today=today)


class AthleteContextTests(unittest.TestCase):
    def test_session_pattern_describes_recent_complete_weeks(self):
        # TODAY is Wednesday 2026-09-23; the current week and older weeks are left out.
        rows = [row('2026-09-15T08:00:00Z', 1.5), row('2026-09-17T08:00:00Z', 2), row('2026-09-19T08:00:00Z', 3),
                row('2026-09-19T15:00:00Z', .5, sport='run'), row('2026-09-09T08:00:00Z', 1),
                row('2026-09-22T08:00:00Z', 5), row('2026-07-01T08:00:00Z', 9)]
        result = session_pattern(rows, 'Europe/Berlin', TODAY, weeks=2)
        self.assertEqual((result['start'], result['end']), ('2026-09-07', '2026-09-20'))
        self.assertEqual(result['sessionsPerWeekMedian'], 2.5)
        self.assertEqual(result['trainingDaysPerWeekMedian'], 2)
        self.assertEqual(result['sessionMinutesMedian'], 90)
        self.assertEqual(result['rideMinutesMedian'], 105)
        self.assertEqual(result['longestSessionMinutes'], 180)
        self.assertEqual(result['sessionsUnder60MinShare'], .2)
        self.assertIsNone(session_pattern([], 'Europe/Berlin', TODAY)['sessionMinutesMedian'])

    def test_recorded_totals_and_sensor_denominators_without_raw_samples(self):
        result = snapshot([row(activity_id=1), row(sport='run', hours=2, activity_id=2)])
        current = result['observed']['currentTraining']['last7Days']
        self.assertEqual(current['trainingHours'], 3)
        self.assertEqual(current['activityCount'], 2)
        self.assertEqual(current['distanceKm'], 40)
        self.assertEqual(current['cyclingTss'], 100)
        self.assertEqual(current['powerZonesSeconds'], [0, 0, 0, 3600, 0, 0, 0])
        self.assertEqual(current['heartRateZonesSeconds'], [0, 10800, 0, 0, 0])
        power = current['intensityDistribution']['cyclingPower']
        self.assertEqual(power['denominatorSeconds'], 3600)
        self.assertEqual(power['high']['share'], 1)
        self.assertEqual(result['dataQuality']['cyclingPowerCoverageLast42Days'], 1)
        self.assertNotIn('histogram', json.dumps(result))
        self.assertNotIn('tssFactor', json.dumps(result))
        self.assertEqual(result['observed']['source'], 'calculated')
        self.assertEqual(result['athlete']['source'], 'athlete')

    def test_local_inclusive_rolling_boundaries_and_future_records(self):
        rows = [row('2026-09-16T22:30:00Z'), row('2026-09-16T21:30:00Z'),
                row('2026-09-23T22:30:00Z')]
        result = snapshot(rows)
        self.assertEqual(result['observed']['currentTraining']['last7Days']['trainingHours'], 1)
        self.assertEqual(result['observed']['currentTraining']['last28Days']['trainingHours'], 2)
        self.assertEqual(result['dataQuality']['futureSessionsExcluded'], 1)
        self.assertEqual(result['dataQuality']['lastRecordedDate'], '2026-09-17')
        rows[0]['utc'] = False
        self.assertEqual(snapshot(rows)['observed']['currentTraining']['last7Days']['trainingHours'], 0)

    def test_week_feedback_uses_calendar_dates_across_dst(self):
        rows = [row('2026-03-29T21:30:00Z'), row('2026-03-29T22:30:00Z')]
        result = summarize_period(rows, gettz('Europe/Berlin'), '2026-03-23', '2026-03-29', 200, 200)
        self.assertEqual(result['trainingHours'], 1)
        self.assertEqual(result['cyclingTss'], 100)
        self.assertEqual(build_snapshot([], [], {}, {}, gettz('Europe/Berlin'), TODAY)['timezone'], 'Europe/Berlin')
        with self.assertRaises(ValueError):
            summarize_period([], 'Europe/Berlin', '2026-03-30', '2026-03-29')

    def test_multisport_counts_activity_once_and_sessions_separately(self):
        rows = [row(activity_id=42), row(sport='run', activity_id=42)]
        current = snapshot(rows)['observed']['currentTraining']['last7Days']
        self.assertEqual(current['activityCount'], 1)
        self.assertEqual(current['sessionCount'], 2)
        self.assertEqual(current['trainingHours'], 2)
        self.assertEqual([item['durationShare'] for item in current['sportDistribution']], [.5, .5])

    def test_tss_is_null_if_any_cycling_session_has_partial_power(self):
        result = snapshot([row(), row(power_fraction=.5), row(sport='run')])
        current = result['observed']['currentTraining']['last42Days']
        self.assertIsNone(current['cyclingTss'])
        self.assertEqual(current['cyclingTssReason'], 'insufficient_power_coverage_or_normalized_power')
        self.assertEqual(result['dataQuality']['cyclingPowerCoverageLast42Days'], .75)
        self.assertEqual(current['intensityDistribution']['cyclingPower']['denominatorSeconds'], 5400)
        self.assertEqual(current['dataQuality']['cyclingPower']['eligibleSeconds'], 7200)

    def test_missing_normalized_power_does_not_get_estimated_from_average(self):
        activity = row()
        activity['tssFactor'] = None
        activity['power']['np'] = None
        current = snapshot([activity])['observed']['currentTraining']['last7Days']
        self.assertIsNone(current['cyclingTss'])
        self.assertEqual(current['powerZonesSeconds'][3], 3600)

    def test_coverage_is_duration_weighted_capped_and_never_above_one(self):
        result = snapshot([row(hours=1, power_fraction=0, hr_fraction=0),
                           row(hours=3, power_fraction=1.04, hr_fraction=2)])
        current = result['observed']['currentTraining']['last42Days']
        self.assertEqual(result['dataQuality']['cyclingPowerCoverageLast42Days'], .75)
        self.assertEqual(result['dataQuality']['heartRateCoverageLast42Days'], .75)
        self.assertEqual(sum(current['powerZonesSeconds']), 10800)
        self.assertEqual(sum(current['heartRateZonesSeconds']), 10800)
        slightly_long = snapshot([row(power_fraction=1.04)])['observed']['currentTraining']['last7Days']
        self.assertEqual(slightly_long['cyclingTss'], 100)
        unreliable = snapshot([row(power_fraction=2)])['observed']['currentTraining']['last7Days']
        self.assertIsNone(unreliable['cyclingTss'])

    def test_partial_totals_and_unknown_duration_have_explicit_quality(self):
        missing = row(hours=None)
        missing['distance'] = missing['elevation'] = None
        result = snapshot([row(), missing])
        current = result['observed']['currentTraining']['last7Days']
        self.assertEqual(current['trainingHours'], 1)
        self.assertEqual(current['distanceKm'], 30)
        self.assertEqual(current['elevationM'], 100)
        self.assertEqual(current['dataQuality']['durationMissingSessions'], 1)
        self.assertEqual(current['dataQuality']['distanceMissingSessions'], 1)
        self.assertIsNone(current['cyclingTss'])
        self.assertIsNone(result['dataQuality']['cyclingPowerCoverageLast42Days'])
        self.assertEqual(current['cyclingTssReason'], 'missing_cycling_duration')
        self.assertIsNone(snapshot([missing])['observed']['currentTraining']['last7Days']['trainingHours'])

    def test_no_data_and_missing_thresholds_are_not_fabricated(self):
        result = snapshot([], athlete={})
        current = result['observed']['currentTraining']['last7Days']
        self.assertEqual(current['trainingHours'], 0)
        self.assertIsNone(current['cyclingTss'])
        self.assertIsNone(current['powerZonesSeconds'])
        self.assertIsNone(current['heartRateZonesSeconds'])
        self.assertFalse(result['dataQuality']['ftpConfigured'])
        self.assertIsNone(result['observed']['observedTrainingCapacity']['maxSingleWeekHours'])
        for invalid in [None, 0, -1, True, float('nan'), float('inf')]:
            invalid_result = snapshot([row()], athlete={'ftp': invalid, 'maxHr': invalid})
            self.assertFalse(invalid_result['dataQuality']['ftpConfigured'])
            self.assertIsNone(invalid_result['observed']['currentTraining']['last7Days']['cyclingTss'])

    def test_running_power_is_not_cycling_power_or_tss(self):
        result = snapshot([row(sport='run')])
        current = result['observed']['currentTraining']['last7Days']
        self.assertIsNone(current['cyclingTss'])
        self.assertIsNone(current['powerZonesSeconds'])
        self.assertIsNone(result['dataQuality']['cyclingPowerCoverageLast42Days'])
        self.assertEqual(result['dataQuality']['heartRateCoverageLast42Days'], 1)

    def test_best_efforts_keep_windows_dates_and_units(self):
        efforts = [
            {'sport': 'ride', 'target': 1200, 'value': 320, 'date': '2025-09-22', 'activityId': 1},
            {'sport': 'ride', 'target': 1200, 'value': 310, 'date': '2026-01-01', 'activityId': 2},
            {'sport': 'ride', 'target': 1200, 'value': 290, 'date': '2026-09-22T22:30:00Z', 'activityId': 3},
            {'sport': 'run', 'target': 5000, 'value': 1200, 'date': '2026-09-01', 'activityId': 4},
            {'sport': 'run', 'target': 5000, 'value': 1300, 'date': '2026-09-22', 'activityId': 5},
            {'sport': 'ride', 'target': 1200, 'value': 500, 'date': '2026-09-24', 'activityId': 6},
        ]
        best = snapshot([], efforts)['observed']['performanceHistory']['bestEfforts']
        self.assertEqual(best['allTime']['cycling']['20min']['watts'], 320)
        self.assertEqual(best['last365Days']['cycling']['20min']['watts'], 310)
        self.assertEqual(best['last90Days']['cycling']['20min'],
                         {'watts': 290, 'date': '2026-09-23', 'ageDays': 0, 'activityId': 3})
        self.assertEqual(best['last90Days']['running']['5km']['durationSeconds'], 1200)
        self.assertEqual(best['last90Days']['running']['5km']['ageDays'], 22)
        efforts[2]['utc'] = False
        self.assertEqual(snapshot([], efforts)['observed']['performanceHistory']['bestEfforts']['last90Days']['cycling']['20min']['ageDays'], 1)

    def test_best_effort_window_edges_and_ties_prefer_most_recent(self):
        efforts = [
            {'sport': 'ride', 'target': 30, 'value': 900, 'date': (TODAY - timedelta(days=90)).isoformat()},
            {'sport': 'ride', 'target': 30, 'value': 800, 'date': (TODAY - timedelta(days=89)).isoformat()},
            {'sport': 'ride', 'target': 30, 'value': 800, 'date': TODAY.isoformat()},
        ]
        best = snapshot([], efforts)['observed']['performanceHistory']['bestEfforts']
        self.assertEqual(best['last90Days']['cycling']['30s']['watts'], 800)
        self.assertEqual(best['last90Days']['cycling']['30s']['ageDays'], 0)
        self.assertEqual(best['allTime']['cycling']['30s']['watts'], 900)

    def test_capacity_uses_contiguous_weeks_and_counts_inactive_weeks(self):
        today = date(2026, 3, 2)  # Monday; exactly eight completed weeks since Jan 5.
        rows = [row('2026-01-05', hours=8), row('2026-01-19', hours=8),
                row('2026-02-02', hours=8), row('2026-02-16', hours=8),
                row('2026-03-02', hours=100)]
        result = snapshot(rows, today=today)
        capacity = result['observed']['observedTrainingCapacity']
        self.assertEqual(capacity['completeWeeks'], 8)
        self.assertEqual(capacity['maxSingleWeekHours'], 8)
        self.assertEqual(capacity['max4WeekAverageHours'], 4)
        self.assertEqual(capacity['max6WeekAverageHours'], 4)
        self.assertEqual(capacity['max8WeekAverageHours'], 4)
        history = result['observed']['trainingHistory']['last365Days']
        self.assertEqual(history['trainingHours'], 132)
        self.assertEqual(history['activeWeeks'], 4)
        self.assertEqual(history['medianWeeklyHours'], 0)
        self.assertEqual(history['maxWeeklyHours'], 8)
        self.assertEqual(history['averageWeeklyHours'], round(32 / history['completeWeeks'], 2))

    def test_capacity_excludes_first_partial_week_and_requires_enough_history(self):
        rows = [row('2026-01-07', hours=100), row('2026-01-12', hours=5), row('2026-01-19', hours=6)]
        result = snapshot(rows, today=date(2026, 1, 26))
        capacity = result['observed']['observedTrainingCapacity']
        self.assertEqual(capacity['completeWeeks'], 2)
        self.assertEqual(capacity['maxSingleWeekHours'], 6)
        self.assertIsNone(capacity['max4WeekAverageHours'])
        self.assertEqual(capacity['reasons']['max4WeekAverageHours'], 'insufficient_complete_weeks')

    def test_unknown_durations_are_not_treated_as_inactive_weeks(self):
        rows = [row('2026-01-05', hours=5), row('2026-01-12', hours=None),
                row('2026-01-19', hours=6), row('2026-01-26', hours=8)]
        result = snapshot(rows, today=date(2026, 2, 2))
        capacity = result['observed']['observedTrainingCapacity']
        self.assertEqual(capacity['maxSingleWeekHours'], 8)
        self.assertIsNone(capacity['max4WeekAverageHours'])
        self.assertEqual(capacity['reasons']['max4WeekAverageHours'], 'missing_training_duration')
        self.assertIsNone(result['observed']['trainingHistory']['last365Days']['averageWeeklyHours'])

    def test_inputs_are_not_modified_and_arbitrary_athlete_secrets_are_excluded(self):
        rows = [row()]
        rows_before = copy.deepcopy(rows)
        reported = {'goal': {'name': 'Event'}, 'source': 'aiRecommendation'}
        result = snapshot(rows, athlete={**ATHLETE, 'apiKey': 'secret', 'source': 'calculated'}, reported=reported)
        self.assertEqual(rows, rows_before)
        self.assertEqual(reported['source'], 'aiRecommendation')
        self.assertEqual(result['selfReported']['source'], 'athlete')
        self.assertEqual(result['athlete']['source'], 'athlete')
        self.assertNotIn('apiKey', result['athlete'])
        json.dumps(result, allow_nan=False)

    def test_invalid_dates_excluded_and_bad_timezone_rejected(self):
        result = snapshot([row('invalid-date'), row()])
        self.assertEqual(result['dataQuality']['invalidDateSessionsExcluded'], 1)
        self.assertEqual(result['observed']['currentTraining']['last7Days']['activityCount'], 1)
        with self.assertRaises(ValueError):
            build_snapshot([], [], {}, {}, 'Mars/Olympus', TODAY)


if __name__ == '__main__':
    unittest.main()
