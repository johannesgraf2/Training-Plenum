import io
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from zipfile import ZipFile

from fitparse import FitFile
from garmin_fit_sdk import Encoder, Profile
from workout_export import WorkoutError
from workout_schedule_probe import (IDENTITY_FIELDS, build_pair, build_probe_zip, decode_checked,
                                    probe_workout, scheduled_midnight, validate_pair)


class ScheduleProbeTests(unittest.TestCase):
    def test_real_binary_pair_links_to_the_exact_workout(self):
        workout, schedule = build_pair(probe_workout('2026-09-24'))
        workout_id = next(FitFile(workout).get_messages('file_id'))
        schedule_id = next(FitFile(schedule).get_messages('file_id'))
        entry = next(FitFile(schedule).get_messages('schedule'))
        self.assertEqual(schedule_id.get_value('type'), 'schedules')
        for key in IDENTITY_FIELDS:
            self.assertEqual(entry.get_value(key), workout_id.get_value(key), key)
        self.assertFalse(entry.get_value('completed'))
        self.assertEqual(entry.get_value('type'), 'workout')
        self.assertEqual(entry.get_value('scheduled_time'), datetime(2026, 9, 24))
        validate_pair(workout, schedule, '2026-09-24')

    def test_calendar_date_does_not_apply_utc_or_daylight_saving_offsets(self):
        # Include both European DST transitions and a year boundary.
        for day in ('2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25', '2027-01-01'):
            with self.subTest(day=day):
                _, schedule = build_pair(probe_workout(day))
                raw = decode_checked(schedule)['schedule_mesgs'][0]['scheduled_time']
                self.assertEqual(datetime(1989, 12, 31) + timedelta(seconds=raw), datetime.fromisoformat(day))
        self.assertEqual(scheduled_midnight('2026-03-30') - scheduled_midnight('2026-03-29'), 86400)
        for day in ('1989-12-30', '1990-01-01', '9999-12-31'):
            with self.assertRaises(WorkoutError):
                build_pair(probe_workout(day))

    def test_reference_date_and_corruption_mismatches_are_rejected(self):
        workout, schedule = build_pair(probe_workout('2026-09-24'))
        changed = probe_workout('2026-09-24')
        changed['steps'][0]['duration']['value'] = 600
        other_workout, _ = build_pair(changed)
        with self.assertRaisesRegex(RuntimeError, 'verweist'):
            validate_pair(other_workout, schedule, '2026-09-24')
        with self.assertRaisesRegex(RuntimeError, 'Trainingsdatum'):
            validate_pair(workout, schedule, '2026-09-25')
        # Prove that time_created is part of the reference, not only serial_number.
        messages = decode_checked(schedule)
        encoder = Encoder()
        encoder.on_mesg(Profile['mesg_num']['FILE_ID'], messages['file_id_mesgs'][0])
        entry = {**messages['schedule_mesgs'][0]}
        entry['time_created'] += 1
        encoder.on_mesg(Profile['mesg_num']['SCHEDULE'], entry)
        with self.assertRaisesRegex(RuntimeError, 'verweist'):
            validate_pair(workout, bytes(encoder.close()), '2026-09-24')
        for which in (0, 1):
            pair = [workout, schedule]
            corrupted = bytearray(pair[which]); corrupted[-1] ^= 1; pair[which] = bytes(corrupted)
            with self.assertRaises(RuntimeError):
                validate_pair(*pair, '2026-09-24')

    def test_zip_contains_one_matching_pair_and_honest_device_status(self):
        with patch('workout_schedule_probe.export_workout', wraps=__import__('workout_export').export_workout) as export:
            content, report = build_probe_zip('2026-09-24')
            self.assertEqual(export.call_count, 1)
        with ZipFile(io.BytesIO(content)) as archive:
            self.assertEqual(len(archive.namelist()), 4)
            validate_pair(archive.read('trainhub-usb-2026-09-24-workout.fit'),
                          archive.read('trainhub-usb-2026-09-24-schedule.fit'), '2026-09-24')
            self.assertEqual(json.loads(archive.read('validation.json')), report)
            self.assertEqual(report['status'], 'binary_validated_device_not_tested')
            self.assertIn('Noch NICHT am Edge 1050 getestet', archive.read('ANLEITUNG.txt').decode())


if __name__ == '__main__':
    unittest.main()
