import copy
import unittest

from fitparse import FitFile
from garmin_fit_sdk import Decoder, Stream
from workout_export import WorkoutError, export_workout, validate_fit, validate_workout, workout_messages


def step(duration='time', value=900, target='none', low=None, high=None, intensity='warmup'):
    return {'kind': 'step', 'name': 'Aufwärmen', 'intensity': intensity,
            'duration': {'type': duration, 'value': value}, 'target': {'type': target, 'low': low, 'high': high}}


def example():
    return {'version': 1, 'name': '5 × 1000 m', 'sport': 'run', 'date': '2026-09-24', 'steps': [
        step(), {'kind': 'repeat', 'count': 5, 'steps': [step('distance', 1000, 'pace', 240, 250, 'interval'),
                                                        step('time', 120, intensity='recovery')]},
        step('time', 600, intensity='cooldown')]}


class WorkoutExportTests(unittest.TestCase):
    def test_export_prefixes_the_selected_day_without_mutating_the_plan_or_cutting_unicode(self):
        for sport, day, name, expected in [
                ('run', '2026-09-24', '5 × 1000 m', '24.09.2026 · 5 × 1000 m'),
                ('ride', '2027-01-01', '30 min konstant', '01.01.2027 · 30 min konstant'),
                ('ride', '2026-10-25', 'ä' * 40, '25.10.2026 · ' + 'ä' * 40)]:
            with self.subTest(sport=sport, day=day):
                workout = {**example(), 'sport': sport, 'date': day, 'name': name}
                original = copy.deepcopy(workout)
                for _ in range(2):
                    content = export_workout(workout)
                    self.assertEqual(next(FitFile(content).get_messages('workout')).get_value('wkt_name'), expected)
                self.assertEqual(workout, original)

    def decode(self, workout):
        content = export_workout(workout)
        messages, errors = Decoder(Stream.from_byte_array(bytearray(content))).read()
        self.assertEqual(errors, [])
        # A second, independent decoder also verifies the SDK output and its CRC.
        self.assertEqual(next(FitFile(content).get_messages('file_id')).get_value('type'), 'workout')
        return messages

    def test_notes_become_the_workout_description_on_the_device(self):
        notes = 'Verpflegung: Während der Einheit Kohlenhydrate zuführen (ca. 40–60 g/h).'
        workout = validate_workout({**example(), 'notes': f'  {notes} '})
        self.assertEqual(workout['notes'], notes)
        self.assertEqual(self.decode(workout)['workout_mesgs'][0]['wkt_description'], notes)
        self.assertNotIn('notes', validate_workout({**example(), 'notes': ''}))
        self.assertNotIn('wkt_description', self.decode(example())['workout_mesgs'][0])
        for invalid in ('ä' * 126, 'Zeile\nzwei', 42):
            with self.assertRaises(WorkoutError):
                validate_workout({**example(), 'notes': invalid})

    def test_running_example_round_trips_real_repeat_and_reversed_pace_range(self):
        messages = self.decode(example())
        self.assertEqual(messages['workout_mesgs'][0]['num_valid_steps'], 5)
        self.assertEqual(messages['workout_mesgs'][0]['sport'], 'running')
        steps = messages['workout_step_mesgs']
        self.assertEqual([s['message_index'] for s in steps], list(range(5)))
        self.assertEqual(steps[0]['duration_time'], 900)
        self.assertEqual(steps[0]['wkt_step_name'], 'Aufwärmen')
        self.assertEqual(steps[1]['duration_distance'], 1000)
        self.assertEqual(steps[1]['custom_target_speed_low'], 4)
        self.assertAlmostEqual(steps[1]['custom_target_speed_high'], 1000 / 240, places=3)
        self.assertEqual(steps[2]['duration_time'], 120)
        self.assertEqual(steps[3]['duration_type'], 'repeat_until_steps_cmplt')
        self.assertEqual(steps[3]['duration_step'], 1)
        self.assertEqual(steps[3]['repeat_steps'], 5)
        self.assertEqual(steps[4]['duration_time'], 600)
        self.assertEqual([s.get('intensity') for s in steps], ['warmup', 'interval', 'recovery', None, 'cooldown'])

    def test_all_cycling_targets_and_open_steps(self):
        workout = example()
        workout.update(sport='ride', steps=[step('open', target=target, low=low, high=high) for target, low, high in [
            ('heart_rate', 130, 155), ('power', 200, 250), ('cadence', 80, 95), ('speed', 25.2, 36), ('none', None, None)]])
        messages = self.decode(workout)
        self.assertEqual(messages['workout_mesgs'][0]['sport'], 'cycling')
        steps = messages['workout_step_mesgs']
        self.assertEqual([s['duration_type'] for s in steps], ['open'] * 5)
        # Absolute bpm and watts must not accidentally become percentage targets.
        self.assertEqual((steps[0]['custom_target_value_low'], steps[0]['custom_target_value_high']), (230, 255))
        self.assertEqual((steps[1]['custom_target_value_low'], steps[1]['custom_target_value_high']), (1200, 1250))
        self.assertEqual((steps[2]['custom_target_cadence_low'], steps[2]['custom_target_cadence_high']), (80, 95))
        self.assertEqual((steps[3]['custom_target_speed_low'], steps[3]['custom_target_speed_high']), (7, 10))
        self.assertEqual(steps[4]['target_type'], 'open')

    def test_multiple_repeat_blocks_reference_their_own_start(self):
        workout = example()
        workout['steps'].append(copy.deepcopy(workout['steps'][1]))
        steps = self.decode(workout)['workout_step_mesgs']
        self.assertEqual([(s['message_index'], s['duration_step']) for s in steps if 'duration_step' in s], [(3, 1), (7, 5)])

    def test_invalid_models_are_rejected(self):
        bad = [None, [], {}, {**example(), 'name': ''}, {**example(), 'name': 'x\x00y'},
               {**example(), 'name': 'ä' * 41}, {**example(), 'date': '2026-02-30'},
               {**example(), 'sport': 'swim'}, {**example(), 'steps': []},
               {**example(), 'steps': [step('time', float('nan'))]},
               {**example(), 'steps': [step('time', True)]},
               {**example(), 'steps': [step('time', 10 ** 400)]},
               {**example(), 'steps': [step(intensity=[])]},
               {**example(), 'name': '\ud800'},
               {**example(), 'steps': [step('time', 0)]},
               {**example(), 'steps': [step('distance', -1)]},
               {**example(), 'steps': [step(target='pace', low=250, high=240)]},
               {**example(), 'steps': [step(target='power', low=0, high=300)]},
               {**example(), 'steps': [step(target='heart_rate', low=130.5, high=150)]},
               {**example(), 'steps': [{'kind': 'repeat', 'count': 2, 'steps': []}]},
               {**example(), 'steps': [{'kind': 'repeat', 'count': 1, 'steps': [step()]}]},
               {**example(), 'steps': [{'kind': 'repeat', 'count': 2, 'steps': [example()['steps'][1]]}]},
               {**example(), 'steps': [step()] * 51}]
        for item in bad:
            with self.subTest(model=item), self.assertRaises(WorkoutError):
                validate_workout(item)

    def test_step_limit_counts_repeat_markers_and_crc_failure_blocks_download(self):
        workout = example()
        workout['steps'] = [step()] * 48 + [{'kind': 'repeat', 'count': 99, 'steps': [step()]}]
        self.assertEqual(self.decode(workout)['workout_mesgs'][0]['num_valid_steps'], 50)
        workout['steps'].append(step())
        with self.assertRaises(WorkoutError):
            export_workout(workout)
        content = bytearray(export_workout(example()))
        content[-1] ^= 0x01
        with self.assertRaises(RuntimeError):
            validate_fit(content, {}, workout_messages(validate_workout(example())))


if __name__ == '__main__':
    unittest.main()
