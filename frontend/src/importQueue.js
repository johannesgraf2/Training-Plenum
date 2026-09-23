export const ACCEPTED_FILES = '.fit,.fit.gz,.gpx,.tcx';

export function prepareFiles(files) {
  return Array.from(files, (item, id) => {
    const file = item.file || item;
    const path = item.path || file.webkitRelativePath || file.name;
    let reason = '';
    if (!/\.(fit(?:\.gz)?|gpx|tcx)$/i.test(file.name)) {
      reason = /\.zip$/i.test(file.name) ? 'ZIP zuerst entpacken und den Ordner oder seine Dateien auswählen.' : 'Kein unterstütztes Aktivitätsformat.';
    } else if (file.size > 50 * 1024 * 1024) {
      reason = 'Datei größer als 50 MB.';
    }
    return { id, file, path, status: reason ? 'skipped' : 'pending', message: reason };
  });
}

// Snapshot handles inside the drop event; its data store closes after the handler.
export function collectDroppedFiles(transfer) {
  const items = Array.from(transfer.items || []).filter(item => item.kind === 'file');
  const roots = items.map(item => ({
    entry: item.getAsEntry?.() || item.webkitGetAsEntry?.(),
    file: item.getAsFile?.(),
  }));
  const fallback = Array.from(transfer.files || []);
  return (async () => {
    const files = [];
    async function walk(entry) {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        files.push({ file, path: entry.fullPath?.replace(/^\//, '') || file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        // Chromium returns directories in chunks of up to 100 entries.
        while (true) {
          const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!entries.length) break;
          for (const child of entries) await walk(child);
        }
      }
    }
    if (!roots.length) return fallback;
    for (const { entry, file } of roots) {
      if (entry) await walk(entry);
      else if (file) files.push(file);
    }
    return files;
  })();
}

export async function uploadRecording(file, apiBase) {
  const body = new FormData();
  body.append('file', file);
  let response;
  try {
    response = await fetch(`${apiBase}/api/upload?summary=1`, { method: 'POST', body });
  } catch (error) {
    throw new Error('Server nicht erreichbar. Bitte erneut versuchen.');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 409 && data.existing_id) {
    return { status: 'duplicate', activityId: data.existing_id, message: 'Bereits importiert; übersprungen.' };
  }
  if (!response.ok) throw new Error(data.error || `Import fehlgeschlagen (HTTP ${response.status}).`);
  if (!data.id) throw new Error('Unvollständige Serverantwort. Bitte erneut versuchen.');
  return { status: 'imported', activity: data, activityId: data.id, message: 'Gespeichert.' };
}

// One request at a time also prevents identical files in this queue racing a save.
export async function runImportQueue(rows, { upload, onUpdate, onImported, shouldStop = () => false }) {
  for (const row of rows) {
    if (shouldStop()) break;
    if (row.status !== 'pending') continue;
    onUpdate(row.id, { status: 'uploading', message: 'Wird importiert…' });
    let result;
    try {
      result = await upload(row.file);
    } catch (error) {
      result = { status: 'error', message: error.message || 'Import fehlgeschlagen.' };
    }
    onUpdate(row.id, result);
    if (result.activity) onImported(result.activity);
  }
}
