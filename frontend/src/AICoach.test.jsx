import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AICoach, { blockQuestions, designAnswers, designFormats, endsWithRace, fitSeasonWeeks, isoWeek, monthSpans, weekStart, weeksToGoal } from './AICoach';

const profile = {
  source: 'athlete', goal: { type: 'endurance', name: 'Fit bleiben' },
  availability: { preferredWeeklyHours: 8, absoluteMaxWeeklyHours: 12, defaultAvailability: { mon: 60, tue: 90, wed: 60, thu: 90, fri: 0, sat: 180, sun: 120 } },
  preferences: {}, limitations: {}, currentState: {}, weeklyOverrides: [], dailyOverrides: [], checkIns: [],
};
const macro = { startDate: '2026-09-21', weeks: [{ week: 1, phase: 'base', targetHours: 8, focus: 'Ruhiger Aufbau' }] };
const session = { id: 'session-1', day: 'tue', template: 'bike_z2_short', params: { durationMin: 60 }, locked: false, rendered: { name: 'Grundlage', date: '2026-09-22', durationMin: 60, estimatedTss: 40, notes: 'Verpflegung (LIT): Optional nur Wasser. Danach Protein.' } };
const weekPlan = { week: '2026-W39', targetHours: 8, focus: 'Ausdauer', sessions: [session] };
const blockProposal = { id: 'proposal-1', kind: 'block', before: null, hinweise: ['Zuletzt wenig Umfang.'], rejectedOptions: [], after: { mode: 'recommend', options: [
  { id: 'ruhig', recommended: true, rationale: 'Sanft wieder einsteigen.', typeName: 'Wiedereinstieg', secondaryName: null, block: macro },
  { id: 'mehr', recommended: false, rationale: 'Mehr Intensität.', typeName: 'Aufbau', secondaryName: 'Kraft', block: { ...macro, weeks: [...macro.weeks, { week: 2, phase: 'recovery', targetHours: 5, focus: 'Erholung' }] } },
] } };
const catalog = { blockTypes: [
  { id: 'grundlage', name: 'Grundlage', summary: 'Aerobe Basis.', defaultWeeks: 8, minWeeks: 6, maxWeeks: 12, rules: ['Keine VO2max-Einheit'], rhythms: { 6: [false, false, true, false, false, true], 8: [false, false, false, true, false, false, false, true] } },
  { id: 'vo2max', name: 'VO2max', summary: 'Kurze, harte Intervalle.', defaultWeeks: 4, minWeeks: 3, maxWeeks: 6, rules: ['Mindestens 2× VO2max-Einheit pro Belastungswoche'], rhythms: { 3: [false, false, true], 4: [false, false, false, true], 5: [false, false, true, false, true], 6: [false, false, true, false, false, true] } },
  { id: 'wettkampfspezifisch', name: 'Wettkampfspezifisch', summary: 'Frisch am Start.', defaultWeeks: 4, minWeeks: 2, maxWeeks: 6, endsByGoal: true, rules: [], rhythms: {} },
  { id: 'taper', name: 'Taper', summary: 'Frisch werden.', defaultWeeks: 1, minWeeks: 1, maxWeeks: 3, endsByGoal: true, rules: [], rhythms: {} },
], secondaryFocus: [{ id: 'kraft', name: 'Kraft' }, { id: 'laufen', name: 'Laufen' }] };
const timeline = { blockId: 'block-1', weeks: [
  { number: 1, week: '2026-W38', startDate: '2026-09-14', phase: 'build', focus: 'Aufbau', targetHours: 8, planned: true, plannedHours: 7.5, completedHours: 6.5, state: 'past' },
  { number: 2, week: '2026-W39', startDate: '2026-09-21', phase: 'build', focus: 'Aufbau', targetHours: 9, planned: true, plannedHours: 8, completedHours: 2, state: 'current' },
  { number: 3, week: '2026-W40', startDate: '2026-09-28', phase: 'recovery', focus: 'Entlastung', targetHours: 5, planned: false, plannedHours: null, completedHours: null, state: 'future' },
] };
const activeBlock = { id: 'block-1', startDate: '2026-09-14', weeks: [macro.weeks[0], { ...macro.weeks[0], week: 2 }, { ...macro.weeks[0], week: 3, phase: 'recovery', targetHours: 5 }] };
const blockReview = { blockId: 'old-block', typeName: 'Aufbau', complete: true, weeks: timeline.weeks.map(w => ({ ...w, state: 'past', planned: true, plannedHours: w.targetHours, completedHours: w.targetHours * 0.9 })),
  totals: { targetHours: 22, comparedWeeks: 3, plannedHours: 22, completedHours: 19.8, completion: 0.9, elapsedCompletedHours: 19.8, plannedSessions: 12, missedSessions: 2, weeksWithMissedReport: 2 },
  checkIns: { source: 'athlete', count: 2, averages: { fatigue: 3.5, motivation: 4, stress: 2, sleepQuality: 3, soreness: 2.5 } }, reflection: null };
