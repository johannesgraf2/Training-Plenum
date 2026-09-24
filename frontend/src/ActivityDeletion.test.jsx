import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import App from './App';
import { newWorkout } from './workoutModel';

jest.mock('./Dashboard', () => ({ activities }) => <div data-testid="analytics-input">{activities.map(a => a.id).join(',')}</div>);
jest.mock('./BestEfforts', () => () => null);
jest.mock('./RouteMap', () => () => null);

let container, root, originalFetch, saved, deleteResponse;
const activity = { id: 'ride-to-delete', title: 'Abendrunde', sport: 'ride', date: '2026-01-31T15:00:00', duration: 60, distance: 25, timeSeries: [] };
const plan = { ...newWorkout('2026-01-31'), id: 'plan-to-keep', name: 'Geplante Runde' };
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const click = async element => act(async () => element.click());
const deleteCalls = () => global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'DELETE');
const openActivity = async () => click([...container.querySelectorAll('span, strong')].find(el => el.textContent === activity.title));
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-31T12:00:00'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '';
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch;
  saved = [activity, { ...activity, id: 'ride-to-keep', title: 'Morgenrunde', duration: 30, distance: 10 }];
  deleteResponse = async () => ({ ok: true, json: async () => ({ deleted: true }) });
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = url.replace('http://localhost:5000', '');
    if (path === '/api/activities') return { ok: true, json: async () => [...saved] };
    if (path === '/api/workouts') return { ok: true, json: async () => [plan] };
    if (path === '/api/activities/ride-to-delete' && options.method === 'DELETE') {
      const response = await deleteResponse();
      if (response.ok) saved = saved.filter(a => a.id !== activity.id);
      return response;
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${path}`);
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers(); jest.restoreAllMocks();
});

test('confirmation identifies the activity and cancellation or Escape never deletes it', async () => {
  await act(async () => root.render(<App />));
  await openActivity();
  await click(button('Aktivität löschen'));
  const confirmation = container.querySelector('#activity-delete-confirmation');
  expect(confirmation.textContent).toContain('Abendrunde');
  expect(confirmation.textContent).toContain('31.01.2026');
  expect(document.activeElement).toBe(button('Abbrechen'));
  expect(deleteCalls()).toHaveLength(0);
  await click(button('Abbrechen'));
  expect(container.querySelector('#activity-delete-confirmation')).toBeNull();
  expect(document.activeElement).toBe(button('Aktivität löschen'));
  await click(button('Aktivität löschen'));
  act(() => Simulate.keyDown(button('Abbrechen'), { key: 'Escape', preventDefault: jest.fn() }));
  expect(container.querySelector('#activity-delete-confirmation')).toBeNull();
  expect(deleteCalls()).toHaveLength(0);
  expect(saved).toHaveLength(2);
});

test('confirmed deletion persists and updates calendar, weekly totals, list and analytics while retaining other activities and plans', async () => {
  await act(async () => root.render(<App />));
  await click(button('Kalender'));
  expect(container.textContent).toContain('35.0 km');
  await openActivity();
  await click(button('Aktivität löschen'));
  await click(button('Endgültig löschen'));
  expect(deleteCalls()).toHaveLength(1);
  expect(container.querySelector('.activity-detail')).toBeNull();
  expect(window.location.hash).toBe('');
  expect(container.textContent).toContain('Aktivität gelöscht.');
  expect(container.textContent).not.toContain('Abendrunde');
  expect(container.textContent).toContain('Morgenrunde');
  expect(container.textContent).toContain('10.0 km');
  expect(container.textContent).not.toContain('35.0 km');
  expect(container.querySelector('.calendar-planned-workout').textContent).toContain('Geplante Runde');
  await click(button('Dashboard'));
  expect(container.querySelector('.activity-list').textContent).toContain('1 Einträge');
  expect(container.querySelector('[data-testid="analytics-input"]').textContent).toBe('ride-to-keep');
  act(() => root.unmount()); root = createRoot(container);
  await act(async () => root.render(<App />));
  expect(container.textContent).not.toContain('Abendrunde');
  expect(container.textContent).toContain('Morgenrunde');
});

test('a pending deletion cannot be submitted twice and a failed request retains the activity for retry', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  let resolveDelete;
  deleteResponse = () => new Promise(resolve => { resolveDelete = resolve; });
  await act(async () => root.render(<App />));
  await openActivity();
  await click(button('Aktivität löschen'));
  const confirm = button('Endgültig löschen');
  act(() => { confirm.click(); confirm.click(); });
  expect(button('Wird gelöscht…').disabled).toBe(true);
  expect(button('Abbrechen').disabled).toBe(true);
  expect(deleteCalls()).toHaveLength(1);
  await act(async () => resolveDelete({ ok: false, status: 500, json: async () => ({ error: 'Database unavailable' }) }));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Aktivität konnte nicht gelöscht werden');
  expect(container.querySelector('h1').textContent).toBe('Abendrunde');
  expect(window.location.hash).toBe('#activity/ride-to-delete');
  expect(saved).toHaveLength(2);
  deleteResponse = async () => ({ ok: true, json: async () => ({ deleted: true }) });
  await click(button('Endgültig löschen'));
  expect(deleteCalls()).toHaveLength(2);
  expect(saved.map(a => a.id)).toEqual(['ride-to-keep']);
  expect(container.querySelector('.activity-detail')).toBeNull();
});
