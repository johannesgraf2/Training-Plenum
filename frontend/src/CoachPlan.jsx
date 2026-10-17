import React, { useEffect, useRef, useState } from 'react';
import { CheckInHistory } from './CoachToday';
import { ChangeCard, request } from './CoachChat';
import { localDate, stepDescription, workoutOverview } from './workoutModel';
import { sportLabels } from './sports';
import { Icon } from './icons';
import { HorizonSetting, PhaseEditor, WeekHoursChart } from './PlanEditor.jsx';
import './CoachPlan.css';

// The plan area: phase bar up to the event (blocks changed by hand with "Ändern"), weekly hours up to the goal, how many
// weeks get worked out, the worked-out weeks, outlined weeks and the history.
// Session changes go through the coach chat (onAsk) or by hand in the workout editor; "Behalten" (lock), the blocks and the horizon are direct.

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `timezone=${encodeURIComponent(timezone())}`;
const DAYS = [['mon', 'Mo', 'Montag'], ['tue', 'Di', 'Dienstag'], ['wed', 'Mi', 'Mittwoch'], ['thu', 'Do', 'Donnerstag'], ['fri', 'Fr', 'Freitag'], ['sat', 'Sa', 'Samstag'], ['sun', 'So', 'Sonntag']];
const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const hm = minutes => minutes == null ? '—' : minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')} h` : `${Math.round(minutes)} min`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const shortDay = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const longDay = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fullDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const SPORTS = { ...sportLabels, strength: 'Krafttraining', rest: 'Ruhetag' };
const TEMPLATE_SPORT = template => template.startsWith('bike_') ? 'ride' : template.startsWith('run_') ? 'run' : template.startsWith('strength') ? 'strength' : 'rest';
// One sentence per template: why the session is in the plan.
export const PURPOSES = {
  bike_recovery: 'Lockert die Beine und fördert die Erholung, ohne neue Ermüdung.',
  bike_z2: 'Baut die aerobe Grundlage auf – die Basis, auf der alles Harte aufsetzt.',
  bike_z2_short: 'Kurze Grundlage: hält den Umfang, ohne zu ermüden.',
  bike_z2_long: 'Lange Grundlage: stärkt Fettstoffwechsel und Ausdauer für lange Tage im Sattel.',
  bike_long: 'Lange Ausfahrt: Ausdauer, Fettstoffwechsel und Übung im Verpflegen.',
  bike_z2_sprints: 'Grundlage mit kurzen Sprints: hält die Spritzigkeit, ohne die Erholung zu stören.',
  bike_tempo: 'Gleichmäßiges Tempo stärkt die muskuläre Ausdauer unter der Schwelle.',
  bike_sweetspot: 'Viel Zeit knapp unter der Schwelle: hebt die FTP bei vertretbarer Ermüdung.',
  bike_threshold: 'Arbeit an der Schwelle: schiebt deine FTP nach oben.',
  bike_threshold_intervals: 'Arbeit an der Schwelle: schiebt deine FTP nach oben.',
  bike_vo2: 'Hebt deine maximale Sauerstoffaufnahme, den Motor für alles darunter.',
  bike_vo2_micro: 'Kurze harte Wechsel: viel Zeit nahe VO2max bei guter Kontrolle.',
  bike_sit: 'Maximale Sprints mit langer Pause: Reiz für VO2max und Spritzigkeit.',
  run_easy: 'Lockerer Lauf für Grundlage und Laufökonomie.',
  run_threshold: 'Tempo an der Schwelle: macht dich auf längeren Strecken schneller.',
  run_long: 'Langer Lauf für Ausdauer und einen belastbaren Bewegungsapparat.',
  strength_general: 'Kraft und Stabilität beugen Verletzungen vor und stützen die Leistung.',
  rest: 'Ruhe gehört zum Training: Jetzt passt sich dein Körper an.',
  bike_ftp_test: 'Misst deine FTP, damit alle Radziele stimmen.',
  run_test_30: 'Misst deine Schwellenpace, damit alle Laufziele stimmen.',
};
export const REVIEW_REASONS = [['asPlanned', 'Alles nach Plan'], ['lackOfTime', 'Wenig Zeit'], ['sick', 'Krank'], ['injured', 'Verletzt'], ['tired', 'Müde'], ['travel', 'Reise']];
const EFFORT = ['sehr leicht', 'leicht', 'mittel', 'hart', 'sehr hart'];