const seasonProfile = { ...profile, goal: { type: 'cycling_event', name: 'Rennen', date: '2027-01-31' } };
const segment = (blockType, typeName, weeks, startDate, endDate) => ({ blockType, typeName, secondaryFocus: null, secondaryName: null, weeks, startDate, endDate, purpose: `${typeName}-Zweck.` });
const seasonSegments = [segment('grundlage', 'Grundlage', 8, '2026-09-28', '2026-11-22'), segment('vo2max', 'VO2max', 6, '2026-11-23', '2027-01-03'), segment('wettkampfspezifisch', 'Wettkampfspezifisch', 4, '2027-01-04', '2027-01-31')];
const season = { id: 'season', goalDate: '2027-01-31', startDate: '2026-09-28', source: 'aiRecommendation', rationale: 'Erst Basis, dann Intensität.', segments: seasonSegments, openFrom: '2026-09-28', remainingWeeks: 18, goalChanged: false, aligned: true };
let container, root, originalFetch, requests, responses, changed, initialPlan;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const inputFor = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, textarea, select');
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const submit = async form => { await act(async () => Simulate.submit(form)); };
const choice = title => [...container.querySelectorAll('button.coach-choice')].find(b => b.querySelector('strong').textContent === title);
const radio = value => container.querySelector(`input[type="radio"][value="${value}"]`);
const startBlock = async () => { await click(radio('nach_pause')); await click(button('Weiter')); await click(choice('Schlag mir was vor')); await click(button('Vorschläge erstellen')); };
const render = async (props = {}) => { await act(async () => root.render(<AICoach apiBase="http://coach.test" initialTab="season" onWorkoutsChanged={changed} {...props} />)); };
const tab = async name => { await click([...container.querySelectorAll('.coach-tabs button')].find(b => b.textContent === name)); };
const todayView = { date: '2026-09-23', checkIn: null, previousCheckIn: null, injuries: [], whoop: null, weekPlanned: true, dailyCheckIn: true,
  readiness: { source: 'calculated', level: 'green', reasons: [], notes: [], affectedSports: [], checkedIn: false },
  sessions: [{ id: 'session-1', source: 'coach', name: 'Grundlage', sport: 'ride', durationMin: 60, hard: false, locked: false }],
  period: { week: '2026-W39', goal: { type: 'fitness', sports: ['ride'], name: 'Fit bleiben', date: null }, weeksToGoal: null, plannedHours: 8, season: null,
    block: { id: 'block-1', blockType: 'aufbau', typeName: 'Aufbau', secondaryName: null, weekNumber: 2, totalWeeks: 3, phase: 'build', deload: false, targetHours: 9, focus: 'Schwelle', startDate: '2026-09-14', endDate: '2026-10-04' } } };

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
    else if (path === '/api/ai-provider') data = { provider: 'openai', model: body?.model || 'gpt-4.1-mini', reasoningEffort: body?.reasoningEffort ?? null, configured: true, keyLast4: '1234', encryptionConfigured: true };
    else if (path === '/api/coach/plan') data = initialPlan;
    else if (path === '/api/coach/block-types') data = catalog;
    else if (path === '/api/coach/blocks/block-1/timeline') data = timeline;
    else if (path === '/api/coach/blocks/old-block/review') data = { ...blockReview, ...(method === 'PUT' ? { reflection: { source: 'athlete', ...body, date: '2026-09-23' } } : {}) };
    else if (path === '/api/coach/today') data = todayView;
    else if (path === '/api/coach/check-ins') data = method === 'POST' ? { ...todayView, checkIn: { ...body, version: 2 }, readiness: { ...todayView.readiness, level: 'yellow', reasons: ['Alkohol gestern'], checkedIn: true } }
      : { checkIns: [{ version: 2, date: '2026-09-22', wellbeing: 4, recovery: 2, stress: 3, soreness: 1, mood: 4, nutrition: 3, alcohol: 1, readiness: { level: 'yellow' } }], injuries: [] };
    else if (path === '/api/coach/feedback') data = { week: new URL(url).searchParams.get('week'), partial: true, planned: { hours: 8 }, completed: { hours: 2 } };
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
  // 2027 starts on a Friday: every Thursday is a multiple of seven days into the year.
  expect(isoWeek('2027-01-31')).toBe('2027-W04');
  expect(isoWeek('2027-09-05')).toBe('2027-W35');
  expect(weeksToGoal('2026-09-28', '2027-01-31')).toBe(18);
});

test('a proposal is human-readable and only saves after explicit confirmation', async () => {
  await render();
  expect(container.textContent).toContain('Neuen Trainingsblock starten');
  expect(button('Weiter').disabled).toBe(true);
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
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  // Taking over the block plans all of its weeks one after another.
  await act(async () => {});
  expect(requests.filter(r => r.path === '/api/coach/proposals').slice(1).map(r => r.body)).toEqual([
    { kind: 'week', week: '2026-W39', instruction: '' }, { kind: 'week', week: '2026-W40', instruction: '' }]);
  expect(requests.filter(r => r.path.endsWith('/confirm')).slice(1).map(r => r.body)).toEqual([{ confirm: true }, { confirm: true }]);
  // Once for the block, then after every planned week so its workouts can be opened right away.
  expect(changed).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain('2 Wochen geplant.');
  expect(container.textContent).toContain('2026-W39: Kurze Woche.');
});

test('the week card stays usable while the coach plans the block weeks', async () => {
  let release;
  responses['POST /api/coach/proposals'] = async body => {
    if (body.kind === 'block') return { ok: true, json: async () => blockProposal };
    if (body.week === '2026-W39' && !release) await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ id: `week-${body.week}`, kind: 'week', hinweise: [], before: null, after: weekPlan }) };
  };
  const twoWeeks = { ...macro, weeks: blockProposal.after.options[1].block.weeks };
  responses['POST /api/coach/proposals/proposal-1/confirm'] = async () => ({ ok: true, json: async () => ({ revision: 1, blocks: [twoWeeks], weeks: {} }) });
  // The athlete's edit in the meantime makes the first answer stale.
  let stale = true;
  responses['POST /api/coach/proposals/week-2026-W39/confirm'] = async () => {
    if (!stale) return { ok: true, json: async () => ({ revision: 2, blocks: [twoWeeks], weeks: {} }) };
    stale = false;
    return { ok: false, status: 409, json: async () => ({ error: 'Profil, Training oder Kalender haben sich geändert.' }) };
  };
  await render();
  await startBlock();
  await click(container.querySelector('[aria-label="Planvorschlag prüfen"] input[value="mehr"]'));
  await click(button('Diese Option übernehmen'));
  expect(container.textContent).toContain('Woche 1 von 2 wird geplant · 2026-W39');
  expect(button('Block löschen').disabled).toBe(true);
  await tab('Woche');
  expect(button('Woche anpassen').disabled).toBe(true);
  expect(container.textContent).toContain('Während der Coach die Wochen plant');
  const next = container.querySelector('[aria-label="Nächste Woche"]');
  expect(next.disabled).toBe(false);
  await click(next);
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W40');
  await change(inputFor('Wunsch für die Planung'), 'Samstag lang');
  await act(async () => release());
  // The stale week is planned again with the new wish, which also applies to the weeks after it.
  expect(requests.filter(r => r.path === '/api/coach/proposals' && r.body.kind === 'week').map(r => [r.body.week, r.body.instruction]))
    .toEqual([['2026-W39', ''], ['2026-W39', 'Samstag lang'], ['2026-W40', 'Samstag lang']]);
  expect(container.textContent).toContain('2 Wochen geplant.');
  expect(container.textContent).not.toContain('Während der Coach die Wochen plant');
  await tab('Saison');
  expect(button('Block löschen').disabled).toBe(false);
});

test('the remaining weeks are planned on request and a failing week stops with a clear message', async () => {
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan } };
  let calls = 0;
  responses['POST /api/coach/proposals'] = async () => { calls += 1; return { ok: false, json: async () => ({ error: 'Regel verletzt.' }) }; };
  await render(); await tab('Woche');
  expect(container.textContent).toContain('Ausnahme für diese Woche');
  await tab('Saison');
  await click(button('Restliche Wochen planen (1)'));
  await act(async () => {});
  expect(calls).toBe(2);
  expect(container.querySelector('[role="alert"]').textContent).toContain('2026-W40 konnte nicht geplant werden: Regel verletzt.');
  expect(requests.some(r => r.path.endsWith('/confirm'))).toBe(false);
});

