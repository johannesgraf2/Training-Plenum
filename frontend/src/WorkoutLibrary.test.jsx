import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import WorkoutEditor from './WorkoutEditor';
import { intensityZone, toDraft, toWorkout, workoutOverview, workoutTotals } from './workoutModel';
import { createLibraryWorkout, libraryPhases, libraryProfile, libraryTags, searchLibrary, workoutLibrary } from './workoutLibraryData';

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
    const overviews = ['start', 'mid', 'end'].map(p => workoutOverview(createLibraryWorkout(phases[p], '2026-09-24', { ftp: 250, maxHr: 190 })));
    const work = overviews.map(o => o.workTime + o.workDistance);
    // Work rises, or stays equal with shorter recoveries (e.g. 3 × 20 min with 5 → 3 min easy).
    [[0, 1], [1, 2]].forEach(([a, b]) => expect(work[a] < work[b] || (work[a] === work[b] && overviews[b].recoveryTime < overviews[a].recoveryTime)).toBe(true));
  }
  const vo2 = ['start', 'mid', 'end'].map(p => workoutLibrary.find(e => e.id === `ride-vo2-4-${p}`));
  expect(vo2.map(e => e.spec[1].repeat)).toEqual([3, 4, 6]);
});

test('3-series micro interval progressions and multi-part VO2max intervals keep their structure', () => {
  const titles = key => ['start', 'mid', 'end'].map(p => workoutLibrary.find(e => e.id === `${key}-${p}`).title);
  expect(titles('ride-vo2-3015')).toEqual(['3 × 6 × 30/15 s', '3 × 8 × 30/15 s', '3 × 11 × 30/15 s']);
  expect(titles('ride-vo2-4020')).toEqual(['3 × 6 × 40/20 s', '3 × 8 × 40/20 s', '3 × 11 × 40/20 s']);
  const micro = createLibraryWorkout(workoutLibrary.find(e => e.id === 'ride-vo2-3015-end'), '2026-09-24', { ftp: 300 });
  expect(micro.steps.filter(s => s.kind === 'repeat').map(b => [b.count, b.steps.map(s => [s.duration.value, s.target.low])])).toEqual(Array(3).fill([11, [[30, 375], [15, 150]]]));
  expect(micro.steps.filter(s => s.name === 'Serienpause')).toHaveLength(2);
  const waves = workoutOverview(createLibraryWorkout(workoutLibrary.find(e => e.id === 'ride-vo2-waves-end'), '2026-09-24', { ftp: 300 }));
  expect(waves.workTime).toBe(4 * 7 * 60);
  const hardStart = createLibraryWorkout(workoutLibrary.find(e => e.id === 'ride-hardstart-4-start'), '2026-09-24', { ftp: 300 });
  expect(hardStart.steps[1]).toMatchObject({ count: 4, steps: [{ duration: { value: 30 }, target: { low: 405 } }, { duration: { value: 210 }, target: { low: 335 } }, { intensity: 'recovery' }] });
});

test('threshold progressions fill each interval with their pattern', () => {
  const entry = id => workoutLibrary.find(e => e.id === id);
  const titles = key => ['start', 'mid', 'end'].map(p => entry(`${key}-${p}`).title);
  expect(titles('ride-threshold-10')).toEqual(['3 × 10 min Schwelle', '4 × 10 min Schwelle', '5 × 10 min Schwelle']);
  expect(titles('ride-threshold-12')).toEqual(['3 × 12 min Schwelle', '4 × 12 min Schwelle', '5 × 12 min Schwelle']);
  expect(titles('ride-threshold-20')).toEqual(['2 × 20 min Schwelle', '3 × 20 min Schwelle', '3 × 20 min Schwelle']);
  expect(entry('ride-threshold-20-end').spec[1].steps[1].duration).toBe(3 * 60);
  expect(titles('ride-threshold-pyramid')).toEqual(['Schwellen-Pyramide 10-15-10', 'Schwellen-Pyramide 10-15-20-15-10', 'Schwellen-Pyramide 15-20-25-20']);
  const workTime = id => workoutOverview(createLibraryWorkout(entry(id), '2026-09-24', { ftp: 300 })).workTime;
  expect(workTime('ride-overunder-start')).toBe(3 * 10 * 60);
  expect(workTime('ride-threshold-waves-mid')).toBe(3 * 15 * 60);
  expect(workTime('ride-threshold-cadwaves-end')).toBe(3 * 20 * 60);
  expect(workTime('ride-threshold-broken-end')).toBe(3 * 18 * 60);
  const overUnder = createLibraryWorkout(entry('ride-overunder-start'), '2026-09-24', { ftp: 300 });
  expect(overUnder.steps[1]).toMatchObject({ kind: 'repeat', count: 3, steps: [{ duration: { value: 120 }, target: { low: 285 } }, { duration: { value: 60 }, target: { low: 315 } }] });
  expect(overUnder.steps[2]).toMatchObject({ duration: { value: 60 }, target: { low: 285 } });
  const progressive = createLibraryWorkout(entry('ride-threshold-progressive-start'), '2026-09-24', { ftp: 300 });
  expect(progressive.steps.slice(1, 4).map(s => [s.duration.value, s.target.low])).toEqual([[200, 285], [200, 300], [200, 315]]);
  const attack = createLibraryWorkout(entry('ride-threshold-attack-end'), '2026-09-24', { ftp: 300 });
  expect(attack.steps.slice(1, 3).map(s => [s.duration.value, s.target.low, s.target.high])).toEqual([[15, 390, 450], [1185, 285, 300]]);
  const finish = createLibraryWorkout(entry('ride-threshold-finish-start'), '2026-09-24', { ftp: 300 });
  expect(finish.steps.slice(1, 3).map(s => [s.duration.value, s.target.low])).toEqual([[840, 290], [60, 345]]);
});

