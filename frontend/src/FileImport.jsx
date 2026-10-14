import React, { useEffect, useRef, useState } from 'react';
import { ACCEPTED_FILES, prepareFiles, runImportQueue, uploadRecording } from './importQueue';
import { activityFiles, canRememberFolder, readFolder, recallFolder, rememberFolder } from './garminUsb';
import './BatchImport.css';

const statusLabels = { pending: 'Bereit', uploading: 'Wird importiert…', imported: 'Neu', duplicate: 'Schon vorhanden', skipped: 'Übersprungen', error: 'Fehler' };

// Files and export folders, or (usb) the Activity folder of a Garmin connected by cable.
// selection: a promise of { files } or { error } from a drop, read once it changes.
export default function FileImport({ apiBase, usb = false, selection, onImported, onOpen, onClose, onBusyChange }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [remembered, setRemembered] = useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const stop = useRef(false);
  const locked = useRef(false);
  const working = busy || reading;

  useEffect(() => { onBusyChange?.(working); }, [working, onBusyChange]);
  useEffect(() => {
    if (!working) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);
  useEffect(() => {
    if (!usb) return undefined;
    let active = true;
    recallFolder().then(handle => { if (active && handle) setRemembered(handle); });
    return () => { active = false; };
  }, [usb]);

  const start = async (base, retry = false) => {
    locked.current = true;
    stop.current = false;
    setStopping(false);
    setBusy(true);
    const queue = base.map(row => retry && row.status === 'error' ? { ...row, status: 'pending', message: '' } : row);
    setRows(queue);
    try {
      await runImportQueue(queue, {
        upload: file => uploadRecording(file, apiBase),
        onUpdate: (id, update) => setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row)),
        onImported,
        shouldStop: () => stop.current,
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  // From the device the import starts right away; files and export folders are listed first.
  const choose = (files, empty = usb ? 'Keine Aktivitäten gefunden. Bitte den Ordner GARMIN auf dem Gerät wählen.' : 'Keine Dateien gefunden. Bitte „Ordner auswählen“ verwenden.') => {
    const prepared = prepareFiles(usb ? activityFiles(files) : files);
    setRows(prepared);
    setError(prepared.length ? '' : empty);
    if (usb && prepared.some(row => row.status === 'pending')) return start(prepared);
    locked.current = false;
  };
  // Reads a folder (from a drop or the device) while the dialog is locked against other selections.
  const read = async (load, failure) => {
    if (locked.current) return;
    locked.current = true;
    setReading(true);
    setError('');
    let files;
    try { files = await load(); } catch (e) {
      locked.current = false;
      setReading(false);
      if (e?.name !== 'AbortError') { setRows([]); setError(failure(e)); }
      return;
    }
    setReading(false);
    await choose(files);
  };

  useEffect(() => {
    if (!selection) return;
    read(async () => {
      const result = await selection;
      if (result.error) throw result.error;
      return result.files;
    }, () => `Der Ordner konnte nicht gelesen werden. Bitte „${usb ? 'Garmin-Ordner wählen' : 'Ordner auswählen'}“ verwenden.`);
  }, [selection]);

  const fromDevice = handle => read(async () => {
    const files = await readFolder(handle);
    setRemembered(handle);
    return files;
  }, e => e?.name === 'NotFoundError'
    ? 'Ordner nicht gefunden. Ist die Garmin angeschlossen? Sonst den Ordner neu wählen.'
    : e?.message || 'Der Ordner konnte nicht gelesen werden.');
  const pickFolder = async () => {
    if (!usb || !canRememberFolder()) { folderInput.current.click(); return; }
    let handle;
    try { handle = await window.showDirectoryPicker({ id: 'garmin-usb', mode: 'read' }); } catch { return; }
    await rememberFolder(handle);
    fromDevice(handle);
  };
  const fromInput = event => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!locked.current) { locked.current = true; choose(files, usb ? undefined : 'Der Ordner enthält keine Dateien.'); }
  };

  const counts = rows.reduce((totals, row) => ({ ...totals, [row.status]: (totals[row.status] || 0) + 1 }), {});
  const finished = rows.length - (counts.pending || 0) - (counts.uploading || 0);
  const processed = !!(counts.imported || counts.duplicate || counts.error);

  return <>
    <div className="batch-content">
      {usb ? <div className={`batch-drop hub-usb ${drag ? 'batch-drag' : ''}`} onDragOver={event => { event.preventDefault(); if (!working) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
        <ol className="hub-steps">
          <li>Garmin per USB-Kabel anschließen.</li>
          <li>Den Ordner <strong>GARMIN</strong> auf dem Gerät wählen. Gelesen wird nur <strong>GARMIN/Activity</strong>.</li>
          <li>Der Import startet sofort. Schon vorhandene Aktivitäten werden übersprungen.</li>
        </ol>
        <div className="batch-pickers">
          {remembered && <button type="button" className="batch-primary" disabled={working} onClick={() => fromDevice(remembered)}>{reading ? 'Gerät wird gelesen…' : `Erneut einlesen: ${remembered.name}`}</button>}
          <button type="button" className={remembered ? '' : 'batch-primary'} disabled={working} onClick={pickFolder}>{remembered ? 'Anderen Ordner wählen' : 'Garmin-Ordner wählen'}</button>
        </div>
        <input ref={folderInput} type="file" hidden multiple webkitdirectory="" directory="" aria-label="Garmin-Ordner auswählen" onChange={fromInput} />
        <p className="batch-formats">{canRememberFolder() ? 'Der Ordner wird gemerkt: Beim nächsten Mal reicht „Erneut einlesen“.' : 'In Chrome oder Edge merkt sich Training Plēnum den Ordner für das nächste Mal.'}</p>
      </div> : <div className={`batch-drop ${drag ? 'batch-drag' : ''}`} onDragOver={event => { event.preventDefault(); if (!working) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
        <span className="batch-folder" aria-hidden="true">↥</span>
        <h3>{reading ? 'Ordner wird gelesen…' : 'Dateien oder Ordner hier ablegen'}</h3>
        <p>Im Exportordner mit Strg+A alle Dateien markieren und gemeinsam hierher ziehen. Unterordner werden mitgelesen.</p>
        <div className="batch-pickers">
          <button type="button" disabled={working} onClick={() => fileInput.current.click()}>Dateien auswählen</button>
          <button type="button" disabled={working} onClick={() => folderInput.current.click()}>Ordner auswählen</button>
        </div>
        <input ref={fileInput} type="file" hidden multiple accept={ACCEPTED_FILES} aria-label="Aktivitätsdateien auswählen" onChange={fromInput} />
        <input ref={folderInput} type="file" hidden multiple webkitdirectory="" directory="" aria-label="Aktivitätsordner auswählen" onChange={fromInput} />
        <p className="batch-formats">FIT · FIT.GZ · GPX · TCX · bis 50 MB pro Datei. ZIP-Dateien zuerst entpacken.</p>
      </div>}
      {error && <p className="batch-error" role="alert">{error}</p>}
      {!!rows.length && <>
        <div className="batch-summary" role="status" aria-live="polite">
          <strong>{rows.length} Dateien</strong><span>{counts.pending || 0} bereit</span><span>{counts.imported || 0} neu</span><span>{counts.duplicate || 0} schon vorhanden</span><span>{counts.skipped || 0} übersprungen</span><span>{counts.error || 0} Fehler</span>
        </div>
        <progress aria-label="Importfortschritt" value={finished} max={rows.length} />
        <div className="batch-progress-label">{finished} von {rows.length} verarbeitet{busy ? ' · Import läuft' : stopping && counts.pending ? ' · Angehalten' : !counts.pending ? ' · Fertig' : ''}</div>
        <ul className="batch-files" aria-label="Dateien und Importergebnisse">{rows.map(row => <li key={row.id}>
          <div className="batch-file-info"><span className="batch-file-name" title={row.path}>{row.path}</span><small>{row.message || `${(row.file.size / 1024).toFixed(1)} KB`}</small></div>
          <div className="batch-file-result"><span className={`batch-status batch-${row.status}`}>{statusLabels[row.status]}</span>{row.activityId && <button type="button" disabled={working} onClick={() => onOpen(row.activityId)}>Ansehen</button>}</div>
        </li>)}</ul>
      </>}
      {usb
        ? <p className="batch-help">Zeigt der Rechner die Garmin nicht als Laufwerk an, den Ordner GARMIN/Activity zuerst auf den Rechner kopieren (auf dem Mac z. B. mit OpenMTP) und die Kopie wählen. Auf dem Gerät liegen meist nur die letzten Aktivitäten.</p>
        : <p className="batch-help">Passt für TrainingPeaks, den Garmin-Connect-Datenexport und die FIT- und GPX-Dateien im Ordner <strong>activities</strong> des Strava-Exports. Bereits vorhandene Aktivitäten werden übersprungen. Fehler in einer Datei stoppen den restlichen Import nicht.</p>}
    </div>
    {!!rows.length && <footer className="batch-footer">
      {busy ? <button type="button" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? 'Wird angehalten…' : 'Nach aktueller Datei stoppen'}</button> : <>
        {!!counts.error && <button type="button" onClick={() => start(rows, true)}>Fehler erneut versuchen</button>}
        {!!counts.pending && <button type="button" className="batch-primary" onClick={() => start(rows)}>{counts.pending} Dateien importieren</button>}
        <button type="button" className={counts.pending ? '' : 'batch-primary'} onClick={onClose}>{processed ? 'Aktivitäten anzeigen' : 'Schließen'}</button>
      </>}
    </footer>}
  </>;
}