test('the own-choice path sends the chosen type, length and focus as structured data', async () => {
  await render();
  await click(radio('mitten_im_training')); await click(button('Weiter')); await click(choice('Ich weiß, was ich will'));
  expect(radio('wettkampfspezifisch').disabled).toBe(true);
  expect(container.textContent).toContain('braucht ein Zieldatum im Athletenprofil');
  expect(button('Block ausarbeiten lassen').disabled).toBe(true);
  await click(radio('vo2max'));
  expect(inputFor('Wochen').value).toBe('4');
  expect(container.querySelector('[aria-label="Rhythmus aus Belastung und Entlastung"]').textContent).toMatch(/^1234/);
  expect(container.querySelectorAll('.coach-rhythm > span.deload')).toHaveLength(1);
  expect([...inputFor('Nebenschwerpunkt').options].find(o => o.value === 'kraft').disabled).toBe(true);
  expect(container.textContent).toContain('Mindestens 2× VO2max-Einheit pro Belastungswoche');
  await change(inputFor('Wochen'), '8');
  expect(button('Block ausarbeiten lassen').disabled).toBe(true);
  expect(container.textContent).toContain('Ein Block „VO2max“ dauert 3–6 Wochen.');
  await change(inputFor('Wochen'), '5');
  await change(inputFor('Nebenschwerpunkt'), 'laufen');
  await change(inputFor('Wunsch (optional)'), ' Kurze Intervalle ');
  await click(button('Block ausarbeiten lassen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body).toEqual({ kind: 'block', mode: 'choose', situation: 'mitten_im_training', startDate: '2026-09-28', blockType: 'vo2max', secondaryFocus: 'laufen', weeks: 5, instruction: 'Kurze Intervalle' });
  expect(container.querySelector('.coach-wizard-steps [aria-current="step"]').textContent).toContain('Vorschau');
});

test('discarding the preview returns to the unchanged choice', async () => {
  await render(); await startBlock();
  await click(button('Vorschläge verwerfen'));
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(button('Vorschläge erstellen')).toBeDefined();
  await click(button('Zurück')); await click(button('Zurück'));
  expect(radio('nach_pause').checked).toBe(true);
});

test('changing availability removes a preview and blocks AI planning until the override is saved', async () => {
  initialPlan = { revision: 2, blocks: [macro], weeks: { '2026-W39': weekPlan } };
  await render(); await tab('Woche'); await click(button('Woche anpassen'));
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
  await change(inputFor('Modell'), 'custom');
  await change(inputFor('Modell-ID'), 'my-compatible-model');
  await submit(button('Provider speichern').closest('form'));
  const writes = requests.filter(r => r.path === '/api/ai-provider' && r.method === 'PUT');
  expect(writes[1].body).toEqual({ provider: 'openai', model: 'my-compatible-model', reasoningEffort: null });
  await change(inputFor('Modell'), 'gpt-6-sol');
  await change(inputFor('Reasoning'), 'medium');
  await submit(button('Provider speichern').closest('form'));
  expect(requests.filter(r => r.path === '/api/ai-provider' && r.method === 'PUT')[2].body).toEqual({ provider: 'openai', model: 'gpt-6-sol', reasoningEffort: 'medium' });
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
  await render({ workouts: [workout] }); await tab('Woche'); await click(button('Woche anpassen'));
  await render({ workouts: [{ ...workout, locked: true }] });
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).toBeNull();
  expect(container.textContent).toContain('Eigene Einheit');
  await click(container.querySelector('[aria-label="Gruppenausfahrt lösen"]'));
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
  expect(container.querySelector('.coach-wizard')).toBeNull();
  expect(button('Woche planen')).toBeUndefined();
  await click(button('Zum Athletenprofil'));
  expect(button('Athletenprofil speichern')).toBeDefined();
});

test('the profile stores sports, goal, outdoor months with their own volume and the training days', async () => {
  await render(); await click(button('Athletenprofil'));
  const toggle = label => [...container.querySelectorAll('.coach-toggle')].find(b => b.textContent === label);
  expect(toggle('Radfahren').getAttribute('aria-pressed')).toBe('true');
  await click(toggle('Radfahren'));  // The last sport stays chosen.
  expect(toggle('Radfahren').getAttribute('aria-pressed')).toBe('true');
  await click(toggle('Triathlon'));
  expect(['Radfahren', 'Laufen', 'Schwimmen'].map(label => toggle(label).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
  expect(container.textContent).toContain('Für Schwimmen hat der Coach noch keine Trainingsvorlagen');
  await click(toggle('Schwimmen'));
  expect(toggle('Triathlon').getAttribute('aria-pressed')).toBe('false');
  await click(container.querySelector('input[name="goal-type"][value="event"]'));
  expect(inputFor('Zieldatum').closest('label').textContent).toContain('Saisonplan und Wettkampfblöcke');
  await change(inputFor('Mindestdauer Radeinheit (min)'), '60');
  for (const month of ['Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt']) await click(toggle(month));
  expect(container.querySelector('.coach-season-volume').textContent).toContain('Draußen · Apr–Okt');
  expect(container.querySelector('.coach-season-volume').textContent).toContain('Drinnen · Nov–Mär');
  expect(inputFor('Umfang drinnen (h/Woche)').placeholder).toBe('8');
  await change(inputFor('Umfang drinnen (h/Woche)'), '5');
  await change(inputFor('Mindestdauer Radeinheit draußen (min)'), '90');
  expect(inputFor('Mindestdauer Radeinheit drinnen (min)').value).toBe('60');
  expect(container.querySelector('.coach-week-summary').textContent).toContain('Wunsch draußen 8 h, drinnen 5 h');
  await change(inputFor('Trainingstage pro Woche'), '2');
  await click(container.querySelector('.coach-checkbox input'));
  expect(container.textContent).toContain('mindestens 3 Trainingstage');
  await change(inputFor('Trainingstage pro Woche'), '4');
  await change(container.querySelector('[aria-label="Sa Standardverfügbarkeit"]'), '240');
  await submit(button('Athletenprofil speichern').closest('form'));
  const body = requests.find(r => r.path === '/api/athlete-profile' && r.method === 'PUT').body;
  expect(body.goal).toMatchObject({ type: 'event', sports: ['ride', 'run'] });
  expect(body.availability).toMatchObject({ trainingDaysPerWeek: 4, noConsecutiveRestDays: true, outdoorMonths: [4, 5, 6, 7, 8, 9, 10],
    preferredWeeklyHours: 8, indoorWeeklyHours: 5, minRideMinutes: { indoor: 60, outdoor: 90 } });
  expect(body.availability.defaultAvailability.sat).toBe(240);
  expect(body.preferences).toEqual({ preferredRestDay: null, preferredLongSessionDay: null, gymAvailability: false, dailyCheckIn: true });
});

test('outdoor months are shown as ranges, also over the new year', () => {
  expect(monthSpans([4, 5, 6, 7, 8, 9, 10])).toBe('Apr–Okt');
  expect(monthSpans([11, 12, 1, 2, 3])).toBe('Nov–Mär');
  expect(monthSpans([1, 3, 12])).toBe('Mär, Dez–Jan');
  expect(monthSpans([...Array(12)].map((_, i) => i + 1))).toBe('ganzjährig');
});

test('a season plan is proposed, adjusted by swapping blocks and confirmed', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  const option = (id, recommended) => ({ id, recommended, rationale: `Plan ${id}.`, season: { ...season, segments: seasonSegments } });
  responses['POST /api/coach/proposals'] = async () => ({ ok: true, json: async () => ({ id: 'season-1', kind: 'season', before: null, hinweise: ['Lange Saison.'], rejectedOptions: [],
    after: { options: [option('a', true), option('b', false)], openFrom: '2026-09-28', remainingWeeks: 18, fixedCount: 0 } }) });
  responses['POST /api/coach/proposals/season-1/confirm'] = async () => ({ ok: true, json: async () => ({ ...initialPlan, season: { ...season, source: 'athleteEdited' } }) });
  await render();
  await change(inputFor('Wunsch für den Saisonplan (optional)'), 'Winter auf der Rolle');
  await click(button('Saisonplan vorschlagen lassen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body).toEqual({ kind: 'season', instruction: 'Winter auf der Rolle', startDate: '2026-09-28' });
  expect(container.textContent).toContain('Lange Saison.');
  expect(container.querySelectorAll('.coach-season-strip')).toHaveLength(2);
  await click(button('Anpassen'));
  await click(container.querySelector('[aria-label="Block 2 nach vorne"]'));
  expect(container.textContent).toContain('18 von 18 Wochen verplant');
  await click(button('Angepassten Plan übernehmen'));
  const confirm = requests.find(r => r.path === '/api/coach/proposals/season-1/confirm').body;
  expect(confirm.optionId).toBe('a');
  expect(confirm.segments.map(item => [item.blockType, item.weeks])).toEqual([['vo2max', 6], ['grundlage', 8], ['wettkampfspezifisch', 4]]);
  expect(container.textContent).toContain('Dein Weg zum Ziel');
  expect(container.textContent).toContain('Von dir angepasst');
});

test('with a goal the block is shaped only once the season plan is set', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  const option = (id, recommended) => ({ id, recommended, rationale: `Plan ${id}.`, season: { ...season, segments: seasonSegments } });
  responses['POST /api/coach/proposals'] = async () => ({ ok: true, json: async () => ({ id: 'season-3', kind: 'season', before: null, hinweise: [], rejectedOptions: [],
    after: { options: [option('a', true), option('b', false)], openFrom: '2026-09-28', remainingWeeks: 18, fixedCount: 0 } }) });
  responses['POST /api/coach/proposals/season-3/confirm'] = async () => ({ ok: true, json: async () => ({ ...initialPlan, season }) });
  await render();
  expect(container.textContent).not.toContain('Neuen Trainingsblock starten');
  expect(container.querySelector('.coach-season-card details:not([open]) .coach-wizard')).not.toBeNull();
  await click(button('Saisonplan vorschlagen lassen'));
  expect(container.querySelector('.coach-jump-card')).toBeNull();
  await click(button('Diesen Plan übernehmen'));
  expect(container.querySelector('.coach-jump-card h2').textContent).toBe('Block 1 von 3: Grundlage · 8 Wochen');
  // Editing the plan hides the block until the plan is set again.
  await click(button('Saisonplan bearbeiten'));
  expect(container.querySelector('.coach-jump-card')).toBeNull();
  await click(button('Abbrechen'));
  expect(container.querySelector('.coach-jump-card')).not.toBeNull();
});

test('planned blocks stay in the season editor as fixed first rows', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  const segments = [{ ...seasonSegments[0], blockId: 'b1', secondaryFocus: 'radfahren', secondaryName: 'Radfahren' }, ...seasonSegments.slice(1)];
  const option = (id, recommended) => ({ id, recommended, rationale: `Plan ${id}.`, season: { ...season, segments } });
  responses['POST /api/coach/proposals'] = async () => ({ ok: true, json: async () => ({ id: 'season-2', kind: 'season', before: null, hinweise: [], rejectedOptions: [],
    after: { options: [option('a', true), option('b', false)], openFrom: '2026-11-23', remainingWeeks: 10, fixedCount: 1 } }) });
  await render();
  await click(button('Saisonplan vorschlagen lassen'));
  await click(button('Anpassen'));
  const rows = container.querySelectorAll('.coach-season-editor li');
  expect(rows).toHaveLength(3);
  expect(rows[0].className).toBe('coach-season-fixed');
  expect(rows[0].textContent).toContain('Grundlage8+ RadfahrenFest');
  expect(rows[0].querySelector('select, input, button')).toBeNull();
  expect(container.querySelector('[aria-label="Block 2 Typ"]').value).toBe('vo2max');
  expect(container.textContent).toContain('10 von 10 freien Wochen verplant');
});

test('a saved season plan is edited within the rules and prefills the next block', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  initialPlan = { ...initialPlan, season };
  responses['PUT /api/coach/season'] = async () => ({ ok: true, json: async () => ({ ...initialPlan, season: { ...season, source: 'athleteEdited' } }) });
  await render();
  expect(container.querySelector('.coach-season-strip').getAttribute('aria-label')).toContain('VO2max, 6 Wochen');
  await click(button('Saisonplan bearbeiten'));
  await change(container.querySelector('[aria-label="Block 1 Typ"]'), 'vo2max');
  expect(container.textContent).not.toContain('Höchstlängen');
  await click(container.querySelector('[aria-label="Block 2 entfernen"]'));
  expect(container.textContent).toContain('auch mit Höchstlängen nur 12 Wochen, bitte einen Block hinzufügen');
  await click(button('Abbrechen'));
  await click(button('Saisonplan bearbeiten'));
  await click(container.querySelector('[aria-label="Block 2 entfernen"]'));
  expect(container.textContent).toContain('12 von 18 Wochen verplant · noch 6 Wochen bis zur Zielwoche');
  expect(container.textContent).not.toContain('Höchstlängen');

  expect(container.querySelector('.coach-season-editor .coach-rules')).toBeNull();
  expect(button('Saisonplan speichern').disabled).toBe(true);
  await click(button('Block hinzufügen'));
  await change(container.querySelector('[aria-label="Block 2 Typ"]'), 'vo2max');
  await change(container.querySelector('[aria-label="Block 2 Wochen"]'), '6');
  expect(button('Saisonplan speichern').disabled).toBe(false);
  await click(button('Saisonplan speichern'));
  expect(requests.find(r => r.path === '/api/coach/season' && r.method === 'PUT').body.segments.map(item => [item.blockType, item.weeks, item.purpose]))
    .toEqual([['grundlage', 8, 'Grundlage-Zweck.'], ['vo2max', 6, ''], ['wettkampfspezifisch', 4, 'Wettkampfspezifisch-Zweck.']]);
  // Without a block, the first season block is the next step and opens right away, without asking for type or start.
  const card = container.querySelector('.coach-jump-card');
  expect(card.querySelector('h2').textContent).toBe('Block 1 von 3: Grundlage · 8 Wochen');
  expect(button('Schließen')).toBeUndefined();
  expect(container.textContent).not.toContain('Neuen Trainingsblock starten');
  expect(container.querySelector('button.coach-season-segment').getAttribute('aria-pressed')).toBe('true');
  expect([...card.querySelectorAll('.coach-wizard-steps li')].map(li => li.textContent)).toEqual(['1Ausgangslage', '2Block gestalten', '3Vorschau']);
  expect(card.textContent).toContain('Start laut Saisonplan: 28. Sept. 2026');
  expect(card.querySelector('input[type="date"]')).toBeNull();
  await click(radio('nach_pause'));
  await click(button('Weiter'));
  expect(choice('Schlag mir was vor')).toBeUndefined();
  expect(card.textContent).toContain('Grundlage gestalten');
  await click(radio('volume-ramp'));
  await change(inputFor('Erste Woche (h)'), '4');
  expect(radio('stimulus-sprints')).toBeNull();
  // A season block keeps length and secondary focus from the season plan; rhythm and rules stay visible.
  expect(inputFor('Wochen')).toBeUndefined();
  expect(inputFor('Nebenschwerpunkt')).toBeUndefined();
  expect(card.querySelector('.coach-rhythm')).not.toBeNull();
  expect(card.querySelector('.coach-rules')).not.toBeNull();
  await click(button('Block ausarbeiten lassen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body).toMatchObject({ kind: 'block', mode: 'choose', situation: 'nach_pause', blockType: 'grundlage', weeks: 8, startDate: '2026-09-28',
    design: [{ question: 'Wie soll der Umfang verlaufen?', answer: 'In der ersten Woche mit 4 h beginnen und dann von Woche zu Woche steigern' }] });
});

test('the season start is set in the season plan and moves the weeks to fill', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  initialPlan = { ...initialPlan, season };
  responses['PUT /api/coach/season'] = async body => ({ ok: true, json: async () => ({ ...initialPlan, season: { ...season, startDate: body.startDate } }) });
  await render();
  expect(container.querySelector('.coach-season-range').textContent).toBe('Start 28. Sept. 2026 · Ziel 31. Jan. 2027 · 18 Wochen');
  await click(button('Saisonplan bearbeiten'));
  await change(inputFor('Saisonstart (Montag)'), '2026-10-14');
  expect(inputFor('Saisonstart (Montag)').value).toBe('2026-10-12');
  expect(container.textContent).toContain('18 von 16 Wochen verplant · 2 Wochen zu viel');
  await change(container.querySelector('[aria-label="Block 1 Wochen"]'), '6');
  await click(button('Saisonplan speichern'));
  expect(requests.find(r => r.method === 'PUT').body).toMatchObject({ startDate: '2026-10-12' });
});

