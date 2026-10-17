import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import CoachOnboarding from './CoachOnboarding.jsx';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MERGED = ['goal', 'availability', 'preferences', 'metrics', 'thresholds', 'background', 'onboarding'];
const withData = { source: 'calculated', hasData: true, recentSports: ['ride', 'strength'], mainSport: 'ride', weeklyHours: 7.8, best4WeekHours: 9.5,
  intervals: { ride: '2026-10-03' } };
const noData = { source: 'calculated', hasData: false, recentSports: [], mainSport: null, weeklyHours: null, best4WeekHours: null, intervals: {} };
let container, root, originalFetch, requests, responses, server, created, closed;

const blankProfile = () => ({ source: 'athlete', goal: { type: 'fitness', sports: ['ride'], name: '', date: null, target: null }, sports: ['ride'],
  metrics: { ride: 'power', run: 'pace' }, thresholds: {}, availability: { preferredWeeklyHours: 8, indoorWeeklyHours: null, absoluteMaxWeeklyHours: 12,
    defaultAvailability: Object.fromEntries(DAYS.map(d => [d, 60])), windows: [], exceptions: [], maxWeeklyHours: null, restDay: null, longDay: null },
  preferences: { gymAvailability: false, dailyCheckIn: true }, background: { type: null, weeklyHours: null, intervals: {}, source: null },
  onboarding: { completed: [] }, events: [] });

const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
const buttonIn = (label, text) => [...container.querySelector(`[aria-label="${label}"]`).querySelectorAll('button')].find(b => b.textContent.startsWith(text));
const inputFor = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, textarea, select');
const checkbox = text => [...container.querySelectorAll('label.coach-checkbox')].find(l => l.textContent.startsWith(text)).querySelector('input');
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const tick = async (ms = 0) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const heading = () => container.querySelector('.onboarding-step h2').textContent;
const writes = path => requests.filter(r => r.path === path && r.method !== 'GET');
const render = async () => { await act(async () => root.render(<CoachOnboarding apiBase="http://coach.test" onClose={closed} onCreated={created} />)); };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-16T10:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  created = jest.fn(); closed = jest.fn();
  requests = []; responses = {};
  server = { profile: blankProfile(), user: { ftp: null, maxHr: null, age: null, weight: null }, background: withData, settings: null, events: [],
    provider: { provider: 'openai', model: 'gpt-6.1-sol', configured: false, keyLast4: null, encryptionConfigured: true, encryptionKeySource: 'environment' },
    snapshot: { observed: { performanceHistory: { bestEfforts: { last90Days: { cycling: { '20min': { watts: 300, date: '2026-09-12' } } }, last365Days: { cycling: {} } } } } },
    run: { paceSecPerKm: null, source: null, basis: null, calculated: null }, polls: 0 };
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method, body });
    const key = `${method} ${path}`;
    if (responses[key]) return responses[key](body);
    let data;
    if (path === '/api/athlete-profile') {
      if (method === 'PUT') Object.entries(body).forEach(([k, v]) => { server.profile[k] = MERGED.includes(k) ? { ...server.profile[k], ...v } : v; });
      data = server.profile;
    } else if (path === '/api/user') data = method === 'PUT' ? (server.user = { ...server.user, ...body }) : server.user;
    else if (path === '/api/ai-provider') data = method === 'PUT' ? (server.provider = { ...server.provider, model: body.model, configured: true, keyLast4: '1234' }) : server.provider;
    else if (path === '/api/ai-provider/test') data = { ok: true };
    else if (path === '/api/coach/onboarding') data = server.background;
    else if (path === '/api/coach/thresholds') data = { ride: { ftp: server.user.ftp }, run: server.run };
    else if (path === '/api/athlete-snapshot') data = server.snapshot;
    else if (path === '/api/coach/plan/settings') data = { settings: method === 'PUT' ? (server.settings = { ...body, createdAt: 'now' }) : server.settings };
    else if (path === '/api/coach/events' && method === 'POST') { const event = { id: `event-${server.events.length + 1}`, ...body, endDate: body.endDate || body.startDate }; server.events = [...server.events, event]; data = { events: server.events, event }; }
    else if (path === '/api/coach/events') data = { events: server.events };
    else if (path.startsWith('/api/coach/events/') && method === 'DELETE') { server.events = server.events.filter(e => `/api/coach/events/${e.id}` !== path); data = { events: server.events }; }
    else if (path === '/api/garmin') data = { available: true, connected: false };
    else if (path === '/api/whoop') data = { connected: false };
    else if (path === '/api/coach/plan/create') data = { job: { id: 'job-1', status: 'running', steps: [{ id: 'frame', label: 'Phasen festlegen', status: 'running' }, ...['2026-W43', '2026-W44', '2026-W45'].map((id, i) => ({ id, label: `Woche ${i + 1} planen`, status: 'pending' }))] } };
    else if (path === '/api/coach/plan/create/job-1') {
      server.polls += 1;
      const step = (id, label, status) => ({ id, label, status });
      data = { job: server.polls === 1 ? { id: 'job-1', status: 'running', error: null, steps: [step('frame', 'Phasen festlegen', 'done'), step('2026-W43', 'Woche 1 planen', 'done'), step('2026-W44', 'Woche 2 planen', 'running'), step('2026-W45', 'Woche 3 planen', 'pending')] }
        : { id: 'job-1', status: 'done', error: null, steps: [step('frame', 'Phasen festlegen', 'done'), ...['2026-W43', '2026-W44', '2026-W45'].map((id, i) => step(id, `Woche ${i + 1} planen`, 'done'))] } };
    } else throw new Error(`Unexpected ${key}`);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers();
});

