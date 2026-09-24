import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import WorkoutEditor from './WorkoutEditor';
import { exampleWorkout, shortCyclingIntervals, summary, toDraft, toWorkout, workoutOverview, workoutTemplates, workoutTotals } from './workoutModel';

let container, root, originalFetch, clickSpy;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch;
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); global.fetch = originalFetch;
  clickSpy?.mockRestore(); clickSpy = null;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const button = text => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(text));
const edit = (label, value) => act(() => Simulate.change(container.querySelector(`[aria-label="${label}"]`), { target: { value } }));
const render = props => act(() => root.render(<WorkoutEditor apiBase="" date="2026-09-24" onClose={jest.fn()} onSaved={jest.fn()} onDeleted={jest.fn()} {...props} />));

test('example preserves repeat structure and shows known duration plus distance', () => {
  const workout = exampleWorkout('2026-09-24');
  expect(toWorkout(toDraft(workout))).toEqual(workout);
  expect(workoutTotals(workout)).toEqual({ time: 2100, distance: 5000, open: 0, fitSteps: 5 });
  expect(summary(workout)).toBe('35 min + 5 km');
  render();
  edit('Workout-Sportart', 'run');
  act(() => button('5 × 1 km').click());
  expect(container.textContent).toContain('4:00–4:10 /km');
  expect(container.textContent).toContain('Gesamtdistanz10 km');
});

test('a note such as fueling advice is kept while editing and saved with the workout', async () => {
  const workout = { ...exampleWorkout('2026-09-24'), notes: 'Verpflegung (LIT): Optional nur Wasser.' };
  expect(toWorkout(toDraft(workout))).toEqual(workout);
  expect(toWorkout(toDraft({ ...workout, notes: '  ' }))).not.toHaveProperty('notes');
  global.fetch = jest.fn().mockImplementation(async (_, request) => ({ ok: true, json: async () => ({ ...JSON.parse(request.body), id: 'saved-1' }) }));
  render();
  edit('Workout-Hinweis', 'Kohlenhydrate 60 g/h');
  expect(container.querySelector('.workout-notes-preview').textContent).toBe('Kohlenhydrate 60 g/h');
  await act(async () => button('Workout speichern').click());
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).notes).toBe('Kohlenhydrate 60 g/h');
});

test('saving, editing and saving again uses one persistent workout', async () => {
  const onSaved = jest.fn();
  global.fetch = jest.fn().mockImplementation(async (_, request) => ({ ok: true, json: async () => ({ ...JSON.parse(request.body), id: 'saved-1' }) }));
  render({ onSaved });
  edit('Workout-Sportart', 'run');
  act(() => button('5 × 1 km').click());
  edit('Block 2: Wiederholungen', '6');
  await act(async () => button('Workout speichern').click());
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.steps[1].count).toBe(6);
  expect(payload.date).toBe('2026-09-24');
  expect(onSaved.mock.calls[0][0].id).toBe('saved-1');
  edit('Schritt 2.1: Ziel von', '3:50');
  await act(async () => button('Workout speichern').click());
  expect(global.fetch.mock.calls[1][0]).toBe('/api/workouts/saved-1');
  expect(global.fetch.mock.calls[1][1].method).toBe('PUT');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).steps[1].steps[0].target.low).toBe(230);
});