test('block questions fit the block type and only send what the athlete answered', () => {
  const vo2 = blockQuestions('vo2max', profile);
  expect(vo2.map(q => q.id)).toEqual(['volume', 'intervals']);
  expect(vo2[0].options.find(o => o.id === 'ramp').input.value).toBe(5);
  expect(designAnswers(vo2, { volume: { option: 'coach' }, intervals: { option: 'reps', value: '2' } }))
    .toEqual([{ question: 'Wie steigst du in die VO2max-Intervalle ein?', answer: 'Mit 2 Wiederholungen VO2max-Intervallen (3–5 min) beginnen und dann steigern' }]);
  expect(vo2[1].options.map(o => o.id)).toEqual(['coach', 'reps', 'long', 'formats']);
  expect(designFormats(vo2, { intervals: { option: 'reps', value: 2 } })).toBeNull();
  expect(designFormats(vo2, { intervals: { option: 'formats', value: [] } })).toEqual([]);
  expect(designAnswers(vo2, { intervals: { option: 'formats', value: [] } })).toEqual([]);
  const formats = { intervals: { option: 'formats', value: ['ride-vo2-4', 'ride-vo2-3015'] } };
  expect(designFormats(vo2, formats)).toEqual(['ride-vo2-4', 'ride-vo2-3015']);
  expect(designAnswers(vo2, formats)).toEqual([{ question: 'Wie steigst du in die VO2max-Intervalle ein?',
    answer: 'Für die VO2max-Einheiten nur diese Intervallformen aus den Workout-Vorlagen: VO2max 4 min, VO2max 30/15' }]);
  expect(blockQuestions('taper', profile).map(q => q.id)).toEqual(['reduction']);
  expect(designAnswers(blockQuestions('grundlage', profile), {})).toEqual([]);
});