async function addWindow(day, { from, to, allDay, unavailable, group, copyTo = [], options = [] } = {}) {
  const row = [...container.querySelectorAll('.onboarding-days li')].find(li => li.querySelector('strong').textContent === day);
  await click([...row.querySelectorAll('button')].find(b => b.textContent === '+ Neue Verfügbarkeit'));
  if (unavailable) await click(buttonIn('Art', 'Nicht verfügbar'));
  if (allDay) await click(checkbox('Den ganzen Tag'));
  if (from) { await change(inputFor('Von'), from); await change(inputFor('Bis'), to); }
  if (group) await click(checkbox('Gruppentraining'));
  for (const other of copyTo) await click(buttonIn('Auch für andere Tage übernehmen', other));
  if (unavailable) return click(button('Speichern'));
  await click(button('Weiter'));
  if (!group) await click(checkbox('Rad'));
  for (const option of options) await click(buttonIn('Optionen Rad', option));
  await click(button('Speichern'));
}

test('a new athlete with data goes from A1 to the created plan', async () => {
  await render();
  // A1: ride and strength are preselected from the data.
  expect(heading()).toBe('Deine Sportarten');
  expect(container.textContent).toContain('Teil A · Athletenprofil · Schritt 1 von 4');
  expect(buttonIn('Sportarten', 'Radfahren').getAttribute('aria-pressed')).toBe('true');
  expect(buttonIn('Sportarten', 'Kraft').textContent).toContain('aus deinen Daten');
  await click(button('Weiter'));
  expect(server.profile.sports).toEqual(['ride', 'strength']);
  expect(server.profile.onboarding.completed).toEqual(['sports']);

  // A2: nothing connected, the step can be skipped.
  expect(heading()).toBe('Verbinde deine Daten');
  expect(container.textContent).toContain('Aktivitäten vorhanden');
  await click(button('Weiter'));

  // A3: the FTP comes from the 20-minute best.
  expect(heading()).toBe('Deine Leistungsdaten');
  expect(container.textContent).toContain('aus deinen Daten: 285 W, abgeleitet aus 20-min-Bestwert vom 12.09.');
  await change(inputFor('Gewicht (kg)'), '72');
  await change(inputFor('Max. Herzfrequenz'), '188');
  await click(button('Weiter'));
  expect(writes('/api/user')[0].body).toEqual({ weight: 72, age: null, maxHr: 188, ftp: 285 });
  expect(server.profile.thresholds.ride).toEqual({ source: 'calculated' });

  // A4: provider with key and cost estimate, then the connection test.
  expect(heading()).toBe('Dein AI-Provider');
  expect(container.textContent).toContain('Plan erstellen ca. 0,40 $, danach ca. 1–1,50 $ im Monat (gpt-6.1-sol)');
  await change(inputFor('API Key'), 'sk-secret');
  await act(async () => Simulate.submit(button('Provider speichern').closest('form')));
  expect(writes('/api/ai-provider')[0].body.apiKey).toBe('sk-secret');
  await click(button('Verbindung testen'));
  expect(container.textContent).toContain('Verbindung zum Provider erfolgreich.');
  await click(button('Weiter'));

  // B1: what the data says, confirmed.
  expect(container.textContent).toContain('Teil B · Plan erstellen · Schritt 1 von 6');
  expect(container.textContent).toContain('Das sehe ich in deinen Daten');
  expect(container.textContent).toContain('Radfahrer');
  expect(container.textContent).toContain('ja, zuletzt am 03.10.');
  await click(button('Stimmt so'));
  expect(server.profile.background).toEqual({ type: 'ride', weeklyHours: 7.8, intervals: { ride: true }, source: 'calculated' });

  // B2: the A event NorthCape 4000.
  expect(heading()).toBe('Dein Ziel');
  expect(button('Weiter').disabled).toBe(true);
  await click(button('+ Event hinzufügen'));
  await change(inputFor('Titel'), 'NorthCape 4000');
  await click(checkbox('Mehrtägig'));
  await change(inputFor('Start'), '2027-07-29');
  await change(inputFor('Ende'), '2027-08-12');
  await change(inputFor('Ziel (Untertyp)'), 'ultra');
  await change(inputFor('Distanz (km)'), '4000');
  await change(inputFor('Höhenmeter'), '30000');
  await change(inputFor('Tage'), '10');
  await change(inputFor('Stunden'), '12');
  await click(button('Event speichern'));
  expect(writes('/api/coach/events')[0].body).toEqual({ title: 'NorthCape 4000', sport: 'ride', subtype: 'ultra', startDate: '2027-07-29', endDate: '2027-08-12',
    allDay: true, time: null, location: null, priority: 'A', handling: null, distanceKm: 4000, targetSeconds: 10 * 86400 + 12 * 3600, elevationM: 30000, description: '' });
  expect(container.textContent).toContain('NorthCape 4000');
  expect(container.textContent).toContain('Rad · Ultra · 4.000 km · 10 d 12 h · 30.000 hm');
  await click(button('Weiter'));
  expect(server.profile.goal).toMatchObject({ type: 'event', name: 'NorthCape 4000', date: '2027-07-29' });

  // B3: ride is locked by the event, strength comes from A1.
  expect(buttonIn('Sportarten im Plan', 'Radfahren').disabled).toBe(true);
  expect(buttonIn('Sportarten im Plan', 'Kraft').getAttribute('aria-pressed')).toBe('true');
  await click(button('Weiter'));
  expect(server.profile.goal.sports).toEqual(['ride']);
  expect(server.profile.preferences.gymAvailability).toBe(true);

  // B4: next Monday until the end of the A event.
  expect(inputFor('Plan startet').value).toBe('2026-10-19');
  expect(inputFor('Plan endet').value).toBe('2027-08-12');
  expect(container.querySelector('.onboarding-timeline-event.priority-a').textContent).toBe('NorthCape 4000');
  await click(button('Weiter'));
  expect(server.settings).toMatchObject({ startDate: '2026-10-19', endDate: '2027-08-12', replanMode: 'afterReview' });

  // B5: the windows from the example, Tuesday copied to Thursday.
  expect(heading()).toBe('Verfügbarkeiten');
  expect(button('Weiter').disabled).toBe(true);
  await addWindow('Dienstag', { from: '18:00', to: '19:30', copyTo: ['Do'], options: ['Draußen'] });
  expect(server.profile.availability.windows.map(w => [w.day, w.from, w.to, w.sports.ride])).toEqual([
    ['tue', '18:00', '19:30', { indoor: true, outdoor: false }], ['thu', '18:00', '19:30', { indoor: true, outdoor: false }]]);
  // The earlier wish of 8 h may not exceed the 3 h of the windows.
  expect(server.profile.availability.preferredWeeklyHours).toBe(3);
  expect(container.textContent).toContain('Für ein Ultra-Event empfehle ich mindestens 10 h/Woche, du hast 3 h eingetragen.');
  await addWindow('Mittwoch', { from: '18:00', to: '20:00', group: true });
  expect(server.profile.availability.windows[2]).toMatchObject({ day: 'wed', group: { sport: 'ride', intensity: 'moderate', note: '' }, sports: { ride: { indoor: true, outdoor: true } } });
  await addWindow('Samstag', { allDay: true });
  await addWindow('Montag', { unavailable: true, allDay: true });
  expect(container.textContent).toContain('Ganzer Tag · nicht verfügbar');
  await change(inputFor('Maximale Stunden pro Woche'), '10');
  await change(inputFor('Bevorzugter Ruhetag'), 'mon');
  await change(inputFor('Tag für die lange Einheit'), 'sat');
  await click(button('Weiter'));
  expect(server.profile.availability).toMatchObject({ maxWeeklyHours: 10, restDay: 'mon', longDay: 'sat' });

  // B6: the summary, with a jump back that returns here.
  expect(heading()).toBe('Bereit');
  expect(container.textContent).toContain('Radfahrer · 7,8 h pro Woche · Intervalle: Rad ja');
  expect(container.textContent).toContain('Rad · Leistung');
  await click(container.querySelector('[class="onboarding-summary"] button'));
  expect(heading()).toBe('Dein Hintergrund');
  await click(button('Stimmt so'));
  expect(heading()).toBe('Bereit');
  await click(button("Los geht's"));

  // B7: progress per step, then the plan opens.
  expect(writes('/api/coach/plan/create')[0].body).toEqual({});
  expect(heading()).toBe('Plan wird erstellt');
  await tick(1500);
  expect([...container.querySelectorAll('.onboarding-create li.done')].map(li => li.textContent)).toEqual(['✓Phasen festlegen erledigt', '✓Woche 1 planen erledigt']);
  expect(created).not.toHaveBeenCalled();
  await tick(1500);
  expect(server.profile.onboarding.completed).toContain('created');
  expect(created).toHaveBeenCalled();
});

