import React, { useCallback, useEffect, useRef, useState } from 'react';
import FileImport from './FileImport';
import GarminConnect, { monthText, syncGarmin, useGarminStatus } from './GarminSync';
import ManualEntry from './ManualEntry';
import WorkoutExport from './WorkoutExport';
import { collectDroppedFiles, resultText } from './importQueue';
import { localDate } from './workoutModel';
import './BatchImport.css';
import './DataHub.css';

const VIEWS = {
  overview: ['Daten & Geräte', 'Aktivitäten holen und geplante Workouts aufs Gerät bringen.'],
  garmin: ['Garmin Connect', 'Neue Aktivitäten kommen automatisch als originale FIT-Datei, geplante Einheiten gehen in deinen Garmin-Kalender. Ohne Export und USB-Kabel.'],
  usb: ['Garmin per USB', 'Aktivitäten direkt vom angeschlossenen Gerät holen.'],
  files: ['Dateien & Exporte', 'Eine Datei, alle Dateien oder einen ganzen Exportordner.'],
  manual: ['Manuell eintragen', 'Eine Einheit ohne Aufzeichnung, z. B. Krafttraining.'],
  export: ['Workouts per USB', 'Geplante Workouts als FIT-Dateien für deine Garmin.'],
};
const ORIGINS = { garmin: 'Garmin Connect', file: 'Datei / USB', manual: 'Manuell' };