test('an active block shows the current block week and German planning actions', async () => {
  initialPlan = { revision: 1, blocks: [{ startDate: '2026-09-14', weeks: [macro.weeks[0], { ...macro.weeks[0], week: 2 }, { ...macro.weeks[0], week: 3, phase: 'recovery' }] }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Woche 2 von 3');
  expect(container.textContent).toContain('Erholung');
  await tab('Woche');
  expect(button('Woche planen').disabled).toBe(false);
  expect(button('Woche anpassen').disabled).toBe(true);
  expect(container.querySelector('[aria-label="Planungswoche"]').max).toBe('2026-W40');
  await click(button('Woche planen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body.kind).toBe('week');
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]').textContent).toContain('Wochenplan prüfen');
});

test('the week buttons step through the block weeks', async () => {
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: {} };
  await render(); await tab('Woche');
  const weekInput = () => container.querySelector('[aria-label="Planungswoche"]');
  const step = label => container.querySelector(`[aria-label="${label}"]`);
  expect(weekInput().value).toBe('2026-W39');
  await click(step('Nächste Woche'));
  expect(weekInput().value).toBe('2026-W40');
  expect(step('Nächste Woche').disabled).toBe(true);
  await click(step('Vorherige Woche'));
  await click(step('Vorherige Woche'));
  expect(weekInput().value).toBe('2026-W38');
  expect(step('Vorherige Woche').disabled).toBe(true);
  expect(container.textContent).toContain('Woche 1 von 3');
});

test('an upcoming block opens on its first week', async () => {
  initialPlan = { revision: 1, blocks: [{ ...macro, startDate: '2026-10-05' }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Startet am');
  await tab('Woche');
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
  expect(container.querySelector('details .coach-wizard').textContent).toContain('Wo stehst du gerade?');
  await tab('Woche');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W40');
});

test('an ended block offers the next block instead of week planning', async () => {
  initialPlan = { revision: 3, blocks: [{ ...macro, startDate: '2026-09-07' }], weeks: {} };
  await render();
  expect(container.textContent).toContain('Block abgeschlossen');
  expect(container.textContent).toContain('Nächsten Trainingsblock starten');
  expect(container.querySelector('.coach-wizard').textContent).toContain('Wo stehst du gerade?');
  expect(button('Woche planen')).toBeUndefined();
  expect(button('Fixieren')).toBeUndefined();
});

test('goal types and the season countdown are shown in German', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => ({ ...profile, goal: { type: 'general_endurance', name: '', date: '2026-12-02', target: null } }) });
  await render();
  expect(container.querySelector('.coach-season').textContent).toBe('Noch 10 Wochen bis Allgemeine Ausdauer · 2. Dez.');
  await click(button('Athletenprofil'));
  expect(container.querySelector('input[name="goal-type"]:checked').value).toBe('fitness');
  expect(container.querySelector('[aria-label="Was ist dein Ziel?"]').textContent).not.toContain('general_endurance');
});

test('the block timeline compares planned and completed hours and selects a week', async () => {
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan } };
  await render();
  const chart = container.querySelector('[aria-label="Block-Zeitstrahl: geplant und absolviert"]');
  const weeks = chart.querySelectorAll('li');
  expect(weeks).toHaveLength(3);
  expect(weeks[1].className).toBe('current');
  expect(weeks[1].textContent).toContain('Jetzt');
  expect(weeks[1].querySelector('button').getAttribute('aria-label')).toBe('Woche 2, Aufbau: geplant 8 h, absolviert 2 h');
  expect(weeks[2].querySelector('button').getAttribute('aria-label')).toBe('Woche 3, Erholung: Blockziel 5 h, absolviert noch offen');
  expect(weeks[2].querySelector('.target').className).toContain('open');
  expect(container.querySelector('.coach-table').textContent).toContain('5 h (Blockziel)');
  await click(weeks[0].querySelector('button'));
  expect(chart.querySelector('[aria-pressed="true"]').getAttribute('aria-label')).toContain('Woche 1');
  await tab('Woche');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W38');
});

