import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDate, summary as workoutSummary } from './workoutModel';
import './AICoach.css';

const DAYS = [['mon', 'Mo'], ['tue', 'Di'], ['wed', 'Mi'], ['thu', 'Do'], ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'So']];
const PHASES = { base: 'Grundlage', build: 'Aufbau', peak: 'Höhepunkt', taper: 'Taper', recovery: 'Erholung' };
export const GOALS = { cycling_event: 'Radsport-Event', ftp: 'FTP steigern', marathon: 'Marathon', endurance: 'Allgemeine Ausdauer', running_event: 'Laufziel' };
// The backend default predates the German goal list; both mean the same goal.
const GOAL_ALIASES = { general_endurance: 'endurance' };
export const goalLabel = type => GOALS[GOAL_ALIASES[type] || type];
const PROPOSAL_TITLES = { macro: 'Trainingsblock prüfen', week: 'Wochenplan prüfen', patch: 'Wochenänderungen prüfen' };
const EMPTY_WORKOUTS = [];
const number = value => value === '' || value == null ? null : Number(value);
const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const sourceValue = value => value && typeof value === 'object' && 'value' in value ? value.value : value;
const hours = value => `${fmt(sourceValue(value))} h`;
const dateLabel = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : '';
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `timezone=${encodeURIComponent(timezone())}`;

