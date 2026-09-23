import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import App from './App';
import { newWorkout } from './workoutModel';

jest.mock('./Dashboard', () => () => null);
jest.mock('./BestEfforts', () => () => null);

let container, root, originalFetch, saved;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-31T12:00:00'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '';
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch; saved = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = url.replace('http://localhost:5000', '');
    if (path === '/api/activities') return { ok: true, json: async () => [] };
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