test('without data part B asks instead of prefilling and thresholds can be tested', async () => {
  server.background = noData; server.snapshot = {};
  server.profile.sports = ['ride', 'run'];
  await render();
  await click(button('Weiter'));
  expect(button('Überspringen')).toBeDefined();
  expect(container.textContent).toContain('Noch keine Aktivitäten');
  await click(button('Überspringen'));
  // A3 without values: test the FTP, enter the threshold pace.
  expect(button('Weiter').disabled).toBe(true);
  await click(buttonIn('FTP (Rad)', 'Testen lassen'));
  expect(container.textContent).toContain('FTP-Test in die erste Planwoche');
  await change(inputFor('Schwellenpace (min/km)'), '4:75');
  expect(button('Weiter').disabled).toBe(true);
  await change(inputFor('Schwellenpace (min/km)'), '4:35');
  await click(button('Weiter'));
  expect(server.profile.thresholds).toEqual({ ride: { source: 'test' }, run: { source: 'athlete', paceSecPerKm: 275, basis: null } });
  expect(writes('/api/user')[0].body.ftp).toBeUndefined();
  // A4 skipped without provider.
  await click(button('Überspringen'));
  // B1: the MATS questions.
  expect(container.textContent).not.toContain('Das sehe ich in deinen Daten');
  expect(container.textContent).toContain('Was hast du zuletzt gemacht?');
  expect(button('Weiter').disabled).toBe(true);
  await click(buttonIn('Was hast du zuletzt gemacht?', 'Läufer'));
  await click(button('Eine halbe Stunde mehr'));
  await click(button('Eine halbe Stunde mehr'));
  await click(buttonIn('Laufen', 'Ja'));
  await click(buttonIn('Rad', 'Nein'));
  await click(button('Weiter'));
  expect(server.profile.background).toEqual({ type: 'run', weeklyHours: 1, intervals: { ride: false, run: true }, source: 'athlete' });
  // B2: a goal without event.
  await click(buttonIn('Ziel ohne Event', 'Schwelle erhöhen'));
  await click(button('Weiter'));
  expect(server.profile.goal).toMatchObject({ type: 'threshold', name: '', date: null });
  // B3 and B4: 12 weeks without event.
  await click(button('Weiter'));
  expect(server.profile.goal.sports).toEqual(['ride', 'run']);
  expect(inputFor('Plan endet').value).toBe('2027-01-10');
  await click(button('Weiter'));
  await addWindow('Samstag', { allDay: true });
  await click(button('Weiter'));
  // B6 needs the provider: the jump goes to A4 and back.
  expect(button("Los geht's").disabled).toBe(true);
  await click(button('AI-Provider verbinden'));
  expect(heading()).toBe('Dein AI-Provider');
  await change(inputFor('API Key'), 'sk-secret');
  await act(async () => Simulate.submit(button('Provider speichern').closest('form')));
  await click(button('Weiter'));
  expect(heading()).toBe('Bereit');
  expect(button("Los geht's").disabled).toBe(false);
});

