import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import WorkoutEditor from './WorkoutEditor';
import { intensityZone, toDraft, toWorkout, workoutOverview, workoutTotals } from './workoutModel';
import { applyCustomTemplate, createLibraryWorkout, customProfile, libraryKeyTarget, libraryPhases, libraryProfile, libraryTags, searchCustomTemplates, searchLibrary, workoutLibrary } from './workoutLibraryData';

let container, root, originalFetch;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; });
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
  expect(zones('ride-base-progressive-mid')).toEqual(['endurance']);
  expect(zones('ride-base-tempofinish-end')).toEqual(['endurance', 'tempo']);
  expect(zones('ride-base-durability-start')).toEqual(['endurance', 'threshold']);
  expect(zones('run-easy-progressive-end')).toEqual(['endurance']);
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

test('running and swimming offer VO2max, threshold, tempo and base progressions like cycling', () => {
  const families = (sport, tag) => new Set(workoutLibrary.filter(e => e.sport === sport && e.family && e.tags.includes(tag)).map(e => e.family)).size;
  for (const sport of ['run', 'swim']) {
    expect(families(sport, 'vo2max')).toBeGreaterThanOrEqual(families('ride', 'vo2max'));
    expect(families(sport, 'threshold')).toBeGreaterThanOrEqual(20);
    expect(families(sport, 'tempo')).toBeGreaterThanOrEqual(8);
    expect(families(sport, 'base')).toBeGreaterThanOrEqual(9);
  }
  const entry = id => workoutLibrary.find(e => e.id === id);
  const zones = id => [...new Set(libraryProfile(entry(id)).map(s => s.zone).filter(Boolean))];
  expect(zones('run-vo2-400-start')).toEqual(['vo2']);
  expect(zones('run-threshold-1000-mid')).toEqual(['threshold']);
  expect(zones('run-tempo-intervals-end')).toEqual(['tempo']);
  expect(zones('swim-vo2-100-start')).toEqual(['vo2']);
  expect(zones('swim-css-100-start')).toEqual(['threshold']);
  expect(zones('swim-tempo-200-start')).toEqual(['tempo']);
  expect(zones('swim-base-continuous-end')).toEqual(['endurance']);
  expect(libraryKeyTarget(entry('swim-vo2-100-start'))).toBe('CSS −4 s/100 m');
  expect(libraryKeyTarget(entry('swim-css-100-start'))).toBe('CSS-Tempo');
  // Swimming has no CSS setting: the offset goes into the step name, the watch gets no pace target.
  const swim = createLibraryWorkout(entry('swim-css-100-mid'), '2026-09-24', { ftp: 300, maxHr: 190 });
  expect(swim.sport).toBe('swim');
  expect(swim.steps[1]).toMatchObject({ kind: 'repeat', count: 12, steps: [
    { name: '100 m · CSS', duration: { type: 'distance', value: 100 }, target: { type: 'none' } },
    { intensity: 'recovery', duration: { type: 'time', value: 10 } }] });
  expect(searchLibrary({ query: 'css block-ende', sport: 'swim' }).map(e => e.id)).toContain('swim-css-100-end');
  expect(searchLibrary({ query: 'schwimmen vo2max' }).every(e => e.sport === 'swim')).toBe(true);
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

test('swimming workouts can be picked from the library and edited as pool sessions', () => {
  render({ maxHr: 190 });
  act(() => button('Beispiel-Einheiten durchsuchen').click());
  act(() => button('Schwimmen (').click());
  expect(container.querySelector('[aria-label="HFmax für Vorlagen"]')).toBeNull();
  expect(container.textContent).toContain('CSS-Tempo');
  act(() => container.querySelector('[aria-label="Vorlage 10 × 100 m CSS übernehmen"]').click());
  expect(container.querySelector('[aria-label="Workout-Sportart"]').value).toBe('swim');
  expect(container.querySelector('.workout-name input').value).toBe('10 × 100 m CSS');
  const targets = Array.from(container.querySelector('[aria-label="Schritt 2.1: Ziel"]').options).map(o => o.value);
  expect(targets).toEqual(['none', 'heart_rate']);
  expect(container.querySelector('.workout-overview').textContent).toContain('Schwimmstrecke');
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

const ownTemplate = (changes = {}) => ({ id: 'own-1', version: 1, name: 'Meine 4 × 8 min', sport: 'ride', notes: 'Mit Freunden',
  steps: [{ kind: 'step', name: 'Einfahren', intensity: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'power', low: 150, high: 150 } },
    { kind: 'repeat', count: 4, steps: [
      { kind: 'step', name: '', intensity: 'interval', duration: { type: 'time', value: 480 }, target: { type: 'power', low: 260, high: 270 } },
      { kind: 'step', name: '', intensity: 'recovery', duration: { type: 'time', value: 240 }, target: { type: 'none' } }] }], ...changes });

test('own templates get the training day, a zone profile and are found by name, note and sport', () => {
  const applied = applyCustomTemplate(ownTemplate(), '2026-10-01');
  expect(applied).not.toHaveProperty('id');
  expect(applied.date).toBe('2026-10-01');
  expect(toWorkout(toDraft(applied))).toEqual(applied);
  expect(customProfile(ownTemplate(), { ftp: 280 }).filter(s => s.zone).map(s => s.zone)).toEqual(Array(4).fill('threshold'));
  expect(customProfile(ownTemplate({ steps: [] }))).toEqual([]);
  const run = ownTemplate({ id: 'own-2', name: 'Langer Lauf', sport: 'run', notes: '' });
  expect(searchCustomTemplates([ownTemplate(), run], { query: 'freunden', sport: 'ride' }).map(t => t.id)).toEqual(['own-1']);
  expect(searchCustomTemplates([ownTemplate(), run], { query: 'lauf', sport: 'run' }).map(t => t.id)).toEqual(['own-2']);
  expect(searchCustomTemplates([ownTemplate(), run], { query: 'vo2', sport: 'ride' })).toEqual([]);
});

test('a built workout is saved as a template without changing the saved workout', async () => {
  const onSaved = jest.fn();
  global.fetch = jest.fn(async (_, request) => ({ ok: true, json: async () => ({ ...JSON.parse(request.body), id: 'own-1' }) }));
  render({ onSaved });
  act(() => Simulate.change(container.querySelector('.workout-name input'), { target: { value: 'Meine Intervalle' } }));
  await act(async () => button('Als Vorlage speichern').click());
  expect(global.fetch.mock.calls[0][0]).toBe('/api/workout-templates');
  expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).name).toBe('Meine Intervalle');
  expect(container.querySelector('[role="status"]').textContent).toContain('Meine Vorlagen');
  expect(onSaved).not.toHaveBeenCalled();
  expect(container.querySelector('.workout-save-state').textContent).toBe('Ungespeicherte Änderungen');
});

test('own templates appear in the library next to the examples, apply to the chosen day and can be deleted', async () => {
  global.fetch = jest.fn(async (url, request) => request?.method === 'DELETE' ? { ok: true, status: 204 }
    : { ok: true, json: async () => [ownTemplate(), ownTemplate({ id: 'own-2', name: 'Langer Lauf', sport: 'run' })] });
  render({ date: '2026-10-03' });
  await act(async () => button('Beispiel-Einheiten durchsuchen').click());
  expect(global.fetch.mock.calls[0][0]).toBe('/api/workout-templates');
  expect(container.querySelector('.library-header h3').textContent).toContain('2 eigene');
  const own = () => Array.from(container.querySelectorAll('[aria-label="Meine Vorlagen"] .library-card strong')).map(e => e.textContent);
  expect(own()).toEqual(['Meine 4 × 8 min']);
  expect(button('Rad (').textContent).toBe(`Rad (${workoutLibrary.filter(e => e.sport === 'ride').length + 1})`);
  // Tag filters only apply to the examples.
  act(() => button('VO2max').click());
  expect(own()).toEqual([]);
  act(() => button('Alle Typen').click());
  act(() => button('Löschen').click());
  expect(container.querySelector('.library-custom-confirm').textContent).toContain('Vorlage löschen?');
  act(() => button('Behalten').click());
  act(() => container.querySelector('[aria-label="Vorlage Meine 4 × 8 min übernehmen"]').click());
  expect(container.querySelector('.library')).toBeNull();
  expect(container.querySelector('.workout-name input').value).toBe('Meine 4 × 8 min');
  expect(container.querySelector('input[type="date"]').value).toBe('2026-10-03');
  expect(container.querySelector('[aria-label="Block 2: Wiederholungen"]').value).toBe('4');
  await act(async () => button('Beispiel-Einheiten durchsuchen').click());
  act(() => button('Löschen').click());
  await act(async () => container.querySelector('.library-custom-confirm button:last-child').click());
  expect(global.fetch.mock.calls.find(([, r]) => r?.method === 'DELETE')[0]).toBe('/api/workout-templates/own-1');
  expect(own()).toEqual([]);
  expect(container.querySelector('.library-custom-hint')).not.toBeNull();
});

test('a library without reachable own templates still shows every example', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
  render();
  await act(async () => button('Beispiel-Einheiten durchsuchen').click());
  expect(container.querySelector('.library-custom-error').textContent).toContain('nicht geladen');
  expect(container.querySelector('.library-header h3').textContent).toBe(`${workoutLibrary.length} Beispiel-Einheiten`);
});
