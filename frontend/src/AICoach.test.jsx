import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AICoach, { isoWeek, weekStart } from './AICoach';

const profile = {
  source: 'athlete', goal: { type: 'endurance', name: 'Fit bleiben' },
  availability: { preferredWeeklyHours: 8, absoluteMaxWeeklyHours: 12, defaultAvailability: { mon: 60, tue: 90, wed: 60, thu: 90, fri: 0, sat: 180, sun: 120 } },
  preferences: {}, limitations: {}, currentState: {}, weeklyOverrides: [], dailyOverrides: [], checkIns: [],
};
const macro = { startDate: '2026-09-21', weeks: [{ week: 1, phase: 'base', targetHours: 8, focus: 'Ruhiger Aufbau' }] };
const session = { id: 'session-1', day: 'tue', template: 'bike_z2_short', params: { durationMin: 60 }, locked: false, rendered: { name: 'Grundlage', date: '2026-09-22', durationMin: 60, estimatedTss: 40 } };
const weekPlan = { week: '2026-W39', targetHours: 8, focus: 'Ausdauer', sessions: [session] };
let container, root, originalFetch, requests, responses, changed, initialPlan;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const inputFor = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, textarea, select');
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const submit = async form => { await act(async () => Simulate.submit(form)); };
const render = async (props = {}) => { await act(async () => root.render(<AICoach apiBase="http://coach.test" onWorkoutsChanged={changed} {...props} />)); };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  originalFetch = global.fetch; requests = []; responses = {}; changed = jest.fn(); initialPlan = { revision: 0, macroPlan: null, weeks: {} };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method, body });
    const key = `${method} ${path}`;
    if (responses[key]) return responses[key](body);
    let data;
    if (path === '/api/athlete-snapshot') data = { athlete: {}, observed: { currentTraining: { last7Days: { trainingHours: 6.5 }, last28Days: { trainingHours: 27 }, last42Days: { trainingHours: 40 } }, observedTrainingCapacity: { max6WeekAverageHours: 9.5 } }, selfReported: profile, dataQuality: { ftpConfigured: true, maxHrConfigured: true } };
    else if (path === '/api/athlete-profile') data = method === 'PUT' ? { ...profile, ...body } : profile;
    else if (path === '/api/ai-provider') data = { provider: 'openai', model: body?.model || 'gpt-4.1-mini', configured: true, keyLast4: '1234', encryptionConfigured: true };
    else if (path === '/api/coach/plan') data = initialPlan;
    else if (path === '/api/coach/proposals') data = { id: 'proposal-1', kind: body.kind, summary: 'Mehr Zeit für Erholung.', before: body.kind === 'macro' ? initialPlan.macroPlan : weekPlan, after: body.kind === 'macro' ? macro : { ...weekPlan, targetHours: 7, sessions: [{ ...session, params: { durationMin: 45 }, rendered: { ...session.rendered, durationMin: 45 } }] } };
    else if (path.endsWith('/confirm')) data = { revision: 1, macroPlan: macro, weeks: {} };
    else if (path.startsWith('/api/coach/weekly-overrides/')) data = body;
    else if (path.startsWith('/api/workouts/') && path.endsWith('/lock')) data = body;
    else if (path.endsWith('/discard')) data = {};
    else throw new Error(`Unexpected ${key}`);
    return { ok: true, json: async () => data };
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers();
});

test('ISO week dates remain correct at year boundaries', () => {
  expect(isoWeek('2027-01-01')).toBe('2026-W53');
  expect(weekStart('2026-W53')).toBe('2026-12-28');
  expect(isoWeek('2025-12-29')).toBe('2026-W01');
  expect(weekStart('2026-W01')).toBe('2025-12-29');
});

test('a proposal is human-readable and only saves after explicit confirmation', async () => {
  await render();
  expect(container.textContent).toContain('6,5 h');
  await click(button('Makroplan vorschlagen'));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]').textContent).toContain('Grundlage');
  expect(requests.some(r => r.path.endsWith('/confirm'))).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  await click(button('Änderungen bestätigen und übernehmen'));
  expect(requests.find(r => r.path.endsWith('/confirm')).body).toEqual({ confirm: true });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(container.textContent).toContain('Plan übernommen.');
});

