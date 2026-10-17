import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WeekPanel } from './PlanSteps';

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

const windows = ['tue', 'thu', 'sat'].map(day => ({ id: day, day, kind: 'available', allDay: false, from: '18:00', to: '20:00', sports: {}, group: null }));
const events = [{ id: 'oetz', title: 'Ötztaler', sport: 'ride', subtype: 'granFondo', priority: 'A', startDate: '2027-08-26', targetSeconds: 36000 }];
const week = { maxWeeklyHours: '13', restDays: [], longDays: [], noConsecutiveRestDays: false };
const rules = { minHours: 6, averageHours: 8, peakHours: 10, rationale: 'Richtwert aus Eventart, Ziel und deinem bisherigen Umfang.', source: 'rules' };
const ai = { minHours: 7, averageHours: 10, peakHours: 12.5, rationale: 'Lange Anstiege brauchen Umfang.', source: 'aiRecommendation' };

test('the recommendation comes from the AI once per event and shows minimum, average and peak week', async () => {
  const request = jest.fn(async (path, method) => method === 'POST'
    ? { recommendation: ai, event: { title: 'Ötztaler', goal: 'targetTime' }, canAsk: false }
    : { recommendation: rules, event: { title: 'Ötztaler', goal: 'targetTime' }, canAsk: true });
  await act(async () => root.render(<WeekPanel week={week} windows={windows} events={events} background={{ weeklyHours: 8 }} request={request} onChange={() => {}} />));
  expect(request.mock.calls.map(([path, method]) => `${method || 'GET'} ${path}`)).toEqual(['GET /api/coach/volume/recommendation', 'POST /api/coach/volume/recommendation']);
  const text = container.textContent;
  expect(text).toContain('mind. 7 hMinimum für „Ötztaler“ mit Zielzeit');
  expect(text).toContain('Ø 10 hempfohlen im Schnitt pro Woche');
  expect(text).toContain('12,5 hstärkste Woche vor dem Taper');
  expect(text).toContain('AI · Empfehlung Lange Anstiege brauchen Umfang.');
  // The budget tile shows the windows (6 h), the typed maximum caps it.
  expect(text).toContain('6 hmaximal verfügbare Zeit pro Woche');
  expect(text).toContain('Für „Ötztaler“ mit Zielzeit empfehle ich mindestens 7 h/Woche, du hast 6 h eingetragen.');
});

test('without windows the budget tile shows the typed maximum', async () => {
  const request = jest.fn(async () => ({ recommendation: rules, event: { title: 'Ötztaler', goal: 'finish' }, canAsk: false }));
  await act(async () => root.render(<WeekPanel week={week} windows={[]} events={events} background={null} request={request} onChange={() => {}} />));
  expect(request).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('13 hmaximal verfügbare Zeit pro Woche');
  expect(container.textContent).toContain('Richtwert Richtwert aus Eventart');
});
