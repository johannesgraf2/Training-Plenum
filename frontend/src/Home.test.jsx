import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './Home';
import RaceGoal, { daysUntil, raceWeeks } from './RaceGoal';
import { powerStep } from './workoutModel';

jest.mock('./BestEfforts', () => () => null);

let container, root, originalFetch, profile, appearance, sparklines;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-28T09:00:00'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch;
  profile = { source: 'athlete', goal: { type: 'endurance', name: '', date: null, target: null } };
  appearance = { background: 'default', backgroundImage: null, raceGoalImage: null };
  sparklines = {};
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === 'http://api/api/athlete-profile') return { ok: true, json: async () => profile };
    if (url === 'http://api/api/appearance') return { ok: true, json: async () => appearance };
    if (url === 'http://api/api/appearance/race-goal/image' && options.method === 'DELETE') return { ok: true, json: async () => ({ ...appearance, raceGoalImage: null }) };
    if (url.startsWith('http://api/api/activities/sparklines?ids=')) return { ok: true, json: async () => sparklines };
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers();
});
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);

test('counts whole calendar days to the race', () => {
  expect(daysUntil('2026-03-01', '2026-01-28')).toBe(32);
  expect(daysUntil('2026-03-29', '2026-03-28')).toBe(1);
  expect(daysUntil('2026-01-28', '2026-01-28')).toBe(0);
});

test('shows the race goal from the athlete profile with a countdown and opens the profile to edit it', async () => {
  profile.goal = { type: 'cycling_event', name: 'Ötztaler Radmarathon', date: '2026-03-01', target: 'unter 10 Stunden' };
  const onEdit = jest.fn();
  await act(async () => root.render(<RaceGoal apiBase="http://api" onEdit={onEdit} />));
  expect(container.querySelector('h3').textContent).toBe('Ötztaler Radmarathon');
  expect(container.querySelector('.race-goal-count').textContent).toBe('32Tage bis zum Start · gut 4 Wochen');
  expect(container.textContent).toContain('Sonntag, 1. März 2026');
  expect(container.textContent).toContain('Radsport-Event');
  expect(container.textContent).toContain('unter 10 Stunden');
  act(() => button('Bearbeiten').click());
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('without a race goal it invites the athlete to add one', async () => {
  const onEdit = jest.fn();
  await act(async () => root.render(<RaceGoal apiBase="http://api" onEdit={onEdit} />));
  expect(button('Bearbeiten')).toBeUndefined();
  act(() => button('Wettkampfziel eintragen').click());
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('reports a failed profile request instead of an empty goal', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'Server nicht erreichbar.' }) }));
  await act(async () => root.render(<RaceGoal apiBase="http://api" onEdit={() => {}} />));
  expect(container.querySelector('[role="alert"]').textContent).toBe('Server nicht erreichbar.');
  expect(button('Wettkampfziel eintragen')).toBeUndefined();
});

test('the start page leads with today and the week, and shows the race goal instead of heart-rate zones', async () => {
  const activities = [
    { id: 'a1', sport: 'run', title: 'Erholungslauf', date: '2026-01-26T07:00:00', duration: 46, distance: 8.2, calories: 620, hrAvg: 132 },
    { id: 'a2', sport: 'ride', title: 'Grundlage mit Sprints', date: '2026-01-27T17:00:00', duration: 125, distance: 62.4, calories: 1450, power: 196 },
    { id: 'old', sport: 'ride', title: 'Letzte Woche', date: '2026-01-20T17:00:00', duration: 60, distance: 30, calories: 700 },
  ];
  const threshold = { id: 'p1', version: 1, sport: 'ride', name: 'Schwelle 3 × 12 min', date: '2026-01-28', steps: [powerStep('warmup', 600, 150), powerStep('interval', 720, 260), powerStep('cooldown', 480, 120)] };
  const easyRun = { id: 'p2', version: 1, sport: 'run', name: 'Lockerer Dauerlauf', date: '2026-01-29', steps: [powerStep('active', 2700, 0)].map(step => ({ ...step, target: { type: 'none' } })) };
  const onOpenWorkout = jest.fn();
  await act(async () => root.render(<Home apiBase="http://api" activities={activities} plannedWorkouts={[threshold, easyRun]} onOpenWorkout={onOpenWorkout} onOpenActivity={() => {}} onEditGoal={() => {}} onReloadWorkouts={() => {}} />));

  expect(container.querySelector('h1').textContent).toBe('Mittwoch, 28. Januar');
  expect(container.querySelector('.home-kicker').textContent).toBe('KW 5Tag 3 von 7');
  // 2:51 h done, plus 30 min today and 45 min tomorrow still planned.
  expect(container.querySelector('.home-lede').textContent).toBe('Heute steht Schwelle 3 × 12 min auf dem Plan. Diese Woche hast du 2:51 h absolviert von geplanten 4:06 h.');
  expect(container.querySelector('.home-figures').textContent).toBe('2:51 hvon 4:06 h70,6 kmDistanz2 / 4Einheiten2.070 kcalKalorien');
  expect(container.querySelector('.today-plan h3').textContent).toBe('Schwelle 3 × 12 min');
  expect(container.querySelectorAll('.today-plan .today-profile-bars i')).toHaveLength(3);
  expect(container.querySelector('.home-tomorrow .plan-card-title').textContent).toBe('Lockerer Dauerlauf');
  expect(container.textContent).not.toContain('Herzfrequenz-Zonen');
  expect(container.querySelector('#race-goal-title').textContent).toBe('Wettkampfziel');
  expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);

  act(() => button('Workout öffnen').click());
  expect(onOpenWorkout).toHaveBeenCalledWith(threshold);
});

