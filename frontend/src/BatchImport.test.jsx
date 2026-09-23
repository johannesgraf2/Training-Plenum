import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import BatchImport from './BatchImport';

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

test('multiple-file selection imports successes, reports duplicates/errors, and retries only failures', async () => {
  const onImported = jest.fn();
  const onClose = jest.fn();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'new' }) })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ existing_id: 'old' }) })
    .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'Corrupt FIT' }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'retry' }) });
  act(() => root.render(<BatchImport apiBase="" onImported={onImported} onClose={onClose} />));
  const input = container.querySelector('input[aria-label="Aktivitätsdateien auswählen"]');
  expect(input.multiple).toBe(true);
  expect(container.querySelector('input[webkitdirectory]')).not.toBeNull();
  act(() => Simulate.change(input, { target: { files: [sample('a.fit'), sample('b.FIT.gz'), sample('c.fit')] } }));
  await act(async () => { button('3 Dateien importieren').click(); });
  expect(container.querySelector('[role="status"]').textContent).toContain('1 importiert1 Duplikate0 übersprungen1 Fehler');
  expect(container.textContent).toContain('Corrupt FIT');
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { button('Fehler erneut versuchen').click(); });
  expect(global.fetch).toHaveBeenCalledTimes(4);
  expect(onImported).toHaveBeenCalledTimes(2);
  expect(container.querySelector('progress').value).toBe(3);
});

test('dragging files into the dialog stages the whole group without uploading automatically', async () => {
  global.fetch = jest.fn();
  act(() => root.render(<BatchImport apiBase="" onImported={() => {}} onClose={() => {}} />));
  await act(async () => { Simulate.drop(container.querySelector('.batch-backdrop'), { dataTransfer: { files: [sample('one.fit'), sample('two.fit.gz')] } }); });
  expect(button('2 Dateien importieren')).toBeDefined();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('files dropped on the main page populate the newly opened dialog', async () => {
  const initialSelection = Promise.resolve({ files: [sample('one.fit'), sample('two.fit.gz')] });
  await act(async () => root.render(<BatchImport apiBase="" initialSelection={initialSelection} onClose={() => {}} />));
  expect(button('2 Dateien importieren')).toBeDefined();
  expect(button('Dateien auswählen').disabled).toBe(false);
});