test('coach sessions are locked at the session; a daily change needs a planned week', async () => {
  const planned = { ...session, rendered: { ...session.rendered, workout: { id: 'session-1' } } };
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: {} };
  await render({ workouts: [{ id: 'session-1', date: '2026-09-22', name: 'Grundlage', locked: false }] }); await tab('Woche');
  expect(container.textContent).not.toContain('Ein Tag sieht anders aus');
  expect(container.textContent).not.toContain('Einheiten fixieren');
  expect(container.querySelector('.coach-session-note')).toBeNull();
  initialPlan = { revision: 2, blocks: [activeBlock], weeks: { '2026-W39': { ...weekPlan, sessions: [planned] } } };
  await act(async () => root.unmount()); root = createRoot(container);
  await render({ workouts: [{ id: 'session-1', date: '2026-09-22', name: 'Grundlage', locked: false }] }); await tab('Woche');
  expect(container.textContent).toContain('Ein Tag sieht anders aus');
  expect(container.textContent).not.toContain('Check-in speichern');
  expect(container.textContent).not.toContain('Eigene Einheit');
  expect(container.querySelector('.coach-session-note').textContent).toBe('Verpflegung (LIT): Optional nur Wasser. Danach Protein.');
  await click(container.querySelector('[aria-label="Grundlage fixieren"]'));
  expect(requests.find(r => r.path === '/api/workouts/session-1/lock').body).toEqual({ locked: true });
});

test('from Friday the week is closed with review and planning the next week', async () => {
  jest.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan } };
  await render(); await tab('Woche');
  const card = () => container.querySelector('[aria-label="Woche abschließen"]');
  expect(card().textContent).toContain('2026-W39 → 2026-W40');
  expect(requests.some(r => r.path === '/api/coach/feedback')).toBe(true);
  expect(card().textContent).toContain('Absolviert (bis heute)');
  await click([...card().querySelectorAll('label')].find(l => l.textContent.includes('Grundlage')).querySelector('input'));
  expect(card().textContent).toContain('1 Einheit');
  await click(button('Weiter zur nächsten Woche'));
  expect(card().textContent).toContain('Erholung · Ziel 5 h');
  await click(button('Nächste Woche planen'));
  expect(requests.filter(r => r.path === '/api/coach/proposals').pop().body).toEqual({ kind: 'week', week: '2026-W40', instruction: '', feedbackWeek: '2026-W39', missedSessions: ['session-1'] });
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W40');
});

test('an already planned next week is adjusted or kept after the weekly review', async () => {
  jest.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  const nextWeek = { ...weekPlan, week: '2026-W40', sessions: [{ ...session, id: 'session-2' }] };
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan, '2026-W40': nextWeek } };
  responses['PUT /api/coach/weeks/2026-W39/missed'] = async body => ({ ok: true, json: async () => ({ ...initialPlan, weeks: { ...initialPlan.weeks, '2026-W39': { ...weekPlan, ...body } } }) });
  await render(); await tab('Woche');
  const card = () => container.querySelector('[aria-label="Woche abschließen"]');
  await click([...card().querySelectorAll('label')].find(l => l.textContent.includes('Grundlage')).querySelector('input'));
  await click(button('Weiter zur nächsten Woche'));
  expect(card().textContent).toContain('Die Woche ist schon geplant.');
  expect(button('Nächste Woche planen')).toBeUndefined();
  await click(button('Nächste Woche anpassen'));
  expect(requests.filter(r => r.path === '/api/coach/proposals').pop().body).toEqual({ kind: 'patch', week: '2026-W40', instruction: '', feedbackWeek: '2026-W39', missedSessions: ['session-1'] });
  await click(button('Vorschlag verwerfen'));
  await click(button('Unverändert lassen'));
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/coach/weeks/2026-W39/missed').body).toEqual({ missedSessions: ['session-1'] });
  expect(card()).toBeNull();
  expect(container.textContent).toContain('Rückblick gespeichert.');
  jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
});

test('an open current week after a planned one starts the rhythm right away', async () => {
  jest.setSystemTime(new Date('2026-09-28T09:00:00Z'));
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan } };
  await render(); await tab('Woche');
  expect(container.querySelector('[aria-label="Woche abschließen"]').textContent).toContain('2026-W39 → 2026-W40');
  jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
});

test('an ended block shows its review and saves the athlete verdict before the next block', async () => {
  initialPlan = { revision: 3, blocks: [{ ...activeBlock, id: 'old-block', startDate: '2026-08-24', endDate: '2026-09-13' }], weeks: {} };
  await render();
  const card = container.querySelector('[aria-label="Blockrückblick"]');
  const stats = card.querySelector('[aria-label="Block in Zahlen"]').textContent;
  expect(stats).toContain('90 %');
  expect(stats).toContain('2 von 12');
  expect(card.querySelector('.coach-timeline button')).toBeNull();
  expect(card.querySelectorAll('.coach-timeline [role="img"]')).toHaveLength(3);
  expect(card.textContent).toContain('Motivation 4/5');
  await click(card.querySelector('input[name="block-rating"][value="4"]'));
  await change(inputFor('Notiz zum Block'), 'Gut, aber müde.');
  await submit(card.querySelector('form'));
  expect(requests.find(r => r.path === '/api/coach/blocks/old-block/review' && r.method === 'PUT').body).toEqual({ rating: 4, note: 'Gut, aber müde.' });
  expect(container.textContent).toContain('Einschätzung gespeichert.');
  expect(container.textContent).toContain('Nächsten Trainingsblock starten');
});

test('the normal week shows a live sum and flags a wish far from recent training', async () => {
  await render(); await click(button('Athletenprofil'));
  const summary = () => container.querySelector('.coach-week-summary').textContent;
  expect(summary()).toBe('10 h verfügbar · Wunsch 8 h · Obergrenze 12 h');
  await change(inputFor('Gewünschter Umfang (h/Woche)'), '12');
  expect(summary()).toContain('Wunsch 12 h');
  expect(summary()).toContain('über der Zeit, die du an den einzelnen Tagen angegeben hast');
  expect(summary()).toContain('im Schnitt 6,8 h pro Woche trainiert. Dein Wunsch von 12 h liegt deutlich darüber.');
  expect(container.querySelector('[aria-label="Fr Standardverfügbarkeit"]').value).toBe('0');
  await change(container.querySelector('[aria-label="Fr Standardverfügbarkeit"]'), '');
  expect(summary()).toContain('10 h verfügbar (Fr offen)');
  expect(summary()).not.toContain('über der Zeit');
});

