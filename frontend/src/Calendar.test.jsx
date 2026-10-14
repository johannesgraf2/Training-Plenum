import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import App from './App';
import { newWorkout } from './workoutModel';

jest.mock('./Dashboard', () => () => null);
jest.mock('./BestEfforts', () => () => null);

let container, root, originalFetch, saved, whoopDays;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-31T12:00:00'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '';
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch; saved = []; whoopDays = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = url.replace('http://localhost:5000', '');
    if (path === '/api/activities') return { ok: true, json: async () => [] };
    if (path === '/api/whoop') return { ok: true, json: async () => ({ connected: true, analytics: { computedAt: 'x', latest: whoopDays[0] || null } }) };
    if (path.startsWith('/api/whoop/days?')) return { ok: true, json: async () => ({ days: whoopDays }) };
    if (path === '/api/workouts' && options.method === 'POST') {
      const workout = { ...JSON.parse(options.body), id: 'calendar-plan' };
      saved.push(workout); return { ok: true, json: async () => workout };
    }
    if (path === '/api/workouts') return { ok: true, json: async () => [...saved] };
    if (path.startsWith('/api/workouts/') && options.method === 'PUT') {
      const workout = { ...JSON.parse(options.body), id: path.split('/').pop() };
      saved = saved.map(w => w.id === workout.id ? workout : w);
      return { ok: true, json: async () => workout };
    }
    if (path.startsWith('/api/workouts/') && options.method === 'DELETE') {
      saved = saved.filter(w => w.id !== path.split('/').pop()); return { ok: true };
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${path}`);
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers();
});
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const day = date => container.querySelector(`.calendar-day[data-date="${date}"]`);
const click = element => act(() => element.click());
const renderCalendar = async () => { await act(async () => root.render(<App />)); click(button('Kalender')); };

test('a calendar day in the next month opens the builder on that date and a saved plan appears immediately and after reload', async () => {
  await renderCalendar();
  expect(container.querySelectorAll('.calendar-add-workout')).toHaveLength(31);
  click(container.querySelector('[aria-label="Nächster Monat"]'));
  expect(container.querySelectorAll('.calendar-add-workout')).toHaveLength(28);
  click(day('2026-02-01').querySelector('.calendar-add-workout'));
  expect(container.querySelector('.workout-dialog input[type="date"]').value).toBe('2026-02-01');
  click([...container.querySelectorAll('.workout-template')].find(b => b.textContent.includes('30 min konstant')));
  await act(async () => button('Workout speichern').click());
  expect(saved[0]).toMatchObject({ date: '2026-02-01', name: '30 min konstant' });
  click(container.querySelector('[aria-label="Workout-Editor schließen"]'));
  expect(day('2026-02-01').querySelector('.calendar-planned-workout').textContent).toContain('Geplant30 min konstant30 min');
  expect(day('2026-02-02').querySelector('.calendar-planned-workout')).toBeNull();
  // A plan does not become a completed activity or change completed weekly totals.
  expect(container.textContent).toContain('Keine Aktivitäten');
  expect(container.textContent).not.toContain('00:30:00');
  act(() => root.unmount()); root = createRoot(container);
  await renderCalendar();
  click(container.querySelector('[aria-label="Nächster Monat"]'));
  expect(day('2026-02-01').querySelector('.calendar-planned-workout').textContent).toContain('30 min konstant');
});

test('existing calendar plans reopen for editing, move when their date changes and disappear after deleting', async () => {
  saved = [{ ...newWorkout('2026-01-31'), id: 'existing', name: 'Kalender-Test' }];
  await renderCalendar();
  click(day('2026-01-31').querySelector('.calendar-planned-workout'));
  expect(container.querySelector('.workout-dialog input[type="date"]').value).toBe('2026-01-31');
  act(() => Simulate.change(container.querySelector('.workout-dialog input[type="date"]'), { target: { value: '2026-02-02' } }));
  await act(async () => button('Workout speichern').click());
  click(container.querySelector('[aria-label="Workout-Editor schließen"]'));
  expect(day('2026-01-31').querySelector('.calendar-planned-workout')).toBeNull();
  click(container.querySelector('[aria-label="Nächster Monat"]'));
  click(day('2026-02-02').querySelector('.calendar-planned-workout'));
  click(button('Löschen'));
  await act(async () => button('Workout löschen').click());
  expect(day('2026-02-02').querySelector('.calendar-planned-workout')).toBeNull();
  expect(saved).toEqual([]);
});

const dataTransfer = () => {
  const data = {};
  return { data, get types() { return Object.keys(data); }, setData: (type, value) => { data[type] = value; }, getData: type => data[type] ?? '', effectAllowed: '', dropEffect: '' };
};
const dragPlan = async (from, to) => {
  const transfer = dataTransfer();
  const plan = day(from).querySelector('.calendar-planned-workout');
  act(() => Simulate.dragStart(plan, { dataTransfer: transfer }));
  act(() => Simulate.dragOver(day(to), { dataTransfer: transfer }));
  expect(day(to).classList.contains('calendar-drop-target')).toBe(true);
  await act(async () => Simulate.drop(day(to), { dataTransfer: transfer }));
  act(() => Simulate.dragEnd(plan, { dataTransfer: transfer }));
};

test('a planned workout can be dragged onto another day and stays there after reload', async () => {
  saved = [{ ...newWorkout('2026-01-31'), id: 'drag-me', name: 'Verschieben', locked: false }];
  await renderCalendar();
  expect(day('2026-01-31').querySelector('.calendar-planned-workout').getAttribute('draggable')).toBe('true');
  await dragPlan('2026-01-31', '2026-01-27');
  const put = global.fetch.mock.calls.find(([, options = {}]) => options.method === 'PUT');
  expect(put[0]).toBe('http://localhost:5000/api/workouts/drag-me');
  const body = JSON.parse(put[1].body);
  expect(body).toMatchObject({ date: '2026-01-27', name: 'Verschieben', sport: 'ride' });
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('locked');
  expect(day('2026-01-31').querySelector('.calendar-planned-workout')).toBeNull();
  expect(day('2026-01-27').querySelector('.calendar-planned-workout').textContent).toContain('Verschieben');
  expect(container.querySelector('.calendar-drop-target')).toBeNull();
  act(() => root.unmount()); root = createRoot(container);
  await renderCalendar();
  expect(day('2026-01-27').querySelector('.calendar-planned-workout').textContent).toContain('Verschieben');
});

test('dropping on the same day does nothing and a refused move is reverted with an error', async () => {
  saved = [{ ...newWorkout('2026-01-31'), id: 'drag-me', name: 'Verschieben', locked: false }];
  await renderCalendar();
  await dragPlan('2026-01-31', '2026-01-31');
  expect(global.fetch.mock.calls.some(([, options = {}]) => options.method === 'PUT')).toBe(false);
  const serve = global.fetch.getMockImplementation();
  global.fetch.mockImplementation(async (url, options = {}) => options.method === 'PUT'
    ? { ok: false, status: 500, json: async () => ({ error: 'Datenbank nicht erreichbar.' }) }
    : serve(url, options));
  await dragPlan('2026-01-31', '2026-01-20');
  expect(day('2026-01-20').querySelector('.calendar-planned-workout')).toBeNull();
  expect(day('2026-01-31').querySelector('.calendar-planned-workout').textContent).toContain('Verschieben');
  expect(container.querySelector('[role="alert"]').textContent).toContain('„Verschieben“ konnte nicht verschoben werden. Datenbank nicht erreichbar.');
});

test('a fixed (locked) plan is not draggable', async () => {
  saved = [{ ...newWorkout('2026-01-31'), id: 'fixed', name: 'Fixiert', locked: true }];
  await renderCalendar();
  const plan = day('2026-01-31').querySelector('.calendar-planned-workout');
  expect(plan.getAttribute('draggable')).toBe('false');
  expect(plan.title).toContain('Fixiert');
});

test('the week column shows the planned weekly hours per week', async () => {
  saved = [
    { ...newWorkout('2026-01-30'), id: 'fri', name: 'Kurz' },
    { ...newWorkout('2026-01-31'), id: 'sat', name: 'Lang', steps: [{ ...newWorkout().steps[0], duration: { type: 'time', value: 5400 } }] },
    { ...newWorkout('2026-01-31'), id: 'run', name: 'Lauf', sport: 'run', steps: [{ ...newWorkout().steps[0], duration: { type: 'distance', value: 8000 } }] },
  ];
  await renderCalendar();
  const summary = day('2026-01-31').closest('.calendar-week').querySelector('.calendar-summary-planned');
  expect(summary.textContent).toContain('Geplant2:00 h');
  expect(summary.textContent).toContain('3 Einheiten · + 8 km');
  expect(summary.textContent).toContain('Radfahren2:00 h');
  expect(day('2026-01-20').closest('.calendar-week').querySelector('.calendar-summary-planned')).toBeNull();
});

test('days show the WHOOP readiness and the week column its averages', async () => {
  const base = { mean: 60, low: 54, high: 66 };
  whoopDays = [
    { date: '2026-01-26', readiness: 80, band: 'green', confidence: 'provisional', hrv: 66, hrvBaseline: base, rhr: 47, sleep: { minutes: 470 } },
    { date: '2026-01-27', readiness: 30, band: 'red', confidence: 'provisional', hrv: 48, hrvBaseline: base, rhr: 55, sleep: { minutes: 320 } },
    { date: '2026-01-28', readiness: null, band: null, confidence: 'calibrating', hrv: null, hrvBaseline: null, rhr: 50, sleep: { minutes: 400 } },
  ];
  await renderCalendar();
  const green = day('2026-01-26').querySelector('.calendar-readiness');
  expect(green.textContent).toBe('80');
  expect(green.getAttribute('title')).toBe('Readiness 80 (grün) · HRV 66 ms · Ruhepuls 47 bpm · Schlaf 7:50 h');
  expect(day('2026-01-27').querySelector('.calendar-readiness').style.getPropertyValue('--band')).toBe('var(--danger)');
  expect(day('2026-01-28').querySelector('.calendar-readiness').getAttribute('title')).toContain('Kalibrierung läuft');
  expect(day('2026-01-29').querySelector('.calendar-readiness')).toBeNull();
  const week = day('2026-01-26').closest('.calendar-week').querySelector('[aria-label="Erholung dieser Woche"]');
  expect(week.textContent).toBe('ErholungØ 55HRV Ø 57 ms (-5 %)');
});
