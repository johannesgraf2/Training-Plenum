import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AICoach, { goalLabel, isoWeek, weekStart } from './AICoach';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MERGED = ['goal', 'availability', 'preferences', 'metrics', 'thresholds', 'background', 'onboarding'];
const blankProfile = () => ({ source: 'athlete', goal: { type: 'fitness', sports: ['ride'], name: '', date: null, target: null }, sports: ['ride'],
  metrics: { ride: 'power', run: 'pace' }, thresholds: { ride: { source: 'athlete' } }, limitations: { notes: '' }, currentState: { notes: '' },
  availability: { preferredWeeklyHours: 8, indoorWeeklyHours: null, absoluteMaxWeeklyHours: 12, defaultAvailability: Object.fromEntries(DAYS.map(d => [d, 90])),
    windows: [{ id: 'w1', day: 'tue', kind: 'available', allDay: false, from: '18:00', to: '19:30', sports: { ride: { indoor: true, outdoor: true } }, group: null }],
    exceptions: [], maxWeeklyHours: null, restDay: null, longDay: null },
  preferences: { gymAvailability: false, dailyCheckIn: true }, background: { type: 'ride', weeklyHours: 7, intervals: {}, source: 'calculated' },
  onboarding: { completed: ['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'period', 'availability', 'ready', 'created'] }, events: [] });
const todayView = { date: '2026-09-23', checkIn: null, previousCheckIn: null, injuries: [], whoop: null, weekPlanned: true, dailyCheckIn: true,
  readiness: { source: 'calculated', level: 'green', reasons: [], notes: [], affectedSports: [], checkedIn: false },
  sessions: [{ id: 'session-1', source: 'coach', name: 'Grundlage', sport: 'ride', durationMin: 60, hard: false, locked: false }],
  period: { week: '2026-W39', goal: { type: 'fitness', sports: ['ride'], name: '', date: null }, weeksToGoal: null, plannedHours: 8, season: null, planWeek: { number: 3, total: 19 },
    block: { id: 'block-1', blockType: 'aufbau', typeName: 'Aufbau', secondaryName: null, weekNumber: 2, totalWeeks: 3, phase: 'build', deload: false, targetHours: 9, focus: 'Schwelle', startDate: '2026-09-14', endDate: '2026-10-04' } },
  outlook: [], hints: [] };
const activePlan = { revision: 4, blocks: [], weeks: {}, frame: { status: 'active', startDate: '2026-09-07', endDate: '2027-01-17' },
  settings: { startDate: '2026-09-07', endDate: '2027-01-17', replanMode: 'afterReview' } };
const overview = adapt => ({ frame: activePlan.frame, settings: activePlan.settings, today: '2026-09-23', phases: [], events: [], nextManualWeek: null, adapt,
  weeks: [{ week: '2026-W39', number: 3, startDate: '2026-09-21', state: 'current', phaseName: 'Grundlage', targetHours: 8, deload: false, events: [], completedHours: 2,
    plan: { week: '2026-W39', targetHours: 8, calculatedHours: 8, focus: 'Grundlage', sessions: [], fixedSessions: [] } }] });
let container, root, originalFetch, requests, responses, server, changed;

const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
const inputFor = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, textarea, select');
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const submit = async form => { await act(async () => Simulate.submit(form)); };
const tick = async (ms = 0) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const writes = path => requests.filter(r => r.path === path && r.method !== 'GET');
const tabs = () => [...container.querySelectorAll('.coach-tabs button')].map(b => b.textContent);
const current = () => container.querySelector('.coach-tabs [aria-current="page"]').textContent;
const render = async (props = {}) => { await act(async () => root.render(<AICoach apiBase="http://coach.test" initialTab="settings" onWorkoutsChanged={changed} {...props} />)); };
const ok = data => async () => ({ ok: true, json: async () => data });

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = []; responses = {}; changed = jest.fn();
  server = { profile: blankProfile(), user: { ftp: 250, maxHr: 185, age: 40, weight: 72 }, plan: activePlan, events: [], settings: activePlan.settings, adapt: null,
    provider: { provider: 'openai', model: 'gpt-4.1-mini', reasoningEffort: null, configured: true, keyLast4: '1234', encryptionConfigured: true } };
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method, body, url });
    const key = `${method} ${path}`;
    if (responses[key]) return responses[key](body);
    let data;
    if (path === '/api/athlete-profile') {
      if (method === 'PUT') Object.entries(body).forEach(([k, v]) => { server.profile[k] = MERGED.includes(k) ? { ...server.profile[k], ...v } : v; });
      data = server.profile;
    } else if (path === '/api/user') data = method === 'PUT' ? (server.user = { ...server.user, ...body }) : server.user;
    else if (path === '/api/ai-provider') data = method === 'PUT' ? (server.provider = { ...server.provider, model: body.model, reasoningEffort: body.reasoningEffort ?? null }) : server.provider;
    else if (path === '/api/coach/plan') data = server.plan;
    else if (path === '/api/coach/plan/weeks') data = server.plan.frame?.status === 'active' ? overview(server.adapt) : { frame: null, settings: null, phases: [], events: [], weeks: [] };
    else if (path === '/api/coach/plan/settings') data = { settings: method === 'PUT' ? (server.settings = { ...body, createdAt: 'now' }) : server.settings };
    else if (path === '/api/coach/plan/advance') data = { job: null, week: null };
    else if (path === '/api/coach/plan/adapt') {
      if (body.later) { server.adapt = { changes: body.changes, since: '2026-09-23' }; data = { adapt: server.adapt, job: null }; }
      else data = { job: { id: 'adapt-1', kind: 'adapt', status: 'running', steps: [{ id: 'frame', label: 'Phasen neu festlegen', status: 'running' }, { id: 'weeks', label: 'Ausgearbeitete Wochen prüfen', status: 'pending' }] } };
    } else if (path === '/api/coach/plan/adapt/adapt-1') data = { job: { id: 'adapt-1', kind: 'adapt', status: 'done', steps: [], result: { frameChanged: true, proposalId: 'p-1' } } };
    else if (path === '/api/coach/proposals/p-1') data = { id: 'p-1', kind: 'weeks', reason: 'settings', status: 'pending', hinweise: [], before: { '2026-W39': overview().weeks[0].plan },
      after: { '2026-W39': { ...overview().weeks[0].plan, targetHours: 6, calculatedHours: 6 } } };
    else if (path === '/api/coach/plan/reset') { server.plan = { ...server.plan, frame: { ...server.plan.frame, status: 'ended' }, revision: 5 }; data = { ...server.plan, deletedWorkouts: 2 }; }
    else if (path === '/api/coach/today') data = todayView;
    else if (path === '/api/coach/check-ins') data = { checkIns: [], injuries: [] };
    else if (path === '/api/coach/events' && method === 'POST') { const event = { id: `event-${server.events.length + 1}`, ...body, endDate: body.endDate || body.startDate }; server.events = [...server.events, event]; data = { events: server.events, event }; }
    else if (path === '/api/coach/events') data = { events: server.events };
    else if (path === '/api/coach/thresholds') data = { ride: { ftp: server.user.ftp, source: 'athlete' }, run: { paceSecPerKm: null, source: null, basis: null, calculated: null }, maxHr: server.user.maxHr };
    else if (path === '/api/athlete-snapshot') data = { observed: {}, dataQuality: { ftpConfigured: true, maxHrConfigured: true, cyclingPowerCoverageLast42Days: 0.8 } };
    else if (path === '/api/coach/onboarding') data = { hasData: true, recentSports: ['ride'], intervals: {} };
    else if (path === '/api/coach/usage') data = { calls: 12, inputTokens: 120000, outputTokens: 30000, cachedTokens: 0, costUsd: 0.54 };
    else if (path === '/api/coach/chat') data = { messages: [] };
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
  // 2027 starts on a Friday: every Thursday is a multiple of seven days into the year.
  expect(isoWeek('2027-01-31')).toBe('2027-W04');
  expect(isoWeek('2027-09-05')).toBe('2027-W35');
  expect(goalLabel('cycling_event')).toBe('Radsport-Event');
});

