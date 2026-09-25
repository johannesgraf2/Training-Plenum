import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import WorkoutEditor from './WorkoutEditor';
import { toDraft, toWorkout, workoutOverview, workoutTotals } from './workoutModel';
import { createLibraryWorkout, libraryPhases, libraryTags, searchLibrary, workoutLibrary } from './workoutLibraryData';

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });
const button = text => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(text));
const edit = (label, value) => act(() => Simulate.change(container.querySelector(`[aria-label="${label}"]`), { target: { value } }));
const render = props => act(() => root.render(<WorkoutEditor apiBase="" date="2026-09-24" onClose={jest.fn()} onSaved={jest.fn()} onDeleted={jest.fn()} {...props} />));
const titles = () => Array.from(container.querySelectorAll('.library-card strong')).map(e => e.textContent);

test('every library session is a valid, exportable workout for both athletes with and without settings', () => {
  expect(workoutLibrary.length).toBeGreaterThanOrEqual(50);
  expect(new Set(workoutLibrary.map(e => e.id)).size).toBe(workoutLibrary.length);
  for (const entry of workoutLibrary) {
    expect(entry.tags.every(tag => libraryTags[tag])).toBe(true);
    expect(!entry.phase || libraryPhases[entry.phase]).toBeTruthy();
    expect(entry.description.length).toBeLessThanOrEqual(250);
    for (const athlete of [{ ftp: 280, maxHr: 190 }, {}]) {
      const workout = createLibraryWorkout(entry, '2026-09-24', athlete);
      expect(toWorkout(toDraft(workout))).toEqual(workout);
      expect(workoutTotals(workout).fitSteps).toBeLessThanOrEqual(50);
      expect(() => workoutOverview(workout)).not.toThrow();
    }
  }
});

test('progressions offer start, middle and end of a block with increasing work', () => {
  const families = {};
  workoutLibrary.filter(e => e.family).forEach(e => { (families[e.family] ||= {})[e.phase] = e; });
  expect(Object.keys(families).length).toBeGreaterThanOrEqual(10);
  for (const phases of Object.values(families)) {
    expect(Object.keys(phases).sort()).toEqual(['end', 'mid', 'start']);
    const work = ['start', 'mid', 'end'].map(p => { const w = createLibraryWorkout(phases[p], '2026-09-24', { ftp: 250, maxHr: 190 }); const o = workoutOverview(w); return o.workTime + o.workDistance; });
    expect(work[0]).toBeLessThan(work[1]);
    expect(work[1]).toBeLessThan(work[2]);
  }
  const vo2 = ['start', 'mid', 'end'].map(p => workoutLibrary.find(e => e.id === `ride-vo2-4-${p}`));
  expect(vo2.map(e => e.spec[1].repeat)).toEqual([3, 4, 6]);
});

test('targets scale with FTP and maximum heart rate', () => {
  const entry = workoutLibrary.find(e => e.id === 'ride-vo2-4-start');
  expect(createLibraryWorkout(entry, '2026-09-24', { ftp: 300 }).steps[1].steps[0].target).toEqual({ type: 'power', low: 345, high: 345 });
  expect(createLibraryWorkout(entry, '2026-09-24', {}).steps[1].steps[0].target).toEqual({ type: 'power', low: 290, high: 290 });
  const run = workoutLibrary.find(e => e.id === 'run-threshold-mid');
  expect(createLibraryWorkout(run, '2026-09-24', { maxHr: 200 }).steps[1].steps[0].target).toEqual({ type: 'heart_rate', low: 172, high: 180 });
  expect(createLibraryWorkout(run, '2026-09-24', {}).steps[1].steps[0].target).toEqual({ type: 'none' });
});

test('search matches German tags, English synonyms, block phases and compact interval notation', () => {
  const ids = query => searchLibrary({ query }).map(e => e.id);
  expect(ids('threshold')).toContain('ride-threshold-start');
  expect(ids('base')).toEqual(expect.arrayContaining(['ride-base-start', 'run-long-mid']));
  expect(ids('vo2max block-ende')).toEqual(expect.arrayContaining(['ride-vo2-4-end', 'run-vo2-1000-end']));
  expect(ids('vo2max block-ende')).not.toContain('ride-vo2-4-start');
  expect(ids('4x4')).toEqual(['ride-vo2-4-mid']);
  expect(ids('ronnestad').length).toBeGreaterThan(0);
  expect(searchLibrary({ sport: 'run', tag: 'vo2max', phase: 'start' }).every(e => e.sport === 'run' && e.phase === 'start')).toBe(true);
});

test('the library opens from the templates, filters and replaces the workout with the chosen session', () => {
  render({ ftp: 300 });
  act(() => button('Beispiel-Einheiten durchsuchen').click());
  expect(container.querySelector('.workout-footer')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[aria-label="Vorlagen durchsuchen"]'));
  expect(titles()).toContain('3 × 4 min VO2max');
  expect(titles()).not.toContain('4 × 1000 m');
  act(() => button('VO2max').click());
  act(() => button('Block-Ende').click());
  expect(titles()).toEqual(expect.arrayContaining(['6 × 4 min VO2max', '3 × 13 × 30/15 s']));
  expect(titles()).not.toContain('3 × 4 min VO2max');
  expect(titles()).not.toContain('3 × 20 min Sweetspot');
  expect(container.textContent).toContain('345 W');
  act(() => button('Filter zurücksetzen')?.click());
  edit('Vorlagen durchsuchen', 'gibt es nicht');
  expect(container.querySelector('.library-count').textContent).toBe('0 Einheiten');
  act(() => button('Filter zurücksetzen').click());
  act(() => button('Laufen (').click());
  expect(titles()).toContain('4 × 1000 m');
  act(() => container.querySelector('[aria-label="Vorlage 5 × 1000 m übernehmen"]').click());
  expect(container.querySelector('.library')).toBeNull();
  expect(container.querySelector('[aria-label="Workout-Sportart"]').value).toBe('run');
  expect(container.querySelector('.workout-name input').value).toBe('5 × 1000 m');
  expect(container.querySelector('[aria-label="Block 2: Wiederholungen"]').value).toBe('5');
  expect(container.querySelector('[aria-label="Workout-Hinweis"]').value).toContain('Block-Mitte');
  expect(container.querySelector('.workout-footer').textContent).toContain('Ungespeicherte Änderungen');
});

test('Escape closes only the library, then the editor', () => {
  const onClose = jest.fn();
  render({ onClose });
  act(() => button('Beispiel-Einheiten durchsuchen').click());
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(container.querySelector('.library')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(onClose).toHaveBeenCalled();
});