test('a failed creation keeps everything and continues on retry', async () => {
  server.profile.onboarding.completed = ['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'period', 'availability'];
  server.provider.configured = true;
  server.settings = { startDate: '2026-10-19', endDate: '2027-01-10', replanMode: 'manual' };
  let calls = 0;
  responses['POST /api/coach/plan/create'] = async () => {
    calls += 1;
    return calls === 1 ? { ok: false, status: 502, json: async () => ({ error: 'Der Provider hat nicht geantwortet.' }) }
      : { ok: true, json: async () => ({ id: 'job-1', status: 'done' }) };
  };
  await render();
  expect(heading()).toBe('Bereit');
  await click(button("Los geht's"));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Der Provider hat nicht geantwortet.');
  expect(container.textContent).toContain('Bisher Erstelltes bleibt erhalten.');
  await click(button('Erneut versuchen'));
  expect(writes('/api/coach/plan/create').map(r => r.body)).toEqual([{}, {}]);
  expect(created).toHaveBeenCalled();
});

test('a creation that already runs is followed instead of failing', async () => {
  server.profile.onboarding.completed = ['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'period', 'availability', 'ready'];
  server.provider.configured = true;
  server.settings = { startDate: '2026-10-19', endDate: '2027-01-10', replanMode: 'afterReview' };
  responses['POST /api/coach/plan/create'] = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Der Coach plant gerade.', job: { id: 'job-1', status: 'running', steps: [] } }) });
  await render();
  await click(button("Los geht's"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await tick(1500); await tick(1500);
  expect(created).toHaveBeenCalled();
});

test('a server without plan creation says so', async () => {
  server.profile.onboarding.completed = ['sports', 'sources', 'thresholds', 'provider', 'background', 'goal', 'planSports', 'period', 'availability', 'ready'];
  server.provider.configured = true;
  server.settings = { startDate: '2026-10-19', endDate: '2027-01-10', replanMode: 'afterReview' };
  responses['POST /api/coach/plan/create'] = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await render();
  await click(button("Los geht's"));
  expect(container.textContent).toContain('Die Planerstellung ist auf diesem Server noch nicht verfügbar.');
  await click(button('Zurück'));
  expect(heading()).toBe('Bereit');
});

test('events can be edited and deleted, plausibility only warns, closing keeps the draft', async () => {
  server.profile.onboarding.completed = ['sports', 'sources', 'thresholds', 'provider', 'background'];
  server.provider.configured = true;
  await render();
  expect(heading()).toBe('Dein Ziel');
  await click(button('+ Event hinzufügen'));
  expect(button('Event speichern').disabled).toBe(true);
  await change(inputFor('Titel'), 'Stadtmarathon');
  await click(buttonIn('Sportart des Events', 'Laufen'));
  await change(inputFor('Datum'), '2027-04-11');
  await change(inputFor('Ziel (Untertyp)'), 'marathon');
  await change(inputFor('Distanz (km)'), '30');
  expect(container.textContent).toContain('Ein Marathon ist etwa 42,2 km lang.');
  await click(buttonIn('Priorität', 'B'));
  await click(buttonIn('Wie soll der Coach damit umgehen?', 'Durchtrainieren'));
  await click(button('Event speichern'));
  expect(writes('/api/coach/events')[0].body).toMatchObject({ sport: 'run', subtype: 'marathon', priority: 'B', handling: 'trainThrough', distanceKm: 30, endDate: null });
  // Only a B event: a goal is still needed.
  expect(button('Weiter').disabled).toBe(true);
  await click(button('Löschen'));
  expect(server.events).toEqual([]);
  await click(button('Schließen, später weitermachen'));
  expect(closed).toHaveBeenCalled();
});
