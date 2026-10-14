import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import DataHub from './DataHub';
import { resultText } from './importQueue';

const base = { available: true, connected: false, email: null, needsLogin: false, mfaPending: false, syncing: false, progress: null,
  lastSyncAt: null, lastResult: {}, lastError: null, syncedThrough: null, imported: 0, autoSyncHours: 6, pushWorkouts: false, disconnecting: false,
  workouts: { scheduled: 0, sent: 0, pushing: false, removing: false, lastPushAt: null, lastPushResult: {}, lastPushError: null },
  history: { target: null, through: null, running: false, stopping: false, complete: false, result: {}, error: null, progress: null } };
const connected = { ...base, connected: true, email: 'me@example.com', lastSyncAt: '2026-10-14T17:00:00Z', syncedThrough: '2026-10-14',
  lastResult: { imported: 3, duplicate: 2 }, imported: 3, pushWorkouts: true,
  workouts: { ...base.workouts, scheduled: 4, sent: 5, lastPushAt: '2026-10-14T17:01:00Z', lastPushResult: { created: 4, updated: 1 } } };
let host, root, originalFetch, current, onClose, onSynced, historyCalls;
const response = (payload, ok = true) => ({ ok, json: async () => payload });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  current = base; onClose = jest.fn(); onSynced = jest.fn(); historyCalls = [];
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/login')) {
      if (body.password !== 'right') return response({ error: 'Garmin hat die Anmeldung abgelehnt.' }, false);
      current = { ...base, mfaPending: true, mfaRequired: true }; return response(current);
    }
    if (url.endsWith('/mfa')) { current = { ...connected, syncing: true, progress: { done: 1, total: 4 } }; return response(current); }
    if (url.endsWith('/sync')) { current = { ...connected, syncing: true }; return response(current); }
    if (url.endsWith('/history')) {
      historyCalls.push([options.method, body]);
      current = { ...current, history: options.method === 'DELETE'
        ? { ...current.history, stopping: true }
        : { ...base.history, target: body.years === null ? '2000-01-01' : '2024-10-14', running: true } };
      return response(current);
    }
    if (url.endsWith('/settings')) { current = { ...current, pushWorkouts: body.pushWorkouts }; return response(current); }
    if (options.method === 'DELETE') { current = base; return response(base); }
    return response(current);
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; });

const render = () => act(async () => root.render(<DataHub apiBase="http://localhost:5000" initialView="garmin" onClose={onClose} onSynced={onSynced} />));
const button = text => Array.from(host.querySelectorAll('button')).find(b => b.textContent.trim() === text);
const click = text => act(async () => button(text).click());
const type = (selector, value) => act(async () => Simulate.change(host.querySelector(selector), { target: { value } }));
const submit = () => act(async () => Simulate.submit(host.querySelector('form')));
const calls = suffix => global.fetch.mock.calls.filter(([url]) => url.endsWith(suffix));

test('logs in with the MFA code and clears the password field', async () => {
  await render();
  await type('input[type="email"]', 'me@example.com');
  await type('input[type="password"]', 'wrong');
  await submit();
  expect(host.textContent).toContain('Garmin hat die Anmeldung abgelehnt.');
  expect(host.querySelector('input[type="password"]').value).toBe('');

  await type('input[type="password"]', 'right');
  await submit();
  const [, options] = calls('/login')[1];
  expect(options).toEqual(expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }));
  expect(JSON.parse(options.body)).toEqual({ email: 'me@example.com', password: 'right' });
  expect(host.textContent).toContain('Bestätigungscode von Garmin');

  await type('input[autocomplete="one-time-code"]', '123456');
  await submit();
  expect(JSON.parse(calls('/mfa')[0][1].body)).toEqual({ code: '123456' });
  expect(host.textContent).toContain('läuft: 1 von 4 geprüft');
  expect(host.querySelector('form')).toBeNull();
});

