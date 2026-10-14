import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import FileImport from './FileImport';
import DataHub from './DataHub';

let container, root, originalFetch;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = global.fetch;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.fetch = originalFetch;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const button = label => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(label));
const sample = name => new File(['FIT'], name);
const garminOff = { ok: true, json: async () => ({ available: true, connected: false }) };
// Only uploads count; the data dialog also asks for the Garmin Connect state.
const uploads = () => global.fetch.mock.calls.filter(([url]) => url.includes('/api/upload'));

test('multiple-file selection imports successes, reports duplicates/errors, and retries only failures', async () => {
  const onImported = jest.fn();
  const onClose = jest.fn();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'new' }) })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ existing_id: 'old' }) })
    .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'Corrupt FIT' }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'retry' }) });
  act(() => root.render(<FileImport apiBase="" onImported={onImported} onClose={onClose} />));
  const input = container.querySelector('input[aria-label="Aktivitätsdateien auswählen"]');
  expect(input.multiple).toBe(true);
  expect(container.querySelector('input[webkitdirectory]')).not.toBeNull();
  act(() => Simulate.change(input, { target: { files: [sample('a.fit'), sample('b.FIT.gz'), sample('c.fit')] } }));
  await act(async () => { button('3 Dateien importieren').click(); });
  expect(container.querySelector('[role="status"]').textContent).toContain('1 neu1 schon vorhanden0 übersprungen1 Fehler');
  expect(container.textContent).toContain('Corrupt FIT');
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { button('Fehler erneut versuchen').click(); });
  expect(global.fetch).toHaveBeenCalledTimes(4);
  expect(onImported).toHaveBeenCalledTimes(2);
  expect(container.querySelector('progress').value).toBe(3);
});

test('dragging files into the data dialog opens the file view and stages the group without uploading', async () => {
  global.fetch = jest.fn(async () => garminOff);
  await act(async () => root.render(<DataHub apiBase="" onClose={() => {}} />));
  expect(container.querySelector('#hub-title').textContent).toBe('Daten & Geräte');
  await act(async () => { Simulate.drop(container.querySelector('.batch-backdrop'), { dataTransfer: { files: [sample('one.fit'), sample('two.fit.gz')] } }); });
  expect(container.querySelector('#hub-title').textContent).toBe('Dateien & Exporte');
  expect(button('2 Dateien importieren')).toBeDefined();
  expect(uploads()).toHaveLength(0);
});

test('files dropped on the main page populate the newly opened dialog', async () => {
  global.fetch = jest.fn(async () => garminOff);
  const initialSelection = Promise.resolve({ files: [sample('one.fit'), sample('two.fit.gz')] });
  await act(async () => root.render(<DataHub apiBase="" initialView="files" initialSelection={initialSelection} onClose={() => {}} />));
  expect(button('2 Dateien importieren')).toBeDefined();
  expect(button('Dateien auswählen').disabled).toBe(false);
});

test('from a Garmin per USB only GARMIN/Activity is read, and the import starts right away', async () => {
  const onImported = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'ride' }) }));
  await act(async () => root.render(<FileImport apiBase="" usb onImported={onImported} onClose={() => {}} />));
  expect(container.textContent).toContain('GARMIN/Activity');
  const input = container.querySelector('input[aria-label="Garmin-Ordner auswählen"]');
  await act(async () => Simulate.change(input, { target: { files: [
    { file: sample('2026-10-13-07-12-33.fit'), path: 'GARMIN/Activity/2026-10-13-07-12-33.fit' },
    { file: sample('Settings.fit'), path: 'GARMIN/Settings/Settings.fit' },
    { file: sample('Monitor.fit'), path: 'GARMIN/Monitor/M1.fit' },
  ] } }));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(onImported).toHaveBeenCalledWith({ id: 'ride' });
  expect(container.querySelector('[role="status"]').textContent).toContain('1 Dateien');
  expect(container.textContent).toContain('GARMIN/Activity/2026-10-13-07-12-33.fit');
  expect(container.textContent).not.toContain('Settings.fit');
  expect(button('Aktivitäten anzeigen')).toBeDefined();
});

test('a USB folder without activities explains what to choose', async () => {
  global.fetch = jest.fn();
  await act(async () => root.render(<FileImport apiBase="" usb onClose={() => {}} />));
  await act(async () => Simulate.change(container.querySelector('input[aria-label="Garmin-Ordner auswählen"]'), { target: { files: [] } }));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Ordner GARMIN');
  expect(global.fetch).not.toHaveBeenCalled();
});
