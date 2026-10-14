// Reading activities from a Garmin connected by USB. The device holds its recordings in GARMIN/Activity;
// the other folders (Settings, Courses, Monitor …) contain FIT files that are no activities.

const parentFolder = path => path.split('/').slice(-2, -1)[0] || '';

// Keeps only the files in an Activity folder, if the chosen folder has one; otherwise everything.
export function activityFiles(files) {
  const items = Array.from(files, item => ({ file: item.file || item, path: item.path || item.webkitRelativePath || item.name }));
  const inActivity = items.filter(item => parentFolder(item.path).toLowerCase() === 'activity');
  return inActivity.length ? inActivity : items;
}

// Chromium browsers can keep a folder handle, so a connected device needs a single click next time.
export const canRememberFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';

const STORE = 'handles';
const KEY = 'garmin-usb';
function withStore(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('training-plenum', 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = action(open.result.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => { resolve(request.result); open.result.close(); };
      request.onerror = () => { reject(request.error); open.result.close(); };
    };
  });
}
export const rememberFolder = handle => withStore('readwrite', store => store.put(handle, KEY)).catch(() => {});
export const recallFolder = () => (canRememberFolder() ? withStore('readonly', store => store.get(KEY)).catch(() => null) : Promise.resolve(null));
export const forgetFolder = () => withStore('readwrite', store => store.delete(KEY)).catch(() => {});

async function walk(handle, prefix, files) {
  for await (const entry of handle.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === 'file') files.push({ file: await entry.getFile(), path });
    else await walk(entry, path, files);
  }
}

// Reads GARMIN/Activity from a folder handle (the GARMIN folder, the drive itself or Activity).
// Throws a NotFoundError when the device is no longer connected.
export async function readFolder(handle) {
  if (handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted' && await handle.requestPermission({ mode: 'read' }) !== 'granted') {
    throw new Error('Kein Zugriff auf den Ordner. Bitte erneut erlauben.');
  }
  for (const path of [['Activity'], ['GARMIN', 'Activity']]) {
    try {
      let folder = handle;
      for (const name of path) folder = await folder.getDirectoryHandle(name);
      const files = [];
      await walk(folder, `${handle.name}/${path.join('/')}`, files);
      return files;
    } catch (error) {
      if (error.name !== 'NotFoundError' && error.name !== 'TypeMismatchError') throw error;
    }
  }
  const files = [];
  await walk(handle, handle.name, files);
  return activityFiles(files);
}
