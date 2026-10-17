import copy
import unittest
from datetime import date

from coach_domain import (CHECK_IN_SCHEMA, DAILY_SCHEMA, DEFAULT_PROFILE, DAYS, BLOCK_WEEKS_SCHEMA, EVENT_DEFAULTS,
                          WEEK_OVERRIDE_SCHEMA, CoachError, apply_patch, complete_event, day_date, plan_settings, threshold_pace,
                          week_events,
                          complete_profile, effective_availability, iso_week, min_ride_minutes, preferred_hours,
                          response_schemas, rest_day_pairs, update_profile, week_season,
                          validate, week_start)
from coach_templates import PARAM_NAMES, SESSION_SCHEMA


def profile():
    value = copy.deepcopy(DEFAULT_PROFILE)
    value['availability'] = {'preferredWeeklyHours': 8, 'absoluteMaxWeeklyHours': 12,
                             'defaultAvailability': dict.fromkeys(DAYS, 120)}
    return value


def session(identity='one', day='mon', locked=False):
    return {'id': identity, 'day': day, 'template': 'bike_z2', 'params': {'durationMin': 60},
            'locked': locked, 'rendered': {'durationMin': 60}}


def changes(operations):
    return {'week': '2026-W40', 'targetHours': 2, 'focus': 'Ausdauer', 'operations': operations}


