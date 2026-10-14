import React, { useEffect, useState } from 'react';
import { sportLabels } from './sports';
import { localDate } from './workoutModel';
import './GarminSync.css';

const SPORTS = ['ride', 'run', 'swim', 'walking', 'hiking'];
const now = () => new Date().toTimeString().slice(0, 5);
const number = value => (value === '' ? null : Number(value));

// A session without a recording, e.g. strength training or a ride whose device ran out of battery.
export default function ManualEntry({ apiBase, onSaved, onBusyChange }) {
  const [draft, setDraft] = useState(() => ({ sport: 'ride', date: localDate(), time: now(), title: '', duration: '', distance: '', hrAvg: '', notes: '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = key => event => setDraft(current => ({ ...current, [key]: event.target.value }));

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body = {
        sport: draft.sport, date: `${draft.date}T${draft.time || '12:00'}`,
        title: draft.title.trim() || sportLabels[draft.sport], duration: number(draft.duration),
        distance: number(draft.distance) ?? 0, hrAvg: number(draft.hrAvg), notes: draft.notes.trim(),
      };
      const response = await fetch(`${apiBase}/api/activities/manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Speichern fehlgeschlagen (HTTP ${response.status}).`);
      onSaved(data);
    } catch (e) {
      setError(e instanceof TypeError ? 'Der Server ist nicht erreichbar. Bitte erneut versuchen.' : e.message);
      setBusy(false);
    }
  }

  return <form className="hub-manual" onSubmit={save}>
    <fieldset className="batch-content" disabled={busy}>
      <div className="hub-sports" role="radiogroup" aria-label="Sportart">
        {SPORTS.map(sport => <button key={sport} type="button" role="radio" aria-checked={draft.sport === sport}
          onClick={() => setDraft(current => ({ ...current, sport }))}>{sportLabels[sport]}</button>)}
      </div>
      <div className="hub-fields">
        <label className="garmin-field">Datum<input type="date" required max={localDate()} value={draft.date} onChange={set('date')} /></label>
        <label className="garmin-field">Startzeit<input type="time" value={draft.time} onChange={set('time')} /></label>
        <label className="garmin-field hub-wide">Titel<input maxLength={200} placeholder={sportLabels[draft.sport]} value={draft.title} onChange={set('title')} /></label>
        <label className="garmin-field">Dauer (min)<input type="number" required min={1} max={1440} step={1} value={draft.duration} onChange={set('duration')} /></label>
        <label className="garmin-field">Distanz (km)<input type="number" min={0} max={1000} step={0.01} value={draft.distance} onChange={set('distance')} /></label>
        <label className="garmin-field">Ø Herzfrequenz (bpm)<input type="number" min={30} max={250} step={1} value={draft.hrAvg} onChange={set('hrAvg')} /></label>
        <label className="garmin-field hub-wide">Notizen<textarea rows={3} placeholder="Wie war das Training?" value={draft.notes} onChange={set('notes')} /></label>
      </div>
      {error && <p role="alert" className="batch-error">{error}</p>}
      <p className="batch-help">Ohne Aufzeichnung gibt es keine Kurven, Zonen oder Bestwerte. Dauer und Distanz zählen aber für Kalender und Wochenumfang.</p>
    </fieldset>
    <footer className="batch-footer">
      <button type="submit" className="batch-primary" disabled={busy}>{busy ? 'Wird gespeichert…' : 'Speichern'}</button>
    </footer>
  </form>;
}
