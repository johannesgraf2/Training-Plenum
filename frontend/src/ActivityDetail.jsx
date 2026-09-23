import React, { useState } from 'react';
import './ActivityDetail.css';
import RouteMap from './RouteMap';

const sports = { ride: 'Radfahren', run: 'Laufen', swim: 'Schwimmen', multisport: 'Multisport', walking: 'Gehen', hiking: 'Wandern', transition: 'Wechsel', unknown: 'Unbekannte Sportart' };
const sensors = { hr: 'Herzfrequenz', power: 'Leistung', speed: 'Geschwindigkeit', cadence: 'Kadenz', elevation: 'Höhe', distance: 'Distanz', gps: 'GPS' };
const EMPTY = [];
const number = (value, digits = 1) => value == null ? '—' : value.toLocaleString('de-DE', { maximumFractionDigits: digits });
export function duration(seconds) {
  if (seconds == null) return '—';
  const value = Math.round(seconds);
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, '0')).join(':');
}

// Missing readings break the path; zero is a recorded value. X is elapsed time.
export function chartGeometry(data, key) {
  const timed = data.filter(point => Number.isFinite(point.time));
  const present = timed.filter(point => Number.isFinite(point[key]));
  if (!present.length) return null;
  const minTime = Math.min(0, timed[0].time);
  const maxTime = timed.reduce((max, point) => Math.max(max, point.time), minTime);
  const min = present.reduce((v, point) => Math.min(v, point[key]), Infinity);
  const max = present.reduce((v, point) => Math.max(v, point[key]), -Infinity);
  const x = point => 40 + (point.time - minTime) / (maxTime - minTime || 1) * 720;
  const y = point => 120 - (point[key] - min) / (max - min || 1) * 96;
  let connected = false;
  let lastTime = null;
  const path = timed.map(point => {
    if (!Number.isFinite(point[key])) { connected = false; return ''; }
    // Do not draw through pauses or prolonged recording gaps.
    const command = connected && point.time - lastTime <= 30 ? 'L' : 'M';
    connected = true;
    lastTime = point.time;
    return `${command}${x(point).toFixed(2)},${y(point).toFixed(2)}`;
  }).join(' ');
  return { timed, present, minTime, maxTime, min, max, x, y, path };
}

function RecordingChart({ data, dataKey, label, unit, color, onSelectRecord }) {
  const [hover, setHover] = useState(null);
  const plot = React.useMemo(() => chartGeometry(data, dataKey), [data, dataKey]);
  if (!plot) return null;
  const move = event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 800 - 40) / 720));
    const target = plot.minTime + fraction * (plot.maxTime - plot.minTime);
    const record = plot.timed.reduce((best, point) => Math.abs(point.time - target) < Math.abs(best.time - target) ? point : best);
    setHover(record);
    onSelectRecord(record);
  };
  return <div className="recording-chart">
    <div className="recording-chart-heading"><h3>{label}</h3><span style={{ color }}>{hover ? `${duration(hover.time)} · ${number(hover[dataKey])} ${unit}` : `${number(plot.min)}–${number(plot.max)} ${unit}`}</span></div>
    <svg viewBox="0 0 800 152" role="img" aria-label={`${label} über die verstrichene Zeit`} onMouseMove={move} onMouseLeave={() => setHover(null)}>
      {[24, 72, 120].map(y => <line key={y} x1="40" x2="760" y1={y} y2={y} style={{ stroke: 'var(--bd-e2e8f0)' }} />)}
      <text x="0" y="28">{number(plot.max, 0)}</text><text x="0" y="124">{number(plot.min, 0)}</text>
      <path d={plot.path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {plot.present.length === 1 && <circle cx={plot.x(plot.present[0])} cy={plot.y(plot.present[0])} r="3" fill={color} />}
      {hover && <line x1={plot.x(hover)} x2={plot.x(hover)} y1="20" y2="124" stroke={color} strokeDasharray="3 3" />}
      <text x="40" y="148">{duration(plot.minTime)}</text><text x="760" y="148" textAnchor="end">{duration(plot.maxTime)}</text>
    </svg>
  </div>;
}

