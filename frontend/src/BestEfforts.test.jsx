import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import BestEfforts, { effortValue } from './BestEfforts';

const activities = [{ id: 'ride', date: '2026-06-01T12:00:00Z' }, { id: 'old', date: '2025-06-01T12:00:00Z' }];
const activity = { id: 'ride', title: 'Best ride', date: '2026-06-01T12:00:00Z' };
const payload = (sport = 'ride') => ({ efforts: sport === 'ride' ? [{ target: 30, value: 320.1, activity }] : [{ target: 400, value: 89, activity: { ...activity, title: 'Best run' } }] });
const response = data => ({ ok: true, json: async () => data });
let host, root, savedFetch, open;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  savedFetch = global.fetch;
  global.fetch = jest.fn(async url => response(payload(new URL(url).searchParams.get('sport'))));
  open = jest.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  global.fetch = savedFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const render = async (viewedYear = 2026) => act(async () => root.render(<BestEfforts activities={activities} apiBase="http://localhost:5000" viewedYear={viewedYear} onOpenActivity={open} />));
const chooseYear = async value => act(async () => Simulate.change(host.querySelector('select'), { target: { value } }));
const clickText = async text => act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === text).click());

test('defaults to the viewed year with seven cycling durations and a link to the source activity', async () => {
  await render();
  expect(host.querySelector('select').value).toBe('2026');
  expect(global.fetch.mock.calls[0][0]).toContain('year=2026');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(7);
  expect(host.textContent).toContain('320 W');
  expect(host.textContent).toContain('60 Min.');
  await act(async () => host.querySelector('.best-efforts-link').click());
  expect(open).toHaveBeenCalledWith(activity);
});

test('year and All-Time selection persist when switching to the five running distances', async () => {
  await render();
  await chooseYear('2025');
  expect(global.fetch.mock.lastCall[0]).toContain('year=2025');
  await chooseYear('all');
  await clickText('Laufen');
  expect(host.querySelector('select').value).toBe('all');
  expect(global.fetch.mock.lastCall[0]).toContain('sport=run&year=all');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(host.textContent).toContain('1:29');
  expect(host.textContent).toContain('21 km');
  expect(host.textContent).not.toContain('320 W');
  expect(host.querySelector('.best-efforts-link').textContent).toContain('01.06.26');
  await render(2025);
  expect(host.querySelector('select').value).toBe('2025');
});

test('missing measurements show dashes and request failures offer retry', async () => {
  global.fetch.mockRejectedValueOnce(new Error('Server nicht erreichbar.'));
  await render();
  expect(host.querySelector('[role="alert"]').textContent).toContain('Server nicht erreichbar.');
  global.fetch.mockResolvedValueOnce(response({ efforts: [{ target: 30, value: null, activity: null }] }));
  await clickText('Erneut versuchen');
  expect(host.querySelectorAll('.best-efforts-value')[0].textContent).toBe('—');
  expect(host.textContent).toContain('Noch keine ausreichend langen Aufzeichnungen');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('an older in-flight response cannot replace the selected sport', async () => {
  let finish;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  await clickText('Laufen');
  await act(async () => finish(response(payload('ride'))));
  expect(host.textContent).toContain('Schnellste Zeit');
  expect(host.textContent).toContain('1:29');
  expect(host.textContent).not.toContain('320 W');
});

test('values keep recorded zero and correctly format minute/hour boundaries', () => {
  expect(effortValue(0, 'ride')).toBe('0 W');
  expect(effortValue(null, 'ride')).toBe('—');
  expect(effortValue(3599.6, 'run')).toBe('1:00:00');
  expect(effortValue(59.9, 'run')).toBe('1:00');
});