export const sessionRef = (session, week) => ({ kind: 'session', week: week.week, sessionId: session.id,
  label: `${shortDay(session.rendered.date)} · ${session.rendered.name}` });
export const weekRef = week => ({ kind: 'week', week: week.week, sessionId: null, label: `Woche ${week.number}` });

// When an outlined week gets its sessions, by replan mode.
export function replanText(week, mode, today = localDate()) {
  if (mode === 'manual' || !week.replanDate) return 'wird auf Knopfdruck ausgearbeitet';
  if (week.replanDate <= today) return 'ist zum Ausarbeiten fällig';
  return mode === 'afterReview' ? `wird nach deinem Wochenrückblick am ${shortDay(week.replanDate)} ausgearbeitet` : `wird am ${shortDay(week.replanDate)} ausgearbeitet`;
}

/** A running replanning or adapting job: the step at work, how far it is and "Stoppen". */
export function JobProgress({ job, stopping, onStop }) {
  const steps = job.steps || [];
  const index = Math.max(0, steps.findIndex(s => s.status === 'running'));
  return <div role="status" className="coach-message coach-job"><span className="coach-spinner" />
    <span>{steps[index]?.label || 'Nächste Woche'} … Der Coach plant.{steps.length > 1 ? ` Schritt ${index + 1} von ${steps.length}.` : ''}</span>
    {onStop && <button type="button" disabled={stopping} onClick={onStop}>{stopping ? 'Wird gestoppt …' : 'Stoppen'}</button>}</div>;
}

function PhaseBar({ overview, today }) {
  const [selected, setSelected] = useState(null);
  const { phases, events, weeks } = overview;
  const total = weeks.length;
  if (!total) return null;
  const first = weeks[0].startDate;
  const position = date => `${Math.min(100, Math.max(0, daysBetween(first, date) / (total * 7) * 100))}%`;
  const phase = phases.find(p => p.id === selected);
  return <>
    <div className="coach-season-strip plan-phases" role="group" aria-label="Phasen bis zum Planende">
      {phases.map(p => <button key={p.id} type="button" className={`coach-season-segment ${p.blockType}${p.endDate < today ? ' past' : ''}`} style={{ flexGrow: p.weeks }}
        aria-pressed={selected === p.id} title={`${p.typeName} · ${p.weeks} Wochen`} onClick={() => setSelected(id => id === p.id ? null : p.id)}><strong>{p.typeName}</strong><small>{p.weeks} Wo.</small></button>)}
      {today >= first && daysBetween(first, today) < total * 7 && <i className="coach-season-today" style={{ left: position(today) }} title="Heute" />}
      {events.map(e => <i key={e.id} className={`plan-event-dot ${e.priority}`} style={{ left: position(e.startDate) }} title={`${e.title} (${e.priority}) · ${shortDay(e.startDate)}`} />)}
    </div>
    <div className="plan-phase-legend"><span><i className="coach-season-today-mark" />Heute</span>{events.length > 0 && <span><i className="plan-event-dot A" />A-Event</span>}
      {events.some(e => e.priority !== 'A') && <span><i className="plan-event-dot B" />B/C-Event</span>}</div>
    {phase && <div className="plan-phase-detail"><strong>{phase.typeName}{phase.secondaryName ? ` + ${phase.secondaryName}` : ''}</strong> · {shortDay(phase.startDate)} – {shortDay(phase.endDate)} · {phase.weeks} Wochen
      {phase.purpose && <p>{phase.purpose}</p>}</div>}
  </>;
}