test('invalid time stays in the editor and an API error does not claim success', async () => {
  render({ initial: { ...exampleWorkout('2026-09-24'), id: 'old' } });
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Zielbereich ungültig.' }) });
  edit('Schritt 2.1: Ziel von', '4:99');
  await act(async () => button('Garmin FIT').click());
  expect(global.fetch).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]').textContent).toContain('min:ss');
  edit('Schritt 2.1: Ziel von', '4:30');
  await act(async () => button('Garmin FIT').click());
  expect(container.querySelector('[role="alert"]').textContent).toContain('Zielbereich ungültig');
  expect(container.querySelector('[aria-label="Schritt 2.1: Ziel von"]').value).toBe('4:30');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test('export downloads actual response bytes and uses current unsaved edits', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:workout'); URL.revokeObjectURL = jest.fn();
  clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const blob = new Blob(['.FIT']);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });
  render({ initial: { ...exampleWorkout('2026-09-24'), id: 'old' } });
  expect(container.querySelector('.workout-export-name strong').textContent).toBe('24.09.2026 · 5 × 1000 m Intervalle');
  act(() => Simulate.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-25' } }));
  expect(container.querySelector('.workout-export-name strong').textContent).toBe('25.09.2026 · 5 × 1000 m Intervalle');
  edit('Schritt 2.1: Ziel', 'power');
  await act(async () => button('Garmin FIT').click());
  expect(global.fetch.mock.calls[0][0]).toBe('/api/workouts/export');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).steps[1].steps[0].target).toEqual({ type: 'power', low: 180, high: 180 });
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(clickSpy).toHaveBeenCalled();
  expect(clickSpy.mock.instances[0].download).toBe('2026-09-25_5_1000_m_Intervalle.fit');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ date: '2026-09-25', name: '5 × 1000 m Intervalle' });
  expect(container.querySelector('[role="status"]').textContent).toContain('Download gestartet');
  expect(container.textContent).toContain('Ungespeicherte Änderungen');
});

test('open duration, block reordering, removal and discarding changes work', () => {
  const onClose = jest.fn();
  render({ initial: { ...exampleWorkout('2026-09-24'), id: 'old' }, onClose });
  edit('Schritt 1: Schrittende', 'open');
  expect(container.textContent).toContain('1 offene Schritte');
  act(() => container.querySelector('[aria-label="Block 2 nach oben"]').click());
  expect(container.querySelector('[aria-label="Wiederholungsblock 1"]')).not.toBeNull();
  act(() => container.querySelector('[aria-label="Schritt 1.2 entfernen"]').click());
  expect(container.querySelector('[aria-label="Schritt 1.2: Dauer"]')).toBeNull();
  act(() => container.querySelector('[aria-label="Workout-Editor schließen"]').click());
  expect(onClose).not.toHaveBeenCalled();
  act(() => button('Verwerfen').click());
  expect(onClose).toHaveBeenCalled();
});

test('delete requires the concrete delete action and only removes a saved plan', async () => {
  const onDeleted = jest.fn(), onClose = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  render({ initial: { ...exampleWorkout('2026-09-24'), id: 'old' }, onDeleted, onClose });
  act(() => button('Löschen').click());
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => button('Workout löschen').click());
  expect(global.fetch).toHaveBeenCalledWith('/api/workouts/old', { method: 'DELETE' });
  expect(onDeleted).toHaveBeenCalledWith('old');
  expect(onClose).toHaveBeenCalled();
});

test('cycling templates supply correct complete duration and time weighted target power', () => {
  const steady = workoutTemplates.find(t => t.id === 'steady30').create('2026-09-24');
  expect(workoutOverview(steady)).toMatchObject({ time: 1800, workTime: 1800, recoveryTime: 0, averagePower: 180 });
  const intervals = workoutTemplates.find(t => t.id === 'intervals4').create('2026-09-24');
  const overview = workoutOverview(intervals);
  expect(overview).toMatchObject({ time: 3600, workTime: 1200, recoveryTime: 1200, allTimed: true, allPower: true });
  expect(overview.segments).toHaveLength(12);
  expect(overview.averagePower).toBeCloseTo(186.6666667);
  expect(overview.segments[1]).toMatchObject({ start: 600, end: 840, power: 330, path: '1.0', repetition: 1 });
  expect(overview.segments[10]).toMatchObject({ start: 2760, end: 3000, power: 120, path: '1.1', repetition: 5 });
  expect(toWorkout(toDraft(intervals))).toEqual(intervals);
});

