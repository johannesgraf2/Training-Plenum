import unittest
from datetime import date

from coach_domain import CoachError
from coach_wellness import blocked_sports, check_in_averages, heal, readiness, record_check_in

TODAY = date(2026, 10, 21)
CALM = {'date': '2026-10-21', 'wellbeing': 4, 'recovery': 4, 'stress': 2, 'soreness': 2, 'mood': 4, 'nutrition': 3, 'alcohol': 0, 'notes': ''}
ANKLE = {'region': 'ankle', 'side': 'right', 'pain': 6, 'timing': 'during', 'onset': 'immediate', 'impact': 'adjust'}
HARD_RUN = [{'sport': 'run', 'hard': True, 'durationMin': 50}]
EASY_SWIM = [{'sport': 'swim', 'hard': False, 'durationMin': 45}]


def profile():
    return {'checkIns': [], 'injuries': []}


class ReadinessTests(unittest.TestCase):
    def test_a_good_morning_is_green(self):
        light = readiness(CALM, [], HARD_RUN)
        self.assertEqual(light['level'], 'green')
        self.assertEqual(light['reasons'], [])

    def test_answers_only_count_against_a_hard_session_where_that_matters(self):
        tired = {**CALM, 'recovery': 2, 'alcohol': 1, 'stress': 4}
        self.assertEqual(readiness(tired, [], EASY_SWIM)['level'], 'green')
        light = readiness(tired, [], HARD_RUN)
        self.assertEqual(light['level'], 'red')  # Three warning signs together.
        self.assertIn('Mehrere Warnsignale zusammen', light['reasons'])

    def test_single_signals_turn_the_day_yellow_or_red(self):
        self.assertEqual(readiness({**CALM, 'wellbeing': 1}, [], [])['level'], 'red')
        self.assertEqual(readiness({**CALM, 'alcohol': 2}, [], [])['level'], 'yellow')
        self.assertEqual(readiness(CALM, [], [], whoop_band='red')['level'], 'yellow')
        hungry = readiness({**CALM, 'nutrition': 1}, [], EASY_SWIM)
        self.assertEqual(hungry['level'], 'green')
        self.assertEqual(hungry['notes'], ['Heute auf genug Kohlenhydrate achten.'])

    def test_a_painful_ankle_is_red_and_rules_out_running(self):
        value = profile()
        record_check_in(value, {**CALM, 'newInjury': ANKLE}, TODAY)
        light = readiness(value['checkIns'][-1], value['injuries'], EASY_SWIM)
        self.assertEqual(light['level'], 'red')
        self.assertEqual(light['reasons'], ['Knöchel rechts: Schmerz 6/10, setzt sofort bei Belastung ein'])
        self.assertEqual(light['affectedSports'], ['run'])
        self.assertEqual(blocked_sports(value['injuries']), {'run': 'Knöchel rechts'})

    def test_mild_pain_is_only_watched(self):
        value = profile()
        record_check_in(value, {**CALM, 'newInjury': {**ANKLE, 'pain': 2, 'onset': 'after', 'impact': 'normal'}}, TODAY)
        light = readiness(value['checkIns'][-1], value['injuries'], HARD_RUN)
        self.assertEqual(light['level'], 'green')
        self.assertEqual(light['notes'], ['Knöchel rechts: 2/10 – weiter beobachten.'])
        self.assertEqual(blocked_sports(value['injuries']), {})


class CheckInTests(unittest.TestCase):
    def test_follow_ups_extend_the_history_until_the_complaint_heals(self):
        value = profile()
        record_check_in(value, {**CALM, 'newInjury': ANKLE}, TODAY)
        identity = value['injuries'][0]['id']
        later = date(2026, 10, 23)
        record_check_in(value, {**CALM, 'date': '2026-10-23', 'injuryUpdates': [{'id': identity, 'pain': 3, 'trend': 'better', 'healed': False}]}, later)
        self.assertEqual([h['pain'] for h in value['injuries'][0]['history']], [6, 3])
        # Pain 3 that no longer starts with the load: still active, no longer blocking.
        value['injuries'][0]['onset'] = 'during'
        self.assertEqual(blocked_sports(value['injuries']), {})
        record_check_in(value, {**CALM, 'date': '2026-10-24', 'injuryUpdates': [{'id': identity, 'pain': 0, 'trend': 'better', 'healed': True}]}, date(2026, 10, 24))
        self.assertEqual(value['injuries'][0]['status'], 'healed')
        self.assertEqual(value['injuries'][0]['endDate'], '2026-10-24')
        with self.assertRaises(CoachError):
            record_check_in(value, {**CALM, 'date': '2026-10-25', 'injuryUpdates': [{'id': identity, 'pain': 1, 'trend': 'same', 'healed': False}]}, date(2026, 10, 25))

    def test_one_check_in_per_day_and_none_for_a_coming_day(self):
        value = profile()
        record_check_in(value, CALM, TODAY)
        record_check_in(value, {**CALM, 'wellbeing': 2}, TODAY)
        self.assertEqual([c['wellbeing'] for c in value['checkIns']], [2])
        with self.assertRaises(CoachError):
            record_check_in(value, {**CALM, 'date': '2026-10-22'}, TODAY)
        with self.assertRaises(CoachError):
            record_check_in(value, {**CALM, 'wellbeing': 6}, TODAY)

    def test_healing_from_the_card(self):
        value = profile()
        record_check_in(value, {**CALM, 'newInjury': ANKLE}, TODAY)
        heal(value, value['injuries'][0]['id'], date(2026, 10, 22))
        self.assertEqual(value['injuries'][0]['status'], 'healed')
        self.assertEqual(value['injuries'][0]['history'][-1], {'date': '2026-10-22', 'pain': 0, 'trend': 'better'})

    def test_averages_cover_old_and_new_check_ins(self):
        old = {'date': '2026-10-01', 'fatigue': 4, 'motivation': 3, 'stress': 2, 'sleepQuality': 4, 'soreness': 1, 'notes': ''}
        averages = check_in_averages([old, {**CALM, 'version': 2}])
        self.assertEqual(averages['stress'], 2)
        self.assertEqual(averages['fatigue'], 4)
        self.assertEqual(averages['wellbeing'], 4)
        self.assertIsNone(check_in_averages([]))


if __name__ == '__main__':
    unittest.main()
