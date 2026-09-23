import React, { useEffect, useMemo, useState } from 'react';
import { localDate, summary, stepDescription } from './workoutModel';
import './TrainingPlanner.css';

const dayLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const hours = minutes => `${(minutes / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;
export function monthRange(month) {
  return [localDate(new Date(month.getFullYear(), month.getMonth(), 1)), localDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))];
}
export async function downloadRange(apiBase, start, end, sport = 'all') {
  const query = new URLSearchParams({ start, end, sport });
  const response = await fetch(`${apiBase}/api/workouts/export-range?${query}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Download fehlgeschlagen.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `trainhub_${start}_${end}.zip`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkoutRangeExport({ apiBase, month, workouts, loadError }) {
  const [start, setStart] = useState(() => monthRange(month)[0]);
  const [end, setEnd] = useState(() => monthRange(month)[1]);
  const [sport, setSport] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const yearMonth = monthRange(month)[0];
  useEffect(() => {
    const value = new Date(`${yearMonth}T12:00:00`);
    const range = monthRange(value); setStart(range[0]); setEnd(range[1]); setMessage(''); setError('');
  }, [yearMonth]);
  const selected = workouts.filter(w => w.date >= start && w.date <= end && (sport === 'all' || w.sport === sport));
  const valid = start && end && start <= end;
  async function download() {
    setBusy(true); setError(''); setMessage('');
    try { await downloadRange(apiBase, start, end, sport); setMessage('ZIP heruntergeladen. Entpacken und die FIT-Dateien gemeinsam übertragen.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="range-export" aria-label="Geplante Workouts herunterladen">
    <div><strong>Workouts herunterladen</strong><p>Alle gespeicherten Pläne im Zeitraum als ZIP mit einzelnen FIT-Dateien.</p></div>
    <fieldset disabled={busy} className="range-fields">
      <label>Von<input type="date" value={start} onChange={e => { setStart(e.target.value); setMessage(''); setError(''); }} /></label>
      <label>Bis (einschließlich)<input type="date" value={end} onChange={e => { setEnd(e.target.value); setMessage(''); setError(''); }} /></label>
      <label>Sport<select value={sport} onChange={e => { setSport(e.target.value); setMessage(''); setError(''); }}><option value="all">Alle Sportarten</option><option value="ride">Radfahren</option><option value="run">Laufen</option></select></label>
      <button className="plan-primary" onClick={download} disabled={!valid || !selected.length || !!loadError}>{busy ? 'ZIP wird erstellt…' : `${selected.length} Workouts als ZIP`}</button>
    </fieldset>
    {!valid && <p role="alert">Bitte einen gültigen Zeitraum wählen.</p>}
    {valid && !selected.length && !loadError && <p>Keine geplanten Workouts in diesem Zeitraum.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <small>Garmin USB: ZIP entpacken, alle .fit-Dateien nach GARMIN/NewFiles kopieren und sicher auswerfen. Die Namen enthalten das Datum; der Export erzeugt keine Garmin-Kalendereinträge.</small>
  </section>;
}

export default function TrainingPlanner({ apiBase, month, workouts, loadError, onSaved, onOpenWorkout }) {
  const nextMonth = useMemo(() => { const now = new Date(); return localDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)); }, []);
  const [startDate, setStartDate] = useState(nextMonth);
  const [weeklyHours, setWeeklyHours] = useState('');
  const [ftp, setFtp] = useState('');
  const [context, setContext] = useState(null);
  const [preview, setPreview] = useState(null);
  const [blockId, setBlockId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  async function json(path, body) {
    const response = await fetch(`${apiBase}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.');
    return result;
  }
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/training-blocks/context?timezone=${encodeURIComponent(zone)}`)
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Historie konnte nicht geladen werden.'); return result; })
      .then(result => { if (active) { setContext(result); setFtp(result.ftp || ''); setWeeklyHours(result.history.recommendedHours || ''); setError(''); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiBase, zone, reload]);
  function change(setter, value) { setter(value); setPreview(null); setSaved(false); setError(''); }
  async function generate(event) {
    event.preventDefault(); setBusy('preview'); setError(''); setPreview(null); setSaved(false);
    try {
      const result = await json(`/api/training-blocks/preview?timezone=${encodeURIComponent(zone)}`, { startDate, weeklyHours: Number(weeklyHours), ftp: Number(ftp) });
      setPreview(result); setBlockId(crypto.randomUUID());
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }
  async function save() {
    setBusy('save'); setError('');
    try { const result = await json('/api/training-blocks', { id: blockId, startDate: preview.startDate, endDate: preview.endDate, workouts: preview.workouts }); onSaved(result.workouts); setSaved(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }
  const conflicts = preview && workouts.filter(w => w.date >= preview.startDate && w.date <= preview.endDate);
  return <div className="training-planner">
    <div className="plan-heading"><span>RADTRAINING · VIER WOCHEN</span><h1>Dein nächster Trainingsblock</h1><p>VO₂max trainieren, Erholung einplanen und alle Workouts gemeinsam mitnehmen.</p></div>
    <div className="plan-columns">
      <section className="plan-card"><h2>VO₂max-Block planen</h2><p>Drei Aufbauwochen, eine Entlastungswoche. Vier Fahrten pro Woche, mit freien Tagen zwischen den Intervalltrainings.</p>
        <form onSubmit={generate}><fieldset disabled={!!busy || !context}>
          <label>Blockbeginn<input required type="date" min={context?.today} value={startDate} onChange={e => change(setStartDate, e.target.value)} /></label>
          <label>Zeitbudget pro Aufbauwoche (h)<input required type="number" min="3" max="12" step="0.25" value={weeklyHours} onChange={e => change(setWeeklyHours, e.target.value)} /></label>
          <label>Aktuelle FTP (W)<input required type="number" min="1" max="1000" value={ftp} onChange={e => change(setFtp, e.target.value)} /></label>
          <small>FTP aus deinem Profil; Anpassungen hier gelten nur für diesen Block. Intervalle Di/Do, Grundlage Sa/So. Die Vorschau zeigt alle Termine.</small>
          <button className="plan-primary" disabled={!context?.history.eligible}>{busy === 'preview' ? 'Plan wird erstellt…' : 'Block als Vorschau erstellen'}</button>
        </fieldset></form>
      </section>
      <section className="plan-card plan-history"><h2>Grundlage: deine Historie</h2>
        {!context ? <p>{error ? 'Historie nicht verfügbar.' : 'Historie wird geladen…'} <button onClick={() => setReload(value => value + 1)}>Erneut laden</button></p> : <>
          <p>Sechs volle Wochen · {dayLabel(context.history.from)}–{dayLabel(context.history.through)}</p>
          <div className="plan-stats"><div><strong>{context.history.medianHours} h</strong><span>Typische Radwoche (Median)</span></div><div><strong>{context.history.recentHours} h</strong><span>Letzte zwei Wochen Ø Rad</span></div><div><strong>{context.history.recommendedHours} h</strong><span>Konservativer Vorschlag</span></div></div>
          <div className="history-weeks">{context.history.weeks.map(week => <div key={week.start}><span>{dayLabel(week.start)}</span><meter min="0" max={Math.max(...context.history.weeks.map(w => w.cyclingMinutes)) || 1} value={week.cyclingMinutes} /><strong>{hours(week.cyclingMinutes)}</strong></div>)}</div>
          <p>Letzte Fahrt: {context.history.lastRide ? dayLabel(context.history.lastRide) : 'Keine'}. Leere Wochen zählen mit; die aktuelle Teilwoche wird nicht hochgerechnet.</p>
          {context.history.warnings.map(warning => <p className="plan-note" key={warning}>{warning}</p>)}
          <small>Der Vorschlag nutzt Umfang und Aktualität. Er bestimmt weder deine aktuelle Ermüdung noch deine gemessene VO₂max.</small>
        </>}
      </section>
    </div>
    {error && <p className="plan-error" role="alert">{error}</p>}
    {loadError && <p className="plan-error" role="alert">{loadError}</p>}
    {preview && <section className="plan-card plan-preview"><div className="plan-preview-header"><div><h2>{dayLabel(preview.startDate)}–{dayLabel(preview.endDate)} · {preview.workouts.length} Rad-Workouts</h2><p>{preview.ftp} W FTP · {Math.round(preview.ftp * 1.10)}–{Math.round(preview.ftp * 1.15)} W Intervalle</p></div>
      <button className="plan-primary" disabled={!!busy || saved || !!loadError || !!conflicts.length} onClick={save}>{saved ? 'Im Kalender gespeichert' : busy === 'save' ? 'Wird gespeichert…' : 'Alle Workouts im Kalender speichern'}</button></div>
      {saved && <p role="status">Block gespeichert. Du kannst jedes Workout im Kalender bearbeiten und unten den gesamten Zeitraum herunterladen.</p>}
      {!saved && !!conflicts.length && <p role="alert">Im Zeitraum sind bereits {conflicts.length} Workouts geplant. Bitte im Kalender prüfen und verschieben oder entfernen.</p>}
      <p>{preview.guidance}</p>{preview.warnings.map(w => <p className="plan-note" key={w}>{w}</p>)}
      <div className="plan-week-grid">{preview.weeks.map(week => <article className={`plan-week ${week.phase === 'Entlastung' ? 'recovery' : ''}`} key={week.week}>
        <span>WOCHE {week.week} · {week.phase.toUpperCase()}</span><h3>{hours(week.minutes)}</h3><p>{week.intervalMinutes} min VO₂max-Intervalle</p>
        {preview.workouts.filter(w => w.date >= week.from && w.date <= week.through).map(w => <details key={w.date}><summary><time>{dayLabel(w.date)}</time><strong>{w.name}</strong><span>{summary(w)}</span></summary><ol>{w.steps.map((step, index) => <li key={index}>{step.kind === 'repeat' ? <>{step.count} Wiederholungen<ul>{step.steps.map((s, i) => <li key={i}>{s.name}: {stepDescription(s)}</li>)}</ul></> : `${step.name}: ${stepDescription(step)}`}</li>)}</ol></details>)}
        <p className="plan-rest">Frei: {preview.restDays.filter(d => d >= week.from && d <= week.through).map(dayLabel).join(', ')}</p>
      </article>)}</div>
      <small>Trainingsprinzipien: <a href="https://www.trainingpeaks.com/blog/cycling-interval-training-101/" target="_blank" rel="noreferrer">TrainingPeaks: Intervalltraining</a> · <a href="https://www.britishcycling.org.uk/knowledge/article/izn20130108-sportive-r-r--maximise-your-post-ride-recovery-0" target="_blank" rel="noreferrer">British Cycling: Erholung</a>. Umfang und Progression sind ein editierbarer Planungsvorschlag.</small>
    </section>}
    <WorkoutRangeExport apiBase={apiBase} month={preview ? new Date(`${preview.startDate}T12:00:00`) : month} workouts={workouts} loadError={loadError} />
    <section className="plan-card"><h2>Gespeicherte Workouts</h2>{!workouts.length && <p>Noch keine Workouts geplant.</p>}<div className="plan-saved-list">{[...workouts].sort((a, b) => a.date.localeCompare(b.date)).map(w => <button key={w.id} onClick={() => onOpenWorkout(w)}><time>{dayLabel(w.date)}</time><strong>{w.name}</strong><span>{summary(w)} →</span></button>)}</div></section>
  </div>;
}