function Badge({ week }) {
  return <span className={`plan-load ${week.deload ? 'deload' : 'load'}`}>{week.deload ? 'Entlastung' : 'Belastung'}</span>;
}

function WeekCard({ week, today, workoutsById, onOpen, onAsk, onReview }) {
  const value = week.plan;
  const fixed = (value.fixedSessions || []).map(item => ({ ...item, name: workoutsById[item.id]?.name || 'Eigene Einheit' }));
  const reviewable = week.state !== 'future' && !value.review;
  return <article className={`coach-card plan-week ${week.state}`} aria-label={`Woche ${week.number}`}>
    <div className="plan-week-head"><div>
      <span className="coach-eyebrow">Woche {week.number}{week.phaseName ? ` · ${week.phaseName}` : ''} · {shortDay(week.startDate)}{week.state === 'current' ? ' · diese Woche' : ''}</span>
      <h3>{fmt(value.calculatedHours ?? value.targetHours)} h · {value.focus || 'Trainingswoche'}</h3></div><Badge week={week} /></div>
    <ol className="plan-days">{DAYS.map(([day, short], index) => {
      const date = new Date(Date.parse(`${week.startDate}T12:00:00Z`) + index * 86400000).toISOString().slice(0, 10);
      const sessions = value.sessions.filter(s => s.rendered?.date === date).sort((a, b) => a.id.localeCompare(b.id));
      const own = fixed.filter(f => f.date === date);
      const events = (week.events || []).filter(e => e.startDate <= date && date <= e.endDate);
      if (!sessions.length && !own.length && !events.length) return <li key={day} className="plan-day empty"><strong>{short}</strong><span className="coach-muted">frei</span></li>;
      return <li key={day} className={`plan-day${date < today ? ' past' : ''}${date === today ? ' today' : ''}`}><strong>{short}</strong><div>
        {events.map(e => <span key={e.id} className={`plan-event ${e.priority}`}>{e.priority}-Event · {e.title}</span>)}
        {sessions.map(s => <button key={s.id} type="button" className={`plan-session sport-${TEMPLATE_SPORT(s.template)}`} onClick={() => onOpen(s, week)}>
          <span>{s.rendered.name}</span><small>{hm(s.rendered.durationMin)}{s.manuallyEdited ? ' · von dir geändert' : ''}{s.locked ? ' · behalten' : ''}</small></button>)}
        {own.map(f => <span key={f.id} className="plan-session fixed"><span>{f.name}</span><small>{hm(f.durationMin)} · fest</small></span>)}
      </div></li>;
    })}</ol>
    {value.hinweise?.length > 0 && <ul className="chat-hints">{value.hinweise.map(h => <li key={h}>{h}</li>)}</ul>}
    <div className="coach-actions"><button type="button" onClick={() => onAsk(weekRef(week))}>Woche anpassen</button>
      {reviewable && <button type="button" onClick={() => onReview(week)}>Wochenrückblick</button>}
      {value.review && <span className="coach-muted">Rückblick: Anstrengung {value.review.effort ?? '—'}/5</span>}</div>
  </article>;
}

function Structure({ workout }) {
  let overview = null;
  try { overview = workout ? workoutOverview(workout) : null; } catch (_) { /* An edited workout may lack targets. */ }
  if (!overview?.allTimed || !overview.segments.length) return null;
  const highest = Math.max(...overview.segments.map(s => s.power || 0), 1);
  const steps = [...new Set(overview.segments.filter(s => ['active', 'interval'].includes(s.intensity)).map(stepDescription))];
  return <>
    <div className="plan-structure" role="img" aria-label="Ablauf der Einheit">{overview.segments.map((s, i) => <i key={i} className={s.intensity}
      style={{ flexGrow: s.seconds, height: `${s.power ? Math.max(18, s.power / highest * 100) : { interval: 90, active: 60, recovery: 30 }[s.intensity] || 35}%` }} />)}</div>
    {steps.length > 0 && <ul className="plan-targets">{steps.slice(0, 4).map(step => <li key={step}>{step}</li>)}</ul>}
  </>;
}

