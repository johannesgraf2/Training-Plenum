import copy
import unittest
from datetime import date

from coach_blocks import (BLOCK_TYPES, block_guidance, easy_runs_over_long_run, rule_texts, block_for_week, block_status, catalog, check_block, check_event_rules, check_week_rules,
                          migrate_plan, place_block, suggested_rhythm)
from coach_domain import DEFAULT_PROFILE, CoachError, complete_event

MONDAY = date(2026, 10, 5)


def weeks(*phases, hours=6):
    return [{'week': i + 1, 'phase': phase, 'targetHours': hours, 'focus': ''} for i, phase in enumerate(phases)]


def session(template, minutes=60):
    return {'template': template, 'rendered': {'durationMin': minutes}}


def profile(**changes):
    value = copy.deepcopy(DEFAULT_PROFILE)
    value['availability']['preferredWeeklyHours'] = 8
    for key, item in changes.items():
        value[key] = {**value[key], **item}
    return value


class CatalogTests(unittest.TestCase):
    def test_catalog_offers_selectable_types_with_german_rules(self):
        result = catalog()
        ids = [item['id'] for item in result['blockTypes']]
        self.assertEqual(ids, ['wiedereinstieg', 'grundlage', 'aufbau', 'schwelle', 'vo2max', 'wettkampfspezifisch', 'taper', 'uebergang'])
        vo2 = next(item for item in result['blockTypes'] if item['id'] == 'vo2max')
        self.assertEqual((vo2['minWeeks'], vo2['defaultWeeks'], vo2['maxWeeks']), (3, 4, 12))
        self.assertIn('Mindestens 2× VO2max-Einheit pro Belastungswoche', vo2['rules'])
        self.assertEqual(list(vo2['rhythms']), [str(n) for n in range(3, 13)])
        self.assertEqual(vo2['rhythms']['3'], [False, False, True])
        self.assertEqual([item['id'] for item in result['secondaryFocus']], ['kraft', 'laufen', 'radfahren'])

    def test_rhythm_is_three_to_one_with_shorter_cycles_for_short_blocks(self):
        pattern = lambda n: ''.join('D' if d else 'L' for d in suggested_rhythm(n, 'grundlage'))
        self.assertEqual(pattern(3), 'LLD')
        self.assertEqual(pattern(4), 'LLLD')
        self.assertEqual(pattern(5), 'LLDLD')
        self.assertEqual(pattern(8), 'LLLDLLLD')
        self.assertEqual(pattern(10), 'LLLDLLDLLD')
        self.assertEqual(suggested_rhythm(2, 'uebergang'), [False, False])
        self.assertEqual(suggested_rhythm(2, 'taper'), [True, True])
        for length in range(4, 13):  # Every suggested rhythm passes the block rules.
            check_block('aufbau', None, weeks(*['recovery' if d else 'build' for d in suggested_rhythm(length, 'aufbau')]),
                        start=MONDAY, profile=profile())


