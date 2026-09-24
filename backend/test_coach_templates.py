import math
import unittest

from jsonschema import Draft202012Validator

from coach_templates import (PARAM_NAMES, SESSION_SCHEMA, TEMPLATES, TemplateError, flat_steps,
                             render_session, template_catalog)
from coach_api import workout_minutes
from workout_export import validate_workout


DAY = '2026-09-23'


class TemplateTests(unittest.TestCase):
    def test_all_default_templates_render_to_existing_workout_model(self):
        for template in TEMPLATES:
            with self.subTest(template=template):
                session = render_session(template, {}, DAY, ftp=250, max_hr=190)
                if session['sport'] in ('ride', 'run'):
                    self.assertEqual(validate_workout(session['workout']), session['workout'])
                    self.assertEqual(sum(step['duration']['value'] for step in flat_steps(session['workout']['steps'])) / 60,
                                     session['durationMin'])
                    self.assertAlmostEqual(workout_minutes(session['workout']), session['durationMin'], places=3)
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

    def test_interval_rides_can_sit_inside_a_longer_easy_ride(self):
        params = {'intervals': 5, 'workMin': 5, 'recoveryMin': 3, 'intensity': 1.12}
        short = render_session('bike_vo2', params, DAY, ftp=250)
        self.assertEqual(short['durationMin'], 10 + 25 + 12 + 10)
        long = render_session('bike_vo2', {**params, 'durationMin': 120}, DAY, ftp=250)
        self.assertEqual(long['durationMin'], 120)
        steps = long['workout']['steps']
        self.assertEqual([s['name'] for s in steps[:2]], ['Aufwärmen', 'Grundlage'])
        self.assertEqual([s['name'] for s in steps[-2:]], ['Grundlage', 'Abwärmen'])
        self.assertEqual(sum(s['duration']['value'] for s in steps if s['name'] == 'Grundlage') / 60, 120 - 57)
        self.assertEqual(steps[1]['target'], {'type': 'power', 'low': 158, 'high': 168})
        self.assertEqual(render_session('bike_vo2', {**params, 'durationMin': 57}, DAY)['durationMin'], 57)
        with self.assertRaisesRegex(TemplateError, 'kürzer'):
            render_session('bike_vo2', {**params, 'durationMin': 50}, DAY)
        with self.assertRaises(TemplateError):
            render_session('run_threshold', {'durationMin': 90}, DAY)

    def test_micro_intervals_are_sets_of_repeat_blocks_with_set_rests(self):
        session = render_session('bike_vo2_micro', {'sets': 3, 'reps': 13, 'workSec': 30, 'restSec': 15, 'setRestMin': 5,
                                                    'intensity': 1.3, 'cadence': 100}, DAY, ftp=250)
        self.assertEqual(session['name'], 'VO2-Mikrointervalle Rad 3×13×30/15')
        self.assertEqual(session['workout']['name'], session['name'])
        steps = session['workout']['steps']
        self.assertEqual([s['kind'] for s in steps], ['step', 'repeat', 'step', 'repeat', 'step', 'repeat', 'step'])
        work, rest = steps[1]['steps']
        self.assertEqual((steps[1]['count'], work['duration']['value'], rest['duration']['value']), (13, 30, 15))
        self.assertEqual(work['name'], 'Satz 1 · Hart · 100 U/min')
        self.assertEqual(work['target'], {'type': 'power', 'low': 312, 'high': 338})
        self.assertEqual(steps[2]['name'], 'Satzpause')
        self.assertEqual(session['durationMin'], 10 + 3 * 13 * 45 / 60 + 2 * 5 + 10)
        forty = render_session('bike_vo2_micro', {'sets': 3, 'reps': 10, 'workSec': 40, 'restSec': 20, 'durationMin': 120}, DAY, ftp=250)
        self.assertEqual((forty['name'], forty['durationMin']), ('VO2-Mikrointervalle Rad 3×10×40/20', 120))
        with self.assertRaises(TemplateError):
            render_session('bike_vo2_micro', {'workSec': 5}, DAY)

    def test_sit_and_sprints_inside_an_easy_ride(self):
        sit = render_session('bike_sit', {'reps': 6}, DAY, ftp=250)
        self.assertEqual(sit['name'], 'Sprintintervalle (SIT) Rad 6×30 s')
        self.assertEqual(sit['workout']['steps'][1]['steps'][0]['target'], {'type': 'power', 'low': 388, 'high': 462})
        self.assertEqual(sit['durationMin'], 10 + 6 * (30 + 240) / 60 + 10)
        ride = render_session('bike_z2_sprints', {'durationMin': 120, 'reps': 8, 'workSec': 10}, DAY, ftp=250)
        self.assertEqual((ride['name'], ride['durationMin']), ('Grundlage mit Sprints 8×10 s', 120))
        sprints = [s for s in flat_steps(ride['workout']['steps']) if s['name'] == 'Sprint']
        self.assertEqual((len(sprints), sprints[0]['target']), (8, {'type': 'power', 'low': 375, 'high': 625}))

    def test_fueling_follows_the_aim_and_length_of_the_session(self):
        note = lambda template, **params: render_session(template, params, DAY, ftp=250)['notes']
        self.assertIn('(HIT)', note('bike_vo2_micro'))
        self.assertIn('(HIT)', note('bike_sit'))
        self.assertIn('40–60 g/h', note('bike_sweetspot'))
        self.assertEqual(note('bike_z2_short'), 'Verpflegung (LIT): Optional nur Wasser. Danach Protein.')
        self.assertIn('30 g/h', note('bike_z2', durationMin=120))
        self.assertIn('lange Einheit', note('bike_z2_long', durationMin=180))
        self.assertIn('lange Einheit', note('bike_vo2', durationMin=180))
        self.assertIn('Wasser reicht', note('bike_recovery'))
        self.assertIn('Protein', note('strength_general'))
        self.assertIsNone(note('rest'))
        session = render_session('bike_vo2', {}, DAY, ftp=250)
        self.assertEqual(session['workout']['notes'], session['notes'])

    def test_catalog_explains_new_templates_to_the_coach(self):
        catalog = {item['id']: item for item in template_catalog()}
        self.assertIn('30/15', catalog['bike_vo2_micro']['use'])
        self.assertIn('setRestMin', catalog['bike_vo2_micro']['durationRule'])
        self.assertIn('cadence', catalog['bike_vo2']['durationRule'])
        self.assertNotIn('cadence', catalog['run_threshold']['durationRule'])

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
