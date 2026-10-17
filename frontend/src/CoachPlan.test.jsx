import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import CoachPlan, { replanText } from './CoachPlan';

const workout = { id: 'w1', name: 'Sweetspot Rad', sport: 'ride', date: '2026-10-20', steps: [
  { kind: 'step', intensity: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'power', low: 120, high: 150 } },
  { kind: 'step', intensity: 'interval', duration: { type: 'time', value: 720 }, target: { type: 'power', low: 250, high: 260 } },
  { kind: 'step', intensity: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', low: 110, high: 130 } }] };
const sweetspot = { id: 'w1', day: 'tue', template: 'bike_sweetspot', params: {}, locked: false,
  rendered: { name: 'Sweetspot Rad', date: '2026-10-20', durationMin: 32, notes: 'Verpflegung: Kohlenhydrate.', workout } };
const week = (number, start, extra = {}) => ({ week: `2026-W${42 + number}`, number, startDate: start, state: 'future', blockId: 'b1', blockType: 'grundlage',
  phaseName: 'Grundlage', phase: 'build', deload: false, targetHours: 6, focus: 'Basis', plan: null, events: [], completedHours: null, replanDate: null, ...extra });
const overview = {
  frame: { status: 'active', startDate: '2026-10-19', endDate: '2027-08-12', rationale: 'Erst Basis, dann Schwelle.' },
  settings: { startDate: '2026-10-19', endDate: '2027-08-12', replanMode: 'sunday' }, today: '2026-10-19',
  phases: [{ id: 'b1', blockType: 'grundlage', typeName: 'Grundlage', purpose: 'Aerobe Basis bauen.', startDate: '2026-10-19', endDate: '2026-12-13', status: 'active', weeks: 8 },
    { id: 'b2', blockType: 'schwelle', typeName: 'Schwelle', purpose: 'FTP heben.', startDate: '2026-12-14', endDate: '2027-01-10', status: 'planned', weeks: 4 }],
  events: [{ id: 'e1', title: 'NorthCape 4000', priority: 'A', startDate: '2027-01-08', endDate: '2027-01-10', planWeek: 12 }],
  weeks: [week(1, '2026-10-19', { state: 'current', plan: { targetHours: 6, calculatedHours: 6, focus: 'Grundlage festigen', sessions: [sweetspot], fixedSessions: [], hinweise: [] } }),
    week(2, '2026-10-26', { plan: { targetHours: 7, calculatedHours: 7, focus: 'Mehr Umfang', sessions: [], fixedSessions: [], hinweise: [] } }),
    week(4, '2026-11-09', { replanDate: '2026-10-25', deload: true, targetHours: 4 })],
  nextManualWeek: null, job: null,
};
let container, root, requests, asked, data;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text);
const click = async element => { await act(async () => element.click()); };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = []; asked = jest.fn(); data = overview;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://coach.test').pathname;
    const method = options.method || 'GET';
    requests.push({ path, method, body: options.body ? JSON.parse(options.body) : undefined });
    if (path === '/api/coach/plan/weeks') return { ok: true, json: async () => data };
    if (path.endsWith('/review')) return { ok: true, json: async () => ({ revision: 3, job: { id: 'j1', status: 'running', steps: [] } }) };
    if (path.endsWith('/lock')) return { ok: true, json: async () => ({}) };
    if (path === '/api/coach/check-ins') return { ok: true, json: async () => ({ checkIns: [], injuries: [] }) };
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers(); });
const render = async (props = {}) => { await act(async () => root.render(<CoachPlan apiBase="" workoutsById={{ w1: workout }} onAsk={asked} {...props} />)); };

test('without a plan the area starts the onboarding', async () => {
  data = { frame: null, phases: [], events: [], weeks: [] };
  const start = jest.fn();
  await render({ onStart: start });
  expect(container.textContent).toContain('Lass uns deinen Plan bauen');
  await click(button("Los geht's"));
  expect(start).toHaveBeenCalled();
});

test('the plan shows the countdown, phases, worked-out and outlined weeks', async () => {
  await render();
  expect(container.textContent).toContain('NorthCape 4000');
  expect(container.textContent).toContain('Noch 11 Wochen · Woche 1 von 3');
  expect([...container.querySelectorAll('.plan-phases button')].map(b => b.textContent)).toEqual(['Grundlage8 Wo.', 'Schwelle4 Wo.']);
  await click(container.querySelector('.plan-phases button'));
  expect(container.querySelector('.plan-phase-detail').textContent).toContain('Aerobe Basis bauen.');
  expect(container.querySelector('.plan-event-dot.A').getAttribute('title')).toContain('NorthCape 4000');
  expect(container.querySelectorAll('.plan-week')).toHaveLength(2);
  expect(container.textContent).toContain('6 h · Grundlage festigen');
  expect(container.querySelector('.plan-outlined').textContent).toContain('Woche 4Grundlage · 4 h · Entlastung');
  expect(container.querySelector('.plan-outlined').textContent).toContain('wird am So., 25.10. ausgearbeitet');
  await click(button('Woche anpassen'));
  expect(asked).toHaveBeenCalledWith({ kind: 'week', week: '2026-W43', sessionId: null, label: 'Woche 1' });
});

test('a session opens its detail; moving it asks the coach, keeping it locks the workout', async () => {
  await render();
  await click([...container.querySelectorAll('.plan-session')].find(b => b.textContent.includes('Sweetspot')));
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('Viel Zeit knapp unter der Schwelle');
  expect(dialog.textContent).toContain('Verpflegung: Kohlenhydrate.');
  expect(dialog.textContent).toContain('12:00 min · 250–260 W');
  await click(button('Behalten'));
  expect(requests.find(r => r.path === '/api/workouts/w1/lock').body).toEqual({ locked: true });
  expect(button('Wird behalten')).toBeDefined();
  await act(async () => Simulate.change(container.querySelector('select[aria-label="Neuer Tag"]'), { target: { value: 'thu' } }));
  await click(button('Verschieben'));
  expect(asked).toHaveBeenCalledWith({ kind: 'session', week: '2026-W43', sessionId: 'w1', label: 'Di., 20.10. · Sweetspot Rad' }, 'Bitte verschiebe diese Einheit auf Donnerstag.');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('the weekly review is sent and hands its replanning job on', async () => {
  const job = jest.fn();
  await render({ onJob: job });
  await click(button('Wochenrückblick'));
  await click(button('3 · mittel'));
  await click(button('Wenig Zeit'));
  await click(button('Absenden'));
  expect(requests.find(r => r.method === 'PUT').body).toEqual({ missedSessions: [], effort: 3, reasons: ['lackOfTime'], note: '' });
  expect(requests.find(r => r.method === 'PUT').path).toBe('/api/coach/weeks/2026-W43/review');
  expect(job).toHaveBeenCalledWith({ id: 'j1', status: 'running', steps: [] });
});

test('the replanning moment follows the replan mode', () => {
  const outlined = { replanDate: '2026-11-01' };
  expect(replanText(outlined, 'sunday', '2026-10-20')).toBe('wird am So., 01.11. ausgearbeitet');
  expect(replanText(outlined, 'afterReview', '2026-10-20')).toBe('wird nach deinem Wochenrückblick am So., 01.11. ausgearbeitet');
  expect(replanText({ replanDate: null }, 'manual')).toBe('wird auf Knopfdruck ausgearbeitet');
  expect(replanText(outlined, 'sunday', '2026-11-02')).toBe('ist zum Ausarbeiten fällig');
});