test('hard duration, recovery duration and their watt values edit independently and persist in the export model', async () => {
  global.fetch = jest.fn().mockImplementation(async (_, request) => ({ ok: true, json: async () => ({ ...JSON.parse(request.body), id: 'new-plan' }) }));
  render();
  act(() => button('4-min-Intervalle').click());
  expect(container.querySelectorAll('.workout-profile [role="button"]')).toHaveLength(12);
  edit('Block 2: Wiederholungen', '3');
  edit('Schritt 2.1: Dauer', '5:00');
  edit('Schritt 2.1: Zielwert', '350');
  edit('Schritt 2.2: Dauer', '2:00');
  edit('Schritt 2.2: Zielwert', '100');
  expect(container.querySelector('.workout-metrics').textContent).toContain('Gesamtdauer41 min');
  expect(container.querySelector('.workout-metrics').textContent).toContain('Belastung15 min');
  expect(container.querySelector('.workout-metrics').textContent).toContain('Erholung6 min');
  expect(container.querySelectorAll('.workout-profile [role="button"]')).toHaveLength(8);
  await act(async () => button('Workout speichern').click());
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.steps[1]).toMatchObject({ count: 3, steps: [
    { intensity: 'interval', duration: { type: 'time', value: 300 }, target: { type: 'power', low: 350, high: 350 } },
    { intensity: 'recovery', duration: { type: 'time', value: 120 }, target: { type: 'power', low: 100, high: 100 } },
  ] });
  // Loading the saved model restores both editable halves and the same overall profile.
  act(() => root.render(<WorkoutEditor key="reopened" apiBase="" initial={{ ...payload, id: 'new-plan' }} onClose={jest.fn()} onSaved={jest.fn()} onDeleted={jest.fn()} />));
  expect(container.querySelector('[aria-label="Schritt 2.1: Zielwert"]').value).toBe('350');
  expect(container.querySelector('[aria-label="Schritt 2.2: Zielwert"]').value).toBe('100');
  expect(container.querySelector('.workout-metrics').textContent).toContain('Gesamtdauer41 min');
});

test('selecting intervals creates a complete block and new intervals have a distinct recovery target', () => {
  render();
  edit('Schritt 1: Intensität', 'interval');
  expect(container.querySelector('[aria-label="Block 1: Wiederholungen"]').value).toBe('5');
  expect(container.querySelector('[aria-label="Schritt 1.1: Dauer"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Schritt 1.2: Dauer"]').value).toBe('4:00');
  expect(container.querySelector('[aria-label="Schritt 1.2: Zielwert"]').value).toBe('120');
  act(() => button('+ Intervalle mit Pause').click());
  expect(container.querySelector('[aria-label="Schritt 2.1: Dauer"]').value).toBe('4:00');
  expect(container.querySelector('[aria-label="Schritt 2.1: Zielwert"]').value).toBe('330');
  expect(container.querySelector('[aria-label="Schritt 2.2: Zielwert"]').value).toBe('120');
});

test('the profile selects the shared interval editor via mouse or keyboard and reacts to target ranges', () => {
  render();
  act(() => button('4-min-Intervalle').click());
  act(() => Simulate.click(container.querySelectorAll('.workout-profile [role="button"]')[3]));
  expect(container.querySelector('.workout-step-selected').textContent).toContain('Belastung');
  expect(container.querySelectorAll('.workout-profile [aria-pressed="true"]')).toHaveLength(5);
  act(() => Simulate.keyDown(container.querySelectorAll('.workout-profile [role="button"]')[4], { key: 'Enter', preventDefault: jest.fn() }));
  expect(container.querySelector('.workout-step-selected').textContent).toContain('Pause / Erholung');
  edit('Schritt 2.2: Zielmodus', 'range');
  edit('Schritt 2.2: Ziel von', '100');
  edit('Schritt 2.2: Ziel bis', '140');
  expect(container.querySelector('.workout-chart-detail').textContent).toContain('100–140 W');
});