test('the coach has Heute, Plan and Einstellungen; former tabs open where their content lives now', async () => {
  await render({ initialTab: 'week', tabVersion: 0 });
  expect(tabs()).toEqual(['Heute', 'Plan', 'Einstellungen']);
  expect(current()).toBe('Plan');
  await render({ initialTab: 'profile', tabVersion: 1 });
  expect(current()).toBe('Einstellungen');
  expect(container.querySelector('.settings-nav [aria-current="page"]').textContent).toBe('Athletenprofil');
  await render({ initialTab: 'settings', initialSection: 'events', tabVersion: 2 });
  expect(container.querySelector('.settings-nav [aria-current="page"]').textContent).toBe('Events & Ziele');
  expect(requests.filter(r => r.path === '/api/coach/plan')).toHaveLength(1);  // The coach stays loaded.
  expect(container.textContent).not.toContain('Saisonplan');
});

test('provider keys are transient and never included in a later model-only save', async () => {
  const storageSpy = jest.spyOn(Storage.prototype, 'setItem');
  await render({ initialSection: 'provider' });
  await change(container.querySelector('input[type="password"]'), 'sk-secret-example');
  await submit(button('Provider speichern').closest('form'));
  expect(writes('/api/ai-provider')[0].body.apiKey).toBe('sk-secret-example');
  expect(container.querySelector('input[type="password"]').value).toBe('');
  expect(container.textContent).not.toContain('sk-secret-example');
  await change(inputFor('Modell'), 'custom');
  await change(inputFor('Modell-ID'), 'my-compatible-model');
  await submit(button('Provider speichern').closest('form'));
  expect(writes('/api/ai-provider')[1].body).toEqual({ provider: 'openai', model: 'my-compatible-model', reasoningEffort: null });
  expect(storageSpy).not.toHaveBeenCalled(); storageSpy.mockRestore();
});

