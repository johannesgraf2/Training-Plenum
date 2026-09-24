import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { localDate, summary as workoutSummary } from './workoutModel';
import './AICoach.css';

const DAYS = [['mon', 'Mo'], ['tue', 'Di'], ['wed', 'Mi'], ['thu', 'Do'], ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'So']];
const PHASES = { base: 'Grundlage', build: 'Aufbau', peak: 'Höhepunkt', taper: 'Taper', recovery: 'Erholung' };
export const GOALS = { cycling_event: 'Radsport-Event', ftp: 'FTP steigern', marathon: 'Marathon', endurance: 'Allgemeine Ausdauer', running_event: 'Laufziel' };
// The backend default predates the German goal list; both mean the same goal.
const GOAL_ALIASES = { general_endurance: 'endurance' };
export const goalLabel = type => GOALS[GOAL_ALIASES[type] || type];
const PROPOSAL_TITLES = { block: 'Trainingsblock wählen', week: 'Wochenplan prüfen', patch: 'Wochenänderungen prüfen' };
const SITUATIONS = { nach_pause: 'Nach einer Pause', mitten_im_training: 'Mitten im Training', saison_vorbei: 'Saison vorbei' };
const SITUATION_HINTS = { nach_pause: 'Du steigst nach Krankheit, Urlaub oder Pause wieder ein.', mitten_im_training: 'Du trainierst regelmäßig und willst gezielt weiter.', saison_vorbei: 'Der Höhepunkt liegt hinter dir, Erholung steht an.' };
const WIZARD_STEPS = ['Ausgangslage', 'Weg', 'Auswahl', 'Vorschau'];
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
  return { start: block.startDate, end: block.endDate || addDays(block.startDate, block.weeks.length * 7 - 1), weeks: block.weeks.length };
}