function SessionDetail({ session, week, workout, today, busy, onClose, onAsk, onLock, onSkip, onOpenWorkout }) {
  const [moveTo, setMoveTo] = useState('');
  const [skipping, setSkipping] = useState(false);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const date = session.rendered.date;
  const past = date < today;
  const ref = sessionRef(session, week);
  const days = DAYS.map(([day, , long], index) => [day, long, new Date(Date.parse(`${week.startDate}T12:00:00Z`) + index * 86400000).toISOString().slice(0, 10)])
    .filter(([day, , value]) => value >= today && day !== session.day);
  const ask = message => { onClose(); onAsk(ref, message); };
  return <div className="chat-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="chat-window plan-detail" role="dialog" aria-modal="true" aria-label={session.rendered.name}>
      <header className="chat-head"><div><span className="coach-eyebrow">{longDay(date)} · {SPORTS[TEMPLATE_SPORT(session.template)]} · {hm(session.rendered.durationMin)}</span><h2>{session.rendered.name}</h2></div>
        <div className="chat-head-actions"><button type="button" aria-label="Schließen" onClick={onClose}>✕</button></div></header>
      <div className="plan-detail-body">
        <Structure workout={session.rendered.workout} />
        {session.manuallyEdited && <p className="coach-message plan-edited">{session.locked ? 'Von dir geändert. „Behalten“ ist an: Der Coach lässt die Einheit so.'
          : 'Von dir geändert. Damit der Coach sie bei der nächsten Anpassung nicht ersetzt, tippe unten auf „Behalten“.'}</p>}
        <h3>{session.manuallyEdited ? 'Warum der Coach sie geplant hat' : 'Warum diese Einheit'}</h3><p>{PURPOSES[session.template] || 'Teil deines Wochenplans.'}{week.plan.focus ? ` Wochenfokus: ${week.plan.focus}.` : ''}</p>
        {session.rendered.notes && <><h3>Verpflegung</h3><p className="coach-session-note">{session.rendered.notes}</p></>}
        <div className="plan-change" aria-label="Mit dem Coach ändern" role="group">
          <div className="plan-change-head"><h3>Mit dem Coach ändern</h3><span className="coach-badge recommendation">KI</span></div>
          {past ? <p className="coach-muted">Die Einheit liegt in der Vergangenheit.</p> : <>
            <div className="plan-detail-actions">
              <button type="button" disabled={busy} onClick={() => ask('Bitte tausche diese Einheit gegen eine Alternative mit gleichem Ziel.')}>Andere Einheit vorschlagen</button>
              <div className="plan-move"><select aria-label="Neuer Tag" value={moveTo} onChange={e => setMoveTo(e.target.value)}><option value="">Tag wählen …</option>
                {days.map(([day, long, value]) => <option key={day} value={day}>{long}, {shortDay(value).split(', ')[1]}</option>)}</select>
                <button type="button" disabled={!moveTo || busy} onClick={() => ask(`Bitte verschiebe diese Einheit auf ${DAYS.find(([d]) => d === moveTo)[2]}.`)}>Verschieben</button></div>
            </div>
            <p className="coach-muted">Öffnet den Coach-Chat. Er prüft Verfügbarkeiten und Wochenbelastung und zeigt dir die Änderung, bevor sie gilt.</p></>}
        </div>
        {workout && <div className="plan-change" aria-label="Selbst ändern" role="group">
          <div className="plan-change-head"><h3>Selbst ändern</h3><span className="coach-badge athlete">ohne KI</span></div>
          {skipping ? <div className="coach-message plan-skip" role="group" aria-label="Auslassen bestätigen"><span>Einheit auslassen? Sie verschwindet aus Plan und Kalender{week.plan.calculatedHours != null
            ? `, die Woche hat dann ${hm(week.plan.calculatedHours * 60 - session.rendered.durationMin)}` : ''}. Nachgeholt wird nichts.</span>
            <button type="button" className="coach-primary" disabled={busy} onClick={() => onSkip(session.id)}>Auslassen</button>
            <button type="button" disabled={busy} onClick={() => setSkipping(false)}>Abbrechen</button></div>
            : <div className="plan-detail-actions">
              {onOpenWorkout && <button type="button" disabled={session.locked} onClick={() => { onClose(); onOpenWorkout(workout, { library: true }); }}>Einheit aus Vorlagen tauschen</button>}
              {onOpenWorkout && <button type="button" onClick={() => { onClose(); onOpenWorkout(workout); }}>Im Editor bearbeiten · Garmin-Export</button>}
              {!past && <button type="button" disabled={busy || session.locked} onClick={() => setSkipping(true)}>Auslassen</button>}
            </div>}
          <p className="coach-muted">{session.locked ? 'Zum Tauschen oder Auslassen zuerst „Behalten“ lösen. Exportieren geht auch so.'
            : 'Ablauf, Werte und Datum änderst du direkt, oder du lässt die Einheit aus; das gilt sofort, ohne Prüfung durch den Coach.'}</p>
        </div>}
        {workout && <div className="plan-change" aria-label="Behalten" role="group">
          <div className="plan-detail-actions"><button type="button" disabled={busy} aria-pressed={!!session.locked} onClick={() => onLock(session.id, !session.locked)}>
            <Icon name={session.locked ? 'lock' : 'unlock'} size={14} /> {session.locked ? 'Wird behalten' : 'Behalten'}</button></div>
          <p className="coach-muted">„Behalten“ heißt: Der Coach lässt die Einheit bei Anpassungen unangetastet, auch mit deinen eigenen Änderungen.</p>
        </div>}
      </div>
    </section>
  </div>;
}

