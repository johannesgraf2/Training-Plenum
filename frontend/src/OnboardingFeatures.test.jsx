import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import DateInput from './DateInput';
import { EventForm, AvailabilityForm } from './PlanSteps';
import { PlanTimeline, ThresholdFields, thresholdChanges, thresholdDraft } from './OnboardingUI';
import { shouldAskCheckIn, CheckInStrip } from './CoachToday';

let root, container;
const render = async element => { await act(async () => root.render(element)); };
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const input = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === label)?.querySelector('input, select');
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T10:00:00Z'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('the calendar marks only the complete current date and distinguishes selection', async () => {
  await render(<DateInput value="2027-07-17" onChange={jest.fn()} />);
  await click(button('Kalender öffnen'));
  expect(container.querySelector('[aria-current="date"]')).toBeNull();
  expect(button('2027-07-17').getAttribute('aria-pressed')).toBe('true');
  for (let i = 0; i < 9; i += 1) await click(button('Vorheriger Monat'));
  expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  expect(container.querySelector('[aria-current="date"]').getAttribute('aria-label')).toBe('2026-10-17');
});

test('an event title survives sport, subtype, date and priority changes', async () => {
  const save = jest.fn();
  await render(<EventForm onSave={save} onCancel={jest.fn()} />);
  await change(input('Titel'), 'Frankfurt Marathon');
  expect(input('Titel').placeholder).toContain('Frankfurt Marathon oder Ötztaler');
  await click([...container.querySelectorAll('[aria-label="Sportart des Events"] button')].find(b => b.textContent === 'Laufen'));
  await change(input('Ziel (Untertyp)'), 'marathon');
  await change(input('Datum'), '2027-07-17');
  await click([...container.querySelectorAll('[aria-label="Priorität"] button')].find(b => b.textContent.startsWith('B')));
  expect(input('Titel').value).toBe('Frankfurt Marathon');
  expect(input('Ziel (Untertyp)').compareDocumentPosition(container.querySelector('[aria-label="Priorität"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await click(button('Event speichern'));
  expect(save.mock.calls[0][0]).toMatchObject({ title: 'Frankfurt Marathon', subtype: 'marathon', priority: 'B' });
});

test('10-km-pace keeps its meaning through the form and storage', async () => {
  const data = { profile: { thresholds: {} }, user: {}, thresholds: {} };
  let saved;
  function Form() {
    const [draft, setDraft] = React.useState(() => thresholdDraft(data));
    return <><ThresholdFields draft={draft} sports={['run']} onChange={setDraft} /><button onClick={() => { saved = thresholdChanges(draft, ['run']); }}>Sichern</button></>;
  }
  await render(<Form />);
  await change(input('Bezugswert Laufen'), 'tenKm');
  await change(input('10-km-Pace (min/km)'), '4:30');
  await click(button('Sichern'));
  expect(saved.thresholds.run).toEqual({ source: 'athlete', referenceType: 'tenKm', paceSecPerKm: 270, basis: null });
  expect(thresholdDraft({ ...data, profile: { thresholds: saved.thresholds } }).run.referenceType).toBe('tenKm');
});

test('timeline names A, B and C events', async () => {
  await render(<PlanTimeline start="2026-10-19" end="2027-01-10" events={['A', 'B', 'C'].map((priority, index) => ({ id: priority, priority, title: `Event ${priority}`, startDate: `2026-11-${10 + index * 10}` }))} />);
  expect([...container.querySelectorAll('.onboarding-timeline-event em')].map(e => e.textContent)).toEqual(['A · Event A', 'B · Event B', 'C · Event C']);
});

test('copying availability includes sport options and group details on every selected day', async () => {
  const save = jest.fn();
  await render(<AvailabilityForm day="mon" sports={['ride']} onSave={save} onCancel={jest.fn()} />);
  const targets = container.querySelector('[aria-label="Auch für andere Tage übernehmen"]');
  await click([...targets.querySelectorAll('button')].find(b => b.textContent === 'Mi'));
  await click([...targets.querySelectorAll('button')].find(b => b.textContent === 'Fr'));
  expect(targets.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  await click([...container.querySelectorAll('label')].find(l => l.textContent.startsWith('Gruppentraining')).querySelector('input'));
  await change(input('Notiz (optional)'), 'Vereinsausfahrt');
  await click(button('Weiter'));
  expect(container.textContent).toContain('Mittwoch, Freitag');
  await click(button('Speichern'));
  const copied = save.mock.calls[0][0];
  expect(copied.map(w => w.day)).toEqual(['mon', 'wed', 'fri']);
  copied.forEach(w => expect(w).toMatchObject({ kind: 'available', allDay: false, from: '18:00', to: '19:30', sports: { ride: { indoor: true, outdoor: true } }, group: { sport: 'ride', note: 'Vereinsausfahrt' } }));
  expect(new Set(copied.map(w => w.id)).size).toBe(3);
});

test('the daily question stays hidden while onboarding is required', async () => {
  const day = { date: '2026-10-17', dailyCheckIn: true, onboardingRequired: true };
  expect(shouldAskCheckIn(day)).toBe(false);
  await render(<CheckInStrip today={day} />);
  expect(container.textContent).toBe('');
});
