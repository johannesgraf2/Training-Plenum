import { activityFiles, readFolder } from './garminUsb';

const file = name => new File(['FIT'], name);
function folder(name, children) {
  const entries = Object.entries(children).map(([child, value]) => (value instanceof File
    ? { kind: 'file', name: child, getFile: async () => value }
    : folder(child, value)));
  return {
    kind: 'directory', name,
    async *values() { yield* entries; },
    async getDirectoryHandle(child) {
      const found = entries.find(entry => entry.name === child);
      if (!found) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      if (found.kind !== 'directory') throw Object.assign(new Error('file'), { name: 'TypeMismatchError' });
      return found;
    },
  };
}
const device = () => ({
  GARMIN: { Activity: { 'a.fit': file('a.fit'), 'b.fit': file('b.fit') }, Settings: { 'Settings.fit': file('Settings.fit') } },
});
const paths = files => files.map(item => item.path).sort();

test('keeps only the files of an Activity folder, or everything when there is none', () => {
  const picked = [{ file: file('a.fit'), path: 'GARMIN/Activity/a.fit' }, { file: file('s.fit'), path: 'GARMIN/Settings/s.fit' }];
  expect(paths(activityFiles(picked))).toEqual(['GARMIN/Activity/a.fit']);
  expect(paths(activityFiles([{ file: file('x.fit'), path: 'Kopie/x.fit' }]))).toEqual(['Kopie/x.fit']);
});

test('reads GARMIN/Activity whether the drive, the GARMIN folder or Activity itself was chosen', async () => {
  const drive = folder('EDGE', device());
  expect(paths(await readFolder(drive))).toEqual(['EDGE/GARMIN/Activity/a.fit', 'EDGE/GARMIN/Activity/b.fit']);
  expect(paths(await readFolder(folder('GARMIN', device().GARMIN)))).toEqual(['GARMIN/Activity/a.fit', 'GARMIN/Activity/b.fit']);
  expect(paths(await readFolder(folder('Activity', device().GARMIN.Activity)))).toEqual(['Activity/a.fit', 'Activity/b.fit']);
});

test('asks for read access again and refuses without it', async () => {
  const handle = folder('GARMIN', device().GARMIN);
  handle.queryPermission = jest.fn(async () => 'prompt');
  handle.requestPermission = jest.fn(async () => 'granted');
  expect(await readFolder(handle)).toHaveLength(2);
  handle.requestPermission = jest.fn(async () => 'denied');
  await expect(readFolder(handle)).rejects.toThrow('Kein Zugriff');
});