class ProfileTests(unittest.TestCase):
    def test_season_follows_the_outdoor_months_and_older_profiles_get_defaults(self):
        stored = profile()
        after = update_profile(stored, {'availability': {'minRideMinutes': {'indoor': 60, 'outdoor': 90}, 'trainingDaysPerWeek': 4}})
        self.assertEqual(after['availability']['defaultAvailability'], stored['availability']['defaultAvailability'])
        self.assertEqual(after['availability']['trainingDaysPerWeek'], 4)
        january, may = date(2027, 1, 4), date(2027, 5, 3)
        self.assertIsNone(week_season(after, may))
        self.assertEqual(min_ride_minutes(after, may), 60)  # without a split the shorter one applies
        self.assertEqual(preferred_hours(after, january), 8)
        after = update_profile(after, {'availability': {'outdoorMonths': [10, 4, 5, 6, 7, 8, 9], 'indoorWeeklyHours': 5}})
        self.assertEqual(after['availability']['outdoorMonths'], [4, 5, 6, 7, 8, 9, 10])
        self.assertEqual((week_season(after, january), week_season(after, may)), ('indoor', 'outdoor'))
        self.assertEqual((min_ride_minutes(after, january), min_ride_minutes(after, may)), (60, 90))
        self.assertEqual((preferred_hours(after, january), preferred_hours(after, may)), (5, 8))
        # The Thursday decides: Mon 29 Mar 2027 belongs to April's week.
        self.assertEqual(week_season(after, date(2027, 3, 29)), 'outdoor')
        after['availability']['minRideMinutes']['indoor'] = None
        self.assertIsNone(min_ride_minutes(after, january))
        for bad in ({'trainingDaysPerWeek': 8}, {'outdoorMonths': [13]}, {'outdoorMonths': [4, 4]},
                    {'indoorWeeklyHours': 13}, {'noConsecutiveRestDays': True, 'trainingDaysPerWeek': 2}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(after, {'availability': bad})

    def test_older_profiles_move_to_sports_goal_types_and_outdoor_months(self):
        stored = profile()
        stored['goal'] = {'type': 'marathon', 'name': 'Berlin', 'date': None, 'target': None}
        stored['preferences'] = {'indoorPreference': 'avoid', 'outdoorPreference': 'prefer', 'trainingEnvironment': 'outdoor'}
        value = complete_profile(stored)
        self.assertEqual((value['goal']['type'], value['goal']['sports']), ('event', ['run']))
        self.assertEqual(value['availability']['outdoorMonths'], list(range(1, 13)))
        self.assertEqual(value['preferences'], DEFAULT_PROFILE['preferences'])
        self.assertEqual(update_profile(value, {'goal': {'type': 'ftp'}})['goal']['type'], 'performance')
        with self.assertRaises(CoachError):
            update_profile(value, {'goal': {'sports': []}})
        with self.assertRaises(CoachError):
            update_profile(value, {'goal': {'sports': ['ride', 'rowing']}})

    def test_rest_day_pairs_skip_days_without_time_and_elapsed_days(self):
        limits = {day: {'maxMinutes': 0 if day in ('thu', 'fri') else 60} for day in DAYS}
        self.assertEqual(rest_day_pairs({'mon', 'wed', 'sat'}, limits), set())  # Thu and Fri have no time
        self.assertEqual(rest_day_pairs({'mon', 'sat'}, limits), {('tue', 'wed'), ('wed', 'thu')})
        self.assertEqual(rest_day_pairs({'mon', 'sat'}, limits, elapsed=['mon', 'tue']), {('tue', 'wed'), ('wed', 'thu')})
        self.assertEqual(rest_day_pairs({'mon', 'sat'}, limits, elapsed=['mon', 'tue', 'wed']), set())
    def test_updates_preserve_overrides_checkins_and_do_not_mutate_old_profile(self):
        before = profile()
        before['weeklyOverrides'] = [{'week': '2026-W40', 'overrides': {'thu': {'available': False}}, 'note': ''}]
        after = update_profile(before, {'limitations': {'notes': 'Knie empfindlich'}})
        self.assertEqual(after['limitations']['notes'], 'Knie empfindlich')
        self.assertEqual(before['limitations']['notes'], '')
        self.assertEqual(after['weeklyOverrides'], before['weeklyOverrides'])
        after['weeklyOverrides'][0]['note'] = 'changed'
        self.assertEqual(before['weeklyOverrides'][0]['note'], '')

    def test_unknown_fields_null_groups_and_bool_numbers_rejected(self):
        for bad in (None, [], {'source': 'calculated'}, {'weeklyOverrides': []},
                    {'goal': None}, {'availability': None}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(profile(), bad)
        for key in ('preferredWeeklyHours', 'absoluteMaxWeeklyHours'):
            for invalid in (True, False, -1, 81, float('nan'), float('inf'), '8'):
                value = profile()['availability']
                value[key] = invalid
                with self.subTest(key=key, value=invalid), self.assertRaises(CoachError):
                    update_profile(profile(), {'availability': value})

    def test_unknown_availability_stays_null_and_preferred_cannot_exceed_maximum(self):
        value = update_profile(DEFAULT_PROFILE, {})
        self.assertIsNone(value['availability']['preferredWeeklyHours'])
        self.assertIsNone(value['availability']['absoluteMaxWeeklyHours'])
        self.assertTrue(all(v is None for v in value['availability']['defaultAvailability'].values()))
        invalid = profile()['availability']
        invalid.update(preferredWeeklyHours=15, absoluteMaxWeeklyHours=10)
        with self.assertRaises(CoachError):
            update_profile(profile(), {'availability': invalid})

    def test_daily_minute_values_are_whole_numbers_not_bools(self):
        for invalid in (True, 60.5, -1, 1441, float('nan')):
            value = profile()['availability']
            value['defaultAvailability']['thu'] = invalid
            with self.assertRaises(CoachError):
                update_profile(profile(), {'availability': value})


class CalendarTests(unittest.TestCase):
    def test_iso_week_transition_uses_iso_year_not_calendar_year(self):
        self.assertEqual(week_start('2020-W53'), date(2020, 12, 28))
        self.assertEqual(iso_week(date(2021, 1, 1)), '2020-W53')
        self.assertEqual(week_start('2021-W01'), date(2021, 1, 4))
        result = effective_availability(profile(), '2020-W53')
        self.assertEqual(result['mon']['date'], '2020-12-28')
        self.assertEqual(result['sun']['date'], '2021-01-03')

    def test_invalid_calendar_values_raise_domain_errors(self):
        for invalid in (None, True, '2026-W00', '2021-W53', '2026-W54', '2026-W1', '2026-w01', '0000-W01'):
            with self.subTest(week=invalid), self.assertRaises(CoachError):
                week_start(invalid)
        for invalid in (None, True, '2026-02-29', '20260923', '1969-12-31', '9999-01-01'):
            with self.subTest(day=invalid), self.assertRaises(CoachError):
                day_date(invalid)
        self.assertEqual(day_date('2024-02-29'), date(2024, 2, 29))

    def test_week_bounds_cannot_overflow_daily_dates(self):
        for invalid in ('0001-W01', '1969-W52', '9999-W52'):
            with self.subTest(week=invalid), self.assertRaises(CoachError):
                week_start(invalid)

    def test_defaults_weekly_then_daily_precedence_without_mutating_profile(self):
        value = profile()
        value['preferences']['preferredLongSessionDay'] = 'sun'
        value['weeklyOverrides'] = [{'week': '2026-W40', 'overrides': {
            'thu': {'available': False}, 'sat': {'maxMinutes': 300, 'preferLong': True}}, 'note': 'Reise'}]
        value['dailyOverrides'] = [{'date': '2026-10-01', 'available': True, 'maxMinutes': 45},
                                   {'date': '2026-10-03', 'action': 'skip'}]
        before = copy.deepcopy(value)
        result = effective_availability(value, '2026-W40')
        self.assertEqual(result['thu']['maxMinutes'], 45)
        self.assertEqual(result['sat']['maxMinutes'], 0)
        self.assertTrue(result['sat']['preferLong'])
        self.assertTrue(result['sun']['preferLong'])
        self.assertEqual(value, before)
        other_week = effective_availability(value, '2026-W41')
        self.assertEqual(other_week['thu']['maxMinutes'], 120)
        self.assertEqual(other_week['sat']['maxMinutes'], 120)

    def test_available_true_can_reopen_weekly_unavailable_day_with_default_duration(self):
        value = profile()
        value['weeklyOverrides'] = [{'week': '2026-W40', 'overrides': {'thu': {'available': False}}, 'note': ''}]
        value['dailyOverrides'] = [{'date': '2026-10-01', 'available': True}]
        self.assertEqual(effective_availability(value, '2026-W40')['thu']['maxMinutes'], 120)

    def test_override_and_checkin_schemas_reject_unknown_null_and_bool_metrics(self):
        for bad in ({'available': None}, {'maxMinutes': True}, {'maxMinutes': -1}, {'action': 'delete'}, {'extra': 1}):
            with self.subTest(daily=bad), self.assertRaises(CoachError):
                validate(bad, DAILY_SCHEMA)
        for bad in ({'overrides': {'thu': {'maxMinutes': None}}, 'note': ''},
                    {'overrides': {'monday': {'available': False}}, 'note': ''},
                    {'overrides': {'thu': {'available': 0}}, 'note': ''}):
            with self.subTest(weekly=bad), self.assertRaises(CoachError):
                validate(bad, WEEK_OVERRIDE_SCHEMA)
        data = {'date': '2026-09-23', 'fatigue': 3, 'motivation': 4, 'stress': 2,
                'sleepQuality': 4, 'soreness': 2, 'notes': ''}
        self.assertEqual(validate(data, CHECK_IN_SCHEMA), data)
        for invalid in (True, None, 0, 6, 3.5):
            with self.assertRaises(CoachError):
                validate({**data, 'fatigue': invalid}, CHECK_IN_SCHEMA)


class PatchTests(unittest.TestCase):
    def setUp(self):
        self.before = {'week': '2026-W40', 'targetHours': 1, 'focus': 'Grundlage',
                       'sessions': [session('one'), session('locked', 'sat', True)]}

    def test_patch_only_changes_requested_session_and_preserves_locked_session_exactly(self):
        original = copy.deepcopy(self.before)
        new = session('new', 'tue')
        patch = changes([{'op': 'remove', 'sessionId': 'one', 'session': None},
                         {'op': 'add', 'sessionId': 'new', 'session': new}])
        result = apply_patch(self.before, patch)
        self.assertEqual(self.before, original)
        self.assertEqual(result['sessions'], [original['sessions'][1], new])
        self.assertEqual(result['targetHours'], 2)

    def test_locked_sessions_cannot_be_changed_deleted_or_readded(self):
        for op, payload in [('replace', session('locked', 'sun')), ('remove', None), ('add', session('locked'))]:
            with self.subTest(op=op), self.assertRaises(CoachError):
                apply_patch(self.before, changes([{'op': op, 'sessionId': 'locked', 'session': payload}]))

    def test_missing_duplicate_or_mismatched_patch_ids_rejected(self):
        bad = [
            [{'op': 'remove', 'sessionId': 'missing', 'session': None}],
            [{'op': 'add', 'sessionId': 'one', 'session': session('one')}],
            [{'op': 'replace', 'sessionId': 'one', 'session': session('other')}],
            [{'op': 'remove', 'sessionId': 'one', 'session': session('one')}],
            [{'op': 'replace', 'sessionId': 'one', 'session': None}],
            [{'op': 'replace', 'sessionId': 'one', 'session': session('one')},
             {'op': 'remove', 'sessionId': 'one', 'session': None}],
        ]
        for operations in bad:
            with self.subTest(operations=operations), self.assertRaises(CoachError):
                apply_patch(self.before, changes(operations))

    def test_ai_schemas_require_exact_types_and_forbid_extra_workout_fields(self):
        schema = response_schemas(SESSION_SCHEMA)['week']
        data = {'week': '2026-W40', 'targetHours': 1, 'focus': 'Grundlage', 'hinweise': [], 'sessions': [
            {'id': 'mon', 'day': 'mon', 'template': 'bike_z2', 'params': dict.fromkeys(PARAM_NAMES)}]}
        validate(data, schema)
        for bad in ({**data, 'targetHours': True}, {**data, 'sessions': None},
                    {**data, 'sessions': [{**data['sessions'][0], 'locked': False}]},
                    {**data, 'sessions': [{**data['sessions'][0], 'day': 'monday'}]}):
            with self.assertRaises(CoachError):
                validate(bad, schema)
        with self.assertRaises(CoachError):
            validate([{'week': True, 'phase': 'base', 'targetHours': 1, 'focus': ''}], BLOCK_WEEKS_SCHEMA)
        with self.assertRaises(CoachError):
            validate({key: value for key, value in data.items() if key != 'hinweise'}, schema)


if __name__ == '__main__':
    unittest.main()


def window(identity, day, start=None, end=None, kind='available', sports=None, group=None):
    return {'id': identity, 'day': day, 'kind': kind, 'allDay': start is None, 'from': start, 'to': end,
            'sports': {'ride': {'indoor': True, 'outdoor': True}} if sports is None else sports, 'group': group}


class PlanInputTests(unittest.TestCase):
    def test_sports_metrics_and_thresholds_with_their_origin(self):
        stored = profile()
        for key in ('sports', 'metrics', 'thresholds'):
            del stored[key]  # stored before these fields existed
        stored['preferences'] = {'gymAvailability': True}
        value = complete_profile(stored)
        self.assertEqual((value['sports'], value['metrics'], value['thresholds']),
                         (['ride', 'strength'], {'ride': 'power', 'run': 'pace'}, {}))
        value = update_profile(value, {'sports': ['ride', 'run', 'strength'], 'metrics': {'run': 'heart_rate'},
                                       'thresholds': {'ride': {'source': 'test'},
                                                      'run': {'source': 'calculated', 'paceSecPerKm': 270, 'basis': '10km'}}})
        self.assertEqual(value['metrics'], {'ride': 'power', 'run': 'heart_rate'})
        self.assertIsNone(threshold_pace(value))  # heart rate is the primary metric
        self.assertEqual(threshold_pace(update_profile(value, {'metrics': {'run': 'pace'}})), 270)
        self.assertIsNone(threshold_pace(update_profile(value, {'thresholds': {'run': {'source': 'test', 'paceSecPerKm': None,
                                                                                        'basis': None}}})))
        for bad in ({'sports': ['ride', 'ride']}, {'sports': ['golf']}, {'metrics': {'ride': 'pace'}},
                    {'thresholds': {'run': {'source': 'athlete', 'paceSecPerKm': None, 'basis': None}}},
                    {'thresholds': {'run': {'source': 'athlete', 'paceSecPerKm': 60, 'basis': None}}}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(value, bad)

    def test_a_named_goal_date_becomes_the_a_event(self):
        stored = profile()
        del stored['events']
        stored['goal'] = {'type': 'event', 'sports': ['ride'], 'name': ' NorthCape 4000 ', 'date': '2027-07-29', 'target': 'Ankommen'}
        events = complete_profile(stored)['events']
        self.assertEqual(events, [{**EVENT_DEFAULTS, 'id': 'goal-2027-07-29', 'title': 'NorthCape 4000', 'sport': 'ride',
                                   'startDate': '2027-07-29', 'endDate': '2027-07-29', 'priority': 'A',
                                   'description': 'Ankommen'}])
        self.assertEqual(complete_profile(stored)['events'], events)
        stored['goal']['name'] = ''
        self.assertEqual(complete_profile(stored)['events'], [])
        stored['events'] = []
        stored['goal']['name'] = 'Saved later'
        self.assertEqual(complete_profile(stored)['events'], [])  # only profiles from before events move over

    def test_events_take_ultra_distances_multi_day_times_and_b_c_options(self):
        event = complete_event({'title': 'NorthCape 4000', 'sport': 'ride', 'subtype': 'ultra', 'startDate': '2027-07-29',
                                'endDate': '2027-08-12', 'priority': 'A', 'distanceKm': 4000,
                                'targetSeconds': 10 * 86400 + 12 * 3600, 'elevationM': 30000}, 'nc')
        self.assertEqual((event['handling'], event['allDay'], event['time'], event['description']), (None, True, None, ''))
        self.assertEqual(complete_event({'title': 'Gran Fondo', 'sport': 'ride', 'startDate': '2027-05-16', 'priority': 'B',
                                         'allDay': False, 'time': '08:30'}, 'gf')['handling'], 'miniTaper')
        self.assertEqual(complete_event({'title': 'Kriterium', 'sport': 'ride', 'startDate': '2027-05-16', 'priority': 'C',
                                         'time': '18:00'}, 'c')['handling'], 'replaceHard')
        base = {'title': 'Rennen', 'sport': 'ride', 'startDate': '2027-05-16', 'priority': 'B'}
        for bad in ({'endDate': '2027-05-15'}, {'endDate': '2027-08-01'}, {'priority': 'A', 'handling': 'miniTaper'},
                    {'handling': 'replaceHard'}, {'subtype': 'marathon'}, {'distanceKm': 10001},
                    {'targetSeconds': 61 * 86400}, {'elevationM': 100001}, {'allDay': False}, {'title': '  '},
                    {'time': '25:00'}, {'startDate': '2027-02-30'}, {'unknown': 1}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                complete_event({**base, **bad}, 'x')

    def test_windows_set_the_minutes_per_day_and_the_week_settings(self):
        windows = [window('tue', 'tue', '18:00', '19:00', sports={'ride': {'indoor': True, 'outdoor': False},
                                                                  'run': {'treadmill': False, 'outdoor': True}}),
                   window('wed', 'wed', '18:00', '20:00', group={'sport': 'ride', 'intensity': 'hard', 'note': 'Vereinsausfahrt'}),
                   window('sat', 'sat', '07:00', '14:00'), window('sat-late', 'sat', '13:00', '15:00'),
                   window('sat-off', 'sat', '10:00', '11:00', kind='unavailable', sports={}),
                   window('sun', 'sun', sports={'strength': {'equipment': ['kettlebell']}})]
        value = update_profile(profile(), {'availability': {'windows': windows, 'maxWeeklyHours': None,
                                                            'restDay': 'mon', 'longDay': 'sat'}})
        minutes = value['availability']['defaultAvailability']
        self.assertEqual(minutes, {'mon': 0, 'tue': 60, 'wed': 120, 'thu': 0, 'fri': 0, 'sat': 420, 'sun': 1440})
        self.assertEqual(value['availability']['absoluteMaxWeeklyHours'], 34)
        self.assertEqual((value['preferences']['preferredRestDay'], value['preferences']['preferredLongSessionDay']), ('mon', 'sat'))
        self.assertTrue(effective_availability(value, '2026-W40')['sat']['preferLong'])
        capped = update_profile(value, {'availability': {'maxWeeklyHours': 10}})
        self.assertEqual(capped['availability']['absoluteMaxWeeklyHours'], 10)
        self.assertEqual(update_profile(value, {'availability': {'windows': [window('a', 'mon', '06:00', '24:00')]}})
                         ['availability']['defaultAvailability']['mon'], 1080)
        for bad in ([window('a', 'mon', '19:00', '18:00')], [window('a', 'mon', '18:00', None)],
                    [window('a', 'mon', '18:00', '19:00'), window('a', 'tue', '18:00', '19:00')],
                    [window('a', 'mon', kind='unavailable')],
                    [window('a', 'mon', group={'sport': 'ride', 'intensity': 'easy', 'note': ''})],
                    [window('a', 'mon', '18:00', '19:00', group={'sport': 'run', 'intensity': 'easy', 'note': ''})],
                    [window('a', 'mon', '24:00', '24:00')], [{**window('a', 'mon'), 'sports': {'ride': {'indoor': True}}}]):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(value, {'availability': {'windows': bad}})

    def test_exceptions_act_as_daily_overrides(self):
        value = update_profile(profile(), {'availability': {'exceptions': [
            {'id': 'mallorca', 'from': '2026-10-01', 'to': '2026-10-03', 'kind': 'available', 'maxMinutes': 300, 'note': 'Mallorca'},
            {'id': 'sick', 'from': '2026-09-28', 'to': '2026-09-29', 'kind': 'unavailable', 'maxMinutes': 60, 'note': 'Erkältet'}]}})
        self.assertEqual([e['id'] for e in value['availability']['exceptions']], ['sick', 'mallorca'])
        self.assertIsNone(value['availability']['exceptions'][0]['maxMinutes'])
        # A cleared override ({} or only a note) leaves the exception in place.
        value['dailyOverrides'] = [{'date': '2026-09-28'}, {'date': '2026-10-02', 'note': 'Flug'},
                                   {'date': '2026-10-03', 'maxMinutes': 90}]
        week = effective_availability(value, '2026-W40')  # Mon 28 Sep - Sun 4 Oct
        self.assertEqual([week[d]['maxMinutes'] for d in DAYS], [0, 0, 120, 300, 300, 90, 120])
        self.assertEqual(week['fri']['note'], 'Flug')
        self.assertEqual(week['thu']['exception'], {'id': 'mallorca', 'note': 'Mallorca'})
        self.assertNotIn('exception', week['sat'])
        for bad in ({'from': '2026-10-03', 'to': '2026-10-01'}, {'kind': 'available', 'maxMinutes': None}, {'to': '2026-13-01'}):
            item = {'id': 'x', 'from': '2026-10-01', 'to': '2026-10-02', 'kind': 'unavailable', 'maxMinutes': None, 'note': '', **bad}
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(value, {'availability': {'exceptions': [item]}})

    def test_week_entries_and_plan_settings(self):
        value = profile()
        value['events'] = [complete_event({'title': 'NC', 'sport': 'ride', 'startDate': '2026-09-27', 'endDate': '2026-09-29',
                                           'priority': 'A'}, 'nc'),
                           complete_event({'title': 'Later', 'sport': 'run', 'startDate': '2026-10-05', 'priority': 'C'}, 'later')]
        self.assertEqual([(e['kind'], e['id']) for e in week_events(value, '2026-W40')], [('event', 'nc')])
        first = plan_settings({'startDate': '2026-10-19', 'endDate': '2027-08-12', 'replanMode': 'afterReview'}, None, 'now')
        self.assertEqual(first['createdAt'], 'now')
        self.assertEqual(plan_settings({'startDate': '2026-10-19', 'endDate': '2030-01-01', 'replanMode': 'manual'}, first, 'later'),
                         {'startDate': '2026-10-19', 'endDate': '2030-01-01', 'replanMode': 'manual', 'generationWeeks': 3, 'taperWeeks': 1, 'createdAt': 'now'})
        for bad in ({'endDate': '2026-10-19'}, {'replanMode': 'daily'}, {'startDate': 'soon'}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                plan_settings({'startDate': '2026-10-19', 'endDate': '2027-01-01', 'replanMode': 'sunday', **bad}, None, 'now')

    def test_background_and_onboarding_progress(self):
        stored = profile()
        del stored['background'], stored['onboarding']  # stored before the onboarding
        value = complete_profile(stored)
        self.assertEqual((value['background']['type'], value['onboarding']), (None, {'completed': []}))
        value = update_profile(value, {'background': {'type': 'ride', 'weeklyHours': 7.8, 'intervals': {'ride': True}, 'source': 'calculated'},
                                       'onboarding': {'completed': ['sports', 'sources']}})
        value = update_profile(value, {'background': {'weeklyHours': 6}})  # fields left out keep their value
        self.assertEqual(value['background'], {'type': 'ride', 'weeklyHours': 6, 'intervals': {'ride': True}, 'source': 'calculated'})
        for bad in ({'background': {'type': 'golf'}}, {'background': {'intervals': {'golf': True}}},
                    {'onboarding': {'completed': ['done']}}, {'onboarding': {'completed': ['sports', 'sports']}}):
            with self.subTest(value=bad), self.assertRaises(CoachError):
                update_profile(value, bad)