test('the connection badge opens the provider settings with costs and the usage of this month', async () => {
  await render({ initialTab: 'today' });
  await click(button('Provider verbunden · gpt-4.1-mini'));
  expect(current()).toBe('Einstellungen');
  expect(container.querySelector('[aria-label="AI-Provider"]')).not.toBeNull();
  await change(inputFor('Modell'), 'gpt-6.1-sol');
  expect(container.querySelector('.coach-cost').textContent).toContain('Plan erstellen ca. 0,40 $');
  expect(container.querySelector('[aria-label="Verbrauch diesen Monat"]').textContent).toContain('12 Anfragen · 120.000 Tokens Eingabe, 30.000 Ausgabe · ca. 0,54 $');
  await submit(button('Provider speichern').closest('form'));
  expect(button('Provider verbunden · gpt-6.1-sol')).toBeDefined();
  expect(container.querySelector('[role="status"]').textContent).toBe('Provider-Einstellungen gespeichert.');
});

test('a rejected provider save clears the secret and explains a missing encryption key', async () => {
  responses['PUT /api/ai-provider'] = async () => ({ ok: false, json: async () => ({ error: 'Verschlüsselung ist nicht konfiguriert.' }) });
  await render({ initialSection: 'provider' });
  await change(container.querySelector('input[type="password"]'), 'sk-secret-rejected');
  await submit(button('Provider speichern').closest('form'));
  expect(container.querySelector('input[type="password"]').value).toBe('');
  expect(container.querySelector('[role="alert"]').textContent).toContain('Verschlüsselung');
  await act(async () => root.unmount()); root = createRoot(container);
  server.provider = { ...server.provider, configured: false, encryptionConfigured: false, encryptionKeySource: 'invalid', encryptionKeyFile: 'C:/TrainHub/.run/ai-encryption-key.txt' };
  await render({ initialSection: 'provider' });
  expect(container.querySelector('[role="note"]').textContent).toContain('enthält keinen gültigen Schlüssel');
  expect(button('Provider speichern').disabled).toBe(true);
});

test('a plan-relevant change asks to adapt the plan; yes runs the adaptation and shows the change in the plan', async () => {
  await render({ initialSection: 'availability' });
  expect(container.querySelector('[aria-label="Plan anpassen"]')).toBeNull();
  await click(button('+ Ausnahme eintragen'));
  await change(inputFor('Von'), '2026-10-05');
  await change(inputFor('Bis'), '2026-10-09');
  await change(inputFor('Notiz (optional)'), 'Dienstreise');
  await click(button('Ausnahme speichern'));
  expect(writes('/api/athlete-profile').pop().body.availability.exceptions).toEqual([
    expect.objectContaining({ from: '2026-10-05', to: '2026-10-09', kind: 'unavailable', maxMinutes: null, note: 'Dienstreise' })]);
  expect(container.textContent).toContain('05.10.–09.10.2026 · keine Zeit · Dienstreise');
  const card = () => container.querySelector('[aria-label="Plan anpassen"]');
  expect(card().textContent).toContain('Du hast deine Verfügbarkeiten geändert.');
  // A new event also lays out the phases again.
  await click(button('Events & Ziele'));
  await click(button('+ Event hinzufügen'));
  await change(inputFor('Titel'), 'Rennen');
  await change(inputFor('Datum'), '2026-12-12');
  await click(button('Event speichern'));
  expect(server.profile.goal).toEqual(expect.objectContaining({ type: 'event', name: 'Rennen', date: '2026-12-12' }));
  expect(card().textContent).toContain('deine Verfügbarkeiten und deine Events geändert. Ich prüfe die ausgearbeiteten Wochen und lege die Phasen danach neu fest.');
  await click(button('Ja, Plan anpassen'));
  expect(writes('/api/coach/plan/adapt')[0].body).toEqual({ changes: ['availability', 'events'] });
  expect(current()).toBe('Plan');
  expect(container.textContent).toContain('Phasen neu festlegen … Der Coach plant.');
  await tick(1500);
  expect(container.textContent).toContain('Phasen neu festgelegt. Prüfe unten die Anpassung deiner ausgearbeiteten Wochen.');
  expect(container.querySelector('[aria-label="Anpassung an deine Einstellungen"]').textContent).toContain('Passend zu deinen geänderten Einstellungen');
});

