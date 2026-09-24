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
const blockProposal = { id: 'proposal-1', kind: 'block', before: null, hinweise: ['Zuletzt wenig Umfang.'], rejectedOptions: [], after: { mode: 'recommend', options: [
  { id: 'ruhig', recommended: true, rationale: 'Sanft wieder einsteigen.', typeName: 'Wiedereinstieg', secondaryName: null, block: macro },
  { id: 'mehr', recommended: false, rationale: 'Mehr Intensität.', typeName: 'Aufbau', secondaryName: 'Kraft', block: { ...macro, weeks: [...macro.weeks, { week: 2, phase: 'recovery', targetHours: 5, focus: 'Erholung' }] } },
] } };
let container, root, originalFetch, requests, responses, changed, initialPlan;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const inputFor = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, textarea, select');
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const submit = async form => { await act(async () => Simulate.submit(form)); };
const startBlock = async () => { await change(inputFor('Wo stehst du gerade?'), 'nach_pause'); await click(button('Vorschläge erstellen')); };
const render = async (props = {}) => { await act(async () => root.render(<AICoach apiBase="http://coach.test" onWorkoutsChanged={changed} {...props} />)); };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  originalFetch = global.fetch; requests = []; responses = {}; changed = jest.fn(); initialPlan = { revision: 0, blocks: [], weeks: {} };
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
    else if (path === '/api/coach/proposals') data = body.kind === 'block' ? blockProposal : { id: 'proposal-1', kind: body.kind, hinweise: ['Kurze Woche.'], before: weekPlan, after: { ...weekPlan, targetHours: 7, sessions: [{ ...session, params: { durationMin: 45 }, rendered: { ...session.rendered, durationMin: 45 } }] } };
    else if (path.endsWith('/confirm')) data = { revision: 1, blocks: [macro], weeks: {} };
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
  expect(container.textContent).toContain('Neuen Trainingsblock starten');
  expect(button('Vorschläge erstellen').disabled).toBe(true);
  await startBlock();
  expect(requests.find(r => r.path === '/api/coach/proposals').body).toEqual({ kind: 'block', mode: 'recommend', situation: 'nach_pause', startDate: '2026-09-28' });
  const preview = container.querySelector('[aria-label="Planvorschlag prüfen"]');
  expect(preview.textContent).toContain('Trainingsblock wählen');
  expect(preview.textContent).toContain('Zuletzt wenig Umfang.');
  expect(preview.textContent).toContain('Aufbau + Kraft');
  expect(preview.querySelector('input[value="ruhig"]').checked).toBe(true);
  expect(requests.some(r => r.path.endsWith('/confirm'))).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  await click(preview.querySelector('input[value="mehr"]'));
  await click(button('Diese Option übernehmen'));
  expect(requests.find(r => r.path.endsWith('/confirm')).body).toEqual({ confirm: true, optionId: 'mehr' });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(container.textContent).toContain('Trainingsblock übernommen.');
});

test('changing availability removes a preview and blocks AI planning until the override is saved', async () => {
  initialPlan = { revision: 2, blocks: [macro], weeks: { '2026-W39': weekPlan } };
  await render(); await click(button('Woche anpassen'));
  expect(container.textContent).toContain('Geändert: Grundlage');
  expect(container.textContent).toContain('Kurze Woche.');
  await change(container.querySelector('[aria-label="Do Verfügbarkeit diese Woche"]'), 'no');
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(button('Woche anpassen').disabled).toBe(true);
  await submit(button('Wochenverfügbarkeit speichern').closest('form'));
  expect(requests.find(r => r.path === '/api/coach/weekly-overrides/2026-W39').body).toEqual({ overrides: { thu: { available: false } }, note: '' });
  expect(button('Woche anpassen').disabled).toBe(false);
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
  initialPlan = { revision: 2, blocks: [macro], weeks: { '2026-W39': weekPlan } };
  await render({ workouts: [workout] }); await click(button('Woche anpassen'));
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
  await startBlock();
  await render({ workouts: [{ id: 'added', date: '2026-09-24', name: 'Neue Einheit' }] });
  await act(async () => resolveProposal({ ok: true, json: async () => ({ ...blockProposal, id: 'late' }) }));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
});