test('the provider tab explains where the encryption key lives and what to do when it is missing', async () => {
  const status = extra => async () => ({ ok: true, json: async () => ({ provider: 'openai', model: 'gpt-4.1-mini', configured: false, keyLast4: null, ...extra }) });
  responses['GET /api/ai-provider'] = status({ encryptionConfigured: true, encryptionKeySource: 'created', encryptionKeyFile: 'C:/TrainHub/.run/ai-encryption-key.txt' });
  await render(); await click(button('AI Provider'));
  expect(container.querySelector('.coach-key-note').textContent).toContain('C:/TrainHub/.run/ai-encryption-key.txt und wurde beim letzten Start angelegt');
  expect(button('Provider speichern').disabled).toBe(false);
  await act(async () => root.unmount()); root = createRoot(container);
  responses['GET /api/ai-provider'] = status({ encryptionConfigured: false, encryptionKeySource: 'invalid', encryptionKeyFile: 'C:/TrainHub/.run/ai-encryption-key.txt' });
  await render(); await click(button('AI Provider'));
  expect(container.querySelector('[role="note"]').textContent).toContain('enthält keinen gültigen Schlüssel');
  expect(container.textContent).not.toContain('Backend-Konfiguration');
  expect(button('Provider speichern').disabled).toBe(true);
});

const blockOf = (id, blockType, typeName, startDate, count) => ({ id, blockType, typeName, status: 'active', startDate, endDate: new Date(Date.parse(`${startDate}T12:00:00Z`) + (count * 7 - 1) * 86400000).toISOString().slice(0, 10),
  weeks: Array.from({ length: count }, (_, i) => ({ week: i + 1, phase: i === count - 1 ? 'recovery' : 'base', targetHours: 6, focus: 'Grundlage' })) });

test('a season block without a plan is created from the season strip, in order', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  const base = blockOf('b1', 'grundlage', 'Grundlage', '2026-09-28', 8);
  initialPlan = { revision: 1, blocks: [base], weeks: {}, season: { ...season, openFrom: '2026-11-23', remainingWeeks: 10, segments: [{ ...seasonSegments[0], blockId: 'b1' }, ...seasonSegments.slice(1)] } };
  await render();
  const segments = container.querySelectorAll('button.coach-season-segment');
  expect(segments).toHaveLength(3);
  expect(container.querySelector('.coach-jump-card')).toBeNull();
  expect(container.querySelector('.coach-block-card')).not.toBeNull();
  expect(container.textContent).not.toContain('Absolviertes Training berücksichtigen');
  await click(segments[2]);
  expect(container.querySelector('.coach-jump-card').textContent).toContain('Als Nächstes kommt VO2max ab 23. Nov.');
  await click(button('Zu VO2max springen'));
  expect(container.querySelector('.coach-jump-card h2').textContent).toBe('Block 2 von 3: VO2max · 6 Wochen');
  expect(container.querySelectorAll('button.coach-season-segment')[1].getAttribute('aria-pressed')).toBe('true');
  // The opened season block takes the place of the Grundlage block and its weeks.
  expect(container.querySelector('.coach-block-card')).toBeNull();
  await click(button('Weiter'));
  let resolveProposal;
  responses['POST /api/coach/proposals'] = () => new Promise(resolve => { resolveProposal = resolve; });
  await click(button('Block ausarbeiten lassen'));
  expect(requests.find(r => r.path === '/api/coach/proposals').body).toMatchObject({ kind: 'block', mode: 'choose', blockType: 'vo2max', weeks: 6, startDate: '2026-11-23' });
  expect(requests.find(r => r.path === '/api/coach/proposals').body.design).toBeUndefined();
  // While the coach works, the card says so right below the button, too.
  expect(container.querySelector('.coach-jump-card .coach-generating').textContent).toContain('Der Coach arbeitet deinen Block aus');
  await act(async () => resolveProposal({ ok: true, json: async () => blockProposal }));
  expect(container.querySelector('.coach-generating')).toBeNull();
  // The proposal is shown only in the card that asked for it.
  expect(container.querySelectorAll('.coach-proposal-embedded')).toHaveLength(1);
  expect(container.querySelector('.coach-jump-card .coach-proposal-embedded')).not.toBeNull();
});

test('the athlete jumps between blocks and deletes one with its workouts', async () => {
  const first = blockOf('b1', 'grundlage', 'Grundlage', '2026-09-28', 2);
  const second = blockOf('b2', 'vo2max', 'VO2max', '2026-10-12', 2);
  const planned = { week: '2026-W42', targetHours: 1, focus: 'VO2max', sessions: [{ ...session, rendered: { ...session.rendered, date: '2026-10-13', workout: { name: 'Grundlage' } } }] };
  initialPlan = { revision: 1, blocks: [first, second], weeks: { '2026-W42': planned } };
  responses['DELETE /api/coach/blocks/b2'] = async () => ({ ok: true, json: async () => ({ revision: 2, blocks: [first], weeks: {}, deletedWorkouts: 1 }) });
  await render();
  const switcher = () => [...container.querySelectorAll('.coach-block-switch button')];
  expect(switcher().map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  expect(container.textContent).toContain('Aktueller Trainingsblock');
  await click(switcher()[1]);
  expect(container.textContent).toContain('Kommender Trainingsblock');
  await tab('Woche');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W42');
  expect(container.querySelector('[aria-label="Planungswoche"]').min).toBe('2026-W42');
  expect(button('Woche anpassen').disabled).toBe(false);
  await tab('Saison');
  await click(button('Block löschen'));
  expect(container.querySelector('.coach-confirm-delete').textContent).toContain('Die geplante Woche und 1 Workout im Kalender werden entfernt');
  await click(button('Endgültig löschen'));
  expect(requests.some(r => r.method === 'DELETE' && r.path === '/api/coach/blocks/b2')).toBe(true);
  expect(container.textContent).toContain('Trainingsblock gelöscht. 1 Workout wurde aus dem Kalender entfernt.');
  expect(changed).toHaveBeenCalled();
  expect(container.querySelector('.coach-block-switch')).toBeNull();
  expect(container.textContent).toContain('Aktueller Trainingsblock');
  await tab('Woche');
  expect(container.querySelector('[aria-label="Planungswoche"]').value).toBe('2026-W40');
});

test('deleting the season asks whether its blocks and workouts go too', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  initialPlan = { ...initialPlan, season };
  responses['DELETE /api/coach/season'] = async () => ({ ok: true, json: async () => ({ revision: 2, blocks: [], weeks: {}, season: null, deletedWorkouts: 3 }) });
  await render();
  await click(button('Saisonplan löschen'));
  expect(requests.some(r => r.method === 'DELETE')).toBe(false);
  await click(button('Abbrechen'));
  await click(button('Saisonplan löschen'));
  await click(button('Mit Blöcken und Workouts löschen'));
  expect(global.fetch.mock.calls.find(([, options]) => options?.method === 'DELETE')[0]).toContain('/api/coach/season?timezone=');
  expect(global.fetch.mock.calls.find(([, options]) => options?.method === 'DELETE')[0]).toContain('&blocks=true');
  expect(container.textContent).toContain('Saisonplan und seine Trainingsblöcke gelöscht. 3 Workouts wurden aus dem Kalender entfernt.');
  expect(changed).toHaveBeenCalled();
});