export function isoWeek(date = localDate()) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekStart(week) {
  const [year, weekNumber] = week.split('-W').map(Number);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (weekNumber - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const weekEnd = week => addDays(weekStart(week), 6);

// Blocks start on a Monday that is not in the past.
export function nextMonday(today = localDate()) {
  const monday = weekStart(isoWeek(today));
  return monday === today ? today : addDays(monday, 7);
}

export function blockRange(block) {
  if (!block?.startDate || !block.weeks?.length) return null;
  return { start: block.startDate, end: addDays(block.startDate, block.weeks.length * 7 - 1), weeks: block.weeks.length };
}
const blockWeek = (range, date) => Math.floor(daysBetween(range.start, date) / 7) + 1;

export function missingSetup(profile) {
  const missing = [];
  if (profile?.availability?.absoluteMaxWeeklyHours == null) missing.push('Wochenmaximum');
  const open = DAYS.filter(([day]) => profile?.availability?.defaultAvailability?.[day] == null).map(([, label]) => label);
  if (open.length) missing.push(`Verfügbarkeit ${open.join(', ')}`);
  return missing;
}

function blankProfile(data = {}) {
  const goal = { type: 'endurance', name: '', date: null, target: null, ...data.goal };
  return {
    ...data,
    goal: { ...goal, type: GOAL_ALIASES[goal.type] || goal.type },
    availability: { preferredWeeklyHours: null, absoluteMaxWeeklyHours: null, ...data.availability,
      defaultAvailability: Object.fromEntries(DAYS.map(([day]) => [day, data.availability?.defaultAvailability?.[day] ?? null])) },
    preferences: { preferredRestDay: null, preferredLongSessionDay: null, indoorPreference: 'neutral', outdoorPreference: 'neutral', gymAvailability: false, ...data.preferences },
    limitations: { notes: '', ...data.limitations }, currentState: { notes: '', ...data.currentState },
  };
}

function Field({ label, children, hint }) {
  return <label className="coach-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function SeasonGoal({ goal }) {
  if (!goal?.date) return null;
  const days = daysBetween(localDate(), goal.date);
  if (days < 0) return null;
  const name = goal.name?.trim() || goalLabel(goal.type) || 'dein Ziel';
  const left = days < 7 ? (days === 1 ? 'Noch 1 Tag' : `Noch ${days} Tage`) : `Noch ${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'Woche' : 'Wochen'}`;
  return <p className="coach-season"><strong>{left}</strong> bis {name} · {dateLabel(goal.date)}</p>;
}

function SetupChecklist({ missing, providerReady, onProfile, onProvider }) {
  const steps = [
    { title: 'Athletenprofil', text: missing.length ? `Es fehlt: ${missing.join(' · ')}` : 'Erledigt', done: !missing.length, action: onProfile, label: 'Zum Athletenprofil' },
    { title: 'AI Provider', text: providerReady ? 'Erledigt' : 'Eigenen API-Key hinterlegen und die Verbindung testen.', done: providerReady, action: onProvider, label: 'Provider einrichten' },
    { title: 'Ersten Block planen', text: 'Danach schlägt dir der Coach einen Trainingsblock vor.', done: false },
  ];
  const current = steps.findIndex(step => !step.done);
  return <section className="coach-card" aria-label="Einrichtung">
    <span className="coach-eyebrow">Einrichtung</span><h2>In drei Schritten zum ersten Trainingsblock</h2>
    <ol className="coach-checklist">{steps.map((step, i) => <li key={step.title} className={step.done ? 'done' : i === current ? 'current' : ''}>
      <span className="coach-step" aria-hidden="true">{step.done ? '✓' : i + 1}</span>
      <div><strong>{step.title}</strong><small>{step.text}</small></div>
      {!step.done && step.action && <button type="button" className={i === current ? 'coach-primary' : ''} onClick={step.action}>{step.label}</button>}
    </li>)}</ol>
  </section>;
}

function BlockOverview({ value }) {
  const range = blockRange(value);
  if (!range) return <p className="coach-muted">Noch kein Trainingsblock.</p>;
  const max = Math.max(...value.weeks.map(w => Number(w.targetHours) || 0), 1);
  return <><p className="coach-muted">{dateLabel(range.start)} – {dateLabel(range.end)} · {range.weeks} {range.weeks === 1 ? 'Woche' : 'Wochen'}</p>
    <div className="coach-macro" aria-label="Wochenvolumen und Trainingsphasen">{value.weeks.map((w, i) =>
      <div key={w.week ?? i} className="coach-macro-week" title={`Woche ${w.week}: ${PHASES[w.phase] || w.phase}, ${hours(w.targetHours)}. ${w.focus || ''}`}>
        <span>{fmt(w.targetHours)}</span><div className="coach-bar-track"><div className={`coach-bar ${w.phase}`} style={{ height: `${Math.max(3, Number(w.targetHours) / max * 100)}%` }} /></div>
        <strong>{w.week ?? i + 1}</strong><small>{PHASES[w.phase] || w.phase}</small>
      </div>)}</div>
    <details className="coach-details"><summary>Wochenziele lesen</summary><ul className="coach-focus-list">{value.weeks.map((w, i) => <li key={i}><strong>Woche {w.week ?? i + 1} · {PHASES[w.phase] || w.phase} · {hours(w.targetHours)}</strong><span>{w.focus || 'Kein zusätzlicher Fokus'}</span></li>)}</ul></details>
  </>;
}

const sessionName = session => session.rendered?.name || session.name || session.template;
const sessionDuration = session => session.rendered?.durationMin ?? session.params?.durationMin;
function SessionList({ value }) {
  if (!value) return <p className="coach-muted">Noch keine Woche geplant.</p>;
  return <><p className="coach-week-focus"><strong>{hours(value.targetHours)}</strong> · {value.focus || 'Trainingswoche'}</p>
    <div className="coach-sessions">{(value.sessions || []).map((session, i) => <div className="coach-session" key={session.id || i}>
      <strong className="coach-day">{DAYS.find(([d]) => d === session.day)?.[1] || session.day}</strong>
      <div><strong>{sessionName(session)}</strong><small>{session.rendered?.date && `${dateLabel(session.rendered.date)} · `}{sessionDuration(session) == null ? 'Dauer offen' : `${fmt(sessionDuration(session))} min`}{session.rendered?.estimatedTss != null && ` · ${fmt(session.rendered.estimatedTss)} TSS`}</small></div>
      {session.locked && <span className="coach-badge">Fixiert</span>}
    </div>)}</div></>;
}

function Proposal({ value, busy, onConfirm, onDiscard }) {
  const macro = value.kind === 'macro';
  const beforeSessions = value.before?.sessions || [];
  const afterSessions = value.after?.sessions || [];
  const changes = macro ? [] : [
    ...afterSessions.flatMap(s => {
      const before = beforeSessions.find(b => b.id === s.id);
      if (!before) return [`Neu: ${sessionName(s)} (${DAYS.find(([d]) => d === s.day)?.[1] || s.day})`];
      if (JSON.stringify([before.day, before.template, before.params]) !== JSON.stringify([s.day, s.template, s.params])) return [`Geändert: ${sessionName(before)} → ${sessionName(s)} (${DAYS.find(([d]) => d === s.day)?.[1] || s.day})`];
      return [];
    }), ...beforeSessions.filter(b => !afterSessions.some(s => b.id === s.id)).map(s => `Entfällt: ${sessionName(s)}`),
  ];
  return <section className="coach-card coach-proposal" aria-label="Planvorschlag prüfen">
    <div className="coach-section-heading"><div><span className="coach-eyebrow">AI-Empfehlung · Noch nicht gespeichert</span><h2>{PROPOSAL_TITLES[value.kind] || 'Vorschlag prüfen'}</h2></div><span className="coach-badge recommendation">Vorschau</span></div>
    <p>Prüfe den Vorschlag und übernimm ihn ausdrücklich. Bis dahin ändert sich nichts.</p>
    {changes.length > 0 && <ul className="coach-change-list">{changes.map((change, i) => <li key={i}>{change}</li>)}</ul>}
    <div className="coach-compare"><div><h3>Bisher</h3>{macro ? <BlockOverview value={value.before} /> : <SessionList value={value.before} />}</div><div><h3>Vorgeschlagen</h3>{macro ? <BlockOverview value={value.after} /> : <SessionList value={value.after} />}</div></div>
    <div className="coach-actions"><button className="coach-primary" disabled={busy} onClick={onConfirm}>Änderungen bestätigen und übernehmen</button><button disabled={busy} onClick={onDiscard}>Vorschlag verwerfen</button></div>
  </section>;
}

export default function AICoach({ initialTab = 'plan', apiBase = '', workouts = EMPTY_WORKOUTS, onWorkoutsChanged, onOpenWorkout }) {
  const [tab, setTab] = useState(initialTab);
  const [snapshot, setSnapshot] = useState(null);
  const [profile, setProfile] = useState(null);
  const [provider, setProvider] = useState(null);
  const [model, setModel] = useState('gpt-4.1-mini');
  const [apiKey, setApiKey] = useState('');
  const [plan, setPlan] = useState(null);
  const [week, setWeek] = useState(() => isoWeek());
  const [weekly, setWeekly] = useState({ overrides: {}, note: '' });
  const [daily, setDaily] = useState({ date: localDate(), action: 'normal', maxMinutes: '', note: '' });
  const [checkIn, setCheckIn] = useState({ date: localDate(), fatigue: 3, motivation: 3, stress: 3, sleepQuality: 3, soreness: 3, notes: '' });
  const [startDate, setStartDate] = useState(() => nextMonday());
  const [weeks, setWeeks] = useState(6);
  const [instruction, setInstruction] = useState('');
  const [feedbackWeek, setFeedbackWeek] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [dirty, setDirty] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const contextVersion = useRef(0);
  const pending = useRef(false);
  const priorWorkouts = useRef(workouts);
  const currentWeek = plan?.weeks?.[week];
  const anyDirty = Object.values(dirty).some(Boolean);
  const weekWorkouts = useMemo(() => workouts.filter(w => w.date >= weekStart(week) && w.date <= weekEnd(week)), [workouts, week]);

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Anfrage fehlgeschlagen (${response.status}).`);
    return data;
  }
  function invalidate(area) {
    contextVersion.current += 1;
    setProposal(null); setNotice('');
    if (area) setDirty(d => ({ ...d, [area]: true }));
  }
  async function run(label, action) {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e.message || 'Die Anfrage konnte nicht abgeschlossen werden.'); }
    finally { pending.current = false; setBusy(''); }
  }
  async function refreshSnapshot() { setSnapshot(await request(`/api/athlete-snapshot?${tzQuery()}`)); }

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([request(`/api/athlete-snapshot?${tzQuery()}`), request('/api/athlete-profile'), request('/api/ai-provider'), request('/api/coach/plan')])
      .then(([s, p, ai, saved]) => {
        if (cancelled) return;
        setSnapshot(s); setProfile(blankProfile(p)); setProvider(ai); setModel(ai.model || 'gpt-4.1-mini'); setPlan(saved);
        const range = blockRange(saved.macroPlan);
        if (range && localDate() < range.start) setWeek(isoWeek(range.start)); // An upcoming block starts with its first week.
      })
      .catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; contextVersion.current += 1; };
    // apiBase selects the backend; individual writes refresh their own state.
  }, [apiBase]);

  useEffect(() => {
    if (dirty.weekly) return;
    const override = profile?.weeklyOverrides?.find(entry => entry.week === week);
    setWeekly({ overrides: override?.overrides || {}, note: override?.note || '' });
    setDirty(d => ({ ...d, weekly: false }));
    // A profile save must not replace a weekly draft the athlete is still editing.
  }, [week, profile?.weeklyOverrides]);
  useEffect(() => {
    if (priorWorkouts.current !== workouts) { priorWorkouts.current = workouts; contextVersion.current += 1; setProposal(null); setFeedback(null); }
  }, [workouts]);

  function editProfile(section, key, value) {
    invalidate('profile'); setProfile(p => ({ ...p, [section]: { ...p[section], [key]: value } }));
  }
  function editWeekly(day, patch) {
    invalidate('weekly'); setWeekly(w => ({ ...w, overrides: { ...w.overrides, [day]: { ...w.overrides[day], ...patch } } }));
  }
  async function saveProfile(event) {
    event.preventDefault();
    await run('Profil wird gespeichert …', async () => {
      const { goal, availability, preferences, limitations, currentState } = profile;
      const saved = await request('/api/athlete-profile', 'PUT', { goal, availability, preferences, limitations, currentState });
      setProfile(blankProfile(saved)); setDirty(d => ({ ...d, profile: false })); invalidate();
      await refreshSnapshot(); setNotice('Dein Athletenprofil wurde gespeichert.');
    });
  }
  async function propose(kind) {
    if (anyDirty) { setError('Speichere zuerst deine offenen Änderungen.'); return; }
    const version = contextVersion.current;
    await run('Der Coach erstellt einen Vorschlag …', async () => {
      setProposal(null);
      const body = kind === 'macro' ? { kind, startDate, weeks: Number(weeks) } : { kind, week, instruction, ...(kind === 'patch' && feedbackWeek ? { feedbackWeek } : {}) };
      const next = await request(`/api/coach/proposals?${tzQuery()}`, 'POST', body);
      if (contextVersion.current === version) setProposal(next);
    });
  }
  const canPlan = !busy && !anyDirty && provider?.configured;
  const block = plan?.macroPlan;
  const range = blockRange(block);
  const today = localDate();
  const missing = profile ? missingSetup(profile) : [];
  const profileReady = !missing.length && !dirty.profile;
  // Exactly one next step: set up, start a block, work through it, or start the next one.
  const stage = range ? (today > range.end ? 'ended' : 'active') : profileReady && provider?.configured ? 'start' : 'setup';
  const blockForm = label => <fieldset disabled={!!busy}><div className="coach-inline-form">
    <Field label="Start (Montag)"><input type="date" min={nextMonday()} value={startDate} onChange={e => { if (e.target.value) { invalidate(); setStartDate(weekStart(isoWeek(e.target.value))); } }} /></Field>
    <Field label="Wochen"><input type="number" min="1" max="12" value={weeks} onChange={e => { invalidate(); setWeeks(e.target.value); }} /></Field>
    <button className="coach-primary" disabled={!canPlan || !weeks || weeks < 1 || weeks > 12} onClick={() => propose('macro')}>{label}</button>
  </div><p className="coach-muted">Ein Trainingsblock dauert meist 4–12 Wochen und endet idealerweise mit einer Entlastungswoche.</p></fieldset>;

  return <div className="ai-coach">
    <header className="coach-heading"><div><span className="coach-eyebrow">Training Plēnum / Dein Training, mit Kontext</span><h1>AI Coach <span className="coach-beta">BYOK</span></h1><p>Deine Trainingsdaten. Deine Ziele. Ein Plan, den du freigibst.</p></div><span className={`coach-connection ${provider?.configured ? 'ready' : ''}`}><i />{provider?.configured ? 'Provider verbunden' : 'Provider einrichten'}</span></header>
    <nav className="coach-tabs" aria-label="AI Coach Bereiche">{[['plan', 'Trainingsplan'], ['profile', 'Athletenprofil'], ['provider', 'AI Provider']].map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}{((key === 'profile' && dirty.profile) || (key === 'provider' && dirty.provider)) && <span aria-label="Ungespeicherte Änderungen"> •</span>}</button>)}</nav>
    {error && <div role="alert" className="coach-message error">{error}{!profile && !loading && <button onClick={() => window.location.reload()}>Erneut laden</button>}</div>}
    {notice && <div role="status" className="coach-message success">{notice}</div>}
    {busy && <div role="status" className="coach-message"><span className="coach-spinner" />{busy}</div>}
    {loading && <p role="status" className="coach-muted">Athletenkontext wird geladen …</p>}
    {!loading && snapshot && <section className="coach-stats" aria-label="Gemessener Trainingskontext">
      {[['Letzte 7 Tage', snapshot.observed?.currentTraining?.last7Days?.trainingHours, 'Trainingsstunden'], ['Letzte 28 Tage', snapshot.observed?.currentTraining?.last28Days?.trainingHours, 'Trainingsstunden'], ['Letzte 42 Tage', snapshot.observed?.currentTraining?.last42Days?.trainingHours, 'Trainingsstunden'], ['Historisch · 6 Wochen Ø', snapshot.observed?.observedTrainingCapacity?.max6WeekAverageHours, 'Maximal beobachtet pro Woche']].map(([label, value, sub]) => <div key={label}><span>{label}</span><strong>{hours(value)}</strong><small>{sub}</small></div>)}
      <p>Aus Trainingsdaten berechnet · Historischer Umfang ist keine Belastbarkeitsempfehlung.</p>
    </section>}

    {!loading && profile && tab === 'profile' && <form onSubmit={saveProfile} className="coach-card">
      <fieldset disabled={!!busy}><div className="coach-section-heading"><div><span className="coach-eyebrow">Selbstauskunft · Von dir</span><h2>Wofür trainierst du?</h2></div><span className="coach-badge athlete">Athlet</span></div>
        <div className="coach-form-grid"><Field label="Zieltyp"><select value={profile.goal.type} onChange={e => editProfile('goal', 'type', e.target.value)}>{Object.entries(GOALS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{!GOALS[profile.goal.type] && <option value={profile.goal.type}>{profile.goal.type}</option>}</select></Field>
          <Field label="Ziel / Event"><input maxLength={200} value={profile.goal.name} onChange={e => editProfile('goal', 'name', e.target.value)} placeholder="z. B. Ötztaler Radmarathon" /></Field>
          <Field label="Zieldatum"><input type="date" value={profile.goal.date || ''} onChange={e => editProfile('goal', 'date', e.target.value || null)} /></Field>
          <Field label="Konkretes Ziel (optional)"><input maxLength={300} value={profile.goal.target || ''} onChange={e => editProfile('goal', 'target', e.target.value || null)} placeholder="z. B. entspannt finishen" /></Field>
          <Field label="Gewünschter Umfang (h/Woche)"><input type="number" min="0" max="60" step="0.5" value={profile.availability.preferredWeeklyHours ?? ''} onChange={e => editProfile('availability', 'preferredWeeklyHours', number(e.target.value))} /></Field>
          <Field label="Absolutes Zeitmaximum (h/Woche)" hint="Dein zeitliches Limit für Ausnahmefälle."><input type="number" min={profile.availability.preferredWeeklyHours || 0} max="60" step="0.5" value={profile.availability.absoluteMaxWeeklyHours ?? ''} onChange={e => editProfile('availability', 'absoluteMaxWeeklyHours', number(e.target.value))} /></Field></div>
        <h3>Deine normale Woche</h3><p className="coach-muted">Minuten pro Tag. 0 = keine Zeit, leer = noch offen.</p>
        <div className="coach-day-inputs">{DAYS.map(([day, label]) => <Field key={day} label={label}><input aria-label={`${label} Standardverfügbarkeit in Minuten`} type="number" min="0" max="1440" step="5" value={profile.availability.defaultAvailability[day] ?? ''} onChange={e => editProfile('availability', 'defaultAvailability', { ...profile.availability.defaultAvailability, [day]: number(e.target.value) })} /></Field>)}</div>
        <div className="coach-form-grid">{[['preferredRestDay', 'Bevorzugter Ruhetag'], ['preferredLongSessionDay', 'Tag für lange Einheiten']].map(([key, label]) => <Field key={key} label={label}><select value={profile.preferences[key] || ''} onChange={e => editProfile('preferences', key, e.target.value || null)}><option value="">Keine Präferenz</option>{DAYS.map(([day, name]) => <option value={day} key={day}>{name}</option>)}</select></Field>)}
          {[['indoorPreference', 'Indoor'], ['outdoorPreference', 'Outdoor']].map(([key, label]) => <Field label={label} key={key}><select value={profile.preferences[key]} onChange={e => editProfile('preferences', key, e.target.value)}><option value="neutral">Neutral</option><option value="prefer">Bevorzugt</option><option value="avoid">Vermeiden</option></select></Field>)}
        </div>
        <label className="coach-checkbox"><input type="checkbox" checked={profile.preferences.gymAvailability} onChange={e => editProfile('preferences', 'gymAvailability', e.target.checked)} />Fitnessstudio verfügbar</label>
        <div className="coach-form-grid"><Field label="Einschränkungen"><textarea maxLength={2000} value={profile.limitations.notes} onChange={e => editProfile('limitations', 'notes', e.target.value)} placeholder="Verletzungen, Einschränkungen oder Dinge, die berücksichtigt werden sollen" /></Field><Field label="Aktueller Zustand"><textarea maxLength={2000} value={profile.currentState.notes} onChange={e => editProfile('currentState', 'notes', e.target.value)} placeholder="Was sollte der Coach über deine aktuelle Situation wissen?" /></Field></div>
        <div className="coach-actions"><button className="coach-primary" type="submit">Athletenprofil speichern</button>{dirty.profile && <small className="coach-muted">Ungespeicherte Angaben</small>}</div>
      </fieldset>
    </form>}

    {!loading && provider && tab === 'provider' && <section className="coach-card coach-provider">
      <span className="coach-eyebrow">Bring your own key</span><h2>Dein AI Provider</h2><p className="coach-muted">Training Plēnum sendet verdichteten Trainingskontext und Workout-Templates an deinen Provider. Modellanfragen werden über deinen API-Zugang abgerechnet.</p>
      {!provider.encryptionConfigured && <div className="coach-message">Vor dem Speichern muss die serverseitige Schlüsselverschlüsselung eingerichtet werden. Details findest du in der Backend-Konfiguration.</div>}
      <form onSubmit={event => { event.preventDefault(); const key = apiKey.trim(); setApiKey(''); run('Provider wird gespeichert …', async () => { const saved = await request('/api/ai-provider', 'PUT', { provider: 'openai', model: model.trim(), ...(key ? { apiKey: key } : {}) }); setProvider(saved); setModel(saved.model || model); setDirty(d => ({ ...d, provider: false })); invalidate(); setNotice('Provider-Einstellungen gespeichert.'); }); }}>
        <fieldset disabled={!!busy}><div className="coach-form-grid"><Field label="Provider"><select value="openai" disabled><option value="openai">OpenAI</option></select></Field><Field label="Modell"><input required list="coach-models" value={model} onChange={e => { invalidate('provider'); setModel(e.target.value); }} /><datalist id="coach-models"><option value="gpt-4.1-mini" /><option value="gpt-4.1" /><option value="gpt-4o-mini" /></datalist></Field></div>
          <Field label={provider.configured ? `API Key ersetzen (gespeichert: ••••${provider.keyLast4 || ''})` : 'API Key'} hint="Der Key wird verschlüsselt im Backend gespeichert. Das Browserfeld wird nach dem Absenden geleert."><input type="password" autoComplete="new-password" spellCheck="false" value={apiKey} placeholder={provider.configured ? 'Leer lassen, um den vorhandenen Key zu behalten' : 'API Key eingeben'} onChange={e => { invalidate('provider'); setApiKey(e.target.value); }} /></Field>
          <div className="coach-actions"><button className="coach-primary" type="submit" disabled={!provider.encryptionConfigured}>Provider speichern</button><button type="button" disabled={!provider.configured || dirty.provider} onClick={() => run('Verbindung wird geprüft …', async () => { await request('/api/ai-provider/test', 'POST', {}); setNotice('Verbindung zum Provider erfolgreich.'); })}>Verbindung testen</button>{provider.configured && <button type="button" className="coach-danger" onClick={() => run('Key wird entfernt …', async () => { const saved = await request('/api/ai-provider', 'DELETE'); setProvider({ ...provider, ...saved, configured: false, keyLast4: null }); setApiKey(''); setDirty(d => ({ ...d, provider: false })); invalidate(); setNotice('API Key entfernt.'); })}>Gespeicherten Key entfernen</button>}</div>
        </fieldset>
      </form>
    </section>}

    {!loading && profile && tab === 'plan' && <>
      <SeasonGoal goal={profile.goal} />
      {stage !== 'setup' && !provider?.configured && <div className="coach-message">Verbinde deinen eigenen API-Zugang, um Vorschläge zu erstellen. <button onClick={() => setTab('provider')}>Provider einrichten</button></div>}
      {anyDirty && <div className="coach-message">Speichere deine offenen Angaben, bevor du einen neuen AI-Vorschlag erstellst.</div>}
      {stage === 'setup' && <SetupChecklist missing={dirty.profile ? [...missing, 'Änderungen speichern'] : missing} providerReady={!!provider?.configured} onProfile={() => setTab('profile')} onProvider={() => setTab('provider')} />}
      {stage === 'start' && <section className="coach-card"><span className="coach-eyebrow">Nächster Schritt</span><h2>Neuen Trainingsblock starten</h2>
        <p className="coach-muted">Der Coach schlägt Phasen, Wochenumfänge und Entlastung für den Block vor. Gespeichert wird erst, wenn du den Vorschlag übernimmst.</p>
        {blockForm('Trainingsblock vorschlagen')}
      </section>}
      {stage === 'ended' && <section className="coach-card"><span className="coach-eyebrow">Block abgeschlossen</span><h2>Neuen Trainingsblock starten</h2>
        <BlockOverview value={block} />
        {blockForm('Nächsten Trainingsblock vorschlagen')}
      </section>}
      {stage === 'active' && <><section className="coach-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">Aktueller Trainingsblock</span><h2>{today < range.start ? `Startet am ${dateLabel(range.start)}` : `Woche ${blockWeek(range, today)} von ${range.weeks}`}</h2></div><span className="coach-badge recommendation">AI-Empfehlung</span></div>
        <BlockOverview value={block} />
        {!Object.keys(plan.weeks || {}).length && <details className="coach-details"><summary>Block neu planen</summary><p className="coach-muted">Solange noch keine Woche geplant ist, kannst du den Block ersetzen.</p>{blockForm('Neuen Trainingsblock vorschlagen')}</details>}
      </section>
      <section className="coach-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">{weekStart(week) >= range.start && weekStart(week) <= range.end ? `Woche ${blockWeek(range, weekStart(week))} von ${range.weeks}` : 'Außerhalb des Blocks'}</span><h2>Deine Trainingswoche</h2></div><Field label="Kalenderwoche"><input aria-label="Planungswoche" type="week" min={isoWeek(range.start)} max={isoWeek(range.end)} value={week} disabled={!!busy} onChange={e => { if (e.target.value && !dirty.weekly) { invalidate(); setFeedback(null); setWeek(e.target.value); } else if (dirty.weekly) setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); }} /></Field></div>
        <p className="coach-muted">{dateLabel(weekStart(week))} – {dateLabel(weekEnd(week))} · {week}</p><SessionList value={currentWeek} />
        <details className="coach-details"><summary>Verfügbarkeit für diese Woche {dirty.weekly ? '· ungespeichert' : ''}</summary><p className="coach-muted">Nur für {week}. Deine normale Wochenverfügbarkeit bleibt bestehen.</p><form onSubmit={event => { event.preventDefault(); run('Wochenverfügbarkeit wird gespeichert …', async () => {
          const body = { overrides: Object.fromEntries(Object.entries(weekly.overrides).map(([day, values]) => [day, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '' && v !== null))])), note: weekly.note };
          await request(`/api/coach/weekly-overrides/${week}`, 'PUT', body); setDirty(d => ({ ...d, weekly: false })); invalidate();
          setProfile(p => ({ ...p, weeklyOverrides: [...(p.weeklyOverrides || []).filter(w => w.week !== week), { week, ...body }] })); await refreshSnapshot(); setNotice('Wochenverfügbarkeit gespeichert. Du kannst jetzt eine Anpassung vorschlagen lassen.');
        }); }}><fieldset disabled={!!busy}><div className="coach-week-availability">{DAYS.map(([day, label]) => { const values = weekly.overrides[day] || {}; return <div className="coach-availability-day" key={day}><strong>{label}</strong><small>Standard: {profile.availability.defaultAvailability[day] == null ? 'offen' : `${profile.availability.defaultAvailability[day]} min`}</small><select aria-label={`${label} Verfügbarkeit diese Woche`} value={values.available === false ? 'no' : values.available === true ? 'yes' : 'default'} onChange={e => editWeekly(day, { available: e.target.value === 'default' ? undefined : e.target.value === 'yes' })}><option value="default">Standard</option><option value="yes">Verfügbar</option><option value="no">Keine Zeit</option></select><input aria-label={`${label} Minuten diese Woche`} type="number" min="0" max="1440" step="5" placeholder="Minuten" disabled={values.available === false} value={values.maxMinutes ?? ''} onChange={e => editWeekly(day, { maxMinutes: number(e.target.value) })} /><label className="coach-checkbox"><input type="checkbox" checked={!!values.preferLong} disabled={values.available === false} onChange={e => editWeekly(day, { preferLong: e.target.checked })} />Lang bevorzugt</label></div>; })}</div><Field label="Notiz zur Woche"><textarea maxLength={2000} value={weekly.note} onChange={e => { invalidate('weekly'); setWeekly(w => ({ ...w, note: e.target.value })); }} /></Field><button type="submit">Wochenverfügbarkeit speichern</button></fieldset></form></details>
        <fieldset disabled={!!busy}><Field label="Wunsch für die Planung"><textarea maxLength={2000} value={instruction} placeholder="z. B. Donnerstag und Freitag frei halten, die lange Ausfahrt am Samstag beibehalten." onChange={e => { invalidate(); setInstruction(e.target.value); }} /></Field>
          <div className="coach-actions"><button className="coach-primary" disabled={!canPlan || !!currentWeek} onClick={() => propose('week')}>Woche planen</button><button disabled={!canPlan || !currentWeek} onClick={() => propose('patch')}>Woche anpassen</button></div>
        </fieldset>
        <details className="coach-details"><summary>Absolviertes Training berücksichtigen</summary><p className="coach-muted">Wähle eine abgeschlossene Woche als Grundlage für die nächste Anpassung.</p><fieldset disabled={!!busy}><div className="coach-inline-form"><Field label="Feedback-Woche"><input type="week" value={feedbackWeek} onChange={e => { invalidate(); setFeedback(null); setFeedbackWeek(e.target.value); }} /></Field><button disabled={!feedbackWeek} onClick={() => run('Wochenfeedback wird geladen …', async () => { setFeedback(await request(`/api/coach/feedback?week=${encodeURIComponent(feedbackWeek)}&${tzQuery()}`)); })}>Training vergleichen</button></div></fieldset>{feedback && <div className="coach-feedback"><div><small>Geplant</small><strong>{hours(feedback.planned?.hours ?? feedback.planned?.trainingHours)}</strong></div><div><small>Absolviert</small><strong>{hours(feedback.completed?.hours ?? feedback.completed?.trainingHours)}</strong></div><div><small>Nicht zugeordnet / ausgefallen</small><strong>{feedback.missedSessions?.length ?? '—'} Einheiten</strong></div></div>}{feedbackWeek && <p className="coach-muted">Eine Anpassung berücksichtigt {feedbackWeek}. Die Zuordnung von Aktivitäten zu Einheiten kann unvollständig sein.</p>}</details>
      </section></>}

      {proposal && <Proposal value={proposal} busy={!!busy} onDiscard={() => run('Vorschlag wird verworfen …', async () => { await request(`/api/coach/proposals/${proposal.id}/discard`, 'POST', {}); setProposal(null); setNotice('Vorschlag verworfen.'); })} onConfirm={() => run('Plan wird übernommen …', async () => { try { const saved = await request(`/api/coach/proposals/${proposal.id}/confirm`, 'POST', { confirm: true }); setPlan(saved); setProposal(null); await onWorkoutsChanged?.(); setNotice('Plan übernommen. Die Einheiten sind im Kalender verfügbar.'); } catch (e) { setProposal(null); throw e; } })} />}

      {stage === 'active' && <div className="coach-secondary-grid"><section className="coach-card"><span className="coach-eyebrow">Dein Kalender / Feste Zusagen</span><h2>Einheiten fixieren</h2><p className="coach-muted">Fixierte Einheiten werden bei einer AI-Anpassung unverändert übernommen.</p>{weekWorkouts.length ? <div className="coach-lock-list">{weekWorkouts.map(workout => <div key={workout.id}><button className="coach-workout-link" disabled={!onOpenWorkout || !!busy} onClick={() => onOpenWorkout?.(workout)}><strong>{workout.name}</strong><small>{dateLabel(workout.date)} · {workout.steps ? workoutSummary(workout) : ''}</small></button><button disabled={!!busy} aria-pressed={!!workout.locked} onClick={() => run('Einheit wird aktualisiert …', async () => { invalidate(); await request(`/api/workouts/${workout.id}/lock`, 'PUT', { locked: !workout.locked }); setPlan(await request('/api/coach/plan')); await onWorkoutsChanged?.(); setNotice(workout.locked ? 'Fixierung aufgehoben.' : 'Einheit fixiert.'); })}>{workout.locked ? 'Fixiert · lösen' : 'Fixieren'}</button></div>)}</div> : <p className="coach-empty">In dieser Woche gibt es noch keine Kalendereinheiten. Du kannst auch eigene Workouts im Kalender anlegen und hier fixieren.</p>}</section>
        <section className="coach-card"><span className="coach-eyebrow">Selbstauskunft / Tagesform</span><h2>Heute zählt auch</h2>
          <details className="coach-details"><summary>Kurzfristige Änderung {dirty.daily ? '· ungespeichert' : ''}</summary><form onSubmit={event => { event.preventDefault(); run('Tagesänderung wird gespeichert …', async () => { await request(`/api/coach/daily-overrides/${daily.date}`, 'PUT', { action: daily.action, ...(daily.action === 'skip' ? { available: false } : { available: true }), ...(daily.maxMinutes === '' ? {} : { maxMinutes: Number(daily.maxMinutes) }), note: daily.note }); setDirty(d => ({ ...d, daily: false })); invalidate(); await refreshSnapshot(); setNotice('Tagesänderung gespeichert. Lass den Plan bei Bedarf anpassen.'); }); }}><fieldset disabled={!!busy}><div className="coach-form-grid"><Field label="Tag"><input type="date" required value={daily.date} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, date: e.target.value })); }} /></Field><Field label="Änderung"><select value={daily.action} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, action: e.target.value })); }}><option value="normal">Normal / Zeit ändern</option><option value="reduce">Einheit reduzieren</option><option value="skip">Einheit auslassen</option></select></Field><Field label="Heute maximal (Minuten)"><input type="number" min="0" max="1440" step="5" value={daily.maxMinutes} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, maxMinutes: e.target.value })); }} /></Field></div><Field label="Notiz zur Tagesänderung"><textarea maxLength={2000} value={daily.note} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, note: e.target.value })); }} /></Field><button type="submit">Tagesänderung speichern</button></fieldset></form></details>
          <details className="coach-details"><summary>Check-in {dirty.checkIn ? '· ungespeichert' : ''}</summary><p className="coach-muted">1 = sehr niedrig / schlecht, 5 = sehr hoch / gut. Deine persönliche Einschätzung.</p><form onSubmit={event => { event.preventDefault(); run('Check-in wird gespeichert …', async () => { await request('/api/coach/check-ins', 'POST', checkIn); setDirty(d => ({ ...d, checkIn: false })); invalidate(); await refreshSnapshot(); setNotice('Check-in gespeichert.'); }); }}><fieldset disabled={!!busy}><Field label="Check-in Datum"><input type="date" required value={checkIn.date} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, date: e.target.value })); }} /></Field>{[['fatigue', 'Müdigkeit'], ['motivation', 'Motivation'], ['stress', 'Stress'], ['sleepQuality', 'Schlafqualität'], ['soreness', 'Muskelkater']].map(([key, label]) => <label className="coach-rating" key={key}><span>{label}</span><input aria-label={label} type="range" min="1" max="5" value={checkIn[key]} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, [key]: Number(e.target.value) })); }} /><output>{checkIn[key]}/5</output></label>)}<Field label="Check-in Notiz"><textarea maxLength={2000} value={checkIn.notes} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, notes: e.target.value })); }} /></Field><button type="submit">Check-in speichern</button></fieldset></form></details>
        </section></div>}
    </>}
    {!loading && snapshot && <details className="coach-card coach-context"><summary>Datenbasis & Herkunft</summary><div className="coach-provenance"><span className="coach-badge">Berechnet · Trainingsdaten</span><span className="coach-badge athlete">Athlet · Selbstauskunft</span><span className="coach-badge recommendation">AI · Empfehlung</span></div><p className="coach-muted">Fehlende Messwerte bleiben offen. Der Snapshot enthält verdichtete Daten ohne Sensorstreams.</p><div className="coach-quality"><span>FTP: <strong>{snapshot.dataQuality?.ftpConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Maximale Herzfrequenz: <strong>{snapshot.dataQuality?.maxHrConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Leistungsdaten (42 Tage): <strong>{snapshot.dataQuality?.cyclingPowerCoverageLast42Days == null ? '—' : `${fmt(snapshot.dataQuality.cyclingPowerCoverageLast42Days * 100)} %`}</strong></span></div><details className="coach-details"><summary>Kompakten Athlete Snapshot ansehen</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details></details>}
  </div>;
}