class BlockRuleTests(unittest.TestCase):
    def test_length_last_deload_and_load_streak(self):
        with self.assertRaisesRegex(CoachError, '3–12 Wochen'):
            check_block('vo2max', None, weeks('build', 'recovery'), start=MONDAY, profile=profile())
        with self.assertRaisesRegex(CoachError, 'Entlastungswoche'):
            check_block('vo2max', None, weeks('build', 'build', 'build'), start=MONDAY, profile=profile())
        with self.assertRaisesRegex(CoachError, 'Belastungswochen'):
            check_block('grundlage', None, weeks('base', 'base', 'base', 'base', 'base', 'recovery'), start=MONDAY, profile=profile())
        check_block('grundlage', None, weeks('base', 'base', 'recovery', 'base', 'base', 'recovery'), start=MONDAY, profile=profile())

    def test_taper_transition_cap_goal_date_and_strength(self):
        race = weeks('build', 'peak', 'taper')
        race[-1]['targetHours'] = 5
        with self.assertRaisesRegex(CoachError, 'Zieldatum im Profil'):
            check_block('wettkampfspezifisch', None, race, start=MONDAY, profile=profile())
        goal = profile(goal={'date': '2026-10-25'})
        with self.assertRaisesRegex(CoachError, '30 % weniger'):
            check_block('wettkampfspezifisch', None, race, start=MONDAY, profile=goal)
        race[-1]['targetHours'] = 4.2
        check_block('wettkampfspezifisch', None, race, start=MONDAY, profile=goal)
        check_block('wettkampfspezifisch', None, race, start=MONDAY, profile=profile(goal={'date': '2026-10-24'}))  # Saturday race
        with self.assertRaisesRegex(CoachError, 'spätestens in der Woche des Zieldatums'):
            check_block('wettkampfspezifisch', None, race, start=MONDAY, profile=profile(goal={'date': '2026-10-18'}))
        with self.assertRaisesRegex(CoachError, '60 % des Wunschumfangs'):
            check_block('uebergang', None, weeks('recovery', 'recovery', hours=5), start=MONDAY, profile=profile())
        check_block('uebergang', None, weeks('recovery', 'recovery', hours=4.8), start=MONDAY, profile=profile())
        goal = profile(goal={'date': '2026-10-11'})
        check_block('taper', None, weeks('taper', hours=5), start=MONDAY, profile=goal)
        with self.assertRaisesRegex(CoachError, 'jede Woche eine Entlastungswoche'):
            check_block('taper', None, weeks('build', 'taper', hours=5), start=date(2026, 9, 28), profile=goal)
        with self.assertRaisesRegex(CoachError, '70 % des Wunschumfangs'):
            check_block('taper', None, weeks('taper', hours=6), start=MONDAY, profile=goal)
        with self.assertRaisesRegex(CoachError, '„Taper“ muss spätestens in der Woche des Zieldatums'):
            check_block('taper', None, weeks('taper', 'taper', hours=5), start=MONDAY, profile=goal)
        with self.assertRaisesRegex(CoachError, 'Krafttraining-Verfügbarkeit'):
            check_block('aufbau', 'kraft', weeks('build', 'build', 'build', 'recovery'), start=MONDAY, profile=profile())
        check_block('aufbau', 'kraft', weeks('build', 'build', 'build', 'recovery'), start=MONDAY,
                    profile=profile(preferences={'gymAvailability': True}))
        with self.assertRaisesRegex(CoachError, 'Blocktyp'):
            check_block('sprint', None, weeks('build'), start=MONDAY, profile=profile())


class WeekRuleTests(unittest.TestCase):
    def test_vo2_block_needs_two_vo2_sessions_in_load_weeks_only(self):
        block = {'blockType': 'vo2max', 'secondaryFocus': None}
        with self.assertRaisesRegex(CoachError, 'mindestens 2× VO2max'):
            check_week_rules(block, {'phase': 'build'}, [session('bike_vo2'), session('bike_z2')])
        check_week_rules(block, {'phase': 'build'}, [session('bike_vo2'), session('bike_vo2'), session('bike_z2')])
        check_week_rules(block, {'phase': 'recovery'}, [session('bike_z2')])
        # A runner meets the rule with running VO2 sessions; before there were none, so a run plan could never pass.
        check_week_rules(block, {'phase': 'build'}, [session('run_vo2'), session('run_vo2_short'), session('run_easy'), session('run_long')])
        # A running plan builds around one key session per week; with the bike among the sports two stay the rule.
        week = [session('run_vo2'), session('run_easy'), session('run_strides'), session('run_long')]
        check_week_rules(block, {'phase': 'build'}, week, sports=['run', 'strength'])
        with self.assertRaisesRegex(CoachError, 'mindestens 2× VO2max'):
            check_week_rules(block, {'phase': 'build'}, week, sports=['run', 'ride'])
        with self.assertRaisesRegex(CoachError, 'mindestens 1× VO2max'):
            check_week_rules(block, {'phase': 'build'}, week[1:], sports=['run'])
        self.assertIn('Mindestens 1× VO2max-Einheit pro Belastungswoche', rule_texts('vo2max', ['run']))
        self.assertIn('run_long_mp', block_guidance('wettkampfspezifisch', ['run']))
        self.assertEqual(block_guidance('vo2max', ['ride']), BLOCK_TYPES['vo2max']['guidance'])
        with self.assertRaisesRegex(CoachError, 'höchstens 1×'):
            check_week_rules(block, {'phase': 'build'}, [session('bike_vo2'), session('bike_vo2'),
                                                         session('bike_sweetspot'), session('bike_threshold')])

    def test_easy_runs_stay_shorter_than_the_long_run(self):
        run = lambda identity, template, minutes: {'id': identity, 'template': template, 'rendered': {'durationMin': minutes}}
        week = [run('mi', 'run_easy', 85), run('sa', 'run_long', 85), run('so', 'run_strides', 92)]
        self.assertEqual(easy_runs_over_long_run(week), {'so'})
        self.assertEqual(easy_runs_over_long_run(week[:2] + [run('so', 'run_long_mp', 150)]), set())
        self.assertEqual(easy_runs_over_long_run([run('mi', 'run_easy', 85)]), set())  # Without a long run nothing to compare.

    def test_forbidden_templates_easy_share_and_secondary_focus(self):
        with self.assertRaisesRegex(CoachError, 'keine VO2max'):
            check_week_rules({'blockType': 'grundlage'}, {'phase': 'recovery'}, [session('bike_vo2')])
        base = {'blockType': 'grundlage', 'secondaryFocus': None}
        with self.assertRaisesRegex(CoachError, '80 %'):
            check_week_rules(base, {'phase': 'base'}, [session('bike_sweetspot', 60), session('bike_z2', 180)])
        check_week_rules(base, {'phase': 'base'}, [session('bike_sweetspot', 60), session('bike_z2', 240), session('strength_general', 300)])
        running = {'blockType': 'grundlage', 'secondaryFocus': 'laufen'}
        with self.assertRaisesRegex(CoachError, 'Nebenschwerpunkt Laufen'):
            check_week_rules(running, {'phase': 'base'}, [session('bike_z2')])
        check_week_rules(running, {'phase': 'base'}, [session('bike_z2'), session('run_easy')])
        check_week_rules(running, {'phase': 'recovery'}, [session('bike_z2')])
        with self.assertRaisesRegex(CoachError, 'keine Qualitätseinheit'):
            check_week_rules({'blockType': 'uebergang'}, {'phase': 'recovery'}, [session('bike_tempo')])