test('a new tab request opens that tab without reloading the coach', async () => {
  await render({ initialTab: 'plan', tabVersion: 0 });
  await render({ initialTab: 'plan', tabVersion: 0 });
  expect(button('Athletenprofil').getAttribute('aria-current')).toBeNull();
  await render({ initialTab: 'profile', tabVersion: 1 });
  expect(button('Athletenprofil').getAttribute('aria-current')).toBe('page');
  expect(requests.filter(r => r.path === '/api/coach/plan')).toHaveLength(1);
});

test('the coach reports when it starts and finishes working', async () => {
  const busyChanges = jest.fn();
  let resolveProposal;
  responses['POST /api/coach/proposals'] = () => new Promise(resolve => { resolveProposal = resolve; });
  await render({ onBusyChange: busyChanges });
  await startBlock();
  expect(busyChanges).toHaveBeenLastCalledWith('Der Coach erstellt einen Vorschlag …');
  await act(async () => resolveProposal({ ok: true, json: async () => blockProposal }));
  expect(busyChanges).toHaveBeenLastCalledWith('');
});

test('the season may end with a taper after the race-specific block', () => {
  expect(endsWithRace(['grundlage', 'wettkampfspezifisch'])).toBe(true);
  expect(endsWithRace(['grundlage', 'wettkampfspezifisch', 'taper'])).toBe(true);
  expect(endsWithRace(['grundlage', 'taper'])).toBe(false);
  expect(endsWithRace(['wettkampfspezifisch', 'grundlage'])).toBe(false);
});

test('fitting the weeks spreads the difference within the type limits and keeps the taper', () => {
  const typeOf = id => catalog.blockTypes.find(type => type.id === id);
  const fit = (target, ...items) => fitSeasonWeeks(items.map(([blockType, weeks]) => ({ blockType, weeks })), typeOf, target).map(item => item.weeks);
  expect(fit(20, ['grundlage', 6], ['vo2max', 3], ['wettkampfspezifisch', 2], ['taper', 1])).toEqual([9, 5, 5, 1]);
  expect(fit(13, ['grundlage', 12], ['vo2max', 6], ['wettkampfspezifisch', 4], ['taper', 2])).toEqual([6, 3, 2, 2]);
  expect(fit(12, ['grundlage', 40], ['wettkampfspezifisch', ''])).toEqual([10, 2]); // Out of range and empty lengths first go into the limits.
  expect(fit(40, ['grundlage', 8], ['wettkampfspezifisch', 4], ['taper', 1])).toEqual([12, 6, 3]); // Every block at its maximum.
});

test('the season editor takes a one-week taper and fits the other blocks to the goal week', async () => {
  responses['GET /api/athlete-profile'] = async () => ({ ok: true, json: async () => seasonProfile });
  initialPlan = { ...initialPlan, season };
  responses['PUT /api/coach/season'] = async body => ({ ok: true, json: async () => ({ ...initialPlan, season: { ...season, segments: body.segments } }) });
  await render();
  await click(button('Saisonplan bearbeiten'));
  expect(button('Wochen angleichen').disabled).toBe(true);
  await click(button('Block hinzufügen'));
  await change(container.querySelector('[aria-label="Block 3 Typ"]'), 'taper');
  await click(container.querySelector('[aria-label="Block 3 nach hinten"]'));
  expect(container.querySelector('[aria-label="Block 4 Typ"]').value).toBe('taper');
  expect(container.querySelector('[aria-label="Block 4 Wochen"]').value).toBe('1');
  expect(container.textContent).toContain('19 von 18 Wochen verplant · 1 Woche zu viel');
  await click(button('Wochen angleichen'));
  expect(container.textContent).toContain('18 von 18 Wochen verplant');
  await click(button('Saisonplan speichern'));
  expect(requests.find(r => r.path === '/api/coach/season').body.segments.map(item => [item.blockType, item.weeks]))
    .toEqual([['grundlage', 8], ['vo2max', 5], ['wettkampfspezifisch', 4], ['taper', 1]]);
});

test('today shows the block week, asks for the check-in and adapts the week to it', async () => {
  initialPlan = { revision: 1, blocks: [activeBlock], weeks: { '2026-W39': weekPlan } };
  await render({ initialTab: 'today' });
  expect(container.querySelector('.coach-today-period h2').textContent).toBe('Aufbau · Woche 2 von 3');
  expect(container.querySelector('.coach-today-period').textContent).toContain('Belastungswoche · Wochenziel 9 h · Fokus: Schwelle');
  expect(container.querySelector('.coach-tabs [aria-label="Check-in offen"]')).not.toBeNull();
  await click(button('Check-in ausfüllen'));
  const dialog = () => container.querySelector('[role="dialog"]');
  const chip = (question, answer) => [...dialog().querySelectorAll('fieldset')].find(f => f.querySelector('legend').textContent.startsWith(question))
    .querySelectorAll('button').forEach(b => { if (b.textContent === answer) b.click(); });
  await click(button('Fertig'));
  expect(dialog().textContent).toContain('Noch 8 offen');
  await act(async () => {
    for (const [question, answer] of [['Wohlbefinden', 'gut'], ['Erholung', 'normal'], ['Stress', 'mittel'], ['Muskelkater', 'leicht'], ['Stimmung', 'gut'],
      ['Ernährung gestern', 'passend'], ['Alkohol gestern', 'mehr'], ['Schmerzen oder Verletzung?', 'nein']]) chip(question, answer);
  });
  await click(button('Fertig'));
  expect(requests.find(r => r.path === '/api/coach/check-ins' && r.method === 'POST').body).toEqual({ date: '2026-09-23', wellbeing: 4, recovery: 3, stress: 3, soreness: 2, mood: 4,
    nutrition: 3, alcohol: 2, notes: '', newInjury: null, injuryUpdates: [] });
  expect(dialog().textContent).toContain('Gelb – etwas zurücknehmen');
  await click(button('Woche anpassen lassen'));
  expect(dialog()).toBeNull();
  expect(requests.filter(r => r.path === '/api/coach/proposals').pop().body).toEqual({ kind: 'patch', week: '2026-W39', instruction: '', trigger: 'checkIn' });
  // The proposal shows on Heute, right below the traffic light.
  expect(container.querySelector('.coach-today-period')).not.toBeNull();
  expect(container.querySelector('[aria-label="Planvorschlag prüfen"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Tagesampel"]').textContent).toContain('Alkohol gestern');
});

test('the review tab shows the measured context and the check-ins of the last weeks', async () => {
  await render({ initialTab: 'review' });
  expect(container.textContent).toContain('6,5 h');
  const history = container.querySelector('[aria-label="Check-in-Verlauf"]');
  expect([...history.querySelectorAll('tbody td')].map(td => td.textContent)).toEqual(['Di., 22.9.', '', 'gut', 'müde', 'mittel', 'keiner', 'gut', 'passend', '1–2 Getränke']);
  expect(history.querySelector('.today-dot.yellow')).not.toBeNull();
});