test('shows the sync state, syncs on request and reloads activities when it finishes', async () => {
  current = connected;
  await render();
  expect(host.textContent).toContain('me@example.com');
  expect(host.textContent).toContain('3 neu, 2 schon vorhanden');
  expect(host.textContent).toContain('alle 6 h');
  await click('Jetzt synchronisieren');
  expect(calls('/sync')[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  expect(button('Wird abgeglichen…').disabled).toBe(true);
  current = connected;  // the next poll sees the finished sync
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
  expect(onSynced).toHaveBeenCalled();
});

test('asks for a new login when the session expired and disconnects after confirmation', async () => {
  current = { ...connected, needsLogin: true, lastError: 'Die Garmin-Anmeldung ist abgelaufen. Bitte neu verbinden.' };
  await render();
  expect(host.textContent).toContain('Anmeldung abgelaufen');
  expect(host.querySelector('input[type="email"]').value).toBe('me@example.com');
  expect(button('Neu anmelden')).toBeTruthy();
  expect(button('Jetzt synchronisieren').disabled).toBe(true);
  await click('Trennen…');
  expect(host.textContent).toContain('Bereits importierte Aktivitäten bleiben erhalten.');
  await click('Trennen');
  expect(calls('/api/garmin').some(([, options]) => options.method === 'DELETE')).toBe(true);
  expect(host.textContent).toContain('Verbinden');
});

test('shows the workouts in the Garmin calendar and switches sending off with or without removing them', async () => {
  current = connected;
  await render();
  expect(host.textContent).toContain('Im Garmin-Kalender (ab heute)4 Einheiten');
  expect(host.textContent).toContain('4 neu, 1 geändert');
  const toggle = () => host.querySelector('.garmin-switch input');
  expect(toggle().checked).toBe(true);
  await act(async () => toggle().click());
  expect(calls('/settings')).toHaveLength(0);  // asks first, because workouts were already sent
  await act(async () => Array.from(host.querySelectorAll('.whoop-confirm input')).at(-1).click());
  await click('Abschalten');
  expect(JSON.parse(calls('/settings')[0][1].body)).toEqual({ pushWorkouts: false, removeWorkouts: true });
  expect(calls('/settings')[0][1].method).toBe('PUT');
  expect(toggle().checked).toBe(false);
  await act(async () => toggle().click());
  expect(JSON.parse(calls('/settings')[1][1].body)).toEqual({ pushWorkouts: true, removeWorkouts: false });
});

test('disconnecting can also delete the sent workouts', async () => {
  current = connected;
  await render();
  await click('Trennen…');
  await act(async () => host.querySelector('.whoop-confirm input').click());
  await click('Trennen');
  expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/garmin?deleteWorkouts=1', { method: 'DELETE' });
});

test('loads older activities for the chosen range, shows the progress and stops on request', async () => {
  current = connected;
  await render();
  expect(host.textContent).toContain('Ältere Aktivitäten nachladen');
  await act(async () => button('2 Jahre').click());
  expect(button('2 Jahre').getAttribute('aria-checked')).toBe('true');
  await click('Nachladen');
  expect(historyCalls).toEqual([['POST', { years: 2 }]]);
  expect(host.querySelector('progress[aria-label="Fortschritt beim Nachladen"]')).not.toBeNull();
  await click('Anhalten');
  expect(historyCalls[1][0]).toBe('DELETE');
  expect(button('Wird angehalten…').disabled).toBe(true);
});

test('a paused history offers to continue, and a finished one says so', async () => {
  const history = { ...base.history, target: `${new Date().getFullYear() - 1}-10-14`, through: '2026-03-01', result: { imported: 40, duplicate: 3 }, error: 'Garmin meldet zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.' };
  current = { ...connected, history };
  await render();
  expect(host.textContent).toContain('Angehalten, geprüft bis März 2026 · 40 neu, 3 schon vorhanden');
  expect(host.textContent).toContain('zu viele Anfragen');
  await click('Fortsetzen');
  expect(historyCalls).toEqual([['POST', { years: 1 }]]);
  act(() => root.unmount());
  root = createRoot(host);
  current = { ...connected, history: { ...base.history, target: '2000-01-01', through: '2000-01-01', complete: true, result: { imported: 812 } } };
  await render();
  expect(host.textContent).toContain('Fertig: die ganze Historie geprüft · 812 neu');
  expect(button('Bereits geladen').disabled).toBe(true);
  expect(button('Alles').getAttribute('aria-checked')).toBe('true');
});

test('explains a server without the Garmin library', async () => {
  current = { ...base, available: false };
  await render();
  expect(host.querySelector('[role="alert"]').textContent).toContain('Python 3.12');
  expect(host.querySelector('form')).toBeNull();
});

test('summarizes sync results in words', () => {
  expect(resultText({ imported: 1, skipped: 2, failed: 0 })).toBe('1 neu, 2 übersprungen');
  expect(resultText({ duplicate: 4, failed: 1 })).toBe('4 schon vorhanden, 1 Fehler');
  expect(resultText({})).toBe('keine neuen Aktivitäten');
  expect(resultText({ created: 0 }, [['created', 'neu']], 'alles aktuell')).toBe('alles aktuell');
});