test('work steps are coloured below, at and above the threshold', () => {
  expect([0.65, 0.82, 0.85, 0.9, 0.95, 1, 1.05, 1.08, 1.2].map(f => intensityZone(f))).toEqual(['endurance', 'tempo', 'tempo', 'sweetspot', 'threshold', 'threshold', 'threshold', 'vo2', 'vo2']);
  expect([0.75, 0.845, 0.88, 0.925].map(f => intensityZone(f, 'heart_rate'))).toEqual(['endurance', 'tempo', 'threshold', 'vo2']);
  const zones = id => [...new Set(libraryProfile(workoutLibrary.find(e => e.id === id)).map(s => s.zone).filter(Boolean))];
  expect(zones('ride-sweetspot-start')).toEqual(['sweetspot']);
  expect(zones('ride-tempo-start')).toEqual(['tempo']);
  expect(zones('ride-k3-start')).toEqual(['tempo']);
  expect(zones('run-tempo-start')).toEqual(['tempo']);
  expect(zones('ride-sweetspot-overunder-start')).toEqual(['sweetspot', 'threshold']);
  expect(zones('ride-sweetspot-longride-end')).toEqual(['endurance', 'sweetspot']);
  expect(zones('ride-threshold-20-mid')).toEqual(['threshold']);
  expect(zones('ride-vo2-4-start')).toEqual(['vo2']);
  expect(zones('ride-threshold-attack-start')).toEqual(['vo2', 'threshold']);
  expect(zones('run-threshold-start')).toEqual(['threshold']);
  render({ ftp: 300 });
  act(() => button('Beispiel-Einheiten durchsuchen').click());
  act(() => button('Sweetspot').click());
  expect(container.querySelectorAll('.library-profile rect.zone-sweetspot').length).toBeGreaterThan(0);
  expect(titles()).toContain('3 × 12 min Sweetspot progressiv');
  expect(titles()).not.toContain('3 × 4 min VO2max');
  act(() => container.querySelector('[aria-label="Vorlage 3 × 12 min Sweetspot übernehmen"]').click());
  expect(container.querySelector('.workout-chart-legend').textContent).toContain('Sweetspot');
  expect(container.querySelector('.workout-chart-legend').textContent).not.toContain('Belastung');
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
  expect(ids('threshold')).toEqual(expect.arrayContaining(['ride-threshold-10-start', 'ride-threshold-waves-mid', 'ride-threshold-lowcad-end']));
  expect(ids('low cadence threshold')).toEqual(['ride-threshold-lowcad-start', 'ride-threshold-lowcad-mid', 'ride-threshold-lowcad-end']);
  expect(ids('over/under schwelle block-start')).toEqual(expect.arrayContaining(['ride-overunder-start', 'ride-overunder-31-start', 'ride-overunder-hard-start']));
  expect(ids('base')).toEqual(expect.arrayContaining(['ride-base-start', 'run-long-mid']));
  expect(ids('vo2max block-ende')).toEqual(expect.arrayContaining(['ride-vo2-4-end', 'run-vo2-1000-end']));
  expect(ids('vo2max block-ende')).not.toContain('ride-vo2-4-start');
  expect(ids('4x4')).toEqual(expect.arrayContaining(['ride-vo2-4-mid', 'ride-hardstart-4-start', 'ride-vo2-attack-start']));
  expect(ids('4x4')).not.toContain('ride-vo2-4-start');
  expect(ids('hard start block-ende')).toEqual(['ride-hardstart-4-end', 'ride-hardstart-5-end']);
  expect(ids('vo₂ 45/15')).toHaveLength(3);
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
  expect(titles()).toEqual(expect.arrayContaining(['6 × 4 min VO2max', '3 × 11 × 30/15 s']));
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