class NewTemplateRuleTests(unittest.TestCase):
    def test_micro_intervals_count_as_vo2_sit_as_quality_sprint_rides_as_easy(self):
        from coach_templates import render_session
        rendered = lambda template, **params: {'template': template, 'rendered': render_session(template, params, '2026-10-06', 250)}
        vo2 = {'blockType': 'vo2max', 'secondaryFocus': None}
        check_week_rules(vo2, {'phase': 'build'}, [rendered('bike_vo2'), rendered('bike_vo2_micro'), rendered('bike_z2_long')])
        base = {'blockType': 'grundlage', 'secondaryFocus': None}
        with self.assertRaisesRegex(CoachError, 'keine VO2max'):
            check_week_rules(base, {'phase': 'base'}, [rendered('bike_vo2_micro')])
        with self.assertRaisesRegex(CoachError, 'höchstens 1× Qualitätseinheit'):
            check_week_rules(base, {'phase': 'base'}, [rendered('bike_sit'), rendered('bike_sweetspot'), rendered('bike_z2_long', durationMin=360)])
        # Only the sprints themselves are hard: a sprint ride keeps the easy share.
        check_week_rules(base, {'phase': 'base'}, [rendered('bike_z2_sprints'), rendered('bike_sit')])
        with self.assertRaisesRegex(CoachError, 'keine Sprintintervall'):
            check_week_rules({'blockType': 'wiedereinstieg'}, {'phase': 'base'}, [rendered('bike_sit')])

    def test_guidance_names_progression_chains(self):
        from coach_blocks import BLOCK_TYPES
        self.assertIn('3x9x30/15 -> 3x11x30/15 -> 3x13x30/15', BLOCK_TYPES['vo2max']['guidance'])
        self.assertIn('1:30 -> 2:00 -> 2:30 -> 3:00 h', BLOCK_TYPES['grundlage']['guidance'])


class StoredBlockTests(unittest.TestCase):
    def test_macro_plan_migrates_to_a_stable_custom_block(self):
        legacy = {'macroPlan': {'source': 'aiRecommendation', 'startDate': '2026-09-21', 'weeks': weeks('base', 'recovery')},
                  'weeks': {'2026-W39': {'week': '2026-W39'}}}
        first, second = migrate_plan(legacy), migrate_plan(legacy)
        self.assertEqual(first, second)
        self.assertNotIn('macroPlan', first)
        self.assertEqual(first['weeks'], legacy['weeks'])
        block = first['blocks'][0]
        self.assertEqual((block['id'], block['blockType'], block['status'], block['endDate']), ('custom-2026-09-21', 'custom', 'active', '2026-10-04'))
        self.assertEqual(migrate_plan(first), first)
        self.assertEqual(migrate_plan({'macroPlan': None, 'weeks': {}}), {'blocks': [], 'weeks': {}})
        self.assertEqual(block_status(block, date(2026, 10, 4)), 'active')
        self.assertEqual(block_status(block, date(2026, 10, 5)), 'completed')

    def test_new_block_ends_overlapping_blocks_but_never_planned_weeks(self):
        blocks = migrate_plan({'macroPlan': {'startDate': '2026-09-21', 'weeks': weeks('base', 'base', 'recovery')}, 'weeks': {}})['blocks']
        with self.assertRaisesRegex(CoachError, '2026-W40 ist bereits'):
            place_block(blocks, {'2026-W40': {}}, date(2026, 9, 28), 4)
        placed, replaced = place_block(blocks, {'2026-W39': {}}, date(2026, 9, 28), 4)
        self.assertEqual(replaced, ['custom-2026-09-21'])
        self.assertEqual((placed[0]['status'], placed[0]['endDate']), ('abandoned', '2026-09-27'))
        self.assertEqual(blocks[0]['status'], 'active')
        self.assertEqual(block_for_week(placed, date(2026, 9, 21))[1], 1)
        self.assertEqual(block_for_week(placed, date(2026, 9, 28)), (None, None))
        self.assertEqual(place_block(blocks, {}, date(2026, 10, 12), 4), (blocks, []))