export function WeekReview({ apiBase = '', week, completedHours, onSaved, onClose }) {
  const [effort, setEffort] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [missed, setMissed] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = localDate();
  const sessions = (week.plan.sessions || []).filter(s => s.rendered?.date <= today && s.template !== 'rest');
  const toggle = (list, set, key) => set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await request(apiBase, `/api/coach/weeks/${week.week}/review?${tzQuery()}`, 'PUT', { missedSessions: missed, effort, reasons, note: note.trim() });
      onSaved(result);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return <section className="coach-card plan-review" aria-label="Wochenrückblick">
    <span className="coach-eyebrow">Wochenrückblick · Woche {week.number}</span><h2>Wie lief deine Woche?</h2>
    <div className="coach-feedback"><div><small>Geplant</small><strong>{fmt(week.plan.calculatedHours)} h</strong></div><div><small>Absolviert{week.state === 'current' ? ' (bis heute)' : ''}</small><strong>{fmt(completedHours)} h</strong></div>
      <div><small>Ausgelassen (deine Angabe)</small><strong>{missed.length}</strong></div></div>
    <fieldset className="plan-chips"><legend>Wie anstrengend war die Woche?</legend>{EFFORT.map((label, i) => <button key={label} type="button" aria-pressed={effort === i + 1} onClick={() => setEffort(i + 1)}>{i + 1} · {label}</button>)}</fieldset>
    <fieldset className="plan-chips"><legend>Was war los?</legend>{REVIEW_REASONS.map(([key, label]) => <button key={key} type="button" aria-pressed={reasons.includes(key)} onClick={() => toggle(reasons, setReasons, key)}>{label}</button>)}</fieldset>
    {sessions.length > 0 && <fieldset className="coach-missed"><legend>Welche Einheiten hast du ausgelassen?</legend>{sessions.map(s => <label className="coach-checkbox" key={s.id}>
      <input type="checkbox" checked={missed.includes(s.id)} onChange={() => toggle(missed, setMissed, s.id)} />{shortDay(s.rendered.date)} · {s.rendered.name}</label>)}</fieldset>}
    <label className="coach-field"><span>Notiz (optional)</span><textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
    {error && <div role="alert" className="coach-message error">{error}</div>}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy} onClick={save}>Absenden</button><button type="button" disabled={busy} onClick={onClose}>Abbrechen</button></div>
  </section>;
}

