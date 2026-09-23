import { collectDroppedFiles, prepareFiles, runImportQueue, uploadRecording } from './importQueue';

const file = name => new File(['FIT'], name);
const entry = name => ({ isFile: true, fullPath: `/export/${name}`, file: resolve => resolve(file(name)) });
const directory = (chunks, fullPath = '/export') => ({
  isDirectory: true, fullPath,
  createReader: () => { let offset = 0; return { readEntries: resolve => resolve(chunks[offset++] || []) }; },
});

test('drops include all 107 files across directory chunks and nested directories', async () => {
  const root = directory([
    Array.from({ length: 100 }, (_, i) => entry(`${i}.fit.gz`)),
    [directory([Array.from({ length: 7 }, (_, i) => entry(`nested/${100 + i}.FIT`))])],
  ]);
  const files = await collectDroppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => root }], files: [] });
  expect(files).toHaveLength(107);
  expect(files[106].path).toBe('export/nested/106.FIT');
  expect(prepareFiles(files).every(row => row.status === 'pending')).toBe(true);
});

test('file-only drop fallback retains every selected file', async () => {
  const selected = [file('one.fit'), file('two.FIT.gz'), file('three.tcx')];
  expect(await collectDroppedFiles({ files: selected })).toEqual(selected);
  expect(await collectDroppedFiles({ items: selected.map(f => ({ kind: 'file', getAsFile: () => f })), files: selected })).toEqual(selected);
});

test('unreadable folders report an error rather than silently importing a partial list', async () => {
  const bad = { isDirectory: true, createReader: () => ({ readEntries: (resolve, reject) => reject(new Error('denied')) }) };
  await expect(collectDroppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => bad }] })).rejects.toThrow('denied');
});

test('unsupported files and oversized files stay visible as skipped', () => {
  const rows = prepareFiles([file('ride.FIT.GZ'), file('workouts.csv'), file('export.zip'), { name: 'big.fit', size: 51 * 1024 * 1024 }]);
  expect(rows.map(row => row.status)).toEqual(['pending', 'skipped', 'skipped', 'skipped']);
  expect(rows[2].message).toContain('entpacken');
});

test('serial queue continues after failures and duplicates without reimporting completed rows', async () => {
  const rows = prepareFiles([file('good.fit'), file('copy.fit'), file('bad.fit'), file('last.fit'), file('readme.txt')]);
  const upload = jest.fn()
    .mockResolvedValueOnce({ status: 'imported', activity: { id: 'one' } })
    .mockResolvedValueOnce({ status: 'duplicate', activityId: 'one' })
    .mockRejectedValueOnce(new Error('Invalid FIT'))
    .mockResolvedValueOnce({ status: 'imported', activity: { id: 'two' } });
  const onImported = jest.fn();
  const onUpdate = (id, update) => Object.assign(rows[id], update);
  await runImportQueue(rows, { upload, onUpdate, onImported });
  expect(rows.map(row => row.status)).toEqual(['imported', 'duplicate', 'error', 'imported', 'skipped']);
  expect(onImported.mock.calls.map(([activity]) => activity.id)).toEqual(['one', 'two']);
  await runImportQueue(rows, { upload, onUpdate, onImported });
  expect(upload).toHaveBeenCalledTimes(4);
});

test('stop finishes the active file and leaves pending files resumable', async () => {
  const rows = prepareFiles([file('a.fit'), file('b.fit')]);
  let stopped = false;
  const upload = jest.fn(async () => { stopped = true; return { status: 'imported', activity: { id: 'a' } }; });
  const onUpdate = (id, update) => Object.assign(rows[id], update);
  await runImportQueue(rows, { upload, onUpdate, onImported: () => {}, shouldStop: () => stopped });
  expect(rows.map(row => row.status)).toEqual(['imported', 'pending']);
  expect(upload).toHaveBeenCalledTimes(1);
});

test('upload uses summary responses and recognizes duplicates and server errors', async () => {
  const previous = global.fetch;
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'new' }) })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ existing_id: 'old' }) })
    .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'Corrupt FIT' }) });
  try {
    expect((await uploadRecording(file('a.fit'), 'http://localhost:5000')).status).toBe('imported');
    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:5000/api/upload?summary=1');
    expect(global.fetch.mock.calls[0][1].body.get('file').name).toBe('a.fit');
    expect((await uploadRecording(file('a.fit'), '')).status).toBe('duplicate');
    await expect(uploadRecording(file('a.fit'), '')).rejects.toThrow('Corrupt FIT');
  } finally { global.fetch = previous; }
});
