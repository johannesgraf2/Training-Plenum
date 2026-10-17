import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanTimeline, parseDate } from './OnboardingUI';

test('every event on the timeline carries its name, B and C with their priority', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  const events = [{ id: 'a', title: 'Ötztaler', priority: 'A', startDate: '2027-08-29' }, { id: 'b', title: 'Kriterium', priority: 'B', startDate: '2027-05-01' },
    { id: 'c', title: 'Testrennen', priority: 'C', startDate: '2027-03-01' }];
  await act(async () => root.render(<PlanTimeline start="2026-10-19" end="2027-09-05" events={events} />));
  expect([...container.querySelectorAll('.onboarding-timeline-event')].map(e => e.textContent)).toEqual(['Ötztaler', 'BKriterium', 'CTestrennen']);
  act(() => root.unmount());
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('typed dates are German or ISO and must exist', () => {
  expect(parseDate('17.10.2026')).toBe('2026-10-17');
  expect(parseDate('7.3.27')).toBe('2027-03-07');
  expect(parseDate('2027-07-17')).toBe('2027-07-17');
  expect(parseDate('31.02.2027')).toBeNull();
  expect(parseDate('17.10.')).toBeNull();
});
