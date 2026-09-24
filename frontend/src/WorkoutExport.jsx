import React, { useMemo, useState } from 'react';
import { sportLabels } from './sports';
import { fitFileName, localDate, summary } from './workoutModel';

const addDays = (key, days) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); };
const dayLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const byDate = (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
const safeSummary = workout => { try { return summary(workout); } catch (_) { return ''; } };

async function download(apiBase, picked) {
  // One workout goes straight to a .fit file; several are bundled so they can be copied in one go.
  const single = picked.length === 1;
  const response = await fetch(`${apiBase}/api/workouts/${single ? 'export' : 'export-selection'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(single ? picked[0] : { ids: picked.map(w => w.id) }),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    // 405 without a message: the running backend predates this export and needs a restart.
    throw new Error(error || (response.status === 405 ? 'Der Server kennt diesen Export noch nicht. Bitte das Backend neu starten.' : `Download fehlgeschlagen (HTTP ${response.status}).`));
  }
  const first = picked[0].date, last = picked[picked.length - 1].date;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = single ? fitFileName(picked[0]) : first === last ? `trainhub_${first}.zip` : `trainhub_${first}_${last}.zip`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export tab of the import dialog: pick planned workouts and download them for a Garmin in one file.
export default function WorkoutExport({ apiBase, workouts, loadError, onClose, today = localDate() }) {
  const [showPast, setShowPast] = useState(false);
  const [picked, setPicked] = useState(() => new Set(workouts.filter(w => w.date >= today && w.date <= addDays(today, 6)).map(w => w.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const visible = useMemo(() => workouts.filter(w => showPast || w.date >= today).sort(byDate), [workouts, showPast, today]);
  const selected = visible.filter(w => picked.has(w.id));

  const change = next => { setPicked(next); setError(''); setMessage(''); };
  const pickRange = days => change(new Set(visible.filter(w => w.date >= today && (days === null || w.date <= addDays(today, days - 1))).map(w => w.id)));
  const toggle = id => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); change(next); };

  async function start() {
    setBusy(true); setError(''); setMessage('');
    try {
      await download(apiBase, selected);
      setMessage(selected.length === 1 ? 'FIT-Datei heruntergeladen.' : 'ZIP heruntergeladen. Entpacken und alle FIT-Dateien gemeinsam übertragen.');
    } catch (err) { setError(err instanceof TypeError ? 'Der Server ist nicht erreichbar. Bitte erneut versuchen.' : err.message); }
    finally { setBusy(false); }
  }

  return <>
    <div className="batch-content">
      {loadError && <p className="batch-error" role="alert">{loadError}</p>}
      <div className="export-presets" role="group" aria-label="Schnellauswahl">
        <button type="button" disabled={busy} onClick={() => pickRange(7)}>Nächste 7 Tage</button>
        <button type="button" disabled={busy} onClick={() => pickRange(14)}>Nächste 14 Tage</button>
        <button type="button" disabled={busy} onClick={() => pickRange(null)}>Alle kommenden</button>
        <button type="button" disabled={busy} onClick={() => change(new Set())}>Keine</button>
        <label className="export-past"><input type="checkbox" checked={showPast} disabled={busy} onChange={event => setShowPast(event.target.checked)} />Vergangene zeigen</label>
      </div>
      {visible.length ? <ul className="batch-files export-list" aria-label="Geplante Workouts">{visible.map(workout => <li key={workout.id}>
        <label>
          <input type="checkbox" checked={picked.has(workout.id)} disabled={busy} onChange={() => toggle(workout.id)} />
          <span className="export-day">{dayLabel(workout.date)}</span>
          <span className="batch-file-info"><span className="batch-file-name">{workout.name || 'Workout'}</span><small>{[sportLabels[workout.sport] || workout.sport, safeSummary(workout)].filter(Boolean).join(' · ')}</small></span>
        </label>
      </li>)}</ul> : <p className="export-empty">{showPast ? 'Noch keine geplanten Workouts.' : 'Keine kommenden Workouts geplant.'}</p>}
      {error && <p className="batch-error" role="alert">{error}</p>}
      {message && <p className="export-done" role="status">{message}</p>}
      <div className="export-garmin">
        <strong>So kommen sie auf deine Garmin</strong>
        <ol>
          {selected.length > 1 && <li>ZIP-Datei entpacken.</li>}
          <li>Garmin per USB verbinden und {selected.length > 1 ? 'alle .fit-Dateien' : 'die .fit-Datei'} in <strong>GARMIN/NewFiles</strong> kopieren.</li>
          <li>Gerät sicher auswerfen. Die Workouts stehen mit Datum im Namen im Trainingsmenü.</li>
        </ol>
      </div>
    </div>
    <footer className="batch-footer">
      <button type="button" disabled={busy} onClick={onClose}>Schließen</button>
      <button type="button" className="batch-primary" disabled={busy || !selected.length} onClick={start}>
        {busy ? 'Wird erstellt…' : !selected.length ? 'Workouts auswählen' : selected.length === 1 ? '1 Workout als FIT herunterladen' : `${selected.length} Workouts als ZIP herunterladen`}
      </button>
    </footer>
  </>;
}