test('later keeps a hint in the plan that starts the adaptation from there', async () => {
  await render({ initialSection: 'thresholds' });
  await change(inputFor('FTP in Watt'), '265');
  await click(button('Leistungsdaten speichern'));
  expect(server.user.ftp).toBe(265);
  await click(button('Später'));
  expect(writes('/api/coach/plan/adapt')[0].body).toEqual({ changes: ['thresholds'], later: true });
  expect(container.querySelector('[aria-label="Plan anpassen"]')).toBeNull();
  await click(button('Plan'));
  expect(container.querySelector('.plan-adapt').textContent).toContain('Deine Einstellungen haben sich geändert.');
  await click(button('Plan anpassen'));
  expect(writes('/api/coach/plan/adapt')[1].body).toEqual({ changes: ['thresholds'] });
});

test('without a plan, changes are saved without asking and the plan section creates one', async () => {
  server.plan = { revision: 0, blocks: [], weeks: {} };
  server.settings = null;
  server.profile.onboarding = { completed: [] };
  await render({ initialSection: 'training' });
  await click(button('Laufen'));
  await click(button('Sportarten speichern'));
  expect(server.profile.goal.sports).toEqual(['ride', 'run']);
  expect(container.querySelector('[aria-label="Plan anpassen"]')).toBeNull();
  await click(button('Coach-Verhalten'));
  expect(container.textContent).toContain('Das legst du fest, sobald dein Plan steht.');
  await click(button('Plan'));
  expect(current()).toBe('Plan');
  await click(button('Einstellungen'));
  await click(container.querySelector('.settings-nav button:last-child'));
  await click(button('Plan erstellen'));
  expect(container.querySelector('[role="dialog"][aria-label="Plan bauen"]')).not.toBeNull();
});