export default function ActivityDetail({ activity: a, onBack, onDelete, apiBase }) {
  const details = a.fitDetails || {};
  const data = a.timeSeries || EMPTY;
  const [selection, setSelection] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deletePending = React.useRef(false);
  const deleteButton = React.useRef(null);
  const cancelDelete = () => {
    if (deletePending.current) return;
    setConfirmDelete(false);
    setDeleteError('');
    deleteButton.current?.focus();
  };
  const removeActivity = async () => {
    if (deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(a.id);
    } catch (error) {
      setDeleteError('Aktivität konnte nicht gelöscht werden. Bitte versuche es erneut.');
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  };
  const selectedRecord = selection?.data === data ? selection.record : null;
  const selectRecord = React.useCallback(record => {
    setSelection(previous => previous?.data === data && previous.record === record ? previous : { data, record });
  }, [data]);
  const timer = details.timerSeconds ?? (a.duration == null ? null : a.duration * 60);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const metrics = [
    ['Aktive Timerzeit', duration(timer), '', 'Zeit bei laufendem Aktivitätstimer, ohne Pausen'],
    ['Verstrichene Zeit', duration(details.elapsedSeconds), '', 'Gesamte Zeit einschließlich Pausen'],
    ['Distanz', number(a.distance, 2), 'km'],
    ['Ø Herzfrequenz', number(a.hrAvg, 0), 'bpm'],
    ['Max. Herzfrequenz', number(a.hrMax, 0), 'bpm'],
    ['Ø Leistung', number(a.power, 0), 'W'],
    ['Ø Geschwindigkeit', number(a.speedAvg, 1), 'km/h'],
    ['Anstieg', number(a.elevation, 0), 'm'],
    ['Ø Kadenz', number(a.cadence, 1), 'U/min'],
    ['Energie', number(a.calories, 0), 'kcal'],
  ];
  return <article className="activity-detail">
    <button className="activity-back" onClick={onBack} disabled={deleting}>← Zurück zu den Aktivitäten</button>
    <header className="activity-heading">
      <div><div className="activity-eyebrow">{sports[a.sport] || a.sport}</div>
        <h1>{a.title}</h1>
        <p>{new Date(a.date).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'medium' })} · {timezone}</p>
      </div>
      <div className="activity-actions">
        {a.originalFileUrl && <a className="original-download" href={`${apiBase}${a.originalFileUrl}`}>Originaldatei herunterladen ↓</a>}
        {onDelete && <button type="button" className="activity-delete" ref={deleteButton}
          aria-expanded={confirmDelete} aria-controls="activity-delete-confirmation" disabled={deleting}
          onClick={() => { setConfirmDelete(true); setDeleteError(''); }}>Aktivität löschen</button>}
      </div>
    </header>
    {confirmDelete && <section id="activity-delete-confirmation" className="activity-delete-confirmation"
      role="group" aria-labelledby="activity-delete-title" aria-busy={deleting}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelDelete(); } }}>
      <h2 id="activity-delete-title">Aktivität wirklich löschen?</h2>
      <p><strong>{a.title}</strong> · {new Date(a.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <p>Die Aktivität wird aus deinem Kalender, deinen Listen und Auswertungen entfernt. Das lässt sich nicht rückgängig machen.</p>
      {deleteError && <p role="alert" className="activity-delete-error">{deleteError}</p>}
      <div className="activity-confirm-actions">
        <button type="button" autoFocus disabled={deleting} onClick={cancelDelete}>Abbrechen</button>
        <button type="button" className="activity-delete-confirm" disabled={deleting} onClick={removeActivity}>
          {deleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
        </button>
      </div>
    </section>}
    <div className="activity-metrics">{metrics.map(([label, value, unit, explanation]) => <div key={label} title={explanation}>
      <span>{label}</span><strong>{value} {value !== '—' && <small>{unit}</small>}</strong>
    </div>)}</div>
    <div className="recording-info">
      <h2>Aufgezeichnete Daten</h2>
      <div className="sensor-chips">{(details.measurements || []).map(key => <span key={key}>{sensors[key] || key}</span>)}</div>
      {details.untimedRecordCount > 0 && <p>{details.untimedRecordCount} Messpunkte ohne Zeitstempel sind gespeichert und werden im Diagramm ausgelassen.</p>}
    </div>
    {details.sessions?.length > 1 && <section className="activity-section"><h2>Sportabschnitte</h2><div className="activity-table-scroll"><table><thead><tr><th>Sport</th><th>Start ({timezone})</th><th>Timerzeit</th><th>Verstrichen</th><th>Distanz</th></tr></thead><tbody>
      {details.sessions.map((s, i) => <tr key={i}><td>{sports[s.sport] || s.sport}</td><td>{new Date(s.startTime).toLocaleString('de-DE')}</td><td>{duration(s.timerSeconds)}</td><td>{duration(s.elapsedSeconds)}</td><td>{number(s.distanceKm, 2)} km</td></tr>)}
    </tbody></table></div><p>Durchschnittswerte bleiben bei mehreren Sportabschnitten getrennt in der Datei erhalten.</p></section>}
    <RouteMap key={a.id} data={data} selectedRecord={selectedRecord} onSelectRecord={selectRecord} />
    <section key={`charts-${a.id}`} className="activity-section"><h2>Aktivitätsverlauf</h2>
      {data.length ? <>
        <RecordingChart data={data} dataKey="hr" label="Herzfrequenz" unit="bpm" color="#dc4b57" onSelectRecord={selectRecord} />
        <RecordingChart data={data} dataKey="power" label="Leistung" unit="W" color="#b17b10" onSelectRecord={selectRecord} />
        <RecordingChart data={data} dataKey="speed" label="Geschwindigkeit" unit="km/h" color="#3776c4" onSelectRecord={selectRecord} />
        <RecordingChart data={data} dataKey="cadence" label="Kadenz" unit="U/min" color="#168c83" onSelectRecord={selectRecord} />
        <RecordingChart data={data} dataKey="elevation" label="Höhe" unit="m" color="#8c65b0" onSelectRecord={selectRecord} />
      </> : <p>Diese Aktivität enthält keine einzelnen Messpunkte.</p>}
    </section>
    {!!details.laps?.length && <details className="activity-section"><summary>Runden anzeigen ({details.laps.length})</summary><div className="activity-table-scroll"><table><thead><tr><th>Runde</th><th>Timerzeit</th><th>Verstrichen</th><th>Distanz (km)</th><th>Ø HF (bpm)</th><th>Ø Leistung (W)</th></tr></thead><tbody>{details.laps.map((lap, i) => <tr key={i}><td>{i + 1}</td><td>{duration(lap.timerSeconds)}</td><td>{duration(lap.elapsedSeconds)}</td><td>{number(lap.distanceKm, 2)}</td><td>{number(lap.hrAvg, 0)}</td><td>{number(lap.power, 0)}</td></tr>)}</tbody></table></div></details>}
    {a.notes && <section className="activity-section"><h2>Notizen</h2><p>{a.notes}</p></section>}
  </article>;
}