// The running block, else the next one, else the most recent; replaced blocks are history only.
export function currentBlock(blocks = [], today = localDate()) {
  const usable = blocks.filter(block => block.status !== 'abandoned' && blockRange(block));
  return usable.find(block => block.startDate <= today && today <= blockRange(block).end)
    || usable.filter(block => block.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
    || usable[usable.length - 1] || null;
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

function BlockOverview({ value, chart }) {
  const range = blockRange(value);
  if (!range) return <p className="coach-muted">Noch kein Trainingsblock.</p>;
  const max = Math.max(...value.weeks.map(w => Number(w.targetHours) || 0), 1);
  const type = [value.typeName, value.secondaryName && `+ ${value.secondaryName}`].filter(Boolean).join(' ');
  return <><p className="coach-muted">{type && <strong className="coach-block-type">{type}</strong>}{type && ' · '}{dateLabel(range.start)} – {dateLabel(range.end)} · {range.weeks} {range.weeks === 1 ? 'Woche' : 'Wochen'}</p>
    {chart || <>
    <div className="coach-macro" aria-label="Wochenvolumen und Trainingsphasen">{value.weeks.map((w, i) =>
      <div key={w.week ?? i} className="coach-macro-week" title={`Woche ${w.week}: ${PHASES[w.phase] || w.phase}, ${hours(w.targetHours)}. ${w.focus || ''}`}>
        <span>{fmt(w.targetHours)}</span><div className="coach-bar-track"><div className={`coach-bar ${w.phase}`} style={{ height: `${Math.max(3, Number(w.targetHours) / max * 100)}%` }} /></div>
        <strong>{w.week ?? i + 1}</strong><small>{PHASES[w.phase] || w.phase}</small>
      </div>)}</div>
    <details className="coach-details"><summary>Wochenziele lesen</summary><ul className="coach-focus-list">{value.weeks.map((w, i) => <li key={i}><strong>Woche {w.week ?? i + 1} · {PHASES[w.phase] || w.phase} · {hours(w.targetHours)}</strong><span>{w.focus || 'Kein zusätzlicher Fokus'}</span></li>)}</ul></details>
    </>}
  </>;
}

// Bullet chart per block week: outline = planned (dashed = block target only), solid = completed hours.
function BlockTimeline({ timeline, selected, onSelect }) {
  const weeks = timeline.weeks;
  const planned = w => w.plannedHours ?? w.targetHours;
  const max = Math.max(1, ...weeks.flatMap(w => [Number(planned(w)) || 0, Number(w.completedHours) || 0]));
  const height = value => `${value ? Math.max(3, value / max * 100) : 0}%`;
  const describe = w => `Woche ${w.number}, ${PHASES[w.phase] || w.phase}: ${w.planned ? 'geplant' : 'Blockziel'} ${hours(planned(w))}, absolviert ${w.completedHours == null ? 'noch offen' : hours(w.completedHours)}`;
  return <>
    <ol className="coach-timeline" aria-label="Block-Zeitstrahl: geplant und absolviert">{weeks.map(w => <li key={w.week} className={w.state}>
      <button type="button" aria-pressed={selected === w.week} aria-label={describe(w)} title={`${describe(w)}${w.focus ? `. ${w.focus}` : ''}`} onClick={() => onSelect(w.week)}>
        <span className="coach-timeline-value">{w.state === 'current' && <em>Jetzt</em>}{w.completedHours == null ? '—' : fmt(w.completedHours)} / {fmt(planned(w))}</span>
        <span className="coach-timeline-track"><i className={`target ${w.planned ? '' : 'open'}`} style={{ height: height(planned(w)) }} /><i className="done" style={{ height: height(w.completedHours) }} /></span>
        <strong>{w.number}</strong><small>{PHASES[w.phase] || w.phase}</small>
      </button>
    </li>)}</ol>
    <div className="coach-timeline-legend"><span><i className="target" />Geplant</span><span><i className="target open" />Blockziel, Woche noch nicht geplant</span><span><i className="done" />Absolviert (Stunden, aus Trainingsdaten)</span></div>
    <details className="coach-details"><summary>Als Tabelle anzeigen</summary><table className="coach-table"><thead><tr><th>Woche</th><th>Phase</th><th>Geplant</th><th>Absolviert</th><th>Fokus</th></tr></thead>
      <tbody>{weeks.map(w => <tr key={w.week}><td>{w.number} · {w.week}{w.state === 'current' ? ' (jetzt)' : ''}</td><td>{PHASES[w.phase] || w.phase}</td><td>{hours(planned(w))}{w.planned ? '' : ' (Blockziel)'}</td><td>{w.completedHours == null ? '—' : hours(w.completedHours)}</td><td>{w.focus || '—'}</td></tr>)}</tbody></table></details>
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

const weekday = date => DAYS[(new Date(`${date}T12:00:00`).getDay() + 6) % 7][1];
function WeekSessions({ value, own, workoutsById, busy, onLock, onOpen }) {
  const rows = [
    ...(value?.sessions || []).map(session => ({ id: session.id, date: session.rendered?.date || '', name: sessionName(session), locked: !!session.locked,
      day: DAYS.find(([d]) => d === session.day)?.[1] || session.day, lockable: !!session.rendered?.workout, workout: workoutsById[session.id],
      detail: `${sessionDuration(session) == null ? 'Dauer offen' : `${fmt(sessionDuration(session))} min`}${session.rendered?.estimatedTss != null ? ` · ${fmt(session.rendered.estimatedTss)} TSS` : ''}` })),
    ...own.map(workout => ({ id: workout.id, date: workout.date, name: workout.name, locked: !!workout.locked, day: weekday(workout.date), lockable: true, own: true, workout,
      detail: workout.steps ? workoutSummary(workout) : '' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return <>{value ? <p className="coach-week-focus"><strong>{hours(value.targetHours)}</strong> · {value.focus || 'Trainingswoche'}</p> : <p className="coach-muted">Noch keine Woche geplant.</p>}
    {rows.length > 0 && <div className="coach-sessions">{rows.map(row => <div className="coach-session" key={row.id}>
      <strong className="coach-day">{row.day}</strong>
      <div>{row.workout && onOpen ? <button type="button" className="coach-workout-link" disabled={busy} onClick={() => onOpen(row.workout)}><strong>{row.name}</strong></button> : <strong>{row.name}</strong>}
        <small>{row.date && `${dateLabel(row.date)} · `}{row.own ? 'Eigene Einheit' : row.detail}</small></div>
      {row.lockable ? <button type="button" className="coach-lock" disabled={busy} aria-pressed={row.locked} aria-label={`${row.name} ${row.locked ? 'lösen' : 'fixieren'}`}
        title={row.locked ? 'Fixiert: bleibt bei AI-Anpassungen unverändert. Klicken zum Lösen.' : 'Fixieren: bleibt bei AI-Anpassungen unverändert.'} onClick={() => onLock(row.id, !row.locked)}>
        <Icon name={row.locked ? 'lock' : 'unlock'} size={15} /></button> : row.locked && <span className="coach-badge">Fixiert</span>}
    </div>)}</div>}
    {rows.some(row => row.lockable) && <p className="coach-muted">Mit dem Schloss fixierst du eine Einheit. Der Coach lässt sie bei Anpassungen unverändert.</p>}
  </>;
}

// Close the week → review (athlete-reported missed sessions) → check-in → plan the next week.
function WeekRhythm({ review, next, reviewPlan, nextBlockWeek, feedback, busy, canPlan, checkInForm, wishField, onLoad, onPlan }) {
  const [step, setStep] = useState(0);
  const [missed, setMissed] = useState([]);
  useEffect(() => { onLoad(review); }, [review]);
  const today = localDate();
  const sessions = (reviewPlan?.sessions || []).filter(session => (session.rendered?.date || '') <= today);
  return <section className="coach-card coach-next" aria-label="Woche abschließen">
    <span className="coach-eyebrow">Wochenrhythmus · {review} → {next}</span><h2>Woche abschließen</h2>
    <ol className="coach-wizard-steps">{['Rückblick', 'Check-in', 'Nächste Woche'].map((label, i) => <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    {step === 0 && <>
      <div className="coach-feedback"><div><small>Geplant</small><strong>{hours(feedback?.planned?.hours)}</strong></div><div><small>Absolviert{feedback?.partial ? ' (bis heute)' : ''}</small><strong>{hours(feedback?.completed?.hours)}</strong></div><div><small>Ausgelassen (deine Angabe)</small><strong>{missed.length} {missed.length === 1 ? 'Einheit' : 'Einheiten'}</strong></div></div>
      {sessions.length > 0 ? <fieldset className="coach-missed" disabled={busy}><legend>Welche Einheiten hast du ausgelassen?</legend>{sessions.map(session => <label className="coach-checkbox" key={session.id}>
        <input type="checkbox" checked={missed.includes(session.id)} onChange={e => setMissed(list => e.target.checked ? [...list, session.id] : list.filter(id => id !== session.id))} />
        {DAYS.find(([d]) => d === session.day)?.[1]} · {sessionName(session)}</label>)}</fieldset> : <p className="coach-muted">In dieser Woche liegen noch keine geplanten Einheiten hinter dir.</p>}
      <p className="coach-muted">TrainHub ordnet Aktivitäten nicht automatisch zu. Deine Angabe fließt in die Planung der nächsten Woche ein.</p>
      <div className="coach-actions"><button type="button" className="coach-primary" onClick={() => setStep(1)}>Weiter zum Check-in</button></div>
    </>}
    {step === 1 && <>{checkInForm}<div className="coach-actions"><button type="button" className="coach-primary" onClick={() => setStep(2)}>Weiter</button><button type="button" onClick={() => setStep(0)}>Zurück</button></div></>}
    {step === 2 && <>
      <p className="coach-week-focus"><strong>{next}</strong>{nextBlockWeek && <> · {PHASES[nextBlockWeek.phase] || nextBlockWeek.phase} · Ziel {hours(nextBlockWeek.targetHours)}{nextBlockWeek.focus ? ` · ${nextBlockWeek.focus}` : ''}</>}</p>
      {wishField}
      <div className="coach-actions"><button type="button" className="coach-primary" disabled={!canPlan} onClick={() => onPlan(missed)}>Nächste Woche planen</button><button type="button" onClick={() => setStep(1)}>Zurück</button></div>
    </>}
  </section>;
}

function Hinweise({ items }) {
  if (!items?.length) return null;
  return <div className="coach-hinweise" role="note"><strong>Hinweise des Coaches</strong><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul><small>Hinweise blockieren nichts. Du entscheidest.</small></div>;
}

function BlockOptions({ value, busy, onConfirm, onDiscard }) {
  const options = value.after?.options || [];
  const chosen = value.after?.mode === 'choose';
  const [selected, setSelected] = useState(() => (options.find(o => o.recommended) || options[0])?.id);
  return <section className="coach-proposal-embedded" aria-label="Planvorschlag prüfen">
    <div className="coach-section-heading"><div><span className="coach-eyebrow">AI-Empfehlung · Noch nicht gespeichert</span><h3>{chosen ? 'Deinen Block prüfen' : PROPOSAL_TITLES.block}</h3></div><span className="coach-badge recommendation">Vorschau</span></div>
    <p>{chosen ? 'Prüfe Umfang und Entlastung und übernimm den Block ausdrücklich.' : 'Wähle eine Option und übernimm sie ausdrücklich.'} Bis dahin ändert sich nichts.</p>
    <Hinweise items={value.hinweise} />
    <div className="coach-options" role="radiogroup" aria-label="Blockoptionen">{options.map(option => <label key={option.id} className={`coach-option ${selected === option.id ? 'selected' : ''}`}>
      <input type="radio" name="block-option" value={option.id} checked={selected === option.id} onChange={() => setSelected(option.id)} />
      <div><div className="coach-option-heading">{option.recommended && <span className="coach-badge recommendation">Empfehlung</span>}<p>{option.rationale}</p></div>
        <BlockOverview value={{ ...option.block, typeName: option.typeName, secondaryName: option.secondaryName }} /></div>
    </label>)}</div>
    {value.rejectedOptions?.length > 0 && <p className="coach-muted">{value.rejectedOptions.length === 1 ? 'Eine weitere Option wurde' : `${value.rejectedOptions.length} weitere Optionen wurden`} verworfen, weil sie die Blockregeln verletzt: {value.rejectedOptions.map(o => o.reason).join(' ')}</p>}
    {value.before && <div className="coach-replaces"><h3>Wird ab dem Start ersetzt</h3><BlockOverview value={value.before} /></div>}
    <div className="coach-actions"><button className="coach-primary" disabled={busy || !selected} onClick={() => onConfirm(selected)}>{chosen ? 'Block übernehmen' : 'Diese Option übernehmen'}</button><button disabled={busy} onClick={onDiscard}>{chosen ? 'Zurück zur Auswahl' : 'Vorschläge verwerfen'}</button></div>
  </section>;
}

function RhythmStrip({ pattern }) {
  if (!pattern?.length) return null;
  return <div className="coach-rhythm" aria-label="Rhythmus aus Belastung und Entlastung">
    {pattern.map((deload, i) => <span key={i} className={deload ? 'deload' : ''} title={`Woche ${i + 1}: ${deload ? 'Entlastung' : 'Belastung'}`}>{i + 1}</span>)}
    <small><i /> Belastung <i className="deload" /> Entlastung</small>
  </div>;
}

// Situation → path → own choice or AI options → preview; the AI proposal is shown as the last step.
function BlockWizard({ catalog, profile, busy, canPlan, proposal, onEdit, onPropose, onConfirm, onDiscard }) {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(() => nextMonday());
  const [situation, setSituation] = useState('');
  const [path, setPath] = useState(null);
  const [choice, setChoice] = useState({ blockType: '', secondaryFocus: null, weeks: '' });
  const [wish, setWish] = useState('');
  const edit = change => { onEdit(); change(); };
  const types = catalog?.blockTypes || [];
  const type = types.find(item => item.id === choice.blockType);
  const weeks = Number(choice.weeks);
  const weeksValid = !!type && Number.isInteger(weeks) && weeks >= type.minWeeks && weeks <= type.maxWeeks;
  const current = proposal ? 3 : step;
  function submit() {
    const base = { kind: 'block', situation, startDate, ...(wish.trim() ? { instruction: wish.trim() } : {}) };
    onPropose(path === 'recommend' ? { ...base, mode: 'recommend' } : { ...base, mode: 'choose', blockType: choice.blockType, secondaryFocus: choice.secondaryFocus, weeks });
  }
  const wishField = <Field label="Wunsch (optional)" hint="Präzisiert die Anfrage, z. B. „Samstags lange Ausfahrten“. Der Blocktyp bleibt maßgeblich."><textarea maxLength={1500} value={wish} onChange={e => edit(() => setWish(e.target.value))} /></Field>;
  return <div className="coach-wizard">
    <ol className="coach-wizard-steps">{WIZARD_STEPS.map((label, i) => <li key={label} className={i === current ? 'current' : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    {proposal ? <BlockOptions key={proposal.id} value={proposal} busy={busy} onConfirm={onConfirm} onDiscard={onDiscard} /> : <fieldset disabled={busy}>
      {step === 0 && <>
        <h3>Wo stehst du gerade?</h3>
        <div className="coach-choice-grid" role="radiogroup" aria-label="Ausgangslage">{Object.entries(SITUATIONS).map(([key, name]) => <label key={key} className={`coach-choice ${situation === key ? 'selected' : ''}`}>
          <input type="radio" name="situation" value={key} checked={situation === key} onChange={() => edit(() => setSituation(key))} /><strong>{name}</strong><small>{SITUATION_HINTS[key]}</small>
        </label>)}</div>
        <div className="coach-inline-form"><Field label="Start (Montag)"><input type="date" min={nextMonday()} value={startDate} onChange={e => { if (e.target.value) edit(() => setStartDate(weekStart(isoWeek(e.target.value)))); }} /></Field></div>
        <div className="coach-actions"><button type="button" className="coach-primary" disabled={!situation} onClick={() => setStep(1)}>Weiter</button></div>
      </>}
      {step === 1 && <>
        <h3>Wie möchtest du vorgehen?</h3>
        <div className="coach-choice-grid two">
          <button type="button" className="coach-choice" onClick={() => { edit(() => setPath('recommend')); setStep(2); }}><strong>Schlag mir was vor</strong><small>Der Coach schlägt zwei bis drei passende Blöcke vor, einer davon als Empfehlung.</small></button>
          <button type="button" className="coach-choice" onClick={() => { edit(() => setPath('choose')); setStep(2); }}><strong>Ich weiß, was ich will</strong><small>Du wählst Blocktyp und Länge. Der Coach arbeitet Umfang, Verteilung und Entlastung aus.</small></button>
        </div>
        <div className="coach-actions"><button type="button" onClick={() => setStep(0)}>Zurück</button></div>
      </>}
      {step === 2 && path === 'recommend' && <>
        <h3>Vorschläge erstellen</h3><p className="coach-muted">{SITUATIONS[situation]} · Start am {dateLabel(startDate)}</p>
        {wishField}
        <div className="coach-actions"><button type="button" className="coach-primary" disabled={!canPlan} onClick={submit}>Vorschläge erstellen</button><button type="button" onClick={() => setStep(1)}>Zurück</button></div>
      </>}
      {step === 2 && path === 'choose' && <>
        <h3>Blocktyp wählen</h3><p className="coach-muted">{SITUATIONS[situation]} · Start am {dateLabel(startDate)}</p>
        <div className="coach-choice-grid types" role="radiogroup" aria-label="Blocktyp">{types.map(item => {
          const blocked = item.id === 'wettkampfspezifisch' && !profile.goal.date;
          return <label key={item.id} className={`coach-choice ${choice.blockType === item.id ? 'selected' : ''} ${blocked ? 'disabled' : ''}`}>
            <input type="radio" name="block-type" value={item.id} disabled={blocked} checked={choice.blockType === item.id} onChange={() => edit(() => setChoice(c => ({ ...c, blockType: item.id, weeks: item.defaultWeeks })))} />
            <strong>{item.name}</strong><small>{item.summary}</small><small className="coach-choice-meta">{item.minWeeks}–{item.maxWeeks} Wochen{blocked ? ' · braucht ein Zieldatum im Athletenprofil' : ''}</small>
          </label>;
        })}</div>
        {type && <div className="coach-type-detail">
          <div className="coach-inline-form">
            <Field label="Wochen"><input type="number" min={type.minWeeks} max={type.maxWeeks} value={choice.weeks} onChange={e => edit(() => setChoice(c => ({ ...c, weeks: e.target.value })))} /></Field>
            <Field label="Nebenschwerpunkt"><select value={choice.secondaryFocus || ''} onChange={e => edit(() => setChoice(c => ({ ...c, secondaryFocus: e.target.value || null })))}><option value="">Keiner</option>{(catalog.secondaryFocus || []).map(item => {
              const blocked = item.id === 'kraft' && !profile.preferences.gymAvailability;
              return <option key={item.id} value={item.id} disabled={blocked}>{item.name}{blocked ? ' (Fitnessstudio im Profil fehlt)' : ''}</option>;
            })}</select></Field>
          </div>
          {!weeksValid && <p className="coach-muted">Ein Block „{type.name}“ dauert {type.minWeeks}–{type.maxWeeks} Wochen.</p>}
          {weeksValid && <RhythmStrip pattern={type.rhythms?.[String(weeks)]} />}
          <ul className="coach-rules">{type.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
        </div>}
        {wishField}
        <div className="coach-actions"><button type="button" className="coach-primary" disabled={!canPlan || !weeksValid} onClick={submit}>Block ausarbeiten lassen</button><button type="button" onClick={() => setStep(1)}>Zurück</button></div>
      </>}
    </fieldset>}
  </div>;
}

function Proposal({ value, busy, onConfirm, onDiscard }) {
  const beforeSessions = value.before?.sessions || [];
  const afterSessions = value.after?.sessions || [];
  const changes = [
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
    <Hinweise items={value.hinweise} />
    {changes.length > 0 && <ul className="coach-change-list">{changes.map((change, i) => <li key={i}>{change}</li>)}</ul>}
    <div className="coach-compare"><div><h3>Bisher</h3><SessionList value={value.before} /></div><div><h3>Vorgeschlagen</h3><SessionList value={value.after} /></div></div>
    <div className="coach-actions"><button className="coach-primary" disabled={busy} onClick={() => onConfirm()}>Änderungen bestätigen und übernehmen</button><button disabled={busy} onClick={onDiscard}>Vorschlag verwerfen</button></div>
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
  const [catalog, setCatalog] = useState(null);
  const [firstWeek, setFirstWeek] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [rhythmFeedback, setRhythmFeedback] = useState(null);
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
    Promise.all([request(`/api/athlete-snapshot?${tzQuery()}`), request('/api/athlete-profile'), request('/api/ai-provider'), request('/api/coach/plan'), request('/api/coach/block-types')])
      .then(([s, p, ai, saved, types]) => {
        if (cancelled) return;
        setSnapshot(s); setProfile(blankProfile(p)); setProvider(ai); setModel(ai.model || 'gpt-4.1-mini'); setPlan(saved); setCatalog(types);
        const range = blockRange(currentBlock(saved.blocks));
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
  async function propose(kind, extra = {}) {
    if (anyDirty) { setError('Speichere zuerst deine offenen Änderungen.'); return; }
    const version = contextVersion.current;
    await run('Der Coach erstellt einen Vorschlag …', async () => {
      setProposal(null); setFirstWeek(null);
      const context = extra.feedbackWeek ? { feedbackWeek: extra.feedbackWeek, missedSessions: extra.missedSessions } : kind === 'patch' && feedbackWeek ? { feedbackWeek } : {};
      const body = kind === 'block' ? extra : { kind, week: extra.week || week, instruction, ...context };
      const next = await request(`/api/coach/proposals?${tzQuery()}`, 'POST', body);
      if (contextVersion.current === version) setProposal(next);
    });
  }
  const canPlan = !busy && !anyDirty && provider?.configured;
  const today = localDate();
  const block = currentBlock(plan?.blocks, today);
  const range = blockRange(block);
  const blockHasWeeks = !!range && Object.keys(plan?.weeks || {}).some(key => weekStart(key) >= range.start && weekStart(key) <= range.end);
  const missing = profile ? missingSetup(profile) : [];
  const profileReady = !missing.length && !dirty.profile;
  // Exactly one next step: set up, start a block, work through it, or start the next one.
  const stage = range ? (today > range.end ? 'ended' : 'active') : profileReady && provider?.configured ? 'start' : 'setup';
  function discardProposal() {
    return run('Vorschlag wird verworfen …', async () => { await request(`/api/coach/proposals/${proposal.id}/discard`, 'POST', {}); setProposal(null); setNotice('Vorschlag verworfen.'); });
  }
  function confirmProposal(optionId) {
    return run('Plan wird übernommen …', async () => {
      try {
        const saved = await request(`/api/coach/proposals/${proposal.id}/confirm`, 'POST', { confirm: true, ...(optionId ? { optionId } : {}) });
        setPlan(saved); setProposal(null); await onWorkoutsChanged?.();
        if (proposal.kind === 'block') {
          const first = isoWeek(proposal.after.options.find(option => option.id === optionId).block.startDate);
          setWeek(first); setFeedback(null); setFirstWeek(first);
        } else setNotice('Plan übernommen. Die Einheiten sind im Kalender verfügbar.');
      } catch (e) { setProposal(null); throw e; }
    });
  }
  useEffect(() => {
    if (stage !== 'active' || !block?.id) { setTimeline(null); return undefined; }
    let cancelled = false;
    request(`/api/coach/blocks/${encodeURIComponent(block.id)}/timeline?${tzQuery()}`)
      .then(result => { if (!cancelled) setTimeline(result); }).catch(() => { if (!cancelled) setTimeline(null); });
    return () => { cancelled = true; };
    // Plan revisions and calendar changes refresh planned and completed hours.
  }, [stage, block?.id, plan?.revision, workouts]);
  useEffect(() => {
    if (proposal && proposal.kind !== 'block') document.querySelector('.coach-proposal')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [proposal]);
  const workoutsById = useMemo(() => Object.fromEntries(workouts.map(workout => [workout.id, workout])), [workouts]);
  const ownWorkouts = weekWorkouts.filter(workout => !(currentWeek?.sessions || []).some(session => session.id === workout.id));
  const thisWeek = isoWeek(today);
  const inBlock = key => !!range && weekStart(key) >= range.start && weekStart(key) <= range.end;
  // Close the week when the next block week is still empty: from Friday on, or right away if last week was left open.
  let rhythm = null;
  if (stage === 'active' && !firstWeek) {
    const lastWeek = isoWeek(addDays(today, -7)), nextWeek = isoWeek(addDays(today, 7));
    if (inBlock(thisWeek) && !plan.weeks?.[thisWeek] && plan.weeks?.[lastWeek]) rhythm = { review: lastWeek, next: thisWeek };
    else if ((new Date(`${today}T12:00:00`).getDay() + 6) % 7 >= 4 && plan.weeks?.[thisWeek] && inBlock(nextWeek) && !plan.weeks?.[nextWeek]) rhythm = { review: thisWeek, next: nextWeek };
  }
  async function toggleLock(identity, locked) {
    await run('Einheit wird aktualisiert …', async () => {
      invalidate(); await request(`/api/workouts/${identity}/lock`, 'PUT', { locked });
      setPlan(await request('/api/coach/plan')); await onWorkoutsChanged?.(); setNotice(locked ? 'Einheit fixiert.' : 'Fixierung aufgehoben.');
    });
  }
  const checkInForm = <form onSubmit={event => { event.preventDefault(); run('Check-in wird gespeichert …', async () => { await request('/api/coach/check-ins', 'POST', checkIn); setDirty(d => ({ ...d, checkIn: false })); invalidate(); await refreshSnapshot(); setNotice('Check-in gespeichert.'); }); }}><fieldset disabled={!!busy}><p className="coach-muted">1 = sehr niedrig / schlecht, 5 = sehr hoch / gut. Deine persönliche Einschätzung.</p><Field label="Check-in Datum"><input type="date" required value={checkIn.date} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, date: e.target.value })); }} /></Field>{[['fatigue', 'Müdigkeit'], ['motivation', 'Motivation'], ['stress', 'Stress'], ['sleepQuality', 'Schlafqualität'], ['soreness', 'Muskelkater']].map(([key, label]) => <label className="coach-rating" key={key}><span>{label}</span><input aria-label={label} type="range" min="1" max="5" value={checkIn[key]} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, [key]: Number(e.target.value) })); }} /><output>{checkIn[key]}/5</output></label>)}<Field label="Check-in Notiz"><textarea maxLength={2000} value={checkIn.notes} onChange={e => { invalidate('checkIn'); setCheckIn(c => ({ ...c, notes: e.target.value })); }} /></Field><button type="submit">Check-in speichern</button></fieldset></form>;
  const wishField = <Field label="Wunsch für die Planung"><textarea maxLength={2000} value={instruction} placeholder="z. B. Donnerstag und Freitag frei halten, die lange Ausfahrt am Samstag beibehalten." onChange={e => { invalidate(); setInstruction(e.target.value); }} /></Field>;
  const wizard = <BlockWizard catalog={catalog} profile={profile} busy={!!busy} canPlan={canPlan} proposal={proposal?.kind === 'block' ? proposal : null}
    onEdit={() => invalidate()} onPropose={body => propose('block', body)} onConfirm={confirmProposal} onDiscard={discardProposal} />;

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
        <p className="coach-muted">Ein Trainingsblock dauert meist 4–12 Wochen und endet mit einer Entlastungswoche. Gespeichert wird erst, wenn du ihn übernimmst.</p>
        {wizard}
      </section>}
      {stage === 'ended' && <section className="coach-card"><span className="coach-eyebrow">Block abgeschlossen</span><h2>Nächsten Trainingsblock starten</h2>
        <BlockOverview value={block} />
        <p className="coach-muted">Der abgeschlossene Block geht als Kontext in die Planung ein.</p>
        {wizard}
      </section>}
      {stage === 'active' && firstWeek && !plan.weeks?.[firstWeek] && <section className="coach-card coach-next" aria-label="Erste Woche planen"><span className="coach-eyebrow">Trainingsblock übernommen</span><h2>Erste Woche jetzt planen?</h2>
        <p className="coach-muted">{dateLabel(weekStart(firstWeek))} – {dateLabel(weekEnd(firstWeek))} · {firstWeek}. Du kannst die Woche auch später planen.</p>
        <div className="coach-actions"><button className="coach-primary" disabled={!canPlan} onClick={() => propose('week')}>Erste Woche planen</button><button onClick={() => setFirstWeek(null)}>Später</button></div>
      </section>}
      {rhythm && <WeekRhythm key={rhythm.review} review={rhythm.review} next={rhythm.next} reviewPlan={plan.weeks?.[rhythm.review]} nextBlockWeek={block.weeks?.[blockWeek(range, weekStart(rhythm.next)) - 1]}
        feedback={rhythmFeedback?.week === rhythm.review ? rhythmFeedback : null} busy={!!busy} canPlan={canPlan} checkInForm={checkInForm} wishField={wishField}
        onLoad={key => request(`/api/coach/feedback?week=${encodeURIComponent(key)}&${tzQuery()}`).then(setRhythmFeedback).catch(e => setError(e.message))}
        onPlan={missedSessions => { setWeek(rhythm.next); setFeedback(null); propose('week', { week: rhythm.next, feedbackWeek: rhythm.review, missedSessions }); }} />}
      {stage === 'active' && <><section className="coach-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">Aktueller Trainingsblock</span><h2>{today < range.start ? `Startet am ${dateLabel(range.start)}` : `Woche ${blockWeek(range, today)} von ${range.weeks}`}</h2></div><span className="coach-badge recommendation">AI-Empfehlung</span></div>
        <BlockOverview value={block} chart={timeline && <BlockTimeline timeline={timeline} selected={week} onSelect={key => { if (dirty.weekly) setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); else if (key !== week) { invalidate(); setFeedback(null); setWeek(key); } }} />} />
        {!blockHasWeeks && <details className="coach-details" open={proposal?.kind === 'block' || undefined}><summary>Block neu planen</summary><p className="coach-muted">Solange noch keine Woche geplant ist, kannst du den Block ersetzen.</p>{wizard}</details>}
      </section>
      <section className="coach-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">{weekStart(week) >= range.start && weekStart(week) <= range.end ? `Woche ${blockWeek(range, weekStart(week))} von ${range.weeks}` : 'Außerhalb des Blocks'}</span><h2>Deine Trainingswoche</h2></div><Field label="Kalenderwoche"><input aria-label="Planungswoche" type="week" min={isoWeek(range.start)} max={isoWeek(range.end)} value={week} disabled={!!busy} onChange={e => { if (e.target.value && !dirty.weekly) { invalidate(); setFeedback(null); setWeek(e.target.value); } else if (dirty.weekly) setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); }} /></Field></div>
        <p className="coach-muted">{dateLabel(weekStart(week))} – {dateLabel(weekEnd(week))} · {week}</p>
        <WeekSessions value={currentWeek} own={ownWorkouts} workoutsById={workoutsById} busy={!!busy} onLock={toggleLock} onOpen={onOpenWorkout} />
        <details className="coach-details"><summary>Verfügbarkeit für diese Woche {dirty.weekly ? '· ungespeichert' : ''}</summary><p className="coach-muted">Nur für {week}. Deine normale Wochenverfügbarkeit bleibt bestehen.</p><form onSubmit={event => { event.preventDefault(); run('Wochenverfügbarkeit wird gespeichert …', async () => {
          const body = { overrides: Object.fromEntries(Object.entries(weekly.overrides).map(([day, values]) => [day, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '' && v !== null))])), note: weekly.note };
          await request(`/api/coach/weekly-overrides/${week}`, 'PUT', body); setDirty(d => ({ ...d, weekly: false })); invalidate();
          setProfile(p => ({ ...p, weeklyOverrides: [...(p.weeklyOverrides || []).filter(w => w.week !== week), { week, ...body }] })); await refreshSnapshot(); setNotice('Wochenverfügbarkeit gespeichert. Du kannst jetzt eine Anpassung vorschlagen lassen.');
        }); }}><fieldset disabled={!!busy}><div className="coach-week-availability">{DAYS.map(([day, label]) => { const values = weekly.overrides[day] || {}; return <div className="coach-availability-day" key={day}><strong>{label}</strong><small>Standard: {profile.availability.defaultAvailability[day] == null ? 'offen' : `${profile.availability.defaultAvailability[day]} min`}</small><select aria-label={`${label} Verfügbarkeit diese Woche`} value={values.available === false ? 'no' : values.available === true ? 'yes' : 'default'} onChange={e => editWeekly(day, { available: e.target.value === 'default' ? undefined : e.target.value === 'yes' })}><option value="default">Standard</option><option value="yes">Verfügbar</option><option value="no">Keine Zeit</option></select><input aria-label={`${label} Minuten diese Woche`} type="number" min="0" max="1440" step="5" placeholder="Minuten" disabled={values.available === false} value={values.maxMinutes ?? ''} onChange={e => editWeekly(day, { maxMinutes: number(e.target.value) })} /><label className="coach-checkbox"><input type="checkbox" checked={!!values.preferLong} disabled={values.available === false} onChange={e => editWeekly(day, { preferLong: e.target.checked })} />Lang bevorzugt</label></div>; })}</div><Field label="Notiz zur Woche"><textarea maxLength={2000} value={weekly.note} onChange={e => { invalidate('weekly'); setWeekly(w => ({ ...w, note: e.target.value })); }} /></Field><button type="submit">Wochenverfügbarkeit speichern</button></fieldset></form></details>
        <fieldset disabled={!!busy}>{!rhythm && wishField}
          <div className="coach-actions"><button className="coach-primary" disabled={!canPlan || !!currentWeek} onClick={() => propose('week')}>Woche planen</button><button disabled={!canPlan || !currentWeek} onClick={() => propose('patch')}>Woche anpassen</button></div>
        </fieldset>
        <details className="coach-details"><summary>Absolviertes Training berücksichtigen</summary><p className="coach-muted">Wähle eine abgeschlossene Woche als Grundlage für die nächste Anpassung.</p><fieldset disabled={!!busy}><div className="coach-inline-form"><Field label="Feedback-Woche"><input type="week" value={feedbackWeek} onChange={e => { invalidate(); setFeedback(null); setFeedbackWeek(e.target.value); }} /></Field><button disabled={!feedbackWeek} onClick={() => run('Wochenfeedback wird geladen …', async () => { setFeedback(await request(`/api/coach/feedback?week=${encodeURIComponent(feedbackWeek)}&${tzQuery()}`)); })}>Training vergleichen</button></div></fieldset>{feedback && <div className="coach-feedback"><div><small>Geplant</small><strong>{hours(feedback.planned?.hours ?? feedback.planned?.trainingHours)}</strong></div><div><small>Absolviert</small><strong>{hours(feedback.completed?.hours ?? feedback.completed?.trainingHours)}</strong></div><div><small>Nicht zugeordnet / ausgefallen</small><strong>{feedback.missedSessions?.length ?? '—'} Einheiten</strong></div></div>}{feedbackWeek && <p className="coach-muted">Eine Anpassung berücksichtigt {feedbackWeek}. Die Zuordnung von Aktivitäten zu Einheiten kann unvollständig sein.</p>}</details>
      </section></>}

      {proposal && proposal.kind !== 'block' && <Proposal key={proposal.id} value={proposal} busy={!!busy} onConfirm={confirmProposal} onDiscard={discardProposal} />}

      {stage === 'active' && plan.weeks?.[thisWeek] && <div>
        <section className="coach-card"><span className="coach-eyebrow">Selbstauskunft / Tagesform</span><h2>Heute zählt auch</h2>
          <details className="coach-details"><summary>Kurzfristige Änderung {dirty.daily ? '· ungespeichert' : ''}</summary><form onSubmit={event => { event.preventDefault(); run('Tagesänderung wird gespeichert …', async () => { await request(`/api/coach/daily-overrides/${daily.date}`, 'PUT', { action: daily.action, ...(daily.action === 'skip' ? { available: false } : { available: true }), ...(daily.maxMinutes === '' ? {} : { maxMinutes: Number(daily.maxMinutes) }), note: daily.note }); setDirty(d => ({ ...d, daily: false })); invalidate(); await refreshSnapshot(); setNotice('Tagesänderung gespeichert. Lass den Plan bei Bedarf anpassen.'); }); }}><fieldset disabled={!!busy}><div className="coach-form-grid"><Field label="Tag"><input type="date" required value={daily.date} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, date: e.target.value })); }} /></Field><Field label="Änderung"><select value={daily.action} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, action: e.target.value })); }}><option value="normal">Normal / Zeit ändern</option><option value="reduce">Einheit reduzieren</option><option value="skip">Einheit auslassen</option></select></Field><Field label="Heute maximal (Minuten)"><input type="number" min="0" max="1440" step="5" value={daily.maxMinutes} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, maxMinutes: e.target.value })); }} /></Field></div><Field label="Notiz zur Tagesänderung"><textarea maxLength={2000} value={daily.note} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, note: e.target.value })); }} /></Field><button type="submit">Tagesänderung speichern</button></fieldset></form></details>
          <details className="coach-details"><summary>Check-in {dirty.checkIn ? '· ungespeichert' : ''}</summary>{checkInForm}</details>
        </section></div>}
    </>}
    {!loading && snapshot && <details className="coach-card coach-context"><summary>Datenbasis & Herkunft</summary><div className="coach-provenance"><span className="coach-badge">Berechnet · Trainingsdaten</span><span className="coach-badge athlete">Athlet · Selbstauskunft</span><span className="coach-badge recommendation">AI · Empfehlung</span></div><p className="coach-muted">Fehlende Messwerte bleiben offen. Der Snapshot enthält verdichtete Daten ohne Sensorstreams.</p><div className="coach-quality"><span>FTP: <strong>{snapshot.dataQuality?.ftpConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Maximale Herzfrequenz: <strong>{snapshot.dataQuality?.maxHrConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Leistungsdaten (42 Tage): <strong>{snapshot.dataQuality?.cyclingPowerCoverageLast42Days == null ? '—' : `${fmt(snapshot.dataQuality.cyclingPowerCoverageLast42Days * 100)} %`}</strong></span></div><details className="coach-details"><summary>Kompakten Athlete Snapshot ansehen</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details></details>}
  </div>;
}
