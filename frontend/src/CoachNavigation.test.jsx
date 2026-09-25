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
    setBusy('Der Coach erstellt einen Vorschlag …');
    new Promise(resolve => { mockFinish = resolve; }).then(text => { setResult(text); setBusy(''); });
  };
  return <div className="fake-coach">
    <span data-testid="tab">{initialTab}:{tabVersion}</span>
    <button type="button" onClick={start}>Saisonplan vorschlagen lassen</button>
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
  click([...coach().querySelectorAll('button')].find(b => b.textContent === 'Saisonplan vorschlagen lassen'));
  expect(container.querySelector('.app-nav-status')).toBeNull(); // No marker while the coach is on screen.

  click(nav('Kalender'));
  expect(coach().closest('[hidden]')).not.toBeNull();
  expect(container.querySelector('.app-nav-status.busy').getAttribute('aria-label')).toBe('Läuft: Der Coach erstellt einen Vorschlag …');
  click(nav('Dashboard'));
  await act(async () => mockFinish('Drei Saisonpläne'));
  expect(container.querySelector('.app-nav-status.busy')).toBeNull();
  expect(container.querySelector('.app-nav-status.done')).not.toBeNull();

  click(nav('AI Coach'));
  expect(coach().closest('[hidden]')).toBeNull();
  expect(container.querySelector('[data-testid="result"]').textContent).toBe('Drei Saisonpläne');
  expect(container.querySelector('.app-nav-status')).toBeNull();
  expect(mockMounts).toBe(1);
});