export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  const minutes = Math.round((now - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  if (minutes < 24 * 60) return `vor ${Math.round(minutes / 60)} h`;
  return `am ${new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
}

// The one-line Garmin Connect state for the overview (and the header button).
export function garminSummary(status) {
  if (!status) return { text: 'Status wird geladen…' };
  if (!status.available) return { text: 'Auf diesem Server nicht verfügbar' };
  if (!status.connected) return { text: 'Nicht verbunden. Neue Aktivitäten kommen dann automatisch, ohne Kabel.' };
  if (status.needsLogin) return { text: 'Anmeldung abgelaufen. Bitte neu anmelden.', tone: 'bad' };
  if (status.history?.running) return { text: status.history.through ? `Ältere Aktivitäten werden nachgeladen, geprüft bis ${monthText(status.history.through)}` : 'Ältere Aktivitäten werden nachgeladen…' };
  if (status.syncing) return { text: status.progress ? `Abgleich läuft: ${status.progress.done} von ${status.progress.total}` : 'Abgleich läuft…' };
  if (status.lastError) return { text: status.lastError, tone: 'bad' };
  return { text: status.lastSyncAt ? `Zuletzt ${timeAgo(status.lastSyncAt)}: ${resultText(status.lastResult)}` : 'Verbunden, noch kein Abgleich', tone: 'ok' };
}

function Source({ title, text, tone, onOpen, action }) {
  return <li className="hub-source">
    <button type="button" className="hub-source-main" onClick={onOpen}>
      <span><strong>{title}</strong><span className={tone ? `hub-${tone}` : undefined}>{text}</span></span>
      <span className="hub-chevron" aria-hidden="true">›</span>
    </button>
    {action}
  </li>;
}

function Overview({ apiBase, garmin, setGarmin, workouts, activities, go, onOpen }) {
  const [syncError, setSyncError] = useState('');
  const sync = async () => {
    setSyncError('');
    try { setGarmin(await syncGarmin(apiBase)); } catch (e) { setSyncError(e.message); }
  };
  const summary = garminSummary(garmin);
  const ready = garmin?.connected && !garmin.needsLogin;
  const upcoming = workouts.filter(w => w.date >= localDate()).length;
  const recent = activities.filter(a => a.importedAt).sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 5);
  const push = !garmin?.connected ? 'Erst Garmin Connect verbinden.'
    : garmin.pushWorkouts ? `An: ${garmin.workouts.scheduled} ${garmin.workouts.scheduled === 1 ? 'Einheit' : 'Einheiten'} im Garmin-Kalender` : 'Aus. Einschalten unter Garmin Connect.';

  return <div className="batch-content hub-overview">
    <section aria-labelledby="hub-in">
      <h3 id="hub-in">Aktivitäten holen</h3>
      <ul className="hub-sources">
        <Source title="Garmin Connect" text={summary.text} tone={summary.tone} onOpen={() => go('garmin')}
          action={garmin?.available && (ready
            ? <button type="button" className="hub-action" disabled={garmin.syncing || garmin.workouts?.pushing} onClick={sync}>{garmin.syncing ? 'Läuft…' : 'Jetzt abgleichen'}</button>
            : <button type="button" className="hub-action batch-primary" onClick={() => go('garmin')}>{garmin.connected ? 'Neu anmelden' : 'Verbinden'}</button>)} />
        <Source title="Garmin per USB" text="Gerät per Kabel anschließen und den Ordner GARMIN wählen." onOpen={() => go('usb')} />
        <Source title="Dateien & Exporte" text="FIT, GPX, TCX oder ganze Exportordner von TrainingPeaks, Garmin oder Strava." onOpen={() => go('files')} />
        <Source title="Manuell eintragen" text="Eine Einheit ohne Aufzeichnung." onOpen={() => go('manual')} />
      </ul>
      {syncError && <p role="alert" className="batch-error">{syncError}</p>}
    </section>
    <section aria-labelledby="hub-out">
      <h3 id="hub-out">Workouts aufs Gerät</h3>
      <ul className="hub-sources">
        <Source title="Über Garmin Connect (automatisch)" text={push} tone={garmin?.pushWorkouts ? 'ok' : undefined} onOpen={() => go('garmin')} />
        <Source title="Per USB als FIT-Datei" text={`${upcoming} ${upcoming === 1 ? 'kommendes Workout' : 'kommende Workouts'} herunterladen und nach GARMIN/NewFiles kopieren.`} onOpen={() => go('export')} />
      </ul>
    </section>
    {!!recent.length && <section aria-labelledby="hub-recent">
      <h3 id="hub-recent">Zuletzt importiert</h3>
      <ul className="hub-recent">{recent.map(activity => <li key={activity.id}>
        <button type="button" onClick={() => onOpen(activity.id)}>
          <span className="batch-file-name">{activity.title}</span>
          <small>{[new Date(activity.date).toLocaleDateString('de-DE'), ORIGINS[activity.origin], `importiert ${timeAgo(activity.importedAt)}`].filter(Boolean).join(' · ')}</small>
        </button>
      </li>)}</ul>
    </section>}
  </div>;
}

// The single place for data: Garmin Connect, Garmin per USB, files, manual entries and workouts for the device.
// onClose(imported) tells the app whether new activities arrived, so it can show them.
export default function DataHub({ apiBase, initialView = 'overview', initialSelection = null, activities = [], workouts = [], workoutLoadError = '',
  onImported, onSynced, onOpen, onClose }) {
  const [view, setView] = useState(initialView);
  const [selection, setSelection] = useState(initialSelection);
  const [busy, setBusy] = useState(false);
  const imported = useRef(false);
  const dialog = useRef(null);
  const synced = useCallback(() => { imported.current = true; onSynced?.(); }, [onSynced]);
  const garmin = useGarminStatus(apiBase, synced);
  const added = useCallback(activity => { imported.current = true; onImported?.(activity); }, [onImported]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.querySelector('.batch-close')?.focus();
    return () => previousFocus?.focus();
  }, []);

  const go = next => { setSelection(null); setBusy(false); setView(next); };
  const close = () => { if (!busy) onClose(imported.current); };
  const open = id => { if (!busy) onOpen(id); };
  const drop = event => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || !Array.from(event.dataTransfer.types || ['Files']).includes('Files')) return;
    setSelection(collectDroppedFiles(event.dataTransfer).then(files => ({ files }), error => ({ error })));
    if (view !== 'usb') setView('files');
  };
  const keys = event => {
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab') return;
    const elements = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), a[href]')).filter(element => !element.hidden);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const [title, subtitle] = VIEWS[view];
  return <div className="batch-backdrop" onDragOver={event => event.preventDefault()} onDrop={drop}>
    <section ref={dialog} className="batch-dialog hub-dialog" role="dialog" aria-modal="true" aria-labelledby="hub-title" onKeyDown={keys}>
      <header className="batch-header">
        <div>
          {view !== 'overview' && <button type="button" className="hub-back" disabled={busy} onClick={() => go('overview')}>‹ Daten &amp; Geräte</button>}
          <h2 id="hub-title">{title}</h2><p>{subtitle}</p>
        </div>
        <button type="button" className="batch-close" aria-label="Dialog schließen" disabled={busy} onClick={close}>×</button>
      </header>
      {view === 'overview' && <Overview apiBase={apiBase} garmin={garmin.status} setGarmin={garmin.setStatus} workouts={workouts} activities={activities} go={go} onOpen={open} />}
      {view === 'garmin' && <GarminConnect apiBase={apiBase} status={garmin.status} setStatus={garmin.setStatus} loadError={garmin.error} onBusyChange={setBusy} />}
      {(view === 'usb' || view === 'files') && <FileImport key={view} apiBase={apiBase} usb={view === 'usb'} selection={selection}
        onImported={added} onOpen={id => onOpen(id)} onClose={close} onBusyChange={setBusy} />}
      {view === 'manual' && <ManualEntry apiBase={apiBase} onBusyChange={setBusy} onSaved={activity => { added(activity); onOpen(activity.id); }} />}
      {view === 'export' && <WorkoutExport apiBase={apiBase} workouts={workouts} loadError={workoutLoadError} onClose={close} />}
    </section>
  </div>;
}