test('changing availability removes a preview and blocks AI planning until the override is saved', async () => {
  initialPlan = { revision: 2, macroPlan: macro, weeks: { '2026-W39': weekPlan } };
  await render(); await click(button('Bestehende Woche anpassen'));
  expect(container.textContent).toContain('Geändert: Grundlage');
  await change(container.querySelector('[aria-label="Do Verfügbarkeit diese Woche"]'), 'no');
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(button('Bestehende Woche anpassen').disabled).toBe(true);
  await submit(button('Wochenverfügbarkeit speichern').closest('form'));
  expect(requests.find(r => r.path === '/api/coach/weekly-overrides/2026-W39').body).toEqual({ overrides: { thu: { available: false } }, note: '' });
  expect(button('Bestehende Woche anpassen').disabled).toBe(false);
});

test('provider keys are transient and never included in a later model-only save', async () => {
  const storageSpy = jest.spyOn(Storage.prototype, 'setItem');
  await render(); await click(button('AI Provider'));
  await change(container.querySelector('input[type="password"]'), 'sk-secret-example');
  await submit(button('Provider speichern').closest('form'));
  expect(requests.find(r => r.path === '/api/ai-provider' && r.method === 'PUT').body.apiKey).toBe('sk-secret-example');
  expect(container.querySelector('input[type="password"]').value).toBe('');
  expect(container.textContent).not.toContain('sk-secret-example');
  await change(inputFor('Modell'), 'my-compatible-model');
  await submit(button('Provider speichern').closest('form'));
  const writes = requests.filter(r => r.path === '/api/ai-provider' && r.method === 'PUT');
  expect(writes[1].body).toEqual({ provider: 'openai', model: 'my-compatible-model' });
  expect(storageSpy).not.toHaveBeenCalled(); storageSpy.mockRestore();
});

test('a rejected provider save clears the secret and exposes a useful error', async () => {
  responses['PUT /api/ai-provider'] = async () => ({ ok: false, json: async () => ({ error: 'Verschlüsselung ist nicht konfiguriert.' }) });
  await render(); await click(button('AI Provider'));
  await change(container.querySelector('input[type="password"]'), 'sk-secret-rejected');
  await submit(button('Provider speichern').closest('form'));
  expect(container.querySelector('input[type="password"]').value).toBe('');
  expect(container.querySelector('[role="alert"]').textContent).toContain('Verschlüsselung');
});

test('new workout context invalidates an outstanding proposal and locking refreshes the calendar', async () => {
  const workout = { id: 'own-workout', date: '2026-09-26', name: 'Gruppenausfahrt', locked: false };
  await render({ workouts: [workout] }); await click(button('Makroplan vorschlagen'));
  await render({ workouts: [{ ...workout, locked: true }] });
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  await click(button('Fixiert · lösen'));
  expect(requests.find(r => r.path === '/api/workouts/own-workout/lock').body).toEqual({ locked: false });
  expect(changed).toHaveBeenCalledTimes(1);
});

test('late proposal responses are discarded when the workout context changes', async () => {
  let resolveProposal;
  responses['POST /api/coach/proposals'] = () => new Promise(resolve => { resolveProposal = resolve; });
  const workouts = [];
  await render({ workouts });
  await click(button('Makroplan vorschlagen'));
  await render({ workouts: [{ id: 'added', date: '2026-09-24', name: 'Neue Einheit' }] });
  await act(async () => resolveProposal({ ok: true, json: async () => ({ id: 'late', kind: 'macro', before: null, after: macro }) }));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
});

test('a stale confirmation clears the preview and keeps the stored plan unchanged', async () => {
  responses['POST /api/coach/proposals/proposal-1/confirm'] = async () => ({ ok: false, json: async () => ({ error: 'Kontext geändert. Bitte neuen Vorschlag erstellen.' }) });
  await render(); await click(button('Makroplan vorschlagen'));
  await click(button('Änderungen bestätigen und übernehmen'));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Kontext geändert');
  expect(changed).not.toHaveBeenCalled();
});
