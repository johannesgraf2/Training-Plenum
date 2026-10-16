import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckInDialog, CheckInStrip, shouldAskCheckIn } from './CoachToday';

const today = { date: '2026-10-21', checkIn: null, previousCheckIn: null, injuries: [], whoop: { readiness: 58, band: 'yellow', sleepMinutes: 412 }, weekPlanned: true, dailyCheckIn: true,
  readiness: { level: 'green', reasons: [], notes: [], affectedSports: [], checkedIn: false }, sessions: [],
  period: { week: '2026-W43', goal: { name: 'Olympische Distanz', date: '2027-06-13' }, weeksToGoal: 33, block: null,
    season: { segments: [{ blockType: 'grundlage', typeName: 'Grundlage', weeks: 6, startDate: '2026-08-24', endDate: '2026-10-04' }, { blockType: 'aufbau', typeName: 'Aufbau', weeks: 6, startDate: '2026-10-05', endDate: '2026-11-15' }] } } };
const ankle = { id: 'i1', label: 'Knöchel rechts', region: 'ankle', side: 'right', pain: 6, startDate: '2026-10-19', timing: 'during', onset: 'immediate', impact: 'adjust', history: [{ date: '2026-10-19', pain: 6 }], affectedSports: ['run'], severe: true };

let container, root, requests, saved, closed;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = []; saved = jest.fn(); closed = jest.fn(); window.localStorage.clear();
  global.fetch = jest.fn(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ...today, checkIn: { date: today.date }, readiness: { level: 'red', reasons: ['Knöchel rechts: Schmerz 6/10'], notes: [], affectedSports: ['run'], checkedIn: true }, sessions: [{ id: 's', name: 'Lauf locker', sport: 'run', durationMin: 45, hard: false, source: 'coach' }] }) };
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const click = async element => { await act(async () => element.click()); };
const answer = async (question, text) => {
  const set = [...container.querySelectorAll('fieldset')].find(f => f.querySelector('legend').textContent.startsWith(question));
  await click([...set.querySelectorAll('button')].find(b => b.textContent === text));
};
const fillScales = async () => {
  for (const [q, a] of [['Wohlbefinden', 'gut'], ['Erholung', 'normal'], ['Stress', 'entspannt'], ['Muskelkater', 'keiner'], ['Stimmung', 'neutral'], ['Ernährung gestern', 'passend'], ['Alkohol gestern', 'nein']]) await answer(q, a);
};

test('a new complaint is asked in detail and the result shows the traffic light', async () => {
  await act(async () => root.render(<CheckInDialog apiBase="" today={today} onClose={closed} onSaved={saved} onAdjust={jest.fn()} />));
  expect(container.textContent).toContain('Noch 33 Wochen bis Olympische Distanz');
  expect(container.querySelector('.today-whoop').textContent).toContain('58');
  await fillScales();
  await answer('Schmerzen oder Verletzung?', 'ja');
  await answer('Wo?', 'Knöchel'); await answer('Seite', 'rechts'); await answer('Wann tut es weh?', 'während Belastung');
  await answer('Beginn', 'sofort beim Start');
  await click(button('Fertig'));
  expect(container.textContent).toContain('Noch 1 offen');
  await answer('Auswirkung aufs Training', 'anpassen');
  const slider = container.querySelector('input[aria-label="Wie stark?"]');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '6'); slider.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(button('Fertig'));
  expect(requests[0].url).toContain('/api/coach/check-ins?timezone=');
  expect(requests[0].body.newInjury).toEqual({ pain: 6, region: 'ankle', side: 'right', timing: 'during', onset: 'immediate', impact: 'adjust' });
  expect(saved).toHaveBeenCalled();
  expect(container.textContent).toContain('Rot – heute schonen');
  expect(button('Woche anpassen lassen')).toBeDefined();
});

test('an active complaint gets a follow-up instead of the full questions', async () => {
  await act(async () => root.render(<CheckInDialog apiBase="" today={{ ...today, injuries: [ankle] }} onClose={closed} onSaved={saved} />));
  await fillScales();
  await answer('Neue Schmerzen oder Verletzung?', 'nein');
  await click(button('Fertig'));
  expect(container.textContent).toContain('Noch 1 offen');  // better, same or worse
  await answer('Knöchel rechts', 'besser');
  await click(button('Fertig'));
  expect(requests[0].body.injuryUpdates).toEqual([{ id: 'i1', pain: 6, trend: 'better', healed: false }]);
  // Without onAdjust there is no adjustment button.
  expect(button('Woche anpassen lassen')).toBeUndefined();
});

test('"Später" keeps the dialog away until the next day', async () => {
  expect(shouldAskCheckIn(today)).toBe(true);
  await act(async () => root.render(<CheckInDialog apiBase="" today={today} onClose={closed} onSaved={saved} />));
  await click(button('Später'));
  expect(closed).toHaveBeenCalled();
  expect(shouldAskCheckIn(today)).toBe(false);
  expect(shouldAskCheckIn({ ...today, date: '2026-10-22' })).toBe(true);
  expect(shouldAskCheckIn({ ...today, dailyCheckIn: false, date: '2026-10-22' })).toBe(false);
});

test('the start page line shows the open check-in or the traffic light', async () => {
  const open = jest.fn();
  await act(async () => root.render(<CheckInStrip today={today} onOpen={open} />));
  await click(button('Jetzt ausfüllen'));
  expect(open).toHaveBeenCalled();
  await act(async () => root.render(<CheckInStrip today={{ ...today, checkIn: { date: today.date }, readiness: { level: 'yellow', reasons: ['Alkohol gestern'] } }} />));
  expect(container.textContent).toBe('Gelb – etwas zurücknehmen · Alkohol gesternZum Coach');
});