function History({ weeks, apiBase, version }) {
  if (!weeks.length) return null;
  return <details className="coach-card coach-details plan-history"><summary>Verlauf · {weeks.length} {weeks.length === 1 ? 'Woche' : 'Wochen'}</summary>
    <table className="coach-table"><thead><tr><th>Woche</th><th>Phase</th><th>Geplant</th><th>Absolviert</th><th>Rückblick</th></tr></thead>
      <tbody>{[...weeks].reverse().map(w => <tr key={w.week}><td>{w.number} · {shortDay(w.startDate)}</td><td>{w.phaseName || '—'}</td>
        <td>{w.plan ? `${fmt(w.plan.calculatedHours)} h` : '—'}</td><td>{fmt(w.completedHours)} h</td>
        <td>{w.plan?.review ? `${w.plan.review.effort ?? '—'}/5${w.plan.review.reasons?.length ? ` · ${w.plan.review.reasons.map(r => REVIEW_REASONS.find(([k]) => k === r)?.[1]).join(', ')}` : ''}` : '—'}</td></tr>)}</tbody></table>
    <CheckInHistory apiBase={apiBase} version={version} />
  </details>;
}

/** The plan area of the coach. advance = the running replanning or adapting job, proposalId = an open adjustment of the
 * worked-out weeks after it. */