test('distance and open steps do not fabricate total time or watts; invalid repeat counts do not expand', () => {
  render({ initial: exampleWorkout('2026-09-24') });
  expect(container.querySelector('.workout-metrics').textContent).toContain('Geplante Abschnitte35 min + 5 km');
  expect(container.querySelector('.workout-metrics').textContent).toContain('Zielpace · Belastung4:00–4:10 /km');
  expect(container.querySelector('.workout-overview').textContent).toContain('gleiche Breite je Abschnitt');
  edit('Block 2: Wiederholungen', '99999999');
  expect(container.querySelectorAll('.workout-profile [role="button"]')).toHaveLength(0);
  edit('Block 2: Wiederholungen', '5');
  expect(container.querySelectorAll('.workout-profile [role="button"]')).toHaveLength(12);
  edit('Schritt 1: Schrittende', 'open');
  expect(container.querySelector('.workout-metrics').textContent).toContain('1 offene Schritte');
});

test('templates are specific to the selected sport and running presets use distance intervals', () => {
  render();
  expect(container.querySelectorAll('.workout-template')).toHaveLength(4);
  expect(button('10 × 400 m')).toBeUndefined();
  edit('Workout-Sportart', 'run');
  expect(container.querySelectorAll('.workout-template')).toHaveLength(3);
  expect(button('30 min konstant')).toBeUndefined();
  for (const [label, id, distance, recovery, total] of [
    ['10 × 400 m', 'run400', 400, 200, 9000], ['5 × 1 km', 'run1000', 1000, 400, 10000], ['3 × 2 km', 'run2000', 2000, 600, 10800],
  ]) {
    act(() => button(label).click());
    expect(container.querySelector('[aria-label="Schritt 2.1: Dauer"]').value).toBe(String(distance));
    expect(container.querySelector('[aria-label="Schritt 2.2: Dauer"]').value).toBe(String(recovery));
    const preset = workoutTemplates.find(t => t.id === id).create('2026-09-24');
    expect(workoutOverview(preset)).toMatchObject({ allDistance: true, distance: total, allTimed: false, averagePower: null });
    expect(toWorkout(toDraft(preset))).toEqual(preset);
  }
  expect(container.querySelector('.workout-overview').textContent).toContain('Gesamtdistanz10,8 km');
  expect(container.querySelector('.workout-overview').textContent).toContain('Distanzachse · km');
  edit('Workout-Sportart', 'ride');
  expect(container.querySelectorAll('.workout-template')).toHaveLength(4);
});

test('40/20 preset keeps three sets of seven repetitions and exactly two rests between sets', async () => {
  const preset = shortCyclingIntervals('2026-09-24');
  const blocks = preset.steps.filter(s => s.kind === 'repeat');
  expect(blocks).toHaveLength(3);
  expect(blocks.map(b => b.count)).toEqual([7, 7, 7]);
  expect(blocks.map(b => b.steps.map(s => [s.duration.value, s.target.low]))).toEqual(Array(3).fill([[40, 330], [20, 120]]));
  expect(preset.steps.filter(s => s.name === 'Serienpause')).toHaveLength(2);
  const overview = workoutOverview(preset);
  expect(overview).toMatchObject({ time: 3060, workTime: 840, recoveryTime: 1020 });
  expect(overview.segments).toHaveLength(46);
  expect(overview.segments.filter(s => s.intensity === 'interval')).toHaveLength(21);
  expect(toWorkout(toDraft(preset))).toEqual(preset);
  global.fetch = jest.fn().mockImplementation(async (_, request) => ({ ok: true, json: async () => ({ ...JSON.parse(request.body), id: 'short' }) }));
  render();
  act(() => button('3 × 7 × 40/20 s').click());
  expect(container.querySelector('.workout-metrics').textContent).toContain('Gesamtdauer51 min');
  edit('Schritt 2.1: Zielwert', '340');
  expect(container.querySelector('[aria-label="Schritt 4.1: Zielwert"]').value).toBe('330');
  await act(async () => button('Workout speichern').click());
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.steps.filter(s => s.kind === 'repeat')).toHaveLength(3);
  expect(payload.steps[1].steps[0].target).toEqual({ type: 'power', low: 340, high: 340 });
});