test('a stale confirmation clears the preview and keeps the stored plan unchanged', async () => {
  responses['POST /api/coach/proposals/proposal-1/confirm'] = async () => ({ ok: false, json: async () => ({ error: 'Kontext geändert. Bitte neuen Vorschlag erstellen.' }) });
  await render(); await startBlock();
  await click(button('Diese Option übernehmen'));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Kontext geändert');
  expect(changed).not.toHaveBeenCalled();
});

test('an incomplete setup shows a checklist that jumps to the missing step instead of disabled forms', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => ({ ...profile, availability: { ...profile.availability, absoluteMaxWeeklyHours: null, defaultAvailability: { ...profile.availability.defaultAvailability, fri: null } } }) });
  responses['GET /api/ai-provider'] = async () => ({ ok: true, json: async () => ({ provider: 'openai', model: 'gpt-4.1-mini', configured: false, keyLast4: null, encryptionConfigured: true }) });
  await render();
  const checklist = container.querySelector('[aria-label="Einrichtung"]');
  expect(checklist.textContent).toContain('Es fehlt: Wochenmaximum · Verfügbarkeit Fr');
  expect(checklist.textContent).toContain('Ersten Block planen');
  expect(button('Vorschläge erstellen')).toBeUndefined();
  expect(button('Woche planen')).toBeUndefined();
  await click(button('Zum Athletenprofil'));
  expect(button('Athletenprofil speichern')).toBeDefined();
});

test('an active block shows the current block week and German planning actions', async () => {
  initialPlan = { revision: 1, blocks: [{ startDate: '2026-09-14', weeks: [macro.weeks[0], { ...macro.weeks[0], week: 2 }, { ...macro.weeks[0], week: 3, phase: 'recovery' }] }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Woche 2 von 3');
  expect(container.textContent).toContain('Erholung');
  expect(button('Woche planen').disabled).toBe(false);
  expect(button('Woche anpassen').disabled).toBe(true);
  expect(container.querySelector('[aria-label="Planungswoche"]').max).toBe('2026-W40');
  await click(button('Woche planen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body.kind).toBe('week');
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]').textContent).toContain('Wochenplan prüfen');
});

test('an upcoming block opens on its first week', async () => {
  initialPlan = { revision: 1, blocks: [{ ...macro, startDate: '2026-10-05' }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Startet am');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W41');
});

test('a replaced block is history; the next block and its type are shown', async () => {
  initialPlan = { revision: 4, weeks: {}, blocks: [
    { ...macro, id: 'old', status: 'abandoned', endDate: '2026-09-27', typeName: 'Eigener Block' },
    { ...macro, id: 'next', status: 'active', startDate: '2026-09-28', endDate: '2026-10-04', typeName: 'VO2max', secondaryName: 'Kraft' },
  ] };
  await render();
  expect(container.textContent).toContain('Startet am');
  expect(container.querySelector('.coach-block-type').textContent).toBe('VO2max + Kraft');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W40');
  expect(button('Neue Vorschläge erstellen')).toBeDefined();
});

test('an ended block offers the next block instead of week planning', async () => {
  initialPlan = { revision: 3, blocks: [{ ...macro, startDate: '2026-09-07' }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Block abgeschlossen');
  expect(button('Vorschläge für den nächsten Block')).toBeDefined();
  expect(button('Woche planen')).toBeUndefined();
  expect(button('Fixieren')).toBeUndefined();
});

test('goal types and the season countdown are shown in German', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => ({ ...profile, goal: { type: 'general_endurance', name: '', date: '2026-12-02', target: null } }) });
  await render();
  expect(container.querySelector('.coach-season').textContent).toBe('Noch 10 Wochen bis Allgemeine Ausdauer · 2. Dez.');
  await click(button('Athletenprofil'));
  const select = inputFor('Zieltyp');
  expect(select.value).toBe('endurance');
  expect(select.textContent).not.toContain('general_endurance');
});
