import math
import unittest

from jsonschema import Draft202012Validator

from coach_templates import (PARAM_NAMES, SESSION_SCHEMA, TEMPLATES, TemplateError, flat_steps,
                             render_session, template_catalog)
from coach_api import workout_minutes
from garmin_workouts import garmin_workout
from workout_export import export_workout, validate_workout


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
            render_session('run_threshold', {'cadence': 90}, DAY)  # Cadence is for the bike.

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


class UltraAndPaceTests(unittest.TestCase):
    def test_rides_last_up_to_15_hours_and_bring_ultra_fueling_from_6_hours(self):
        for template, params in (('bike_long', {'durationMin': 900}), ('bike_z2_long', {'durationMin': 900}),
                                 ('bike_threshold', {'durationMin': 900}), ('bike_vo2_micro', {'durationMin': 900})):
            with self.subTest(template=template):
                session = render_session(template, params, DAY, ftp=250)
                self.assertEqual(session['durationMin'], 900)
                self.assertTrue(session['notes'].startswith('Verpflegung (ab 6 h)'))
                self.assertLessEqual(len(session['notes'].encode()), 250)  # FIT description field
                self.assertGreater(session['estimatedTss'], 0)
                with self.assertRaises(TemplateError):
                    render_session(template, {'durationMin': 901}, DAY, ftp=250)
        self.assertTrue(render_session('bike_long', {'durationMin': 359}, DAY)['notes'].startswith('Verpflegung (lange Einheit)'))
        self.assertTrue(render_session('bike_long', {'durationMin': 360}, DAY)['notes'].startswith('Verpflegung (ab 6 h)'))
        catalog = {t['id']: t for t in template_catalog()}
        self.assertEqual(catalog['bike_long']['params']['durationMin'], [90, 900])
        self.assertEqual(catalog['bike_z2_sprints']['params']['durationMin'], [45, 360])

    def test_runs_target_the_threshold_pace_and_fall_back_to_heart_rate(self):
        session = render_session('run_threshold', {}, DAY, max_hr=190, threshold_pace=270)
        work = [s for s in session['workout']['steps'] if s['intensity'] == 'interval']
        # 88 % of max HR sits just below threshold: about 4:27-4:40 /km for a 4:30 threshold pace.
        self.assertEqual(work[0]['target'], {'type': 'pace', 'low': 267, 'high': 280})
        easy = render_session('run_easy', {}, DAY, max_hr=190, threshold_pace=270)['workout']['steps'][1]['target']
        self.assertEqual((easy['type'], easy['low'] > 330, easy['high'] < 370), ('pace', True, True))
        heart = render_session('run_threshold', {}, DAY, max_hr=190)['workout']['steps'][1]['target']
        self.assertEqual(heart['type'], 'heart_rate')
        self.assertEqual(render_session('run_easy', {}, DAY)['workout']['steps'][1]['target'], {'type': 'none'})
        self.assertEqual(render_session('bike_z2', {}, DAY, ftp=250, threshold_pace=270)['workout']['steps'][1]['target']['type'], 'power')
        for bad in (0, 60, 1000, float('nan')):
            with self.subTest(pace=bad), self.assertRaises(TemplateError):
                render_session('run_easy', {}, DAY, threshold_pace=bad)
        self.assertIn('pace', next(t for t in template_catalog() if t['id'] == 'run_easy')['targets'])

    def test_running_vo2_sessions_run_faster_than_threshold_pace(self):
        long = render_session('run_vo2', {}, DAY, max_hr=190, threshold_pace=270)
        self.assertEqual((long['name'], long['durationMin']), ('VO2-Intervalle Lauf 5×3 min', 38))  # 2 min jogging recovery
        work = [s for s in long['workout']['steps'] if s['intensity'] == 'interval']
        # 95 % of max HR: about 7 % faster than a 4:30 threshold pace, roughly 5 km race pace.
        self.assertEqual(work[0]['target'], {'type': 'pace', 'low': 246, 'high': 258})
        short = render_session('run_vo2_short', {'sets': 3, 'reps': 6, 'workSec': 60, 'restSec': 60}, DAY, max_hr=190)
        self.assertEqual((short['name'], short['durationMin']), ('Kurze VO2-Intervalle Lauf 3×6×60/60', 10 + 36 + 2 * 3 + 5))
        self.assertEqual(short['workout']['steps'][1]['steps'][0]['target']['type'], 'heart_rate')
        with self.assertRaises(TemplateError):
            render_session('run_vo2_short', {'cadence': 90}, DAY)  # Cadence and an embedding easy ride are for the bike.
        catalog = {t['id']: t for t in template_catalog()}
        self.assertIn('5 min cooldown', catalog['run_vo2_short']['durationRule'])

    def test_running_key_sessions_sit_inside_a_longer_run_like_a_marathon_plan(self):
        names = lambda session: [s['name'] for s in session['workout']['steps']]
        # „12 km: 3 × 6 min S, jeweils 2 min TP“: the threshold reps inside an easy run.
        threshold = render_session('run_threshold', {'intervals': 3, 'workMin': 6, 'recoveryMin': 2, 'durationMin': 65}, DAY,
                                   max_hr=190, threshold_pace=270)
        self.assertEqual((threshold['name'], threshold['durationMin']), ('Schwellenlauf 3×6 min', 65))
        self.assertEqual(names(threshold)[:2] + names(threshold)[-2:], ['Aufwärmen', 'Locker', 'Locker', 'Abwärmen'])
        # „20 min zusammenhängend S, Rest L“: one interval is a continuous tempo run.
        tempo = render_session('run_threshold', {'intervals': 1, 'workMin': 20, 'durationMin': 60}, DAY)
        self.assertEqual((tempo['name'], [n for n in names(tempo) if n.startswith('Tempo')]), ('Schwellenlauf 20 min', ['Tempo']))
        # „32 km: 16 L + 6 MP + 2 L + 6 MP + 2 L“: the easy running comes first, the race-pace blocks late.
        long = render_session('run_long_mp', {'durationMin': 180, 'intervals': 2, 'workMin': 30, 'recoveryMin': 10}, DAY,
                              max_hr=190, threshold_pace=270)
        self.assertEqual(long['name'], 'Langer Lauf mit Renntempo 2×30 min')
        self.assertEqual(names(long), ['Aufwärmen', 'Locker', 'Renntempo 1', 'Locker', 'Renntempo 2', 'Abwärmen'])
        self.assertEqual([s['duration']['value'] // 60 for s in long['workout']['steps']], [10, 90, 30, 10, 30, 10])
        mp = long['workout']['steps'][2]['target']
        self.assertTrue(270 < mp['low'] < mp['high'] < 300)  # Marathon pace sits a little slower than threshold pace.
        # Strides and hill sprints are easy runs with short fast touches, steered by feel.
        strides = render_session('run_strides', {}, DAY, max_hr=190, threshold_pace=270)
        repeat = next(s for s in strides['workout']['steps'] if s['kind'] == 'repeat')
        self.assertEqual((strides['name'], repeat['count'], repeat['steps'][1]['name'], repeat['steps'][1]['target']),
                         ('Lockerer Lauf mit Steigerungen 6×20 s', 6, 'Steigerung', {'type': 'none'}))
        self.assertEqual(render_session('run_hill_sprints', {}, DAY)['name'], 'Lockerer Lauf mit Bergsprints 6×10 s')
        # „50 min, darin 2 × 10 min HM-Tempo“: race pace inside an easy run; one block is a continuous race-pace run.
        tempo = render_session('run_tempo', {'intervals': 2, 'workMin': 10, 'recoveryMin': 2, 'durationMin': 50,
                                             'intensity': .893}, DAY, max_hr=190, threshold_pace=285)
        self.assertEqual((tempo['name'], tempo['durationMin']), ('Lauf mit Renntempo 2×10 min', 50))
        self.assertEqual([n for n in names(tempo) if n.startswith('Renntempo')], ['Renntempo 1', 'Renntempo 2'])
        pace = next(s for s in tempo['workout']['steps'] if s['name'] == 'Renntempo 1')['target']
        self.assertTrue(pace['low'] < 284 < pace['high'])  # 1:39:50 over 21.1 km is 4:44 min/km.
        marathon = render_session('run_tempo', {'intervals': 1, 'workMin': 30, 'durationMin': 50}, DAY)
        self.assertEqual(marathon['name'], 'Lauf mit Renntempo 30 min')

    def test_easy_rides_and_runs_are_named_by_their_duration(self):
        # A run over an hour is a long run, a ride over three hours a long ride, whatever the template.
        name = lambda template, minutes: render_session(template, {'durationMin': minutes}, DAY)['name']
        self.assertEqual([name('run_easy', 45), name('run_easy', 60), name('run_easy', 65), name('run_long', 50), name('run_long', 95)],
                         ['Lockerer Lauf', 'Lockerer Lauf', 'Langer Lauf', 'Lockerer Lauf', 'Langer Lauf'])
        self.assertEqual([name('bike_z2', 120), name('bike_z2', 180), name('bike_long', 150), name('bike_z2_long', 240)],
                         ['Grundlagenausdauer Rad', 'Grundlagenausdauer Rad', 'Grundlagenausdauer Rad', 'Lange Ausfahrt'])
        self.assertEqual(name('bike_recovery', 60), 'Regeneration Rad')
        with self.assertRaises(TemplateError):
            render_session('bike_vo2', {'intervals': 1}, DAY)  # A single interval stays a running tempo run.

    def test_lauf_abc_is_an_easy_run_with_drills_and_strides(self):
        session = render_session('run_drills', {}, DAY, max_hr=190, threshold_pace=270)
        steps = session['workout']['steps']
        self.assertEqual((session['name'], session['durationMin']), ('Lockerer Lauf mit Lauf-ABC', 45))
        self.assertEqual([s['name'] for s in steps if s['kind'] == 'step' and s['intensity'] == 'active'][:6],
                         ['Fußgelenkarbeit', 'Skippings', 'Kniehebelauf', 'Anfersen', 'Hopserlauf', 'Seitgalopp'])
        self.assertTrue(all(s['target'] == {'type': 'none'} for s in steps
                            if s['kind'] == 'step' and s['name'] in ('Skippings', 'Zurückgehen')))  # By feel, not by pace.
        self.assertEqual(next(s for s in steps if s['kind'] == 'repeat')['steps'][0]['name'], 'Steigerung')
        self.assertEqual(render_session('run_drills', {'durationMin': 30, 'reps': 8, 'workSec': 30}, DAY)['durationMin'], 30)

    def test_pace_targets_export_as_speed_ranges(self):
        workout = render_session('run_threshold', {}, DAY, max_hr=190, threshold_pace=270)['workout']
        self.assertTrue(export_workout(workout).startswith(bytes([14])))
        step = garmin_workout(workout)['workoutSegments'][0]['workoutSteps'][1]
        self.assertEqual(step['targetType']['workoutTargetTypeKey'], 'pace.zone')
        self.assertEqual((step['targetValueOne'], step['targetValueTwo']), (round(1000 / 280, 4), round(1000 / 267, 4)))
