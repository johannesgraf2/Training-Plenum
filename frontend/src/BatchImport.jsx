import React, { useEffect, useRef, useState } from 'react';
import { ACCEPTED_FILES, collectDroppedFiles, prepareFiles, runImportQueue, uploadRecording } from './importQueue';
import './BatchImport.css';

const statusLabels = { pending: 'Bereit', uploading: 'Importiert…', imported: 'Importiert', duplicate: 'Duplikat', skipped: 'Übersprungen', error: 'Fehler' };

export default function BatchImport({ apiBase, onImported, onClose, onLegacy, onOpen, initialSelection }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const stop = useRef(false);
  const locked = useRef(false);
  const closeButton = useRef(null);
  const working = busy || reading;

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    return () => previousFocus?.focus();
  }, []);
  useEffect(() => {
    if (!initialSelection) return;
    let active = true;
    locked.current = true;
    setReading(true);
    initialSelection.then(result => {
      if (!active) return;
      if (result.error) setError('Der Ordner konnte nicht gelesen werden. Bitte „Ordner auswählen“ verwenden.');
      else chooseInitial(result.files);
      locked.current = false;
      setReading(false);
    });
    function chooseInitial(files) {
      setRows(prepareFiles(files));
      if (!files.length) setError('Keine Dateien gefunden. Bitte „Ordner auswählen“ verwenden.');
    }
    return () => { active = false; };
  }, [initialSelection]);
  useEffect(() => {
    if (!working) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);

  const choose = files => {
    if (locked.current) return;
    setRows(prepareFiles(files));
    setError(files.length ? '' : 'Der Ordner enthält keine Dateien.');
  };
  const drop = async event => {
    event.preventDefault();
    event.stopPropagation();
    setDrag(false);
    if (locked.current) return;
    locked.current = true;
    setReading(true);
    setError('');
    try {
      const files = await collectDroppedFiles(event.dataTransfer);
      setRows(prepareFiles(files));
      if (!files.length) setError('Keine Dateien gefunden. Bitte „Ordner auswählen“ verwenden.');
    } catch (error) {
      setError('Der Ordner konnte nicht vollständig gelesen werden. Bitte „Ordner auswählen“ verwenden.');
      setRows([]);
    } finally {
      locked.current = false;
      setReading(false);
    }
  };

  const start = async (retry = false) => {
    if (locked.current) return;
    locked.current = true;
    stop.current = false;
    setStopping(false);
    setBusy(true);
    const queue = rows.map(row => retry && row.status === 'error' ? { ...row, status: 'pending', message: '' } : row);
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
  const counts = rows.reduce((totals, row) => ({ ...totals, [row.status]: (totals[row.status] || 0) + 1 }), {});
  const finished = rows.length - (counts.pending || 0) - (counts.uploading || 0);
  const processed = !!(counts.imported || counts.duplicate || counts.error);
  const handleKeys = event => {
    if (event.key === 'Escape' && !working) onClose();
    if (event.key !== 'Tab') return;
    const elements = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), a[href]')).filter(element => !element.hidden);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="batch-backdrop" onDragOver={event => event.preventDefault()} onDrop={drop}>
    <section className="batch-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-title" onKeyDown={handleKeys}>
      <header className="batch-header"><div><h2 id="batch-title">Aktivitäten importieren</h2><p>Eine Datei, alle Dateien oder einen ganzen Ordner.</p></div><button ref={closeButton} type="button" className="batch-close" aria-label="Import schließen" disabled={working} onClick={onClose}>×</button></header>
      <div className="batch-content">
        <div className={`batch-drop ${drag ? 'batch-drag' : ''}`} onDragOver={event => { event.preventDefault(); if (!working) setDrag(true); }} onDragLeave={() => setDrag(false)}>
          <span className="batch-folder" aria-hidden="true">↥</span>
          <h3>{reading ? 'Ordner wird gelesen…' : 'Dateien oder Ordner hier ablegen'}</h3>
          <p>Im Exportordner mit Strg+A alle Dateien markieren und gemeinsam hierher ziehen. Unterordner werden mitgelesen.</p>
          <div className="batch-pickers">
            <button type="button" disabled={working} onClick={() => fileInput.current.click()}>Dateien auswählen</button>
            <button type="button" disabled={working} onClick={() => folderInput.current.click()}>Ordner auswählen</button>
          </div>
          <input ref={fileInput} type="file" hidden multiple accept={ACCEPTED_FILES} aria-label="Aktivitätsdateien auswählen" onChange={event => { choose(Array.from(event.target.files)); event.target.value = ''; }} />
          <input ref={folderInput} type="file" hidden multiple webkitdirectory="" directory="" aria-label="Aktivitätsordner auswählen" onChange={event => { choose(Array.from(event.target.files)); event.target.value = ''; }} />
          <p className="batch-formats">FIT · FIT.GZ · GPX · TCX · bis 50 MB pro Datei. ZIP-Dateien zuerst entpacken.</p>
        </div>
        {error && <p className="batch-error" role="alert">{error}</p>}
        {!!rows.length && <>
          <div className="batch-summary" role="status" aria-live="polite">
            <strong>{rows.length} Dateien</strong><span>{counts.pending || 0} bereit</span><span>{counts.imported || 0} importiert</span><span>{counts.duplicate || 0} Duplikate</span><span>{counts.skipped || 0} übersprungen</span><span>{counts.error || 0} Fehler</span>
          </div>
          <progress aria-label="Importfortschritt" value={finished} max={rows.length} />
          <div className="batch-progress-label">{finished} von {rows.length} verarbeitet{busy ? ' · Import läuft' : stopping && counts.pending ? ' · Angehalten' : !counts.pending ? ' · Fertig' : ''}</div>
          <ul className="batch-files" aria-label="Dateien und Importergebnisse">{rows.map(row => <li key={row.id}>
            <div className="batch-file-info"><span className="batch-file-name" title={row.path}>{row.path}</span><small>{row.message || `${(row.file.size / 1024).toFixed(1)} KB`}</small></div>
            <div className="batch-file-result"><span className={`batch-status batch-${row.status}`}>{statusLabels[row.status]}</span>{row.activityId && <button type="button" disabled={working} onClick={() => onOpen(row.activityId)}>Ansehen</button>}</div>
          </li>)}</ul>
        </>}
        <p className="batch-help">Bereits vorhandene Aktivitäten werden übersprungen. Fehler in einer Datei stoppen den restlichen Import nicht.</p>
      </div>
      <footer className="batch-footer">
        {busy ? <button type="button" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? 'Wird angehalten…' : 'Nach aktueller Datei stoppen'}</button> : <>
          {!rows.length && <button type="button" className="batch-link" disabled={reading} onClick={onLegacy}>Manuelle Eingabe / CSV</button>}
          {!!counts.error && <button type="button" onClick={() => start(true)}>Fehler erneut versuchen</button>}
          {!!counts.pending && <button type="button" className="batch-primary" onClick={() => start()}>{counts.pending} Dateien importieren</button>}
          {!!rows.length && <button type="button" className={counts.pending ? '' : 'batch-primary'} onClick={onClose}>{processed ? 'Aktivitäten anzeigen' : 'Schließen'}</button>}
        </>}
      </footer>
    </section>
  </div>;
}
