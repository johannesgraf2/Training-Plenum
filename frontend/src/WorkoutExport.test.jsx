import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import BatchImport from './BatchImport';
import { newWorkout } from './workoutModel';

let container, root, originalFetch, clicked;
const plan = (id, date, name) => ({ ...newWorkout(date), id, name });
const workouts = [
  plan('past', '2026-09-20', 'Vorbei'),
  plan('later', '2026-10-05', 'Später'),
  plan('today', '2026-09-24', 'Heute'),
  plan('soon', '2026-09-27', 'Bald'),
];
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-24T12:00:00'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, blob: async () => new Blob(['ZIP']) }));
  global.URL.createObjectURL = jest.fn(() => 'blob:export');
  global.URL.revokeObjectURL = jest.fn();
  clicked = [];
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.download); });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT;
  jest.useRealTimers(); jest.restoreAllMocks();
});
const button = label => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(label));
const rows = () => Array.from(container.querySelectorAll('.export-list li')).map(li => [li.querySelector('.batch-file-name').textContent, li.querySelector('input').checked]);
const openExport = onClose => {
  act(() => root.render(<BatchImport apiBase="http://api" workouts={workouts} onClose={onClose || (() => {})} />));
  act(() => button('Exportieren').click());
};

test('export lists upcoming workouts by date with the next seven days ticked and downloads them as one ZIP', async () => {
  openExport();
  expect(container.querySelector('#batch-title').textContent).toBe('Workouts exportieren');
  expect(rows()).toEqual([['Heute', true], ['Bald', true], ['Später', false]]);
  await act(async () => button('2 Workouts als ZIP').click());
  expect(global.fetch).toHaveBeenCalledWith('http://api/api/workouts/export-selection', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['today', 'soon'] }) }));
  expect(clicked).toEqual(['trainhub_2026-09-24_2026-09-27.zip']);
  expect(container.querySelector('[role="status"]').textContent).toContain('ZIP heruntergeladen');
});

test('presets, single picks and past workouts change the selection; one workout downloads as a FIT file', async () => {
  openExport();
  act(() => button('Alle kommenden').click());
  expect(rows().every(([, checked]) => checked)).toBe(true);
  act(() => button('Keine').click());
  expect(button('Workouts auswählen').disabled).toBe(true);
  act(() => container.querySelector('.export-past input').click());
  expect(rows()[0]).toEqual(['Vorbei', false]);
  act(() => container.querySelectorAll('.export-list input')[0].click());
  await act(async () => button('1 Workout als FIT').click());
  expect(global.fetch.mock.calls[0][0]).toBe('http://api/api/workouts/export');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).id).toBe('past');
  expect(clicked).toEqual(['2026-09-20_Vorbei.fit']);
});

test('a failed export keeps the selection and shows the server message; closing without an import reports nothing imported', async () => {
  const onClose = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Mindestens ein ausgewähltes Workout existiert nicht mehr.' }) }));
  openExport(onClose);
  await act(async () => button('2 Workouts als ZIP').click());
  expect(container.querySelector('[role="alert"]').textContent).toBe('Mindestens ein ausgewähltes Workout existiert nicht mehr.');
  expect(rows().filter(([, checked]) => checked)).toHaveLength(2);
  act(() => button('Schließen').click());
  expect(onClose).toHaveBeenCalledWith(false);
});

test('an outdated backend without the export route asks for a restart instead of showing a bare status code', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 405, json: async () => { throw new SyntaxError('HTML'); } }));
  openExport();
  await act(async () => button('2 Workouts als ZIP').click());
  expect(container.querySelector('[role="alert"]').textContent).toBe('Der Server kennt diesen Export noch nicht. Bitte das Backend neu starten.');
});
