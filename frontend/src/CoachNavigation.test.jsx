import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

jest.mock('./Dashboard', () => () => null);
jest.mock('./BestEfforts', () => () => null);
// A stand-in coach: it counts its mounts and holds a running request the test finishes later.
let mockMounts = 0, mockFinish = null;
jest.mock('./AICoach', () => ({ ...jest.requireActual('./AICoach'), __esModule: true, default: function FakeCoach({ initialTab, tabVersion, onBusyChange }) {
  const { useEffect, useState } = jest.requireActual('react');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => { mockMounts += 1; }, []);
  useEffect(() => { onBusyChange?.(busy); }, [busy]);
  const start = () => {
    setBusy('Der Coach passt deinen Plan an …');
    new Promise(resolve => { mockFinish = resolve; }).then(text => { setResult(text); setBusy(''); });
  };
  return <div className="fake-coach">
    <span data-testid="tab">{initialTab}:{tabVersion}</span>
    <button type="button" onClick={start}>Plan anpassen lassen</button>
    <p data-testid="result">{result}</p>
  </div>;
} }));

let container, root, originalFetch;
beforeEach(() => {
  mockMounts = 0; mockFinish = null;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '';
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch;
  global.fetch = jest.fn(async url => {
    const path = url.replace('http://localhost:5000', '');
    if (path === '/api/activities' || path === '/api/workouts') return { ok: true, json: async () => [] };
    if (path === '/api/whoop') return { ok: true, json: async () => ({ connected: false }) };
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const nav = text => [...container.querySelectorAll('.app-nav button')].find(b => b.textContent === text);
const click = element => act(() => element.click());
const coach = () => container.querySelector('.fake-coach');

test('a running coach request goes on while the athlete looks at the calendar and dashboard', async () => {
  await act(async () => root.render(<App />));
  expect(coach()).toBeNull(); // The coach loads only once it is opened.
  click(nav('AI Coach'));
  click([...coach().querySelectorAll('button')].find(b => b.textContent === 'Plan anpassen lassen'));
  expect(container.querySelector('.app-nav-status')).toBeNull(); // No marker while the coach is on screen.

  click(nav('Kalender'));
  expect(coach().closest('[hidden]')).not.toBeNull();
  expect(container.querySelector('.app-nav-status.busy').getAttribute('aria-label')).toBe('Läuft: Der Coach passt deinen Plan an …');
  click(nav('Dashboard'));
  await act(async () => mockFinish('Plan angepasst'));
  expect(container.querySelector('.app-nav-status.busy')).toBeNull();
  expect(container.querySelector('.app-nav-status.done')).not.toBeNull();

  click(nav('AI Coach'));
  expect(coach().closest('[hidden]')).toBeNull();
  expect(container.querySelector('[data-testid="result"]').textContent).toBe('Plan angepasst');
  expect(container.querySelector('.app-nav-status')).toBeNull();
  expect(mockMounts).toBe(1);
});

test('the morning check-in opens by itself once a day and leads into the coach', async () => {
  const day = { date: '2026-10-21', checkIn: null, previousCheckIn: null, injuries: [], whoop: null, weekPlanned: true, dailyCheckIn: true, sessions: [],
    readiness: { level: 'green', reasons: [], notes: [], affectedSports: [], checkedIn: false }, period: { week: '2026-W43', goal: {}, block: null, season: null, weeksToGoal: null } };
  window.localStorage.clear();
  global.fetch = jest.fn(async url => {
    const path = url.replace('http://localhost:5000', '').split('?')[0];
    if (path === '/api/activities' || path === '/api/workouts') return { ok: true, json: async () => [] };
    if (path === '/api/whoop') return { ok: true, json: async () => ({ connected: false }) };
    if (path === '/api/coach/today') return { ok: true, json: async () => day };
    throw new Error(`Unexpected request ${path}`);
  });
  await act(async () => root.render(<App />));
  expect(container.querySelector('[aria-label="Morgen-Check-in"]')).not.toBeNull();
  expect(container.querySelector('.today-strip.open')).not.toBeNull();  // The start page shows it, too.
  click([...container.querySelectorAll('button')].find(b => b.textContent === 'Später'));
  expect(container.querySelector('[aria-label="Morgen-Check-in"]')).toBeNull();
  // Coming back to the tab the same day does not ask again.
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(container.querySelector('[aria-label="Morgen-Check-in"]')).toBeNull();
  click([...container.querySelectorAll('.today-strip button')][0]);
  expect(container.querySelector('[aria-label="Morgen-Check-in"]')).not.toBeNull();
});