export default function CoachPlan({ apiBase = '', version = 0, workoutsById = {}, advance, stopping, proposalId, reviewWeek, pendingChanges = [], onAsk, onStart, onAdvance,
  onAdapt, onJob, onStop, onChanged, onOpenWorkout, onHorizon }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [review, setReview] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloads, setReloads] = useState(0);
  const today = localDate();
  useEffect(() => {
    let active = true;
    request(apiBase, `/api/coach/plan/weeks?${tzQuery()}`).then(data => { if (active) { setOverview(data); setError(''); } }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiBase, version, reloads]);
  useEffect(() => {
    if (!proposalId) { setProposal(null); return undefined; }
    let active = true;
    request(apiBase, `/api/coach/proposals/${encodeURIComponent(proposalId)}`).then(data => { if (active) setProposal(data); }, () => { if (active) setProposal(null); });
    return () => { active = false; };
  }, [apiBase, proposalId, version]);
  // A review asked for from Heute ({week, key}) opens once.
  const shownReview = useRef(null);
  useEffect(() => {
    if (!reviewWeek || !overview || shownReview.current === reviewWeek.key) return;
    shownReview.current = reviewWeek.key;
    setReview(overview.weeks.find(w => w.week === reviewWeek.week && w.plan) || null);
  }, [reviewWeek, overview]);

  async function decide(action) {
    setBusy(true); setError('');
    try {
      const result = await request(apiBase, `/api/coach/proposals/${encodeURIComponent(proposal.id)}/${action}`, 'POST', action === 'confirm' ? { confirm: true } : {});
      setProposal(p => ({ ...p, status: action === 'confirm' ? 'confirmed' : 'discarded' }));
      if (action === 'confirm') await onChanged?.(result);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  // Skipping is the athlete's call: the calendar workout goes, and with it the session and its hours in the plan.
  async function skip(identity) {
    setBusy(true); setError('');
    try {
      await request(apiBase, `/api/workouts/${encodeURIComponent(identity)}`, 'DELETE');
      setDetail(null);
      await onChanged?.(); setReloads(n => n + 1);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function lock(identity, locked) {
    setBusy(true); setError('');
    try {
      await request(apiBase, `/api/workouts/${encodeURIComponent(identity)}/lock`, 'PUT', { locked });
      setDetail(d => d && { ...d, session: { ...d.session, locked } });
      await onChanged?.(); setReloads(n => n + 1);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (error && !overview) return <div role="alert" className="coach-message error">{error}</div>;
  if (!overview) return <p role="status" className="coach-muted">Plan wird geladen …</p>;
  if (!overview.frame) return <section className="coach-card coach-onboarding-start"><span className="coach-eyebrow">Plan</span><h2>Lass uns deinen Plan bauen</h2>
    <p className="coach-muted">Ziel, Zeitraum und Verfügbarkeiten, dann legt der Coach Phasen bis zu deinem Event fest und arbeitet die ersten 3 Wochen aus. Etwa 5 Minuten.</p>
    <div className="coach-actions"><button type="button" className="coach-primary" onClick={onStart}>Los geht's</button></div></section>;

  const mode = overview.settings?.replanMode;
  const weeks = overview.weeks;
  const event = overview.events.filter(e => e.priority === 'A' && e.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const current = weeks.find(w => w.state === 'current');
  // Whole weeks from this Monday to the Monday of the event week, like the countdown in Heute.
  const countdown = event ? Math.max(0, Math.floor(daysBetween(current?.startDate || weeks[0].startDate, event.startDate) / 7)) : null;
  const worked = weeks.filter(w => w.plan && w.state !== 'past');
  const outlined = weeks.filter(w => !w.plan && w.state !== 'past');
  const past = weeks.filter(w => w.state === 'past');
  const proposalWeeks = proposal ? Object.keys(proposal.after || {}).sort().map(key => ({ week: key, before: proposal.before[key], after: proposal.after[key] })) : [];
  const settingsChange = proposal?.reason === 'settings';
  const reviewed = review && weeks.find(w => w.week === review.week);
  const onlyPhases = !pendingChanges.length && (overview.adapt?.changes || []).every(change => change === 'phases');
  return <div className="coach-plan">
    <section className="coach-card plan-head" aria-label="Plan">
      <div className="plan-head-top"><div>
        <span className="coach-eyebrow">{event ? `${event.title} · ${fullDate(event.startDate)}` : `Dein Plan bis ${fullDate(overview.frame.endDate)}`}</span>
        <h2>{event ? (countdown === 0 ? 'Diese Woche ist es so weit' : `Noch ${countdown} ${countdown === 1 ? 'Woche' : 'Wochen'}`) : `${weeks.length} Wochen`}{current ? ` · Woche ${current.number} von ${weeks.length}` : ''}</h2></div>
        {!editing && <button type="button" className="plan-edit" disabled={advance?.status === 'running'} onClick={() => setEditing(true)}>Phasen ändern</button>}</div>
      <div className="plan-section-label"><span className="coach-eyebrow">Phasen</span>
        <small>{editing ? 'Reihenfolge und Länge der Schwerpunkte ändern. Stunden und Belastung einzelner Wochen änderst du unten im Diagramm.'
          : 'Der Schwerpunkt je Zeitraum, z. B. Grundlage, VO2max oder Schwelle.'}</small></div>
      {editing ? <PhaseEditor key={`${overview.frame.id}-${reloads}`} apiBase={apiBase} overview={overview} onCancel={() => setEditing(false)}
        onSaved={result => { setEditing(false); setReloads(n => n + 1); onChanged?.(result); }} />
        : <PhaseBar overview={overview} today={today} />}
      {!editing && overview.frame.rationale && overview.frame.source !== 'athlete' && <p className="coach-muted">{overview.frame.rationale}</p>}
      <WeekHoursChart key={`hours-${reloads}-${overview.volume?.scale ?? 1}`} overview={overview} today={today} apiBase={apiBase}
        disabled={editing || advance?.status === 'running'} onSaved={result => { setReloads(n => n + 1); onChanged?.(result); }} />
    </section>
    <HorizonSetting key={`horizon-${overview.horizonWeeks}`} apiBase={apiBase} overview={overview} disabled={advance?.status === 'running'}
      onSaved={() => { setReloads(n => n + 1); onHorizon?.(); }} />
    {error && <div role="alert" className="coach-message error">{error}</div>}
    {advance?.status === 'running' && <JobProgress job={advance} stopping={stopping} onStop={onStop} />}
    {(overview.adapt || pendingChanges.length > 0) && advance?.status !== 'running' && <div className="coach-message plan-adapt"><span>{onlyPhases
      ? <><strong>Deine Blöcke oder Wochenstunden haben sich geändert.</strong> Die ausgearbeiteten Wochen passen nicht mehr dazu. Soll ich sie neu ausarbeiten?</>
      : <><strong>Deine Einstellungen haben sich geändert.</strong> Soll ich deinen Plan daran anpassen?</>}</span>
      <button type="button" onClick={() => onAdapt?.(overview.adapt?.changes || [])}>Plan anpassen</button></div>}
    {proposal && <section className="coach-card" aria-label={settingsChange ? 'Anpassung an deine Einstellungen' : 'Anpassung nach deiner Woche'}>
      <span className="coach-eyebrow">{settingsChange ? 'Nach deinen Einstellungen' : 'Nach deiner letzten Woche'}</span>
      <h2>Soll ich die ausgearbeiteten Wochen anpassen?</h2>
      <ChangeCard change={{ summary: settingsChange ? 'Passend zu deinen geänderten Einstellungen' : 'Leichter nach einer schwierigen Woche', status: proposal.status, hinweise: proposal.hinweise, weeks: proposalWeeks }} busy={busy}
        onConfirm={() => decide('confirm')} onDiscard={() => decide('discard')} /></section>}
    {reviewed && <WeekReview key={reviewed.week} apiBase={apiBase} week={reviewed} completedHours={reviewed.completedHours} onClose={() => setReview(null)}
      onSaved={result => { setReview(null); setReloads(n => n + 1); onChanged?.(result); if (result.job) onJob?.(result.job); }} />}
    {worked.map(w => <WeekCard key={w.week} week={w} today={today} workoutsById={workoutsById} onOpen={(session, week) => setDetail({ session, week })} onAsk={ref => onAsk(ref)} onReview={setReview} />)}
    {past.length > 0 && !past.at(-1).plan?.review && past.at(-1).plan && <div className="coach-message"><span>Der Rückblick für Woche {past.at(-1).number} fehlt noch.</span>
      <button type="button" onClick={() => setReview(past.at(-1))}>Wochenrückblick</button></div>}
    {outlined.length > 0 && <section className="coach-card plan-outlined" aria-label="Vorgemerkte Wochen"><span className="coach-eyebrow">Vorgemerkt · Phase und Zielstunden</span>
      <ul>{outlined.map(w => <li key={w.week}><strong>Woche {w.number}</strong><span>{w.phaseName || '—'} · {fmt(w.targetHours)} h{w.deload ? ' · Entlastung' : ''}</span>
        <small>{shortDay(w.startDate)} · {replanText(w, mode, today)}</small>{w.events.map(e => <span key={e.id} className={`plan-event ${e.priority}`}>{e.priority} · {e.title}</span>)}</li>)}</ul>
      {mode === 'manual' && overview.nextManualWeek && <div className="coach-actions"><button type="button" className="coach-primary" disabled={advance?.status === 'running'} onClick={onAdvance}>Nächste Woche planen</button></div>}
    </section>}
    <History weeks={past} apiBase={apiBase} version={version} />
    {detail && <SessionDetail session={detail.session} week={detail.week} workout={workoutsById[detail.session.id]} today={today} busy={busy}
      onClose={() => setDetail(null)} onAsk={onAsk} onLock={lock} onSkip={skip} onOpenWorkout={onOpenWorkout} />}
  </div>;
}