test('a new plan ends the running one and the onboarding starts again at the period', async () => {
  const busyChanges = jest.fn();
  await render({ initialSection: 'plan', onBusyChange: busyChanges });
  await click(button('Plan neu erstellen'));
  expect(container.querySelector('[aria-label="Plan neu erstellen"]').textContent).toContain('Vergangene Wochen und eigene Workouts bleiben');
  await click(button('Beenden und neu erstellen'));
  expect(writes('/api/coach/plan/reset')).toHaveLength(1);
  expect(busyChanges).toHaveBeenCalledWith('Neuer Plan wird vorbereitet …');
  expect(busyChanges).toHaveBeenLastCalledWith('');
  expect(server.profile.onboarding.completed).toEqual(['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'availability']);
  expect(changed).toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"][aria-label="Plan bauen"]').textContent).toContain('Zeitraum');
});

test('ending the plan from the settings keeps the past and Heute invites to build the next one', async () => {
  await render({ initialSection: 'plan' });
  await click(button('Plan beenden'));
  await click([...container.querySelectorAll('[aria-label="Plan beenden"] button')].find(b => b.textContent === 'Plan beenden'));
  expect(container.querySelector('[role="status"]').textContent).toContain('Plan beendet. 2 Workouts wurden aus dem Kalender entfernt.');
  await click(button('Heute'));
  expect(container.querySelector('[aria-label="Plan bauen"]').textContent).toContain('Lass uns deinen Plan bauen');
  expect(button('Coach fragen')).toBeUndefined();
  // The next onboarding starts at the period; everything else stays filled in.
  expect(server.profile.onboarding.completed).not.toContain('period');
  await click(button('Weitermachen'));
  expect(container.querySelector('[role="dialog"][aria-label="Plan bauen"]').textContent).toContain('Zeitraum');
});

test('leaving the settings without an answer keeps the question for the plan', async () => {
  await render({ initialSection: 'training' });
  await click(button('Laufen'));
  await click(button('Sportarten speichern'));
  expect(container.querySelector('[aria-label="Plan anpassen"]')).not.toBeNull();
  await click(button('Plan'));
  expect(container.querySelector('.plan-adapt')).not.toBeNull();
  await click(button('Einstellungen'));
  expect(container.querySelector('[aria-label="Plan anpassen"]').textContent).toContain('die Sportarten im Plan geändert');
  await click(button('Plan'));
  await click(button('Plan anpassen'));
  expect(writes('/api/coach/plan/adapt')[0].body).toEqual({ changes: ['sports'] });
  await click(button('Einstellungen'));
  expect(container.querySelector('[aria-label="Plan anpassen"]')).toBeNull();
});

test('with a plan Heute offers quick buttons that ask the coach chat about today, and opening replans when due', async () => {
  responses['GET /api/coach/today'] = ok({ ...todayView, checkIn: { date: '2026-09-23', version: 2 }, readiness: { ...todayView.readiness, level: 'yellow', reasons: ['Wenig Schlaf'] },
    outlook: [{ date: '2026-09-24', sessions: [] }, { date: '2026-09-25', sessions: [{ id: 'x', name: 'Sweetspot', durationMin: 75 }] }, { date: '2026-09-26', sessions: [] }],
    hints: [{ kind: 'event', eventId: 'e', title: 'Kriterium', priority: 'C', startDate: '2026-09-27', days: 4 }] });
  responses['POST /api/coach/plan/advance'] = ok({ job: { id: 'job-1', kind: 'advance', status: 'done', steps: [], result: { week: '2026-W42', weekNumber: 6, calculatedHours: 8.5, focus: 'Sweetspot', proposalId: null } } });
  responses['POST /api/coach/chat'] = body => ok({ messages: [{ id: 1, role: 'athlete', text: body.message, ref: body.ref, change: null }, { id: 2, role: 'coach', text: 'Dann 40 Minuten locker.', ref: null, change: null }] })();
  await render({ initialTab: 'today' });
  expect(requests.find(r => r.path === '/api/coach/plan/advance').body).toEqual({ trigger: 'auto' });
  expect(container.textContent).toContain('Woche 6 geplant – 8,5 h, Fokus Sweetspot.');
  expect(container.textContent).toContain('Woche 3 von 19 · Aufbau');
  expect(container.textContent).toContain('Kriterium (C-Event) in 4 Tagen.');
  expect(container.textContent).toContain('Sweetspot · 1:15 h');
  expect(container.querySelector('[aria-label="Plan bauen"]')).toBeNull();
  await click(button('Kürzer'));
  const sent = requests.find(r => r.method === 'POST' && r.path === '/api/coach/chat');
  expect(sent.body).toEqual({ message: 'Meine Tagesampel ist heute gelb. Bitte mach die heutige Einheit kürzer.',
    ref: { kind: 'session', week: '2026-W39', sessionId: 'session-1', label: 'Heute · Grundlage' } });
  expect(container.querySelector('[role="dialog"]').textContent).toContain('Dann 40 Minuten locker.');
});

test('a yellow check-in adapts the day in the coach chat', async () => {
  responses['POST /api/coach/check-ins'] = body => ok({ ...todayView, checkIn: { ...body, version: 2 }, readiness: { ...todayView.readiness, level: 'yellow', reasons: ['Alkohol gestern'], checkedIn: true } })();
  await render({ initialTab: 'today' });
  expect(container.querySelector('.coach-tabs [aria-label="Check-in offen"]')).not.toBeNull();
  await click(button('Check-in ausfüllen'));
  const dialog = () => container.querySelector('[role="dialog"]');
  const chip = (question, answer) => [...dialog().querySelectorAll('fieldset')].find(f => f.querySelector('legend').textContent.startsWith(question))
    .querySelectorAll('button').forEach(b => { if (b.textContent === answer) b.click(); });
  await act(async () => {
    for (const [question, answer] of [['Wohlbefinden', 'gut'], ['Erholung', 'normal'], ['Stress', 'mittel'], ['Muskelkater', 'leicht'], ['Stimmung', 'gut'],
      ['Ernährung gestern', 'passend'], ['Alkohol gestern', 'mehr'], ['Schmerzen oder Verletzung?', 'nein']]) chip(question, answer);
  });
  await click(button('Fertig'));
  expect(dialog().textContent).toContain('Gelb – etwas zurücknehmen');
  await click(button('Woche anpassen lassen'));
  expect(container.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Coach-Chat');
  expect(container.querySelector('.chat-ref').textContent).toContain('Über: Heute · Grundlage');
  expect(requests.some(r => r.path === '/api/coach/proposals')).toBe(false);
});
