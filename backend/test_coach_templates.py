import math
import unittest

from jsonschema import Draft202012Validator

from coach_templates import (PARAM_NAMES, SESSION_SCHEMA, TEMPLATES, TemplateError,
                             render_session, template_catalog)
from workout_export import validate_workout


DAY = '2026-09-23'


class TemplateTests(unittest.TestCase):
    def test_all_default_templates_render_to_existing_workout_model(self):
        for template in TEMPLATES:
            with self.subTest(template=template):
                session = render_session(template, {}, DAY, ftp=250, max_hr=190)
                if session['sport'] in ('ride', 'run'):
                    self.assertEqual(validate_workout(session['workout']), session['workout'])
                    self.assertEqual(sum(step['duration']['value'] for step in session['workout']['steps']) / 60,
                                     session['durationMin'])
                else:
                    self.assertIsNone(session['workout'])

    def test_total_duration_includes_warmup_cooldown_and_recovery_between_intervals(self):
        session = render_session('bike_threshold_intervals', {'intervals': 3, 'workMin': 12,
                                 'recoveryMin': 6, 'intensity': .98}, DAY, ftp=250)
        self.assertEqual(session['durationMin'], 10 + 3 * 12 + 2 * 6 + 10)
        work = [item for item in session['workout']['steps'] if item['intensity'] == 'interval']
        recoveries = [item for item in session['workout']['steps'] if item['intensity'] == 'recovery']
        self.assertEqual(len(work), 3)
        self.assertEqual(len(recoveries), 2)
        self.assertEqual(work[0]['target'], {'type': 'power', 'low': 240, 'high': 250})
        self.assertEqual(render_session('bike_z2', {'durationMin': 90}, DAY)['durationMin'], 90)

    def test_missing_ftp_does_not_create_watts_or_tss(self):
        session = render_session('bike_vo2', {}, DAY)
        self.assertIsNone(session['estimatedTss'])
        self.assertTrue(all(step['target'] == {'type': 'none'} for step in session['workout']['steps']))
        self.assertEqual(session['params']['intensity'], 1.12)

    def test_running_heart_rate_targets_require_max_hr_and_never_use_cycling_ftp(self):
        session = render_session('run_easy', {}, DAY, ftp=250, max_hr=200)
        self.assertIsNone(session['estimatedTss'])
        self.assertEqual(session['workout']['steps'][1]['target'], {'type': 'heart_rate', 'low': 135, 'high': 145})
        missing = render_session('run_easy', {}, DAY, ftp=250)
        self.assertTrue(all(item['target'] == {'type': 'none'} for item in missing['workout']['steps']))

    def test_planned_tss_matches_independent_secondwise_normalized_power(self):
        session = render_session('bike_threshold', {'intervals': 3, 'workMin': 12}, DAY, ftp=250)
        watts = []
        for step in session['workout']['steps']:
            target = step['target']
            watts.extend([(target['low'] + target['high']) / 2] * step['duration']['value'])
        fourth_sum = sum((sum(watts[i:i + 30]) / 30) ** 4 for i in range(len(watts) - 29))
        normalized = (fourth_sum / (len(watts) - 29)) ** .25
        expected = round(len(watts) / 3600 * (normalized / 250) ** 2 * 100, 1)
        self.assertEqual(session['estimatedTss'], expected)
        self.assertTrue(math.isfinite(session['estimatedTss']))

    def test_parameters_are_bounded_and_unknowns_rejected(self):
        cases = [('bike_z2', {'durationMin': 0}), ('bike_z2', {'durationMin': 90.5}),
                 ('bike_z2', {'intensity': float('nan')}), ('bike_z2', {'intensity': 1.5}),
                 ('bike_z2', {'durationMin': True}), ('bike_z2', {'evil': None}),
                 ('bike_z2', {'workMin': 10}), ('rest', {'durationMin': 30}),
                 ('bike_threshold', {'intervals': 99}), ('bike_threshold', {'recoveryMin': -1})]
        for template, params in cases:
            with self.subTest(template=template, params=params), self.assertRaises(TemplateError):
                render_session(template, params, DAY)

    def test_unknown_template_invalid_date_and_invalid_athlete_settings_rejected(self):
        for template, day, kwargs in [('unknown', DAY, {}), ('rest', '2026-02-30', {}),
                                     ('rest', '20260923', {}), ('bike_z2', DAY, {'ftp': 0}),
                                     ('run_easy', DAY, {'max_hr': float('inf')})]:
            with self.assertRaises(TemplateError):
                render_session(template, {}, day, **kwargs)

    def test_strict_provider_nulls_are_defaulted_and_catalog_is_independent(self):
        session = {'id': 'wed-easy', 'day': 'wed', 'template': 'bike_z2',
                   'params': dict.fromkeys(PARAM_NAMES)}
        Draft202012Validator.check_schema(SESSION_SCHEMA)
        Draft202012Validator(SESSION_SCHEMA).validate(session)
        self.assertEqual(render_session(session['template'], session['params'], DAY),
                         render_session('bike_z2', {}, DAY))
        first = template_catalog()
        first[0]['defaults']['durationMin'] = 9999
        self.assertEqual(template_catalog()[0]['defaults']['durationMin'], 45)


if __name__ == '__main__':
    unittest.main()
