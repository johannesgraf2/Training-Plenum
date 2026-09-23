import random
import unittest
from datetime import datetime

from best_efforts import activity_efforts, power_efforts, running_efforts


class BestEffortTests(unittest.TestCase):
    def test_power_uses_elapsed_weighting_and_includes_zero(self):
        points = [{'time': 0, 'power': 300}, {'time': 10, 'power': 0}, {'time': 30, 'power': 999}]
        effort, = power_efforts(points)
        self.assertEqual(effort, {'target': 30, 'value': 100, 'startSeconds': 0, 'endSeconds': 30})

    def test_power_searches_windows_between_sample_starts(self):
        points = [{'time': t, 'power': p} for t, p in [(0, 0), (20, 100), (40, 300), (55, 0)]]
        effort, = power_efforts(points)
        self.assertEqual(effort['startSeconds'], 25)
        self.assertEqual(effort['value'], 200)

    def test_power_matches_independent_one_second_reference(self):
        rng = random.Random(7)
        times = [0]
        while times[-1] < 400:
            times.append(times[-1] + rng.randrange(1, 15))
        powers = [rng.randrange(0, 500) for _ in times]
        points = [{'time': time, 'power': power} for time, power in zip(times, powers)]
        seconds = [powers[i] for i in range(len(times) - 1) for _ in range(times[i + 1] - times[i])]
        for effort in power_efforts(points):
            duration = effort['target']
            expected = max(sum(seconds[start:start + duration]) / duration for start in range(len(seconds) - duration + 1))
            self.assertAlmostEqual(effort['value'], expected)

    def test_missing_power_gaps_and_short_samples_do_not_make_a_record(self):
        for points in [
            [{'time': 0, 'power': 600}, {'time': 10}, {'time': 20, 'power': 600}, {'time': 40, 'power': 600}],
            [{'time': 0, 'power': 600}, {'time': 40, 'power': 600}],
            [{'time': 0, 'power': 600}, {'time': 29, 'power': 600}],
            [{'time': 0, 'power': 600}, {'time': 30, 'power': float('nan')}],
        ]:
            self.assertEqual(power_efforts(points), [])
        self.assertEqual(power_efforts([{'time': 0, 'power': 0}, {'time': 30, 'power': 0}])[0]['value'], 0)

    def test_running_interpolates_exact_distance_and_uses_meters(self):
        points = [{'time': t, 'distance': 100 + t * 4} for t in range(0, 271, 30)]
        efforts = {effort['target']: effort for effort in running_efforts(points)}
        self.assertAlmostEqual(efforts[400]['value'], 100)
        self.assertAlmostEqual(efforts[1000]['value'], 250)
        self.assertNotIn(5000, efforts)

    def test_running_searches_both_window_edges(self):
        points = [{'time': t, 'distance': d} for t, d in [(0, 0), (30, 150), (60, 300), (90, 600)]]
        effort, = running_efforts(points)
        self.assertEqual(effort['startSeconds'], 40)
        self.assertEqual(effort['value'], 50)

    def test_running_pauses_count_inside_an_effort_but_not_before_it(self):
        points = [{'time': t, 'distance': d} for t, d in [(0, 0), (20, 0), (40, 200), (60, 200), (80, 400)]]
        effort, = running_efforts(points)
        self.assertEqual(effort['startSeconds'], 20)
        self.assertEqual(effort['value'], 60)

    def test_distance_reset_missing_values_and_long_gaps_are_not_bridged(self):
        for points in [
            [{'time': 0, 'distance': 0}, {'time': 30, 'distance': 200}, {'time': 60, 'distance': 0}, {'time': 90, 'distance': 200}],
            [{'time': 0, 'distance': 0}, {'time': 30}, {'time': 60, 'distance': 400}],
            [{'time': 0, 'distance': 0}, {'time': 100, 'distance': 400}],
        ]:
            self.assertEqual(running_efforts(points), [])

    def test_all_requested_targets_and_multisport_boundaries(self):
        ride = [{'time': t, 'power': 200} for t in range(0, 3601, 30)]
        run = [{'time': t, 'distance': t * 5} for t in range(0, 4201, 30)]
        self.assertEqual([r['target'] for r in power_efforts(ride)], [30, 60, 180, 300, 600, 1200, 3600])
        self.assertEqual([r['target'] for r in running_efforts(run)], [400, 1000, 5000, 10000, 21000])
        details = {'sessions': [{'sport': 'ride', 'startTime': '2026-01-01T00:00:00Z', 'elapsedSeconds': 20}, {'sport': 'run', 'startTime': '2026-01-01T00:00:20Z', 'elapsedSeconds': 41}]}
        records = [{'time': t, 'power': 500, 'distance': t * 10} for t in range(0, 61, 10)]
        efforts = activity_efforts(records, 'multisport', details, datetime(2026, 1, 1))
        self.assertEqual(efforts['ride'], [])
        self.assertEqual(efforts['run'][0]['value'], 40)


if __name__ == '__main__':
    unittest.main()