if __name__ == '__main__':
    unittest.main()


def planned(identity, template, day, minutes=60):
    return {'id': identity, 'template': template, 'rendered': {'date': day, 'durationMin': minutes}}


class EventRuleTests(unittest.TestCase):
    def event(self, priority, handling=None, start='2026-10-10', end=None):
        return complete_event({'title': 'Gran Fondo', 'sport': 'ride', 'startDate': start, 'endDate': end,
                               'priority': priority, 'handling': handling}, 'e')

    def check(self, event, *sessions, changed=None):
        check_event_rules([event], list(sessions), {s['id'] for s in sessions} if changed is None else changed)

    def test_b_mini_taper_keeps_the_days_around_the_race_easy(self):
        race = self.event('B')  # Saturday 10 Oct
        self.check(race, planned('wed', 'bike_vo2', '2026-10-07', 47), planned('fri', 'bike_z2', '2026-10-09'),
                   planned('sun', 'bike_recovery', '2026-10-11'), planned('tue', 'bike_threshold', '2026-10-13', 68))
        for sessions, message in (
                ([planned('fri', 'bike_vo2', '2026-10-09', 47)], 'am Tag vor'),
                ([planned('wed', 'bike_vo2', '2026-10-07', 47), planned('thu', 'bike_tempo', '2026-10-08', 60)], 'höchstens eine kurze'),
                ([planned('thu', 'bike_threshold', '2026-10-08', 90)], 'höchstens eine kurze'),
                ([planned('sat', 'bike_z2', '2026-10-10')], 'keine weitere Einheit'),
                ([planned('mon', 'bike_tempo', '2026-10-12')], '2 Tage nur locker'),
                ([planned('sun', 'strength_general', '2026-10-11')], '2 Tage nur locker')):
            with self.subTest(sessions=sessions), self.assertRaises(CoachError) as error:
                self.check(race, *sessions)
            self.assertIn(message, str(error.exception))
        # Sessions planned before the event existed only fail once they change.
        self.check(race, planned('fri', 'bike_vo2', '2026-10-09', 47), changed=set())

    def test_other_handlings_and_multi_day_events(self):
        self.check(self.event('B', 'trainThrough'), planned('fri', 'bike_vo2', '2026-10-09', 47))
        with self.assertRaises(CoachError):
            self.check(self.event('B', 'trainThrough'), planned('mon', 'bike_vo2', '2026-10-12', 47))
        self.check(self.event('C'), planned('mon', 'bike_tempo', '2026-10-12'))  # one easy day after a C race
        with self.assertRaises(CoachError):
            self.check(self.event('C'), planned('sun', 'bike_tempo', '2026-10-11'))
        self.check(self.event('C', 'easy'), planned('sun', 'bike_tempo', '2026-10-11'))
        with self.assertRaises(CoachError):
            self.check(self.event('A', end='2026-10-20'), planned('thu', 'bike_z2', '2026-10-15'))
        self.check(self.event('A', end='2026-10-20'), planned('rest', 'rest', '2026-10-15'))

    def test_a_c_race_replaces_one_hard_session_of_its_week(self):
        block, load = {'blockType': 'schwelle', 'secondaryFocus': None}, {'phase': 'build'}
        hard = [session('bike_threshold'), session('bike_sweetspot')]
        check_week_rules(block, load, hard)
        check_week_rules(block, load, hard[:1], replaced=1)
        with self.assertRaises(CoachError) as error:
            check_week_rules(block, load, hard, replaced=1)
        self.assertIn('höchstens 1×', str(error.exception))
        with self.assertRaises(CoachError):
            check_week_rules({'blockType': 'grundlage', 'secondaryFocus': None}, {'phase': 'base'}, [session('bike_tempo')], replaced=1)

    def test_competition_block_guides_back_to_back_ultra_weekends(self):
        self.assertIn('back-to-back', BLOCK_TYPES['wettkampfspezifisch']['guidance'])