const renderHome = (props = {}) => act(async () => root.render(<Home apiBase="http://api" activities={[]} plannedWorkouts={[]} onOpenWorkout={() => {}}
  onOpenActivity={() => {}} onEditGoal={() => {}} onReloadWorkouts={() => {}} {...props} />));

test('a day without plans or sessions is shown as a rest day under the landscape', async () => {
  await renderHome();
  expect(container.querySelector('.home-kicker').textContent).toBe('KW 5Tag 3 von 7·Ruhetag');
  expect(container.querySelector('.home-lede').textContent).toBe('Heute ist Ruhetag. Diese Woche hast du 0:00 h absolviert.');
  expect(container.querySelector('.home-rest h3').textContent).toBe('Ruhetag');
  expect(container.querySelector('.home-backdrop .home-landscape')).not.toBeNull();
});

test('uses the uploaded background photo, or none when it is switched off', async () => {
  appearance = { background: 'custom', backgroundImage: '/api/appearance/background/image?v=7', raceGoalImage: null };
  await renderHome();
  expect(container.querySelector('.home-backdrop.photo img').getAttribute('src')).toBe('http://api/api/appearance/background/image?v=7');
  act(() => root.unmount()); root = createRoot(container);
  appearance = { background: 'none', backgroundImage: '/api/appearance/background/image?v=7', raceGoalImage: null };
  await renderHome();
  expect(container.querySelector('.home-backdrop')).toBeNull();
});

test('recent activities show a heart-rate outline and the first line of the note', async () => {
  sparklines = { a1: [118, 131, 126, 140] };
  const activities = [{ id: 'a1', sport: 'ride', title: 'Grundlage', date: '2026-01-26T07:00:00', duration: 59, distance: 29.2, hrAvg: 127, power: 213, notes: 'Locker im Bereich.\nZweite Zeile' },
    { id: 'a2', sport: 'run', title: 'Ohne Puls', date: '2026-01-24T07:00:00', duration: 135, distance: 19.5 }];
  await renderHome({ activities });
  const rows = container.querySelectorAll('.home-table-row');
  expect(global.fetch).toHaveBeenCalledWith('http://api/api/activities/sparklines?ids=a1%2Ca2');
  expect(rows[0].querySelectorAll('polyline')).toHaveLength(1);
  expect(rows[0].querySelector('.home-table-note').textContent).toBe('Locker im Bereich.');
  expect(rows[1].querySelector('polyline')).toBeNull();
  expect(rows[1].textContent).toContain('—');
  expect(rows[1].querySelector('.home-table-title .sport-mark').textContent).toBe('Laufen');
});

test('the race timeline has one tick per calendar week and labels a few month starts', () => {
  const { weeks, labels } = raceWeeks('2027-08-02', '2026-09-24');
  expect(weeks).toHaveLength(46);
  expect(labels.map(label => label.text)).toEqual(['Okt', 'Jan', 'Apr', 'Jul']);
  expect(raceWeeks('2026-09-25', '2026-09-24')).toBeNull();
});

test('the race goal shows its photo and can remove it', async () => {
  profile.goal = { type: 'cycling_event', name: 'NorthCape 4000', date: '2026-08-02', target: null };
  await act(async () => root.render(<RaceGoal apiBase="http://api" onEdit={() => {}} photo="http://api/api/appearance/race-goal/image?v=3" />));
  expect(container.querySelector('.race-goal-photo img').getAttribute('src')).toBe('http://api/api/appearance/race-goal/image?v=3');
  expect(container.querySelectorAll('.race-goal-ticks i').length).toBeGreaterThan(20);
  await act(async () => container.querySelector('[aria-label="Zielfoto entfernen"]').click());
  expect(global.fetch).toHaveBeenCalledWith('http://api/api/appearance/race-goal/image', { method: 'DELETE' });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
