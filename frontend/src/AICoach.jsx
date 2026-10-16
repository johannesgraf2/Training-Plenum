import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { localDate, summary as workoutSummary } from './workoutModel';
import { workoutLibrary } from './workoutLibraryData';
import { CheckInDialog, CheckInHistory, InjuryList, PeriodHeader, ReadinessCard, TodaySessions, healInjury, loadToday } from './CoachToday';
import './AICoach.css';

const DAYS = [['mon', 'Mo'], ['tue', 'Di'], ['wed', 'Mi'], ['thu', 'Do'], ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'So']];
const PHASES = { base: 'Grundlage', build: 'Aufbau', peak: 'Höhepunkt', taper: 'Taper', recovery: 'Erholung' };
export const GOALS = { event: 'Wettkampf / Event', performance: 'Leistung steigern', fitness: 'Allgemeine Ausdauer' };
const GOAL_HINTS = { event: 'Ein Rennen, Marathon oder Event an einem festen Tag.', performance: 'Zum Beispiel FTP, Pace oder Schwelle verbessern.', fitness: 'Regelmäßig und gesund trainieren, ohne festen Termin.' };
const GOAL_PLACEHOLDERS = { event: 'z. B. Ötztaler Radmarathon', performance: 'z. B. FTP auf 300 W', fitness: 'z. B. fit durch den Winter' };
// Goal types of earlier profiles, before the goal became sport-neutral.
const GOAL_ALIASES = { cycling_event: 'event', running_event: 'event', marathon: 'event', ftp: 'performance', endurance: 'fitness', general_endurance: 'fitness' };
const EVENT_LABELS = { ride: 'Radsport-Event', run: 'Laufwettkampf', swim: 'Schwimmwettkampf' };
const LEGACY_SPORTS = { cycling_event: ['ride'], running_event: ['run'], marathon: ['run'] };
// An event is named after its sport, so the goal reads "Radsport-Event" or "Triathlon".
export function goalLabel(type, sports) {
  const key = GOAL_ALIASES[type] || type;
  const chosen = sports?.length ? sports : LEGACY_SPORTS[type] || [];
  if (key !== 'event') return GOALS[key];
  return chosen.length === 3 ? 'Triathlon' : chosen.length === 1 ? EVENT_LABELS[chosen[0]] : 'Wettkampf';
}
const SPORTS = [['ride', 'Radfahren'], ['run', 'Laufen'], ['swim', 'Schwimmen']];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
// Time a normal day can hold: quarter hours up to 3 h, then half hours.
const DAY_MINUTES = [...Array.from({ length: 11 }, (_, i) => 30 + i * 15), ...Array.from({ length: 10 }, (_, i) => 210 + i * 30)];
const PROPOSAL_TITLES = { block: 'Trainingsblock wählen', week: 'Wochenplan prüfen', patch: 'Wochenänderungen prüfen' };
const TABS = [['today', 'Heute'], ['week', 'Woche'], ['season', 'Saison'], ['review', 'Rückblick'], ['profile', 'Athletenprofil'], ['provider', 'AI Provider']];
// Earlier the plan was one tab; its season part now has its own.
const tabOf = key => key === 'plan' ? 'season' : key;
const SITUATIONS = { nach_pause: 'Nach einer Pause', mitten_im_training: 'Mitten im Training', saison_vorbei: 'Saison vorbei' };
const SITUATION_HINTS = { nach_pause: 'Du steigst nach Krankheit, Urlaub oder Pause wieder ein.', mitten_im_training: 'Du trainierst regelmäßig und willst gezielt weiter.', saison_vorbei: 'Der Höhepunkt liegt hinter dir, Erholung steht an.' };
const WIZARD_STEPS = ['Ausgangslage', 'Weg', 'Auswahl', 'Vorschau'];
const SEASON_WIZARD_STEPS = ['Ausgangslage', 'Block gestalten', 'Vorschau'];
const EMPTY_WORKOUTS = [];
const MODEL_PRESETS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'];
const REASONING_LEVELS = [['', 'Standard des Modells'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']];
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
  // Whole days since 1 January; d is at noon, so the half day must not round a full week up.
  const week = Math.ceil((Math.floor((d - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
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

// Block weeks that are not over yet and have no plan, in order.
export function openBlockWeeks(block, weeks = {}, today = localDate()) {
  const range = blockRange(block);
  const result = [];
  for (let day = range?.start; range && day <= range.end; day = addDays(day, 7)) {
    const key = isoWeek(day);
    if (weekEnd(key) >= today && !weeks[key]) result.push(key);
  }
  return result;
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
  const goal = { type: 'fitness', sports: ['ride'], name: '', date: null, target: null, ...data.goal };
  return {
    ...data,
    goal: { ...goal, type: GOAL_ALIASES[goal.type] || goal.type },
    availability: { preferredWeeklyHours: null, indoorWeeklyHours: null, absoluteMaxWeeklyHours: null, outdoorMonths: [], trainingDaysPerWeek: null, noConsecutiveRestDays: false, ...data.availability,
      minRideMinutes: { indoor: null, outdoor: null, ...data.availability?.minRideMinutes },
      defaultAvailability: Object.fromEntries(DAYS.map(([day]) => [day, data.availability?.defaultAvailability?.[day] ?? null])) },
    preferences: { preferredRestDay: null, preferredLongSessionDay: null, gymAvailability: false, dailyCheckIn: true, ...data.preferences },
    limitations: { notes: '', ...data.limitations }, currentState: { notes: '', ...data.currentState },
  };
}

// "Apr–Okt" or "Nov–Mär, Jul"; a run may reach over the new year.
export function monthSpans(months) {
  const chosen = new Set(months);
  if (chosen.size === 12) return 'ganzjährig';
  const gap = MONTHS.findIndex((_, index) => !chosen.has(index + 1)) + 1;
  const runs = [];
  let run = null;
  for (let step = 1; step <= 12; step += 1) {
    const month = (gap - 1 + step) % 12 + 1;
    if (!chosen.has(month)) run = null;
    else if (run) run[1] = month;
    else runs.push(run = [month, month]);
  }
  return runs.map(([from, to]) => from === to ? MONTHS[from - 1] : `${MONTHS[from - 1]}–${MONTHS[to - 1]}`).join(', ');
}

// The wished volume in the season of the given month; the indoor months may have their own.
function seasonHours(availability, month) {
  const { outdoorMonths: months = [], preferredWeeklyHours: outdoor, indoorWeeklyHours: indoor } = availability;
  return months.length && !months.includes(month) && indoor != null ? indoor : outdoor;
}

const minutesLabel = minutes => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}${minutes % 60 ? `:${String(minutes % 60).padStart(2, '0')}` : ''} h`;

function Field({ label, children, hint }) {
  return <label className="coach-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

// Buttons that switch on and off, such as sports or months.
function Toggles({ label, items, isOn, onToggle, className = '' }) {
  return <div className={`coach-toggles ${className}`} role="group" aria-label={label}>{items.map(([key, name]) =>
    <button type="button" key={key} className="coach-toggle" aria-pressed={isOn(key)} onClick={() => onToggle(key)}>{name}</button>)}</div>;
}

// Weekly volume and shortest ride per season: outdoor months, the rest indoors, or one value for the whole year.
function SeasonVolume({ availability, rides, onEdit }) {
  const months = availability.outdoorMonths;
  const indoorMonths = MONTHS.map((_, index) => index + 1).filter(month => !months.includes(month));
  const seasons = !months.length ? [{ key: 'preferredWeeklyHours', title: 'Das ganze Jahr', hours: 'Gewünschter Umfang (h/Woche)', places: ['indoor', 'outdoor'], ride: 'Mindestdauer Radeinheit (min)' }]
    : [{ key: 'preferredWeeklyHours', title: `Draußen · ${monthSpans(months)}`, hours: 'Umfang draußen (h/Woche)', places: ['outdoor'], ride: 'Mindestdauer Radeinheit draußen (min)' },
      ...(indoorMonths.length ? [{ key: 'indoorWeeklyHours', title: `Drinnen · ${monthSpans(indoorMonths)}`, hours: 'Umfang drinnen (h/Woche)', places: ['indoor'], ride: 'Mindestdauer Radeinheit drinnen (min)', hint: 'Leer = wie draußen.' }] : [])];
  // Without seasons one minimum applies to every ride, so it sets both.
  const shortest = places => { const values = places.map(place => availability.minRideMinutes[place]).filter(value => value != null); return values.length ? Math.min(...values) : ''; };
  return <div className={`coach-season-volume ${seasons.length > 1 ? 'two' : ''}`}>{seasons.map(season => <div key={season.key}>
    <h4>{season.title}</h4>
    <Field label={season.hours} hint={season.hint}><input type="number" min="0" max="60" step="0.5" placeholder={season.hint ? availability.preferredWeeklyHours ?? '' : undefined} value={availability[season.key] ?? ''} onChange={e => onEdit(season.key, number(e.target.value))} /></Field>
    {rides && <Field label={season.ride} hint="Gilt nicht für Regenerationsfahrten. Leer = keine Vorgabe."><input type="number" min="0" max="600" step="5" value={shortest(season.places)} onChange={e => onEdit('minRideMinutes', { ...availability.minRideMinutes, ...Object.fromEntries(season.places.map(place => [place, number(e.target.value)])) })} /></Field>}
  </div>)}</div>;
}

// Live sum of the normal week, plus a note when the wish is far from what was trained recently.
function WeekSummary({ availability, recentWeeklyHours }) {
  const days = DAYS.map(([day, label]) => [label, availability.defaultAvailability[day]]);
  const open = days.filter(([, minutes]) => minutes == null).map(([label]) => label);
  const available = days.reduce((sum, [, minutes]) => sum + (minutes || 0), 0) / 60;
  const { preferredWeeklyHours: outdoor, absoluteMaxWeeklyHours: maximum, outdoorMonths: months } = availability;
  const split = months.length > 0 && months.length < 12;
  const indoor = split ? availability.indoorWeeklyHours ?? outdoor : outdoor;
  const preferred = seasonHours(availability, Number(localDate().slice(5, 7)));
  const highest = Math.max(outdoor ?? 0, indoor ?? 0);
  const notes = [];
  if (!open.length && highest > available + 1e-9) notes.push('Dein Wunschumfang liegt über der Zeit, die du an den einzelnen Tagen angegeben hast. Der Coach plant höchstens die verfügbare Zeit.');
  if (recentWeeklyHours != null && preferred) {
    const difference = recentWeeklyHours - preferred;
    if (Math.abs(difference) >= Math.max(1.5, preferred * 0.3)) notes.push(`In den letzten 4 Wochen hast du im Schnitt ${hours(recentWeeklyHours)} pro Woche trainiert. Dein Wunsch${split ? ' für diese Jahreszeit' : ''} von ${hours(preferred)} liegt deutlich ${difference < 0 ? 'darüber. Plane einen schrittweisen Aufbau ein; der Coach berücksichtigt deinen zuletzt trainierten Umfang.' : 'darunter. Das passt, wenn du bewusst kürzertreten willst.'}`);
  }
  const wish = value => value == null ? 'offen' : hours(value);
  return <div className="coach-week-summary" aria-live="polite">
    <strong>{hours(available)} verfügbar{open.length ? ` (${open.join(', ')} offen)` : ''} · Wunsch {split ? `draußen ${wish(outdoor)}, drinnen ${wish(indoor)}` : wish(outdoor)} · Obergrenze {wish(maximum)}</strong>
    {notes.map(note => <p key={note}>{note}</p>)}
  </div>;
}

function KeyNotice({ provider }) {
  const { encryptionKeySource: source, encryptionKeyFile: file } = provider;
  if (!provider.encryptionConfigured) {
    const reason = source === 'invalid' ? `Die Schlüsseldatei ${file} enthält keinen gültigen Schlüssel. TrainHub überschreibt sie nicht, damit kein vorhandener Schlüssel verloren geht.`
      : source === 'unavailable' ? `TrainHub konnte die Schlüsseldatei ${file} nicht anlegen oder lesen.` : 'Dem Server fehlt der Schlüssel, mit dem API-Keys verschlüsselt werden.';
    return <div className="coach-message" role="note"><div><strong>API-Keys lassen sich gerade nicht speichern.</strong> {reason} Normalerweise legt TrainHub diesen Schlüssel beim ersten Start selbst an. Wie du das behebst, steht in AI-COACH.md unter „Einrichtung und erster Plan“.</div></div>;
  }
  return <p className="coach-muted coach-key-note">Dein API-Key wird verschlüsselt gespeichert. {source === 'environment' ? 'Den Schlüssel dafür liefert die Umgebungsvariable TRAINHUB_AI_ENCRYPTION_KEY.'
    : <>Der Schlüssel dafür liegt in <code>{file}</code>{source === 'created' ? ' und wurde beim letzten Start angelegt' : ''}. Sichere diese Datei getrennt von der Datenbank. Geht sie verloren, gibst du den API-Key einfach neu ein; deine Trainingsdaten brauchen sie nicht.</>}</p>;
}

function SeasonGoal({ goal }) {
  if (!goal?.date) return null;
  const days = daysBetween(localDate(), goal.date);
  if (days < 0) return null;
  const name = goal.name?.trim() || goalLabel(goal.type, goal.sports) || 'dein Ziel';
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
    {value.formats?.length > 0 && <p className="coach-muted">Intervallformen: {value.formats.map(formatTitle).join(', ')}</p>}
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
  const WeekTag = onSelect ? 'button' : 'div';
  const planned = w => w.plannedHours ?? w.targetHours;
  const max = Math.max(1, ...weeks.flatMap(w => [Number(planned(w)) || 0, Number(w.completedHours) || 0]));
  const height = value => `${value ? Math.max(3, value / max * 100) : 0}%`;
  const describe = w => `Woche ${w.number}, ${PHASES[w.phase] || w.phase}: ${w.planned ? 'geplant' : 'Blockziel'} ${hours(planned(w))}, absolviert ${w.completedHours == null ? 'noch offen' : hours(w.completedHours)}`;
  return <>
    <ol className="coach-timeline" aria-label="Block-Zeitstrahl: geplant und absolviert">{weeks.map(w => <li key={w.week} className={w.state}>
      <WeekTag {...(onSelect ? { type: 'button', 'aria-pressed': selected === w.week, onClick: () => onSelect(w.week) } : { role: 'img', className: 'coach-timeline-week' })} aria-label={describe(w)} title={`${describe(w)}${w.focus ? `. ${w.focus}` : ''}`}>
        <span className="coach-timeline-value">{w.state === 'current' && <em>Jetzt</em>}{w.completedHours == null ? '—' : fmt(w.completedHours)} / {fmt(planned(w))}</span>
        <span className="coach-timeline-track"><i className={`target ${w.planned ? '' : 'open'}`} style={{ height: height(planned(w)) }} /><i className="done" style={{ height: height(w.completedHours) }} /></span>
        <strong>{w.number}</strong><small>{PHASES[w.phase] || w.phase}</small>
      </WeekTag>
    </li>)}</ol>
    <div className="coach-timeline-legend"><span><i className="target" />Geplant</span>{weeks.some(w => !w.planned) && <span><i className="target open" />Blockziel, Woche noch nicht geplant</span>}<span><i className="done" />Absolviert (Stunden, aus Trainingsdaten)</span></div>
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
      <div><strong>{sessionName(session)}</strong><small>{session.rendered?.date && `${dateLabel(session.rendered.date)} · `}{sessionDuration(session) == null ? 'Dauer offen' : `${fmt(sessionDuration(session))} min`}{session.rendered?.estimatedTss != null && ` · ${fmt(session.rendered.estimatedTss)} TSS`}</small>{session.rendered?.notes && <small className="coach-session-note">{session.rendered.notes}</small>}</div>
      {session.locked && <span className="coach-badge">Fixiert</span>}
    </div>)}</div></>;
}

const weekday = date => DAYS[(new Date(`${date}T12:00:00`).getDay() + 6) % 7][1];
function WeekSessions({ value, own, workoutsById, busy, onLock, onOpen }) {
  const rows = [
    ...(value?.sessions || []).map(session => ({ id: session.id, date: session.rendered?.date || '', name: sessionName(session), locked: !!session.locked, notes: session.rendered?.notes,
      day: DAYS.find(([d]) => d === session.day)?.[1] || session.day, lockable: !!session.rendered?.workout, workout: workoutsById[session.id],
      detail: `${sessionDuration(session) == null ? 'Dauer offen' : `${fmt(sessionDuration(session))} min`}${session.rendered?.estimatedTss != null ? ` · ${fmt(session.rendered.estimatedTss)} TSS` : ''}` })),
    ...own.map(workout => ({ id: workout.id, date: workout.date, name: workout.name, locked: !!workout.locked, notes: workout.notes, day: weekday(workout.date), lockable: true, own: true, workout,
      detail: workout.steps ? workoutSummary(workout) : '' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return <>{value ? <p className="coach-week-focus"><strong>{hours(value.targetHours)}</strong> · {value.focus || 'Trainingswoche'}</p> : <p className="coach-muted">Noch keine Woche geplant.</p>}
    {rows.length > 0 && <div className="coach-sessions">{rows.map(row => <div className="coach-session" key={row.id}>
      <strong className="coach-day">{row.day}</strong>
      <div>{row.workout && onOpen ? <button type="button" className="coach-workout-link" disabled={busy} onClick={() => onOpen(row.workout)}><strong>{row.name}</strong></button> : <strong>{row.name}</strong>}
        <small>{row.date && `${dateLabel(row.date)} · `}{row.own ? 'Eigene Einheit' : row.detail}</small>{row.notes && <small className="coach-session-note">{row.notes}</small>}</div>
      {row.lockable ? <button type="button" className="coach-lock" disabled={busy} aria-pressed={row.locked} aria-label={`${row.name} ${row.locked ? 'lösen' : 'fixieren'}`}
        title={row.locked ? 'Fixiert: bleibt bei AI-Anpassungen unverändert. Klicken zum Lösen.' : 'Fixieren: bleibt bei AI-Anpassungen unverändert.'} onClick={() => onLock(row.id, !row.locked)}>
        <Icon name={row.locked ? 'lock' : 'unlock'} size={15} /></button> : row.locked && <span className="coach-badge">Fixiert</span>}
    </div>)}</div>}
    {rows.some(row => row.lockable) && <p className="coach-muted">Mit dem Schloss fixierst du eine Einheit. Der Coach lässt sie bei Anpassungen unverändert.</p>}
  </>;
}

// Close the week → review (athlete-reported missed sessions, the week's check-ins) → plan the next week.
function WeekRhythm({ review, next, planned, reviewPlan, nextBlockWeek, feedback, busy, canPlan, wishField, onLoad, onPlan, onKeep }) {
  const [step, setStep] = useState(0);
  const [missed, setMissed] = useState([]);
  useEffect(() => { onLoad(review); }, [review]);
  const today = localDate();
  const sessions = (reviewPlan?.sessions || []).filter(session => (session.rendered?.date || '') <= today);
  return <section className="coach-card coach-next" aria-label="Woche abschließen">
    <span className="coach-eyebrow">Wochenrhythmus · {review} → {next}</span><h2>Woche abschließen</h2>
    <ol className="coach-wizard-steps">{['Rückblick', 'Nächste Woche'].map((label, i) => <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    {step === 0 && <>
      <div className="coach-feedback"><div><small>Geplant</small><strong>{hours(feedback?.planned?.hours)}</strong></div><div><small>Absolviert{feedback?.partial ? ' (bis heute)' : ''}</small><strong>{hours(feedback?.completed?.hours)}</strong></div><div><small>Ausgelassen (deine Angabe)</small><strong>{missed.length} {missed.length === 1 ? 'Einheit' : 'Einheiten'}</strong></div></div>
      {sessions.length > 0 ? <fieldset className="coach-missed" disabled={busy}><legend>Welche Einheiten hast du ausgelassen?</legend>{sessions.map(session => <label className="coach-checkbox" key={session.id}>
        <input type="checkbox" checked={missed.includes(session.id)} onChange={e => setMissed(list => e.target.checked ? [...list, session.id] : list.filter(id => id !== session.id))} />
        {DAYS.find(([d]) => d === session.day)?.[1]} · {sessionName(session)}</label>)}</fieldset> : <p className="coach-muted">In dieser Woche liegen noch keine geplanten Einheiten hinter dir.</p>}
      <p className="coach-muted">TrainHub ordnet Aktivitäten nicht automatisch zu. Deine Angabe fließt in die Planung der nächsten Woche ein.</p>
      {feedback?.changes?.checkIns && <p className="coach-muted">Morgen-Check-ins dieser Woche: {feedback.changes.checkIns.filter(c => c.version === 2).length} von 7. Sie gehen mit in die Planung ein.</p>}
      <div className="coach-actions"><button type="button" className="coach-primary" onClick={() => setStep(1)}>Weiter zur nächsten Woche</button></div>
    </>}
    {step === 1 && <>
      <p className="coach-week-focus"><strong>{next}</strong>{nextBlockWeek && <> · {PHASES[nextBlockWeek.phase] || nextBlockWeek.phase} · Ziel {hours(nextBlockWeek.targetHours)}{nextBlockWeek.focus ? ` · ${nextBlockWeek.focus}` : ''}</>}</p>
      {planned && <p className="coach-muted">Die Woche ist schon geplant. Lass sie an deinen Rückblick anpassen oder behalte sie so.</p>}
      {wishField}
      <div className="coach-actions">{planned ? <>
        <button type="button" className="coach-primary" disabled={!canPlan} onClick={() => onPlan(missed)}>Nächste Woche anpassen</button>
        <button type="button" disabled={busy} onClick={() => onKeep(missed)}>Unverändert lassen</button>
      </> : <button type="button" className="coach-primary" disabled={!canPlan} onClick={() => onPlan(missed)}>Nächste Woche planen</button>}<button type="button" onClick={() => setStep(0)}>Zurück</button></div>
    </>}
  </section>;
}

// Morning check-ins and the earlier ones, all on 1–5.
const CHECK_IN_LABELS = [['wellbeing', 'Wohlbefinden'], ['recovery', 'Erholung'], ['fatigue', 'Müdigkeit'], ['motivation', 'Motivation'], ['stress', 'Stress'],
  ['sleepQuality', 'Schlafqualität'], ['soreness', 'Muskelkater'], ['mood', 'Stimmung']];

// Planned against completed over the whole block, plus the athlete's own verdict for the next block.
function BlockReview({ review, busy, onSave }) {
  const [rating, setRating] = useState(review.reflection?.rating ?? null);
  const [note, setNote] = useState(review.reflection?.note ?? '');
  const totals = review.totals;
  const compared = totals.comparedWeeks > 0;
  const tiles = [
    ['Geplant', compared ? hours(totals.plannedHours) : '—', `${totals.comparedWeeks} von ${review.weeks.length} Wochen mit konkretem Plan`],
    ['Absolviert', hours(compared ? totals.completedHours : totals.elapsedCompletedHours), compared ? 'in diesen Wochen' : 'im ganzen Block'],
    ['Umsetzung', totals.completion == null ? '—' : `${fmt(totals.completion * 100)} %`, 'absolviert von geplant'],
    ['Ausgelassen', totals.missedSessions == null ? '—' : `${totals.missedSessions} von ${totals.plannedSessions}`, totals.missedSessions == null ? 'keine Angabe' : `deine Angabe aus ${totals.weeksWithMissedReport} ${totals.weeksWithMissedReport === 1 ? 'Woche' : 'Wochen'}`],
  ];
  return <>
    <div className="coach-stats coach-review-stats" aria-label="Block in Zahlen">{tiles.map(([label, value, sub]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>)}
      <p>Absolvierte Stunden aus Trainingsdaten berechnet · Ausgelassene Einheiten nach deiner Angabe im Wochenrückblick.</p></div>
    <BlockTimeline timeline={review} />
    {review.checkIns.averages && <p className="coach-muted coach-review-checkins">Deine Check-ins im Block ({review.checkIns.count}): {CHECK_IN_LABELS.filter(([key]) => review.checkIns.averages[key] != null).map(([key, label]) => `${label} ${fmt(review.checkIns.averages[key])}/5`).join(' · ')}</p>}
    <form className="coach-reflection" onSubmit={event => { event.preventDefault(); onSave({ rating, note }); }}><fieldset disabled={busy}>
      <h3>Wie lief der Block für dich?</h3>
      <div className="coach-rating-chips" role="radiogroup" aria-label="Bewertung von 1 (schlecht) bis 5 (sehr gut)">{[1, 2, 3, 4, 5].map(value => <label key={value} className={rating === value ? 'selected' : ''}>
        <input type="radio" name="block-rating" value={value} checked={rating === value} onChange={() => setRating(value)} />{value}</label>)}<small>1 = schlecht · 5 = sehr gut</small></div>
      <Field label="Notiz zum Block" hint="Was hat funktioniert, was nicht? Geht als deine Angabe in den nächsten Block ein."><textarea maxLength={1500} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="coach-actions"><button type="submit">Einschätzung speichern</button>{review.reflection && <small className="coach-muted">Gespeichert am {dateLabel(review.reflection.date)}</small>}</div>
    </fieldset></form>
  </>;
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

// Questions about how a block of a type should run. The first answer always leaves it to the coach; other
// answers go to the AI as the athlete's structured wishes, some with a number to fill in.
const COACH_DECIDES = { id: 'coach', label: 'Lass den Coach entscheiden', hint: 'Er richtet sich nach deinem Training der letzten Wochen.' };
const volumeQuestion = start => ({ id: 'volume', label: 'Wie soll der Umfang verlaufen?', options: [COACH_DECIDES,
  { id: 'ramp', label: 'Niedriger einsteigen und steigern', hint: 'Du legst den Umfang der ersten Woche fest.', input: { label: 'Erste Woche (h)', min: 1, max: 40, step: 0.5, value: start },
    answer: value => `In der ersten Woche mit ${fmt(value)} h beginnen und dann von Woche zu Woche steigern` },
  { id: 'steady', label: 'Gleich im gewohnten Umfang', hint: 'Kein Anlauf, du bist schon gut im Training.', answer: () => 'Von Anfang an im gewohnten Umfang trainieren' }] });
const longRideQuestion = (label, value) => ({ id: 'longRide', label, options: [COACH_DECIDES,
  { id: 'target', label: 'Bis auf eine feste Dauer steigern', input: { label: 'Längste Ausfahrt (h)', min: 1, max: 10, step: 0.5, value }, answer: v => `Die längste Ausfahrt bis auf ${fmt(v)} h steigern` }] });
export function blockQuestions(blockType, profile) {
  const preferred = profile?.availability?.preferredWeeklyHours;
  const volume = volumeQuestion(preferred ? Math.max(1, Math.round(preferred * 1.2) / 2) : 4);
  const repsStart = (id, label, what) => ({ id, label, input: { label: 'Wiederholungen zu Beginn', min: 1, max: 10, step: 1, value: 2 },
    answer: v => `Mit ${fmt(v)} ${v === 1 ? 'Wiederholung' : 'Wiederholungen'} ${what} beginnen und dann steigern` });
  const extra = {
    wiedereinstieg: [],
    grundlage: [longRideQuestion('Wie lang soll die längste Ausfahrt am Ende werden?', 3)],
    vo2max: [{ id: 'intervals', label: 'Wie steigst du in die VO2max-Intervalle ein?', options: [COACH_DECIDES,
      { ...repsStart('reps', 'Wenige Wiederholungen, dann steigern', 'VO2max-Intervallen (3–5 min)'), hint: 'z. B. erst 2 × 4 min, dann mehr.' },
      { id: 'long', label: 'Gleich lange Intervalle', hint: '4–5 min von Anfang an.', answer: () => 'Von Anfang an lange VO2max-Intervalle (4–5 min)' },
      { id: 'formats', label: 'Aus den Workout-Vorlagen wählen', hint: 'Du wählst die Intervallformen, der Coach Anzahl und Steigerung.', formats: true,
        answer: ids => `Für die VO2max-Einheiten nur diese Intervallformen aus den Workout-Vorlagen: ${ids.map(formatTitle).join(', ')}` }] }],
    schwelle: [{ id: 'intervals', label: 'Wie steigst du in die Schwellenarbeit ein?', options: [COACH_DECIDES,
      { ...repsStart('reps', 'Wenige Wiederholungen, dann steigern', 'Schwellenintervallen (ca. 10 min)'), hint: 'z. B. erst 2 × 10 min, dann mehr.' },
      { id: 'sweetspot', label: 'Erst Sweetspot', hint: 'Später näher an die Schwelle.', answer: () => 'Mit Sweetspot beginnen und später an die Schwelle gehen' },
      { id: 'long', label: 'Früh lange Intervalle', hint: 'z. B. 2 × 20 min.', answer: () => 'Früh im Block lange Schwellenintervalle (z. B. 2 × 20 min)' }] }],
    aufbau: [{ id: 'intervals', label: 'Welche Intervalle stehen im Vordergrund?', options: [COACH_DECIDES,
      { id: 'threshold', label: 'Sweetspot und Schwelle', answer: () => 'Vor allem Sweetspot- und Schwellenintervalle' },
      { id: 'vo2', label: 'VO2max', answer: () => 'Vor allem VO2max-Intervalle' },
      { id: 'mixed', label: 'Gemischt', answer: () => 'Sweetspot, Schwelle und VO2max abwechseln' }] }],
    wettkampfspezifisch: [{ id: 'focus', label: 'Worauf soll der Block zielen?', options: [COACH_DECIDES,
      { id: 'racePace', label: 'Renntempo auf langen Fahrten', answer: () => 'Lange Ausfahrten mit Abschnitten im Renntempo' },
      { id: 'climbs', label: 'Lange Anstiege', hint: 'Anstiege wie im Rennen üben.', answer: () => 'Lange Anstiege im Renntempo wie im Wettkampf üben' }] },
    longRideQuestion('Wie lang soll die längste Ausfahrt werden?', 5)],
    taper: [{ id: 'reduction', label: 'Wie stark soll der Umfang sinken?', options: [COACH_DECIDES,
      { id: 'strong', label: 'Deutlich', hint: 'Etwa die Hälfte weniger.', answer: () => 'Umfang deutlich senken, etwa 50 % weniger' },
      { id: 'moderate', label: 'Moderat', hint: 'Etwa ein Drittel weniger.', answer: () => 'Umfang moderat senken, etwa 30 % weniger' }] }],
    uebergang: [{ id: 'rest', label: 'Wie willst du die Pause gestalten?', options: [COACH_DECIDES,
      { id: 'easy', label: 'Locker weiterfahren', answer: () => 'Kurze, lockere Fahrten nach Lust' },
      { id: 'off', label: 'Viel Pause', answer: () => 'Viel Pause, nur leichte Bewegung' }] }],
  };
  if (!(blockType in extra)) return [];
  return ['taper', 'uebergang'].includes(blockType) ? extra[blockType] : [volume, ...extra[blockType]];
}
// Interval formats are families of the workout library; the catalog names the ones a block type can use.
const formatTitle = id => workoutLibrary.find(entry => entry.family === id)?.familyTitle || id;
const chosenOption = (question, answers) => question.options.find(o => o.id === answers[question.id]?.option);
// Only answers the athlete gave; questions left to the coach are not sent.
export function designAnswers(questions, answers) {
  return questions.flatMap(question => {
    const answer = answers[question.id];
    const option = chosenOption(question, answers);
    if (!option || option.id === 'coach' || (option.formats && !answer.value?.length)) return [];
    const value = option.formats ? answer.value
      : option.input ? (Number.isFinite(Number(answer.value)) && answer.value !== '' ? Number(answer.value) : option.input.value) : null;
    return [{ question: question.label, answer: option.answer(value) }];
  });
}
// Formats chosen from the workout library: null when no question asks for them, [] when none is picked yet.
export function designFormats(questions, answers) {
  const question = questions.find(q => chosenOption(q, answers)?.formats);
  return question ? answers[question.id].value || [] : null;
}

function BlockQuestions({ questions, answers, formats = [], onAnswer }) {
  const id = useId();
  return <div className="coach-block-questions">{questions.map(question => {
    const answer = answers[question.id] || { option: 'coach' };
    const option = question.options.find(o => o.id === answer.option);
    return <div key={question.id} className="coach-question">
      <h4>{question.label}</h4>
      <div className="coach-choice-grid" role="radiogroup" aria-label={question.label}>{question.options.map(o => <label key={o.id} className={`coach-choice ${answer.option === o.id ? 'selected' : ''}`}>
        <input type="radio" name={`${id}-${question.id}`} value={`${question.id}-${o.id}`} checked={answer.option === o.id} onChange={() => onAnswer(question.id, { option: o.id, value: o.formats ? [] : o.input?.value ?? null })} />
        <strong>{o.label}</strong>{o.hint && <small>{o.hint}</small>}
      </label>)}</div>
      {option?.input && <div className="coach-inline-form"><Field label={option.input.label}><input type="number" min={option.input.min} max={option.input.max} step={option.input.step} value={answer.value ?? ''}
        onChange={e => onAnswer(question.id, { ...answer, value: e.target.value })} /></Field></div>}
      {option?.formats && <>
        <div className="coach-choice-grid types" role="group" aria-label="Intervallformen aus den Workout-Vorlagen">{formats.map(format => {
          const entry = workoutLibrary.find(item => item.family === format);
          const on = answer.value.includes(format);
          return <label key={format} className={`coach-choice ${on ? 'selected' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onAnswer(question.id, { ...answer, value: on ? answer.value.filter(f => f !== format) : [...answer.value, format] })} />
            <strong>{formatTitle(format)}</strong>{entry && <small>{entry.note}</small>}
          </label>;
        })}</div>
        <p className="coach-muted">{answer.value.length ? `${answer.value.length} gewählt. Der Coach nutzt nur diese Formen und legt Wiederholungen und Steigerung fest.` : 'Wähle mindestens eine Intervallform.'}</p>
      </>}
    </div>;
  })}</div>;
}

// Shown right below the button that started an AI request, in addition to the status at the top.
function Generating({ text }) {
  return <div className="coach-message coach-generating"><span className="coach-spinner" />{text}</div>;
}

// Situation → path → own choice or AI options → preview; the AI proposal is shown as the last step.
// A preset (a season segment) already has type, length and start from the season plan: after the situation
// come questions about how this block should run, then the preview.
function BlockWizard({ catalog, profile, busy, canPlan, generating, proposal, preset, initialStart, onEdit, onPropose, onConfirm, onDiscard }) {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(() => preset?.startDate || initialStart || nextMonday());
  const [situation, setSituation] = useState(preset ? 'mitten_im_training' : '');
  const [path, setPath] = useState(preset ? 'choose' : null);
  const [choice, setChoice] = useState(() => preset ? { blockType: preset.blockType, secondaryFocus: preset.secondaryFocus ?? null, weeks: preset.weeks }
    : { blockType: '', secondaryFocus: null, weeks: '' });
  const [answers, setAnswers] = useState({});
  const [wish, setWish] = useState('');
  const edit = change => { onEdit(); change(); };
  const types = catalog?.blockTypes || [];
  const type = types.find(item => item.id === choice.blockType);
  const weeks = Number(choice.weeks);
  const weeksValid = !!type && Number.isInteger(weeks) && weeks >= type.minWeeks && weeks <= type.maxWeeks;
  const questions = useMemo(() => blockQuestions(choice.blockType, profile), [choice.blockType, profile]);
  const formats = designFormats(questions, answers);
  const steps = preset ? SEASON_WIZARD_STEPS : WIZARD_STEPS;
  const current = proposal ? steps.length - 1 : preset && step === 2 ? 1 : step;
  function submit() {
    const base = { kind: 'block', situation, startDate, ...(wish.trim() ? { instruction: wish.trim() } : {}) };
    const design = designAnswers(questions, answers);
    onPropose(path === 'recommend' ? { ...base, mode: 'recommend' }
      : { ...base, mode: 'choose', blockType: choice.blockType, secondaryFocus: choice.secondaryFocus, weeks, ...(design.length ? { design } : {}),
        ...(formats?.length ? { formats } : {}) });
  }
  const wishField = <Field label="Wunsch (optional)" hint="Präzisiert die Anfrage, z. B. „Einheiten mit hoher Kadenz einbauen“ oder „Einzelne lockere Ausfahrten nüchtern“. Der Blocktyp bleibt maßgeblich."><textarea maxLength={1500} value={wish} onChange={e => edit(() => setWish(e.target.value))} /></Field>;
  const generatingNote = generating && <Generating text={path === 'recommend' ? 'Der Coach erstellt Vorschläge für deinen Block … Das kann bis zu einer Minute dauern.' : 'Der Coach arbeitet deinen Block aus … Das kann bis zu einer Minute dauern.'} />;
  return <div className="coach-wizard">
    <ol className="coach-wizard-steps">{steps.map((label, i) => <li key={label} className={i === current ? 'current' : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    {proposal ? <BlockOptions key={proposal.id} value={proposal} busy={busy} onConfirm={onConfirm} onDiscard={onDiscard} /> : <fieldset disabled={busy}>
      {step === 0 && <>
        <h3>Wo stehst du gerade?</h3>
        <div className="coach-choice-grid" role="radiogroup" aria-label="Ausgangslage">{Object.entries(SITUATIONS).map(([key, name]) => <label key={key} className={`coach-choice ${situation === key ? 'selected' : ''}`}>
          <input type="radio" name="situation" value={key} checked={situation === key} onChange={() => edit(() => setSituation(key))} /><strong>{name}</strong><small>{SITUATION_HINTS[key]}</small>
        </label>)}</div>
        {preset ? <p className="coach-muted">Start laut Saisonplan: {seasonDate(startDate)}</p>
          : <div className="coach-inline-form"><Field label="Start (Montag)"><input type="date" min={nextMonday()} value={startDate} onChange={e => { if (e.target.value) edit(() => setStartDate(weekStart(isoWeek(e.target.value)))); }} /></Field></div>}
        <div className="coach-actions"><button type="button" className="coach-primary" disabled={!situation} onClick={() => setStep(preset ? 2 : 1)}>Weiter</button></div>
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
        {generatingNote}
      </>}
      {step === 2 && path === 'choose' && <>
        {preset && type ? <><h3>{type.name} gestalten</h3><p className="coach-muted">{SITUATIONS[situation]} · {type.summary} Beantworte nur, was dir wichtig ist, den Rest entscheidet der Coach.</p>
          <BlockQuestions questions={questions} answers={answers} formats={type.formats} onAnswer={(key, value) => edit(() => setAnswers(a => ({ ...a, [key]: value })))} /></> : <>
        <h3>Blocktyp wählen</h3><p className="coach-muted">{SITUATIONS[situation]} · Start am {dateLabel(startDate)}</p>
        <div className="coach-choice-grid types" role="radiogroup" aria-label="Blocktyp">{types.map(item => {
          const blocked = item.endsByGoal && !profile.goal.date;
          return <label key={item.id} className={`coach-choice ${choice.blockType === item.id ? 'selected' : ''} ${blocked ? 'disabled' : ''}`}>
            <input type="radio" name="block-type" value={item.id} disabled={blocked} checked={choice.blockType === item.id} onChange={() => edit(() => { setChoice(c => ({ ...c, blockType: item.id, weeks: item.defaultWeeks })); setAnswers({}); })} />
            <strong>{item.name}</strong><small>{item.summary}</small><small className="coach-choice-meta">{item.minWeeks}–{item.maxWeeks} Wochen{blocked ? ' · braucht ein Zieldatum im Athletenprofil' : ''}</small>
          </label>;
        })}</div>
        {type && <BlockQuestions questions={questions} answers={answers} formats={type.formats} onAnswer={(key, value) => edit(() => setAnswers(a => ({ ...a, [key]: value })))} />}</>}
        {type && <div className="coach-type-detail">
          {/* A season block takes length and secondary focus from the season plan. */}
          {!preset && <div className="coach-inline-form">
            <Field label="Wochen"><input type="number" min={type.minWeeks} max={type.maxWeeks} value={choice.weeks} onChange={e => edit(() => setChoice(c => ({ ...c, weeks: e.target.value })))} /></Field>
            <Field label="Nebenschwerpunkt"><select value={choice.secondaryFocus || ''} onChange={e => edit(() => setChoice(c => ({ ...c, secondaryFocus: e.target.value || null })))}><option value="">Keiner</option>{(catalog.secondaryFocus || []).map(item => {
              const blocked = item.id === 'kraft' && !profile.preferences.gymAvailability;
              return <option key={item.id} value={item.id} disabled={blocked}>{item.name}{blocked ? ' (Fitnessstudio im Profil fehlt)' : ''}</option>;
            })}</select></Field>
          </div>}
          {!weeksValid && <p className="coach-muted">Ein Block „{type.name}“ dauert {type.minWeeks}–{type.maxWeeks} Wochen.</p>}
          {weeksValid && <RhythmStrip pattern={type.rhythms?.[String(weeks)]} />}
          <ul className="coach-rules">{type.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
        </div>}
        {wishField}
        <div className="coach-actions"><button type="button" className="coach-primary" disabled={!canPlan || !weeksValid || formats?.length === 0} onClick={submit}>Block ausarbeiten lassen</button><button type="button" onClick={() => setStep(preset ? 0 : 1)}>Zurück</button></div>
        {generatingNote}
      </>}
    </fieldset>}
  </div>;
}

const seasonDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const segmentName = segment => `${segment.typeName}${segment.secondaryName ? ` + ${segment.secondaryName}` : ''}`;

// One bar to the goal: each block as wide as its weeks, with a marker for today. With onSelect, a click
// on a segment that is not over yet jumps into that block.
function SeasonStrip({ segments, selected, onSelect }) {
  const total = segments.reduce((sum, segment) => sum + segment.weeks, 0);
  const today = localDate();
  const elapsed = segments.length ? daysBetween(segments[0].startDate, today) / 7 : 0;
  return <div className="coach-season-strip" role={onSelect ? 'group' : 'img'} aria-label={`Saisonplan: ${segments.map(s => `${segmentName(s)}, ${s.weeks} Wochen`).join(' · ')}`}>
    {segments.map((segment, i) => {
      const title = `${segmentName(segment)} · ${segment.weeks} Wochen · ${seasonDate(segment.startDate)} – ${seasonDate(segment.endDate)}${segment.purpose ? `. ${segment.purpose}` : ''}`;
      const content = <><strong>{segment.typeName}</strong><small>{segment.weeks} Wo.</small></>;
      const className = `coach-season-segment ${segment.blockType}`;
      return onSelect && segment.endDate >= today
        ? <button key={i} type="button" className={className} style={{ flexGrow: segment.weeks }} aria-pressed={selected === segment.startDate}
          title={`${title}. ${segment.blockId ? 'Block öffnen' : 'Block anlegen'}`} onClick={() => onSelect(segment)}>{content}</button>
        : <div key={i} className={className} style={{ flexGrow: segment.weeks }} title={title}>{content}</div>;
    })}
    {elapsed > 0 && elapsed < total && <i className="coach-season-today" style={{ left: `${elapsed / total * 100}%` }} title="Heute" />}
  </div>;
}

function SeasonList({ segments }) {
  const today = localDate();
  return <ol className="coach-season-list">{segments.map((segment, i) => <li key={i} className={segment.endDate < today ? 'done' : segment.startDate <= today ? 'current' : ''}>
    <i className={`coach-season-dot ${segment.blockType}`} aria-hidden="true" />
    <div><strong>{segmentName(segment)} · {segment.weeks} {segment.weeks === 1 ? 'Woche' : 'Wochen'}</strong>
      <small>{seasonDate(segment.startDate)} – {seasonDate(segment.endDate)}{segment.blockId ? ' · bereits geplant' : ''}{segment.startDate <= today && today <= segment.endDate ? ' · jetzt' : ''}</small>
      {segment.purpose && <span>{segment.purpose}</span>}</div>
  </li>)}</ol>;
}

// Reorder, change or add blocks; the same rules as on the server are shown while editing.
// The season ends with Wettkampfspezifisch, optionally followed directly by a short taper.
export const endsWithRace = types => types.at(-1) === 'wettkampfspezifisch' || (types.at(-1) === 'taper' && types.at(-2) === 'wettkampfspezifisch');
// Weeks for each block so the season reaches exactly the goal week: lengths go into their type limits first, then
// the difference goes week by week to the training blocks, relative to each type's usual length (the one furthest
// below it grows, the one furthest above it shrinks). Taper and
// Wiedereinstieg keep their length unless nothing else can change. Stops when every block is at its limit.
export function fitSeasonWeeks(items, typeOf, target) {
  const range = item => [typeOf(item.blockType)?.minWeeks ?? 1, typeOf(item.blockType)?.maxWeeks ?? 12];
  const next = items.map(item => {
    const [low, high] = range(item), weeks = Number(item.weeks);
    return { ...item, weeks: Math.min(Math.max(Number.isInteger(weeks) ? weeks : low, low), high) };
  });
  let diff = target - next.reduce((sum, item) => sum + item.weeks, 0);
  while (diff !== 0) {
    const step = Math.sign(diff);
    const movable = next.map((item, index) => ({ item, index })).filter(({ item }) => { const [low, high] = range(item); return item.weeks + step >= low && item.weeks + step <= high; });
    const training = movable.filter(({ item }) => !['taper', 'wiedereinstieg'].includes(item.blockType));
    const pool = training.length ? training : movable;
    if (!pool.length) break;
    const share = ({ item }) => item.weeks / (typeOf(item.blockType)?.defaultWeeks || 1);
    const { index } = pool.reduce((best, c) => (step > 0 ? share(c) < share(best) : share(c) > share(best)) ? c : best);
    next[index] = { ...next[index], weeks: next[index].weeks + step };
    diff -= step;
  }
  return next;
}

// Weeks from a season start up to and including the goal week.
export const weeksToGoal = (start, goalDate) => daysBetween(start, weekStart(isoWeek(goalDate))) / 7 + 1;
// A season start is a Monday that has not passed.
const seasonMonday = date => { const monday = weekStart(isoWeek(date)); return monday < nextMonday() ? nextMonday() : monday; };

// With `start`, the season has no planned block yet and its start can move; the weeks to fill follow it.
function SeasonEditor({ initial, fixed, catalog, profile, remainingWeeks: givenWeeks, start: initialStart, busy, saveLabel, onSave, onCancel }) {
  const nextKey = useRef(initial.length);
  const [items, setItems] = useState(() => initial.map((segment, key) => ({ key, blockType: segment.blockType, secondaryFocus: segment.secondaryFocus ?? null, weeks: segment.weeks, purpose: segment.purpose || '' })));
  const [start, setStart] = useState(initialStart);
  const remainingWeeks = start ? weeksToGoal(start, profile.goal.date) : givenWeeks;
  const types = catalog?.blockTypes || [];
  const typeOf = identity => types.find(type => type.id === identity);
  const total = items.reduce((sum, item) => sum + (Number(item.weeks) || 0), 0);
  const open = remainingWeeks - total;
  const longest = items.reduce((sum, item) => sum + (typeOf(item.blockType)?.maxWeeks || 0), 0);
  const weeksLabel = n => `${n} ${n === 1 ? 'Woche' : 'Wochen'}`;
  // Short notes next to the week sum instead of a separate list.
  const problems = [
    ...(open > 0 ? [`noch ${weeksLabel(open)} bis zur Zielwoche`] : open < 0 ? [`${weeksLabel(-open)} zu viel`] : []),
    ...(open > 0 && longest < remainingWeeks ? [`auch mit Höchstlängen nur ${weeksLabel(longest)}, bitte einen Block hinzufügen`] : []),
    ...items.flatMap((item, i) => {
      const type = typeOf(item.blockType), weeks = Number(item.weeks);
      return type && Number.isInteger(weeks) && weeks >= type.minWeeks && weeks <= type.maxWeeks ? [] : [`Block ${fixed.length + i + 1}: ${type?.name} dauert ${type?.minWeeks}–${type?.maxWeeks} Wochen`];
    }),
    ...(!endsWithRace([...fixed, ...items].map(item => item.blockType)) ? ['der Saisonplan endet mit Wettkampfspezifisch, danach höchstens ein Taper'] : []),
  ];
  const fitted = fitSeasonWeeks(items, typeOf, remainingWeeks);
  const fittable = fitted.some((item, i) => item.weeks !== items[i].weeks);
  const update = (index, patch) => setItems(list => list.map((item, i) => i === index ? { ...item, ...patch } : item));
  const move = (index, delta) => setItems(list => { const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
  const add = () => setItems(list => {
    const item = { key: nextKey.current++, blockType: 'grundlage', secondaryFocus: null, weeks: typeOf('grundlage')?.defaultWeeks || 6, purpose: '' };
    // New blocks go before the closing Wettkampfspezifisch (and its taper).
    const tail = list.at(-1)?.blockType === 'taper' && list.at(-2)?.blockType === 'wettkampfspezifisch' ? 2 : list.at(-1)?.blockType === 'wettkampfspezifisch' ? 1 : 0;
    const at = list.length - tail;
    return [...list.slice(0, at), item, ...list.slice(at)];
  });
  return <div className="coach-season-editor">
    {start && <div className="coach-inline-form"><Field label="Saisonstart (Montag)" hint="Ab hier füllen die Blöcke die Wochen bis zum Ziel."><input type="date" min={nextMonday()} value={start} disabled={busy} onChange={e => { if (e.target.value) setStart(seasonMonday(e.target.value)); }} /></Field></div>}
    <ol>{fixed.map((segment, i) => <li key={`fixed-${i}`} className="coach-season-fixed">
      <span className="coach-step" aria-hidden="true">{i + 1}</span>
      <span>{segment.typeName}</span><span>{segment.weeks}</span><span>{segment.secondaryName ? `+ ${segment.secondaryName}` : 'Kein Nebenschwerpunkt'}</span>
      <span className="coach-season-lock">Fest</span>
      <small>Bereits geplant, {seasonDate(segment.startDate)} – {seasonDate(segment.endDate)}. Bleibt unverändert.</small>
    </li>)}{items.map((item, i) => { const n = fixed.length + i + 1; const type = typeOf(item.blockType); return <li key={item.key}>
      <span className="coach-step" aria-hidden="true">{n}</span>
      <select aria-label={`Block ${n} Typ`} value={item.blockType} disabled={busy} onChange={e => update(i, { blockType: e.target.value, weeks: typeOf(e.target.value)?.defaultWeeks || item.weeks, purpose: '' })}>{types.map(t => <option key={t.id} value={t.id} disabled={t.endsByGoal && !profile.goal.date}>{t.name}</option>)}</select>
      <input aria-label={`Block ${n} Wochen`} type="number" min={type?.minWeeks} max={type?.maxWeeks} value={item.weeks} disabled={busy} onChange={e => update(i, { weeks: e.target.value === '' ? '' : Number(e.target.value) })} />
      <select aria-label={`Block ${n} Nebenschwerpunkt`} value={item.secondaryFocus || ''} disabled={busy} onChange={e => update(i, { secondaryFocus: e.target.value || null })}><option value="">Kein Nebenschwerpunkt</option>{(catalog?.secondaryFocus || []).map(f => <option key={f.id} value={f.id} disabled={f.id === 'kraft' && !profile.preferences.gymAvailability}>+ {f.name}</option>)}</select>
      <span className="coach-season-move">
        <button type="button" aria-label={`Block ${n} nach vorne`} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
        <button type="button" aria-label={`Block ${n} nach hinten`} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
        <button type="button" aria-label={`Block ${n} entfernen`} disabled={busy || items.length === 1} onClick={() => setItems(list => list.filter((_, k) => k !== i))}>✕</button>
      </span>
      {item.purpose && <small>{item.purpose}</small>}
    </li>; })}</ol>
    <div className="coach-actions"><button type="button" disabled={busy} onClick={add}>Block hinzufügen</button>
      <button type="button" disabled={busy || !fittable} title="Verteilt die fehlenden oder überzähligen Wochen auf die Blöcke, innerhalb ihrer Mindest- und Höchstlängen." onClick={() => setItems(list => fitSeasonWeeks(list, typeOf, remainingWeeks))}>Wochen angleichen</button><p className={`coach-season-sum ${problems.length ? '' : 'ok'}`}><strong>{total} von {remainingWeeks} {fixed.length ? 'freien ' : ''}Wochen verplant</strong>{problems.map(problem => ` · ${problem}`).join('')}</p></div>
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy || problems.length > 0} onClick={() => onSave(items.map(({ key, ...item }) => ({ ...item, weeks: Number(item.weeks) })), start)}>{saveLabel}</button><button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button></div>
  </div>;
}

function SeasonOptions({ value, catalog, profile, busy, onConfirm, onDiscard }) {
  const options = value.after?.options || [];
  const fixedCount = value.after?.fixedCount || 0;
  const [selected, setSelected] = useState(() => (options.find(o => o.recommended) || options[0])?.id);
  const [editing, setEditing] = useState(false);
  const option = options.find(o => o.id === selected);
  return <section className="coach-proposal-embedded" aria-label="Saisonplan prüfen">
    <div className="coach-section-heading"><div><span className="coach-eyebrow">AI-Empfehlung · Noch nicht gespeichert</span><h3>{editing ? 'Saisonplan anpassen' : 'Saisonplan wählen'}</h3></div><span className="coach-badge recommendation">Vorschau</span></div>
    <p>{editing ? 'Tausche, verlängere oder ersetze Blöcke. Die Regeln siehst du direkt beim Bearbeiten.' : 'Wähle einen Plan und übernimm ihn so oder angepasst.'} Bis dahin ändert sich nichts.</p>
    <Hinweise items={value.hinweise} />
    {editing && option ? <SeasonEditor initial={option.season.segments.slice(fixedCount)} fixed={option.season.segments.slice(0, fixedCount)} catalog={catalog} profile={profile}
      remainingWeeks={value.after.remainingWeeks} busy={busy} saveLabel="Angepassten Plan übernehmen" onSave={segments => onConfirm(selected, segments)} onCancel={() => setEditing(false)} /> : <>
      <div className="coach-options" role="radiogroup" aria-label="Saisonpläne">{options.map(o => <label key={o.id} className={`coach-option ${selected === o.id ? 'selected' : ''}`}>
        <input type="radio" name="season-option" value={o.id} checked={selected === o.id} onChange={() => setSelected(o.id)} />
        <div><div className="coach-option-heading">{o.recommended && <span className="coach-badge recommendation">Empfehlung</span>}<p>{o.rationale}</p></div>
          <SeasonStrip segments={o.season.segments} />
          <details className="coach-details"><summary>Blöcke im Detail</summary><SeasonList segments={o.season.segments} /></details></div>
      </label>)}</div>
      {value.rejectedOptions?.length > 0 && <p className="coach-muted">{value.rejectedOptions.length === 1 ? 'Ein weiterer Plan wurde' : `${value.rejectedOptions.length} weitere Pläne wurden`} verworfen, weil er die Regeln verletzt: {value.rejectedOptions.map(o => o.reason).join(' ')}</p>}
      {value.before && <p className="coach-muted">Ersetzt deinen bisherigen Saisonplan.</p>}
      <div className="coach-actions"><button className="coach-primary" disabled={busy || !selected} onClick={() => onConfirm(selected)}>Diesen Plan übernehmen</button><button disabled={busy || !selected} onClick={() => setEditing(true)}>Anpassen</button><button disabled={busy} onClick={onDiscard}>Vorschläge verwerfen</button></div>
    </>}
  </section>;
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
    {value.wishDays?.length > 0 && <p className="coach-muted">Auf deinen Wunsch für diese Woche freigegeben: {value.wishDays.map(d => `${DAYS.find(([day]) => day === d.day)?.[1] || d.day} bis ${d.maxMinutes} min`).join(', ')}. Mit dem Übernehmen wird das als Ausnahme der Woche gespeichert.</p>}
    {changes.length > 0 && <ul className="coach-change-list">{changes.map((change, i) => <li key={i}>{change}</li>)}</ul>}
    <div className="coach-compare"><div><h3>Bisher</h3><SessionList value={value.before} /></div><div><h3>Vorgeschlagen</h3><SessionList value={value.after} /></div></div>
    <div className="coach-actions"><button className="coach-primary" disabled={busy} onClick={() => onConfirm()}>Änderungen bestätigen und übernehmen</button><button disabled={busy} onClick={onDiscard}>Vorschlag verwerfen</button></div>
  </section>;
}

export default function AICoach({ initialTab = 'today', tabVersion = 0, adjustVersion = 0, todayVersion = 0, apiBase = '', workouts = EMPTY_WORKOUTS,
  onWorkoutsChanged, onOpenWorkout, onBusyChange, onTodayChanged }) {
  const [tab, setTab] = useState(tabOf(initialTab));
  // The app keeps the coach mounted between pages; a new tabVersion asks it to show initialTab again.
  const shownTabVersion = useRef(tabVersion);
  useEffect(() => {
    if (shownTabVersion.current === tabVersion) return;
    shownTabVersion.current = tabVersion; setTab(tabOf(initialTab));
  }, [tabVersion, initialTab]);
  const [snapshot, setSnapshot] = useState(null);
  const [profile, setProfile] = useState(null);
  const [provider, setProvider] = useState(null);
  const [model, setModel] = useState('gpt-4.1-mini');
  const [customModel, setCustomModel] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [plan, setPlan] = useState(null);
  const [week, setWeek] = useState(() => isoWeek());
  const [weekly, setWeekly] = useState({ overrides: {}, note: '' });
  const [daily, setDaily] = useState({ date: localDate(), action: 'normal', maxMinutes: '', note: '' });
  const [dayView, setDayView] = useState(null);  // The day view: check-in, traffic light, period and sessions.
  const [checkInOpen, setCheckInOpen] = useState(false);
  // Where a week proposal shows: on Heute after the check-in, otherwise with the week.
  const [proposalOrigin, setProposalOrigin] = useState('week');
  const [catalog, setCatalog] = useState(null);
  const [autoStart, setAutoStart] = useState(null);
  const [planning, setPlanning] = useState('');  // Status of the running block planning, empty when idle.
  const [planHints, setPlanHints] = useState([]);
  const [timeline, setTimeline] = useState(null);
  const [rhythmFeedback, setRhythmFeedback] = useState(null);
  const [review, setReview] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [seasonWish, setSeasonWish] = useState('');
  const [seasonEditing, setSeasonEditing] = useState(false);
  const [seasonStart, setSeasonStart] = useState('');
  const [proposing, setProposing] = useState('');
  const [proposal, setProposal] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [jumpSegment, setJumpSegment] = useState(null);
  const [blockOrigin, setBlockOrigin] = useState('main');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [scrollTarget, setScrollTarget] = useState(null);
  const [dirty, setDirty] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const contextVersion = useRef(0);
  const pending = useRef(false);
  const stopPlanning = useRef(false);
  const instructionRef = useRef('');
  const priorWorkouts = useRef(workouts);
  const currentWeek = plan?.weeks?.[week];
  const anyDirty = Object.values(dirty).some(Boolean);
  const weekWorkouts = useMemo(() => workouts.filter(w => w.date >= weekStart(week) && w.date <= weekEnd(week)), [workouts, week]);

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || data.message || `Anfrage fehlgeschlagen (${response.status}).`), { status: response.status });
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
  useEffect(() => { onBusyChange?.(busy || planning); }, [busy, planning]);
  async function refreshSnapshot() { setSnapshot(await request(`/api/athlete-snapshot?${tzQuery()}`)); }

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([request(`/api/athlete-snapshot?${tzQuery()}`), request('/api/athlete-profile'), request('/api/ai-provider'), request('/api/coach/plan'), request('/api/coach/block-types')])
      .then(([s, p, ai, saved, types]) => {
        if (cancelled) return;
        setSnapshot(s); setProfile(blankProfile(p)); setProvider(ai); setModel(ai.model || 'gpt-4.1-mini'); setReasoningEffort(ai.reasoningEffort || ''); setPlan(saved); setCatalog(types);
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
    if (priorWorkouts.current !== workouts) { priorWorkouts.current = workouts; contextVersion.current += 1; setProposal(null); }
  }, [workouts]);

  // A function as value derives the new value from the current one, so quick clicks do not overwrite each other.
  function editProfile(section, key, value) {
    invalidate('profile'); setProfile(p => ({ ...p, [section]: { ...p[section], [key]: typeof value === 'function' ? value(p[section][key]) : value } }));
  }
  function toggleSport(sport) {
    const all = SPORTS.map(([key]) => key);
    editProfile('goal', 'sports', sports => {
      const next = sport === 'tri' ? (all.every(key => sports.includes(key)) ? ['ride'] : all)
        : all.filter(key => key === sport ? !sports.includes(key) : sports.includes(key));
      return next.length ? next : sports;  // At least one sport stays chosen.
    });
  }
  function toggleMonth(month) {
    editProfile('availability', 'outdoorMonths', months => months.includes(month) ? months.filter(m => m !== month) : [...months, month].sort((a, b) => a - b));
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
      setProposal(null); setProposing(kind); setProposalOrigin(extra.trigger ? 'today' : 'week');
      try {
        const context = extra.feedbackWeek ? { feedbackWeek: extra.feedbackWeek, missedSessions: extra.missedSessions } : {};
        // A check-in adjustment follows the traffic light, not the wish written for the week.
        const body = kind === 'block' ? extra : kind === 'season' ? { kind, ...(seasonWish.trim() ? { instruction: seasonWish.trim() } : {}), ...extra }
          : { kind, week: extra.week || week, instruction: extra.trigger ? '' : instruction, ...context, ...(extra.trigger ? { trigger: extra.trigger } : {}) };
        const next = await request(`/api/coach/proposals?${tzQuery()}`, 'POST', body);
        if (contextVersion.current === version) setProposal(next);
      } finally { setProposing(''); }
    });
  }
  // While a block is being planned, the week card stays usable; everything that changes the block or asks the
  // coach for something else waits.
  const occupied = !!busy || !!planning;
  const canPlan = !occupied && !anyDirty && provider?.configured;
  // Answers can arrive out of order while the planning runs next to the athlete's edits: keep the newest plan.
  const keepNewer = next => setPlan(p => (p?.revision ?? -1) > next.revision ? p : next);
  const today = localDate();
  const current = currentBlock(plan?.blocks, today);
  const currentRange = blockRange(current);
  const missing = profile ? missingSetup(profile) : [];
  const profileReady = !missing.length && !dirty.profile;
  // Exactly one next step: set up, start a block, work through it, or start the next one.
  const stage = currentRange ? (today > currentRange.end ? 'ended' : 'active') : profileReady && provider?.configured ? 'start' : 'setup';
  // Current and upcoming blocks. The block card shows the one the athlete jumped into, else the current one.
  const keptBlocks = (plan?.blocks || []).filter(b => b.status !== 'abandoned' && blockRange(b)?.end >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const block = (stage === 'active' && keptBlocks.find(b => b.id === selectedBlockId)) || current;
  const range = blockRange(block);
  const weeksIn = target => { const r = blockRange(target); return Object.entries(plan?.weeks || {}).filter(([key]) => !!r && weekStart(key) >= r.start && weekStart(key) <= r.end).map(([, value]) => value); };
  const blockHasWeeks = weeksIn(block).length > 0;
  function discardProposal() {
    return run('Vorschlag wird verworfen …', async () => { await request(`/api/coach/proposals/${proposal.id}/discard`, 'POST', {}); setProposal(null); setNotice('Vorschlag verworfen.'); });
  }
  // Days opened on the athlete's wish are saved by the backend as an exception of their week.
  async function refreshWeeklyOverrides(confirmed) {
    if (!confirmed.wishDays?.length) return;
    const saved = await request('/api/athlete-profile');
    setProfile(p => ({ ...p, weeklyOverrides: saved.weeklyOverrides }));
  }
  function confirmProposal(optionId, segments) {
    return run('Plan wird übernommen …', async () => {
      try {
        const saved = await request(`/api/coach/proposals/${proposal.id}/confirm`, 'POST', { confirm: true, ...(optionId ? { optionId } : {}), ...(segments ? { segments } : {}) });
        setPlan(saved); setProposal(null); await onWorkoutsChanged?.(); await refreshWeeklyOverrides(proposal);
        if (proposal.kind === 'season') setNotice('Saisonplan übernommen. Du planst weiterhin Block für Block.');
        else if (proposal.kind === 'block') {
          const chosen = proposal.after.options.find(option => option.id === optionId).block;
          setSelectedBlockId(chosen.id || null); setJumpSegment(null); setScrollTarget('.coach-block-card');
          setWeek(isoWeek(chosen.startDate)); setAutoStart({ block: chosen, weeks: saved.weeks || {} });
        } else setNotice('Plan übernommen. Die Einheiten sind im Kalender verfügbar.');
      } catch (e) { setProposal(null); throw e; }
    });
  }
  // All weeks of a block are planned one after another with the standard week from the profile; each week
  // builds on the ones before. The athlete started it by taking over the block or with the button, and can meanwhile
  // step through the weeks, lock sessions and enter exceptions or a wish: these apply to the weeks still to come.
  async function planWeek(key) {
    const path = `/api/coach/proposals?${tzQuery()}`;
    for (let attempt = 1; ; attempt += 1) {
      const body = { kind: 'week', week: key, instruction: instructionRef.current };
      // One retry: an AI answer occasionally breaks a block rule.
      const next = await request(path, 'POST', body).catch(() => request(path, 'POST', body));
      try {
        keepNewer(await request(`/api/coach/proposals/${next.id}/confirm`, 'POST', { confirm: true }));
        await refreshWeeklyOverrides(next);
        return next;
      } catch (e) {
        // An edit of the athlete in the meantime makes the proposal stale; the week is planned again with it.
        if (e.status !== 409 || attempt === 3) throw e;
      }
    }
  }
  async function planBlockWeeks(target, planned) {
    const keys = openBlockWeeks(target, planned, localDate());
    if (!keys.length || planning) return;
    if (anyDirty) { setError('Speichere zuerst deine offenen Änderungen.'); return; }
    stopPlanning.current = false; setPlanHints([]); setError(''); setNotice('');
    const status = text => { if (!stopPlanning.current) setPlanning(text); };
    const hints = [];
    let done = 0;
    status(`Woche 1 von ${keys.length} wird geplant …`);
    try {
      for (const key of keys) {
        if (stopPlanning.current) break;
        status(`Woche ${done + 1} von ${keys.length} wird geplant · ${key} …`);
        const next = await planWeek(key);
        hints.push(...(next.hinweise || []).map(hint => `${key}: ${hint}`));
        done += 1;
        // The new workouts can be opened right away.
        await Promise.resolve(onWorkoutsChanged?.()).catch(() => {});
      }
      setNotice(done === keys.length ? `${done} ${done === 1 ? 'Woche' : 'Wochen'} geplant. Die Einheiten stehen im Kalender, jede Woche lässt sich noch anpassen.`
        : `Angehalten: ${done} von ${keys.length} Wochen geplant.`);
    } catch (e) {
      setError(`${keys[done]} konnte nicht geplant werden: ${e.message}${done ? ` Die ${done} Wochen davor sind gespeichert.` : ''} Mit „Restliche Wochen planen“ geht es dort weiter.`);
    } finally {
      setPlanHints(hints); setPlanning('');
    }
  }
  useEffect(() => {
    if (!autoStart || busy) return;
    setAutoStart(null);
    planBlockWeeks(autoStart.block, autoStart.weeks);
  }, [autoStart, busy]);
  useEffect(() => {
    if (stage !== 'active' || !block?.id) { setTimeline(null); return undefined; }
    let cancelled = false;
    request(`/api/coach/blocks/${encodeURIComponent(block.id)}/timeline?${tzQuery()}`)
      .then(result => { if (!cancelled) setTimeline(result); }).catch(() => { if (!cancelled) setTimeline(null); });
    return () => { cancelled = true; };
    // Plan revisions and calendar changes refresh planned and completed hours.
  }, [stage, block?.id, plan?.revision, workouts]);
  useEffect(() => {
    if (stage !== 'ended' || !block?.id) { setReview(null); return undefined; }
    let cancelled = false;
    request(`/api/coach/blocks/${encodeURIComponent(block.id)}/review?${tzQuery()}`)
      .then(result => { if (!cancelled) setReview(result); }).catch(() => { if (!cancelled) setReview(null); });
    return () => { cancelled = true; };
  }, [stage, block?.id, plan?.revision, workouts]);
  async function saveReview(reflection) {
    await run('Einschätzung wird gespeichert …', async () => {
      invalidate();
      setReview(await request(`/api/coach/blocks/${encodeURIComponent(block.id)}/review?${tzQuery()}`, 'PUT', reflection));
      setPlan(await request('/api/coach/plan')); setNotice('Einschätzung gespeichert. Sie fließt in den nächsten Block ein.');
    });
  }
  async function saveSeason(segments, startDate) {
    await run('Saisonplan wird gespeichert …', async () => {
      invalidate(); setPlan(await request(`/api/coach/season?${tzQuery()}`, 'PUT', { segments, ...(startDate ? { startDate } : {}) })); setSeasonEditing(false); setNotice('Saisonplan gespeichert.');
    });
  }
  const deletedText = count => count ? ` ${count} ${count === 1 ? 'Workout wurde' : 'Workouts wurden'} aus dem Kalender entfernt.` : '';
  // After a deletion the plan shows the block that is now current, starting with its first open week.
  function afterDelete(saved) {
    const next = blockRange(currentBlock(saved.blocks, localDate()));
    setPlan(saved); setSelectedBlockId(null); setJumpSegment(null); setConfirmDelete(null); setPlanHints([]);
    setWeek(next && localDate() < next.start ? isoWeek(next.start) : isoWeek());
  }
  async function deleteSeason(withBlocks) {
    await run('Saisonplan wird gelöscht …', async () => {
      invalidate(); setSeasonEditing(false);
      const saved = await request(`/api/coach/season?${tzQuery()}${withBlocks ? '&blocks=true' : ''}`, 'DELETE');
      afterDelete(saved);
      if (withBlocks) await onWorkoutsChanged?.();
      setNotice(withBlocks ? `Saisonplan und seine Trainingsblöcke gelöscht.${deletedText(saved.deletedWorkouts)}` : 'Saisonplan gelöscht. Deine Trainingsblöcke bleiben bestehen.');
    });
  }
  async function deleteBlock(target) {
    await run('Trainingsblock wird gelöscht …', async () => {
      invalidate();
      const saved = await request(`/api/coach/blocks/${encodeURIComponent(target.id)}?${tzQuery()}`, 'DELETE');
      afterDelete(saved); await onWorkoutsChanged?.();
      setNotice(`Trainingsblock gelöscht.${deletedText(saved.deletedWorkouts)}`);
    });
  }
  // Jump into a block: a planned one opens in the block card, a season block without plan can be created there.
  function showBlock(target) {
    if (dirty.weekly) { setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); return; }
    const r = blockRange(target);
    invalidate(); setJumpSegment(null); setConfirmDelete(null);
    setSelectedBlockId(target.id === current?.id ? null : target.id);
    setWeek(r.start <= today && today <= r.end ? isoWeek(today) : isoWeek(r.start));
    setScrollTarget('.coach-block-card');
  }
  function jumpTo(segment) {
    const target = segment.blockId && keptBlocks.find(b => b.id === segment.blockId);
    if (target) { showBlock(target); return; }
    invalidate(); setConfirmDelete(null); setJumpSegment(segment.startDate); setScrollTarget('.coach-jump-card');
  }
  useEffect(() => {
    if (!scrollTarget) return;
    document.querySelector(scrollTarget)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);
  useEffect(() => {
    if (proposal && !['block', 'season'].includes(proposal.kind)) document.querySelector('.coach-proposal')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [proposal]);
  const workoutsById = useMemo(() => Object.fromEntries(workouts.map(workout => [workout.id, workout])), [workouts]);
  const ownWorkouts = weekWorkouts.filter(workout => !(currentWeek?.sessions || []).some(session => session.id === workout.id));
  const thisWeek = isoWeek(today);
  const inBlock = key => !!currentRange && weekStart(key) >= currentRange.start && weekStart(key) <= currentRange.end;
  // Close the week: from Friday on, or right away if last week was left open. An empty next week is planned,
  // an already planned one is adjusted or kept until the week has its review.
  let rhythm = null;
  if (stage === 'active' && !planning && !autoStart) {
    const lastWeek = isoWeek(addDays(today, -7)), nextWeek = isoWeek(addDays(today, 7));
    const reviewed = plan.weeks?.[thisWeek]?.missedSessions !== undefined;
    if (inBlock(thisWeek) && !plan.weeks?.[thisWeek] && plan.weeks?.[lastWeek]) rhythm = { review: lastWeek, next: thisWeek };
    else if ((new Date(`${today}T12:00:00`).getDay() + 6) % 7 >= 4 && plan.weeks?.[thisWeek] && inBlock(nextWeek)) {
      if (!plan.weeks?.[nextWeek]) rhythm = { review: thisWeek, next: nextWeek };
      else if (!reviewed) rhythm = { review: thisWeek, next: nextWeek, planned: true };
    }
  }
  const openWeeks = stage === 'active' ? openBlockWeeks(block, plan.weeks, today) : [];
  // Step through the weeks of the shown block; a weekly draft has to be saved first.
  function goToWeek(key) {
    if (dirty.weekly) { setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); return; }
    if (key === week) return;
    invalidate(); setWeek(key);
  }
  const inRange = key => !!range && weekStart(key) >= weekStart(isoWeek(range.start)) && weekStart(key) <= range.end;
  const previousWeek = range && inRange(isoWeek(addDays(weekStart(week), -7))) ? isoWeek(addDays(weekStart(week), -7)) : null;
  const followingWeek = range && inRange(isoWeek(addDays(weekStart(week), 7))) ? isoWeek(addDays(weekStart(week), 7)) : null;
  const blockWorkouts = weeksIn(block).flatMap(value => value.sessions || []).filter(session => session.rendered?.workout).length;
  async function toggleLock(identity, locked) {
    await run('Einheit wird aktualisiert …', async () => {
      invalidate(); await request(`/api/workouts/${identity}/lock`, 'PUT', { locked });
      keepNewer(await request('/api/coach/plan')); await onWorkoutsChanged?.(); setNotice(locked ? 'Einheit fixiert.' : 'Fixierung aufgehoben.');
    });
  }
  // The day view follows plan and calendar changes and check-ins saved elsewhere in the app.
  async function refreshToday() {
    try { const view = await loadToday(apiBase); setDayView(view); onTodayChanged?.(view); return view; } catch (_) { return null; }
  }
  useEffect(() => { if (!loading) refreshToday(); }, [apiBase, loading, todayVersion, plan?.revision, workouts]);
  function savedCheckIn(view) {
    invalidate(); setDayView(view); onTodayChanged?.(view); refreshSnapshot().catch(() => {});
  }
  function adjustToToday() {
    const key = isoWeek(localDate());
    if (!provider?.configured) { setTab('provider'); setError('Verbinde zuerst deinen AI-Provider, dann passt der Coach deine Woche an.'); return; }
    if (!plan?.weeks?.[key]) { setError('Für diese Woche hat der Coach noch keinen Plan, den er anpassen könnte.'); return; }
    setTab('today'); setWeek(key);
    propose('patch', { week: key, trigger: 'checkIn' });
  }
  // The app asks for an adjustment after the morning check-in; it starts once the coach has loaded.
  const shownAdjust = useRef(0);
  const [adjustPending, setAdjustPending] = useState(false);
  useEffect(() => { if (adjustVersion !== shownAdjust.current) { shownAdjust.current = adjustVersion; setAdjustPending(true); } }, [adjustVersion]);
  useEffect(() => {
    if (!adjustPending || loading || !plan || !provider || busy) return;
    setAdjustPending(false); adjustToToday();
  }, [adjustPending, loading, plan, provider, busy]);
  async function heal(injury) {
    await run('Beschwerde wird aktualisiert …', async () => {
      invalidate(); const view = await healInjury(apiBase, injury.id); setDayView(view); onTodayChanged?.(view);
      setNotice(`${injury.label} als ausgeheilt gespeichert.`);
    });
  }
  instructionRef.current = instruction;
  const wishField = <Field label="Wunsch für die Planung"><textarea maxLength={2000} value={instruction} placeholder="z. B. Diese Woche am Mittwoch trainieren, Donnerstag frei halten, die lange Ausfahrt am Samstag beibehalten." onChange={e => { invalidate(); setInstruction(e.target.value); }} /></Field>;
  const season = plan?.season;
  // Blocks are laid out in order: the first season block without a plan is the one that can be created next.
  const nextOpenSegment = season?.aligned ? season.segments.find(segment => !segment.blockId && segment.startDate >= season.openFrom) : null;
  // Without a running block, that season block is the next step and opens right away.
  const seasonNext = ['start', 'ended'].includes(stage) && nextOpenSegment?.startDate >= nextMonday(today) ? nextOpenSegment : null;
  // The season block the athlete clicked, else that next block.
  const jumpTarget = (jumpSegment && season?.segments.find(segment => segment.startDate === jumpSegment && !segment.blockId && segment.endDate >= today)) || (!jumpSegment && seasonNext) || null;
  const jumpNumber = jumpTarget ? season.segments.indexOf(jumpTarget) + 1 : 0;
  // The season start is chosen as long as no block is current or upcoming; after that the blocks fix it.
  const seasonStartOpen = !keptBlocks.length;
  const defaultSeasonStart = season?.startDate >= nextMonday(today) ? season.startDate : nextMonday(today);
  const seasonStartField = seasonStartOpen && <div className="coach-inline-form"><Field label="Saisonstart (Montag)" hint="Ab hier plant der Coach die Blöcke bis zum Ziel.">
    <input type="date" min={nextMonday(today)} value={seasonStart || defaultSeasonStart} onChange={e => { if (e.target.value) { invalidate(); setSeasonStart(seasonMonday(e.target.value)); } }} /></Field></div>;
  const proposeSeason = () => propose('season', seasonStartOpen ? { startDate: seasonStart || defaultSeasonStart } : {});
  const seasonGenerating = proposing === 'season' && <Generating text="Der Coach erstellt Saisonpläne … Das kann bis zu einer Minute dauern." />;
  const seasonOpen = season ? season.segments.filter(segment => segment.startDate >= season.openFrom) : [];
  const seasonFixed = season ? season.segments.filter(segment => segment.startDate < season.openFrom && segment.endDate >= today) : [];
  const goalAhead = !!profile?.goal?.date && profile.goal.date >= today;
  // With a goal ahead the season plan comes first: a block is shaped only once the plan is set, fits the blocks
  // and is not being proposed anew or edited.
  const seasonFirst = stage !== 'setup' && goalAhead && (!season || !season.aligned || proposal?.kind === 'season' || seasonEditing);
  // A season block the athlete opened from the strip takes the place of the current block and its weeks.
  const jumpOpen = !!jumpSegment && !!jumpTarget && !seasonFirst;
  const goalName = profile?.goal?.name?.trim() || goalLabel(profile?.goal?.type, profile?.goal?.sports) || 'deinem Ziel';
  const seasonWishField = <Field label="Wunsch für den Saisonplan (optional)" hint="z. B. „Im Winter vor allem Rolle, im Frühjahr ein Trainingslager“."><textarea maxLength={1500} value={seasonWish} onChange={e => { invalidate(); setSeasonWish(e.target.value); }} /></Field>;
  // Several wizards can be on screen; a block proposal shows in the one that asked for it.
  const wizardFor = (origin, extra = {}) => <BlockWizard key={origin} catalog={catalog} profile={profile} busy={occupied} canPlan={canPlan} generating={proposing === 'block' && blockOrigin === origin} proposal={proposal?.kind === 'block' && blockOrigin === origin ? proposal : null}
    onEdit={() => invalidate()} onPropose={body => { setBlockOrigin(origin); propose('block', body); }} onConfirm={confirmProposal} onDiscard={discardProposal} {...extra} />;
  const seasonCard = stage !== 'setup' && goalAhead && <section className="coach-card coach-season-card" aria-label="Saisonplan">
    <div className="coach-section-heading"><div><span className="coach-eyebrow">Saisonplan · bis {goalName}</span><h2>{season ? 'Dein Weg zum Ziel' : 'Deinen Weg zum Ziel planen'}</h2></div>
      {season && proposal?.kind !== 'season' && <span className={`coach-badge ${season.source === 'athleteEdited' ? 'athlete' : 'recommendation'}`}>{season.source === 'athleteEdited' ? 'Von dir angepasst' : 'AI-Empfehlung'}</span>}</div>
    {proposal?.kind === 'season' ? <SeasonOptions key={proposal.id} value={proposal} catalog={catalog} profile={profile} busy={occupied} onConfirm={confirmProposal} onDiscard={discardProposal} />
      : season && seasonEditing ? <SeasonEditor initial={seasonOpen} fixed={seasonFixed} catalog={catalog} profile={profile} remainingWeeks={season.remainingWeeks} start={seasonStartOpen ? defaultSeasonStart : null} busy={occupied} saveLabel="Saisonplan speichern" onSave={saveSeason} onCancel={() => setSeasonEditing(false)} />
      : season ? <>
        {season.rationale && <p>{season.rationale}</p>}
        {season.segments.length > 0 && <p className="coach-muted coach-season-range">Start {seasonDate(season.segments[0].startDate)} · Ziel {seasonDate(profile.goal.date)} · {season.segments.reduce((sum, segment) => sum + segment.weeks, 0)} Wochen</p>}
        {(season.goalChanged || !season.aligned) && <div className="coach-message">{season.goalChanged ? 'Dein Zieldatum hat sich geändert.' : 'Der Saisonplan passt nicht mehr zu deinen geplanten Blöcken.'} Passe ihn an oder lass ihn neu vorschlagen.</div>}
        <SeasonStrip segments={season.segments} selected={jumpTarget?.startDate || (stage === 'active' ? season.segments.find(segment => segment.blockId && segment.blockId === block?.id)?.startDate : null)} onSelect={occupied ? null : jumpTo} />
        <p className="coach-muted coach-season-hint">Klicke auf einen Block, um ihn zu öffnen oder anzulegen und seine Workouts zu planen.</p>
        <details className="coach-details"><summary>Blöcke im Detail</summary><SeasonList segments={season.segments} /></details>
        <details className="coach-details" open={proposing === 'season' || undefined}><summary>Neu vorschlagen lassen</summary><p className="coach-muted">{seasonStartOpen ? 'Der Coach plant die Blöcke ab dem Saisonstart neu.' : 'Bereits geplante Blöcke bleiben fest. Der Coach plant die Zeit danach neu.'}</p>{seasonStartField}{seasonWishField}
          <div className="coach-actions"><button className="coach-primary" disabled={!canPlan} onClick={proposeSeason}>Neue Vorschläge erstellen</button></div>{seasonGenerating}</details>
        {confirmDelete === 'season' ? <div className="coach-confirm-delete" role="group" aria-label="Saisonplan löschen">
          <p><strong>Was soll gelöscht werden?</strong> Nur der Saisonplan, oder auch seine laufenden und kommenden Trainingsblöcke{keptBlocks.length ? ` (${keptBlocks.length})` : ''} mit allen geplanten Wochen und Workouts im Kalender. Abgeschlossene Blöcke und eigene Workouts bleiben.</p>
          <div className="coach-actions"><button disabled={occupied} onClick={() => deleteSeason(false)}>Nur Saisonplan löschen</button><button className="coach-danger" disabled={occupied} onClick={() => deleteSeason(true)}>Mit Blöcken und Workouts löschen</button><button disabled={occupied} onClick={() => setConfirmDelete(null)}>Abbrechen</button></div>
        </div> : <div className="coach-actions"><button disabled={occupied} onClick={() => { invalidate(); setSeasonEditing(true); }}>Saisonplan bearbeiten</button><button className="coach-danger" disabled={occupied} onClick={() => setConfirmDelete('season')}>Saisonplan löschen</button></div>}
      </> : <>
        <p className="coach-muted">Der Coach teilt die Zeit bis {dateLabel(profile.goal.date)} in Trainingsblöcke auf, zum Beispiel Grundlage, Aufbau, VO2max, Schwelle und zum Schluss wettkampfspezifisch. Du bekommst zwei bis drei Varianten, kannst Blöcke tauschen und anpassen und planst danach weiter Block für Block.</p>
        {seasonStartField}
        {seasonWishField}
        <div className="coach-actions"><button className="coach-primary" disabled={!canPlan} onClick={proposeSeason}>Saisonplan vorschlagen lassen</button></div>
        {seasonGenerating}
        <p className="coach-muted coach-season-hint">Sobald dein Saisonplan steht, gestaltest du hier Block für Block, beginnend mit dem ersten.</p>
        {['start', 'ended'].includes(stage) && <details className="coach-details" open={(proposal?.kind === 'block' && blockOrigin === 'main') || undefined}><summary>Ohne Saisonplan einen einzelnen Block planen</summary>{wizardFor('main')}</details>}
      </>}
  </section>;
  const wizard = wizardFor('main');
  const jumpCard = jumpTarget && <section className="coach-card coach-jump-card" aria-label="Block aus dem Saisonplan">
    <div className="coach-section-heading"><div><span className="coach-eyebrow">{jumpSegment ? 'Block aus deinem Saisonplan' : 'Nächster Schritt · Block aus deinem Saisonplan'} · noch nicht angelegt</span>
      <h2>Block {jumpNumber} von {season.segments.length}: {segmentName(jumpTarget)} · {jumpTarget.weeks} {jumpTarget.weeks === 1 ? 'Woche' : 'Wochen'}</h2></div>
      {jumpSegment && <button type="button" disabled={occupied} onClick={() => { invalidate(); setJumpSegment(null); }}>Schließen</button>}</div>
    <p className="coach-muted">{seasonDate(jumpTarget.startDate)} – {seasonDate(jumpTarget.endDate)}{jumpTarget.purpose ? ` · ${jumpTarget.purpose}` : ''}</p>
    {nextOpenSegment?.startDate === jumpTarget.startDate && jumpTarget.startDate >= nextMonday(today) ? <>
      <p>Hier legst du diesen Block an und bestimmst, wie er laufen soll. Typ und Start kommen aus dem Saisonplan oben. Danach arbeitet der Coach Umfang und Entlastung aus und plant nach dem Übernehmen alle Wochen mit Workouts für deinen Kalender.</p>
      {wizardFor(`season-${jumpTarget.startDate}`, { preset: jumpTarget })}
    </> : nextOpenSegment ? <>
      <p>Trainingsblöcke werden der Reihe nach angelegt, jeder baut auf dem vorherigen auf. Als Nächstes kommt {segmentName(nextOpenSegment)} ab {dateLabel(nextOpenSegment.startDate)}.</p>
      <div className="coach-actions"><button className="coach-primary" disabled={occupied} onClick={() => jumpTo(nextOpenSegment)}>Zu {segmentName(nextOpenSegment)} springen</button></div>
    </> : <div className="coach-message">Der Saisonplan passt nicht mehr zu deinen Trainingsblöcken. Passe ihn an oder lass ihn neu vorschlagen, dann lassen sich seine Blöcke anlegen.</div>}
  </section>;

  // On the provider tab the buttons sit far below the header, so feedback appears next to them.
  const messagesInCard = !loading && !!provider && tab === 'provider';
  const messages = <>
    {error && <div role="alert" className="coach-message error">{error}{!profile && !loading && <button onClick={() => window.location.reload()}>Erneut laden</button>}</div>}
    {notice && <div role="status" className="coach-message success">{notice}</div>}
    {planning && <div role="status" className="coach-message"><span className="coach-spinner" />{planning}<button type="button" onClick={() => { stopPlanning.current = true; setPlanning('Wird nach dieser Woche angehalten …'); }}>Anhalten</button></div>}
    {busy && <div role="status" className="coach-message"><span className="coach-spinner" />{busy}</div>}
  </>;

  return <div className="ai-coach">
    <header className="coach-heading"><div><span className="coach-eyebrow">Training Plēnum / Dein Training, mit Kontext</span><h1>AI Coach <span className="coach-beta">BYOK</span></h1><p>Deine Trainingsdaten. Deine Ziele. Ein Plan, den du freigibst.</p></div><button type="button" className={`coach-connection ${provider?.configured ? 'ready' : ''}`} title="AI Provider und Modell einstellen" onClick={() => setTab('provider')}><i />{provider?.configured ? `Provider verbunden · ${provider.model}` : 'Provider einrichten'}</button></header>
    <nav className="coach-tabs" aria-label="AI Coach Bereiche">{TABS.map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}{((key === 'profile' && dirty.profile) || (key === 'provider' && dirty.provider)) && <span aria-label="Ungespeicherte Änderungen"> •</span>}{key === 'today' && dayView && !dayView.checkIn && dayView.dailyCheckIn && <span className="coach-tab-dot" aria-label="Check-in offen" />}</button>)}</nav>
    {!messagesInCard && messages}
    {loading && <p role="status" className="coach-muted">Athletenkontext wird geladen …</p>}
    {!loading && snapshot && tab === 'review' && <section className="coach-stats" aria-label="Gemessener Trainingskontext">
      {[['Letzte 7 Tage', snapshot.observed?.currentTraining?.last7Days?.trainingHours, 'Trainingsstunden'], ['Letzte 28 Tage', snapshot.observed?.currentTraining?.last28Days?.trainingHours, 'Trainingsstunden'], ['Letzte 42 Tage', snapshot.observed?.currentTraining?.last42Days?.trainingHours, 'Trainingsstunden'], ['Historisch · 6 Wochen Ø', snapshot.observed?.observedTrainingCapacity?.max6WeekAverageHours, 'Maximal beobachtet pro Woche']].map(([label, value, sub]) => <div key={label}><span>{label}</span><strong>{hours(value)}</strong><small>{sub}</small></div>)}
      <p>Aus Trainingsdaten berechnet · Historischer Umfang ist keine Belastbarkeitsempfehlung.</p>
    </section>}

    {!loading && profile && tab === 'profile' && <form onSubmit={saveProfile} className="coach-card">
      <fieldset disabled={occupied}><div className="coach-section-heading"><div><span className="coach-eyebrow">Selbstauskunft · Von dir</span><h2>Wofür trainierst du?</h2></div><span className="coach-badge athlete">Athlet</span></div>
        <h3>Welche Sportarten trainierst du?</h3>
        <Toggles label="Sportarten" items={[...SPORTS, ['tri', 'Triathlon']]} isOn={key => key === 'tri' ? SPORTS.every(([sport]) => profile.goal.sports.includes(sport)) : profile.goal.sports.includes(key)} onToggle={toggleSport} />
        {profile.goal.sports.includes('swim') && <p className="coach-muted">Für Schwimmen hat der Coach noch keine Trainingsvorlagen. {profile.goal.sports.length > 1 ? 'Er plant vorerst deine anderen Sportarten.' : 'Wähle zusätzlich Radfahren oder Laufen, damit er planen kann.'}</p>}
        <h3>Was ist dein Ziel?</h3>
        <div className="coach-choice-grid" role="radiogroup" aria-label="Was ist dein Ziel?">{Object.entries(GOALS).map(([key, name]) => <label key={key} className={`coach-choice ${profile.goal.type === key ? 'selected' : ''}`}>
          <input type="radio" name="goal-type" value={key} checked={profile.goal.type === key} onChange={() => editProfile('goal', 'type', key)} /><strong>{name}</strong><small>{GOAL_HINTS[key]}</small></label>)}</div>
        <div className="coach-form-grid"><Field label="Ziel / Event"><input maxLength={200} value={profile.goal.name} onChange={e => editProfile('goal', 'name', e.target.value)} placeholder={GOAL_PLACEHOLDERS[profile.goal.type] || ''} /></Field>
          <Field label="Zieldatum" hint={profile.goal.type === 'event' ? 'Der Tag des Events. Saisonplan und Wettkampfblöcke richten sich danach.' : 'Optional: bis wann du dein Ziel erreichen willst.'}><input type="date" value={profile.goal.date || ''} onChange={e => editProfile('goal', 'date', e.target.value || null)} /></Field>
          <Field label="Konkretes Ziel (optional)"><input maxLength={300} value={profile.goal.target || ''} onChange={e => editProfile('goal', 'target', e.target.value || null)} placeholder="z. B. entspannt finishen" /></Field></div>

        <h3>Wie viel willst du trainieren?</h3>
        <p className="coach-muted">In welchen Monaten trainierst du draußen? Die übrigen Monate gelten als Wintermonate drinnen, etwa auf der Rolle oder dem Laufband. Ohne Auswahl gilt das ganze Jahr derselbe Umfang.</p>
        <Toggles label="Monate draußen" className="months" items={MONTHS.map((name, index) => [index + 1, name])} isOn={month => profile.availability.outdoorMonths.includes(month)} onToggle={toggleMonth} />
        <SeasonVolume availability={profile.availability} rides={profile.goal.sports.includes('ride')} onEdit={(key, value) => editProfile('availability', key, value)} />
        <div className="coach-form-grid"><Field label="Absolutes Zeitmaximum (h/Woche)" hint="Dein zeitliches Limit für Ausnahmefälle, das ganze Jahr."><input type="number" min={Math.max(profile.availability.preferredWeeklyHours || 0, profile.availability.indoorWeeklyHours || 0)} max="60" step="0.5" value={profile.availability.absoluteMaxWeeklyHours ?? ''} onChange={e => editProfile('availability', 'absoluteMaxWeeklyHours', number(e.target.value))} /></Field>
          <div><Field label="Trainingstage pro Woche" hint="So oft willst du im Schnitt trainieren. Leer = der Coach entscheidet."><input type="number" min="1" max="7" step="1" value={profile.availability.trainingDaysPerWeek ?? ''} onChange={e => editProfile('availability', 'trainingDaysPerWeek', number(e.target.value))} /></Field>
            <label className="coach-checkbox"><input type="checkbox" checked={profile.availability.noConsecutiveRestDays} onChange={e => editProfile('availability', 'noConsecutiveRestDays', e.target.checked)} />Keine zwei Ruhetage hintereinander</label>
            {profile.availability.noConsecutiveRestDays && profile.availability.trainingDaysPerWeek != null && profile.availability.trainingDaysPerWeek < 3 && <p className="coach-muted">Dafür braucht es mindestens 3 Trainingstage pro Woche.</p>}</div></div>

        <h3>An welchen Tagen hast du wie viel Zeit?</h3>
        <p className="coach-muted">Wähle für jeden Wochentag, wie lange du an einem normalen Tag höchstens trainieren kannst. „Keine Zeit“ heißt: an diesem Tag nie. Das ist dein Zeitrahmen – der Coach plant darin und nutzt nicht jeden Tag.</p>
        <WeekSummary availability={profile.availability} recentWeeklyHours={sourceValue(snapshot?.observed?.currentTraining?.last28Days?.trainingHours) == null ? null : sourceValue(snapshot.observed.currentTraining.last28Days.trainingHours) / 4} />
        <div className="coach-day-inputs">{DAYS.map(([day, label]) => { const value = profile.availability.defaultAvailability[day]; return <Field key={day} label={label}><select aria-label={`${label} Standardverfügbarkeit`} value={value ?? ''} onChange={e => editProfile('availability', 'defaultAvailability', { ...profile.availability.defaultAvailability, [day]: number(e.target.value) })}>
          <option value="">Offen</option><option value="0">Keine Zeit</option>{[...new Set([...DAY_MINUTES, value])].filter(minutes => minutes > 0).sort((a, b) => a - b).map(minutes => <option key={minutes} value={minutes}>{minutesLabel(minutes)}</option>)}</select></Field>; })}</div>
        <div className="coach-form-grid">{[['preferredRestDay', 'Bevorzugter Ruhetag'], ['preferredLongSessionDay', 'Tag für lange Einheiten']].map(([key, label]) => <Field key={key} label={label}><select value={profile.preferences[key] || ''} onChange={e => editProfile('preferences', key, e.target.value || null)}><option value="">Keine Präferenz</option>{DAYS.map(([day, name]) => <option value={day} key={day}>{name}</option>)}</select></Field>)}</div>

        <h3>Sonst noch wichtig</h3>
        <label className="coach-checkbox"><input type="checkbox" checked={profile.preferences.gymAvailability} onChange={e => editProfile('preferences', 'gymAvailability', e.target.checked)} />Fitnessstudio verfügbar</label>
        <label className="coach-checkbox"><input type="checkbox" checked={profile.preferences.dailyCheckIn} onChange={e => editProfile('preferences', 'dailyCheckIn', e.target.checked)} />Morgen-Check-in beim ersten Öffnen am Tag anzeigen</label>
        <div className="coach-form-grid"><Field label="Einschränkungen"><textarea maxLength={2000} value={profile.limitations.notes} onChange={e => editProfile('limitations', 'notes', e.target.value)} placeholder="Verletzungen, Einschränkungen oder Dinge, die berücksichtigt werden sollen" /></Field><Field label="Aktueller Zustand"><textarea maxLength={2000} value={profile.currentState.notes} onChange={e => editProfile('currentState', 'notes', e.target.value)} placeholder="Was sollte der Coach über deine aktuelle Situation wissen?" /></Field></div>
        <div className="coach-actions"><button className="coach-primary" type="submit">Athletenprofil speichern</button>{dirty.profile && <small className="coach-muted">Ungespeicherte Angaben</small>}</div>
      </fieldset>
    </form>}

    {!loading && provider && tab === 'provider' && <section className="coach-card coach-provider">
      <span className="coach-eyebrow">Bring your own key</span><h2>Dein AI Provider</h2><p className="coach-muted">Training Plēnum sendet verdichteten Trainingskontext und Workout-Templates an deinen Provider. Modellanfragen werden über deinen API-Zugang abgerechnet.</p>
      <KeyNotice provider={provider} />
      <form onSubmit={event => { event.preventDefault(); const key = apiKey.trim(); setApiKey(''); run('Provider wird gespeichert …', async () => { const saved = await request('/api/ai-provider', 'PUT', { provider: 'openai', model: model.trim(), reasoningEffort: reasoningEffort || null, ...(key ? { apiKey: key } : {}) }); setProvider(saved); setModel(saved.model || model); setReasoningEffort(saved.reasoningEffort || ''); setDirty(d => ({ ...d, provider: false })); invalidate(); setNotice('Provider-Einstellungen gespeichert.'); }); }}>
        <fieldset disabled={occupied}><div className="coach-form-grid"><Field label="Provider"><select value="openai" disabled><option value="openai">OpenAI</option></select></Field><Field label="Modell"><select value={customModel || !MODEL_PRESETS.includes(model) ? 'custom' : model} onChange={e => { invalidate('provider'); const custom = e.target.value === 'custom'; setCustomModel(custom); if (!custom) setModel(e.target.value); }}>{MODEL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}<option value="custom">Anderes Modell …</option></select></Field>{(customModel || !MODEL_PRESETS.includes(model)) && <Field label="Modell-ID" hint="Beliebige OpenAI-Modell-ID mit Unterstützung für strukturierte Responses."><input required spellCheck="false" value={model} onChange={e => { invalidate('provider'); setModel(e.target.value); }} /></Field>}<Field label="Reasoning" hint="Nur für Reasoning-Modelle. Höhere Stufen denken länger und kosten mehr."><select value={reasoningEffort} onChange={e => { invalidate('provider'); setReasoningEffort(e.target.value); }}>{REASONING_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
          <Field label={provider.configured ? `API Key ersetzen (gespeichert: ••••${provider.keyLast4 || ''})` : 'API Key'} hint="Das Feld wird nach dem Absenden geleert. Der Key bleibt nur verschlüsselt im Backend."><input type="password" autoComplete="new-password" spellCheck="false" value={apiKey} placeholder={provider.configured ? 'Leer lassen, um den vorhandenen Key zu behalten' : 'API Key eingeben'} onChange={e => { invalidate('provider'); setApiKey(e.target.value); }} /></Field>
          <div className="coach-actions"><button className="coach-primary" type="submit" disabled={!provider.encryptionConfigured}>Provider speichern</button><button type="button" disabled={!provider.configured || dirty.provider} onClick={() => run('Verbindung wird geprüft …', async () => { await request('/api/ai-provider/test', 'POST', {}); setNotice('Verbindung zum Provider erfolgreich.'); })}>Verbindung testen</button>{provider.configured && <button type="button" className="coach-danger" onClick={() => run('Key wird entfernt …', async () => { const saved = await request('/api/ai-provider', 'DELETE'); setProvider({ ...provider, ...saved, configured: false, keyLast4: null }); setApiKey(''); setDirty(d => ({ ...d, provider: false })); invalidate(); setNotice('API Key entfernt.'); })}>Gespeicherten Key entfernen</button>}</div>
          {messages}
        </fieldset>
      </form>
    </section>}

    {!loading && profile && tab === 'today' && <>
      {stage === 'setup' && <SetupChecklist missing={dirty.profile ? [...missing, 'Änderungen speichern'] : missing} providerReady={!!provider?.configured} onProfile={() => setTab('profile')} onProvider={() => setTab('provider')} />}
      {dayView ? <>
        <section className="coach-card coach-today-period"><PeriodHeader today={dayView} /></section>
        {dayView.checkIn ? <ReadinessCard readiness={dayView.readiness} time="heute">
          <div className="coach-actions"><button type="button" disabled={occupied} onClick={() => setCheckInOpen(true)}>Check-in ändern</button>
            {dayView.readiness.level !== 'green' && dayView.weekPlanned && <button type="button" className="coach-primary" disabled={!canPlan} onClick={adjustToToday}>Woche an heute anpassen</button>}</div>
        </ReadinessCard> : <div className="coach-message coach-checkin-open"><span><strong>Dein Morgen-Check-in fehlt noch.</strong> Mit ihm weiß der Coach, wie es dir heute geht.</span><button type="button" disabled={occupied} onClick={() => setCheckInOpen(true)}>Check-in ausfüllen</button></div>}
        {proposing === 'patch' && proposalOrigin === 'today' && <Generating text="Der Coach passt deine Woche an den Check-in an … Das kann bis zu einer Minute dauern." />}
        {proposal && proposalOrigin === 'today' && !['block', 'season'].includes(proposal.kind) && <Proposal key={proposal.id} value={proposal} busy={occupied} onConfirm={confirmProposal} onDiscard={discardProposal} />}
        <section className="coach-card"><span className="coach-eyebrow">Heute</span><TodaySessions sessions={dayView.sessions} />
          <div className="coach-actions"><button type="button" onClick={() => setTab('week')}>Zur Woche</button></div></section>
        <InjuryList injuries={dayView.injuries} busy={occupied} onHeal={heal} />
      </> : <p role="status" className="coach-muted">Dein Tag wird geladen …</p>}
    </>}

    {!loading && profile && tab === 'week' && <>
      {stage !== 'setup' && !provider?.configured && <div className="coach-message">Verbinde deinen eigenen API-Zugang, um Vorschläge zu erstellen. <button onClick={() => setTab('provider')}>Provider einrichten</button></div>}
      {anyDirty && <div className="coach-message">Speichere deine offenen Angaben, bevor du einen neuen AI-Vorschlag erstellst.</div>}
      {rhythm && <WeekRhythm key={`${rhythm.review}-${!!rhythm.planned}`} review={rhythm.review} next={rhythm.next} planned={!!rhythm.planned} reviewPlan={plan.weeks?.[rhythm.review]} nextBlockWeek={current.weeks?.[blockWeek(currentRange, weekStart(rhythm.next)) - 1]}
        feedback={rhythmFeedback?.week === rhythm.review ? rhythmFeedback : null} busy={occupied} canPlan={canPlan} wishField={wishField}
        onLoad={key => request(`/api/coach/feedback?week=${encodeURIComponent(key)}&${tzQuery()}`).then(setRhythmFeedback).catch(e => setError(e.message))}
        onPlan={missedSessions => { setSelectedBlockId(null); setWeek(rhythm.next); propose(rhythm.planned ? 'patch' : 'week', { week: rhythm.next, feedbackWeek: rhythm.review, missedSessions }); }}
        onKeep={missedSessions => run('Rückblick wird gespeichert …', async () => { invalidate(); setPlan(await request(`/api/coach/weeks/${rhythm.review}/missed`, 'PUT', { missedSessions })); setNotice('Rückblick gespeichert. Die nächste Woche bleibt, wie sie ist.'); })} />}
      {stage === 'active' ? <>
      <section className="coach-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">{weekStart(week) >= range.start && weekStart(week) <= range.end ? `Woche ${blockWeek(range, weekStart(week))} von ${range.weeks}` : 'Außerhalb des Blocks'}</span><h2>Deine Trainingswoche</h2></div><div className="coach-week-nav">
          <button type="button" className="coach-week-step" aria-label="Vorherige Woche" title="Vorherige Woche" disabled={!!busy || !previousWeek} onClick={() => goToWeek(previousWeek)}><Icon name="chevron" size={16} className="coach-flip" /></button>
          <Field label="Kalenderwoche"><input aria-label="Planungswoche" type="week" min={isoWeek(range.start)} max={isoWeek(range.end)} value={week} disabled={!!busy} onChange={e => { if (e.target.value) goToWeek(e.target.value); }} /></Field>
          <button type="button" className="coach-week-step" aria-label="Nächste Woche" title="Nächste Woche" disabled={!!busy || !followingWeek} onClick={() => goToWeek(followingWeek)}><Icon name="chevron" size={16} /></button>
        </div></div>
        <p className="coach-muted">{dateLabel(weekStart(week))} – {dateLabel(weekEnd(week))} · {week}</p>
        <WeekSessions value={currentWeek} own={ownWorkouts} workoutsById={workoutsById} busy={!!busy} onLock={toggleLock} onOpen={onOpenWorkout} />
        <details className="coach-details"><summary>Ausnahme für diese Woche {dirty.weekly ? '· ungespeichert' : ''}</summary><p className="coach-muted">Geplant wird mit deiner Standardwoche aus dem Athletenprofil. Nur wenn {week} anders aussieht (Urlaub, Termine), hier abweichen und die Woche danach anpassen lassen.</p><form onSubmit={event => { event.preventDefault(); run('Wochenverfügbarkeit wird gespeichert …', async () => {
          const body = { overrides: Object.fromEntries(Object.entries(weekly.overrides).map(([day, values]) => [day, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '' && v !== null))])), note: weekly.note };
          await request(`/api/coach/weekly-overrides/${week}`, 'PUT', body); setDirty(d => ({ ...d, weekly: false })); invalidate();
          setProfile(p => ({ ...p, weeklyOverrides: [...(p.weeklyOverrides || []).filter(w => w.week !== week), { week, ...body }] })); await refreshSnapshot(); setNotice('Wochenverfügbarkeit gespeichert. Du kannst jetzt eine Anpassung vorschlagen lassen.');
        }); }}><fieldset disabled={!!busy}><div className="coach-week-availability">{DAYS.map(([day, label]) => { const values = weekly.overrides[day] || {}; return <div className="coach-availability-day" key={day}><strong>{label}</strong><small>Standard: {profile.availability.defaultAvailability[day] == null ? 'offen' : `${profile.availability.defaultAvailability[day]} min`}</small><select aria-label={`${label} Verfügbarkeit diese Woche`} value={values.available === false ? 'no' : values.available === true ? 'yes' : 'default'} onChange={e => editWeekly(day, { available: e.target.value === 'default' ? undefined : e.target.value === 'yes' })}><option value="default">Standard</option><option value="yes">Verfügbar</option><option value="no">Keine Zeit</option></select><input aria-label={`${label} Minuten diese Woche`} type="number" min="0" max="1440" step="5" placeholder="Minuten" disabled={values.available === false} value={values.maxMinutes ?? ''} onChange={e => editWeekly(day, { maxMinutes: number(e.target.value) })} /><label className="coach-checkbox"><input type="checkbox" checked={!!values.preferLong} disabled={values.available === false} onChange={e => editWeekly(day, { preferLong: e.target.checked })} />Lang bevorzugt</label></div>; })}</div><Field label="Notiz zur Woche"><textarea maxLength={2000} value={weekly.note} onChange={e => { invalidate('weekly'); setWeekly(w => ({ ...w, note: e.target.value })); }} /></Field><button type="submit">Wochenverfügbarkeit speichern</button></fieldset></form></details>
        <fieldset disabled={!!busy}>{!rhythm && wishField}
          <div className="coach-actions"><button className="coach-primary" disabled={!canPlan || !!currentWeek} onClick={() => propose('week')}>Woche planen</button><button disabled={!canPlan || !currentWeek} onClick={() => propose('patch')}>Woche anpassen</button></div>
          {planning && <p className="coach-muted">Während der Coach die Wochen plant, kannst du schon Einheiten fixieren, Ausnahmen eintragen und deinen Wunsch ändern. Noch nicht geplante Wochen berücksichtigen das. Woche planen oder anpassen geht danach wieder.</p>}
          {['week', 'patch'].includes(proposing) && <Generating text="Der Coach plant deine Woche … Das kann bis zu einer Minute dauern." />}
        </fieldset>
      </section>
      </> : <section className="coach-card"><span className="coach-eyebrow">Woche</span><h2>Noch kein laufender Trainingsblock</h2>
        <p className="coach-muted">Die Wochenplanung beginnt mit einem Trainingsblock. Lege ihn im Bereich Saison an, danach plant der Coach hier deine Wochen.</p>
        <div className="coach-actions"><button type="button" className="coach-primary" onClick={() => setTab('season')}>Zur Saison</button></div></section>}
      {proposal && proposalOrigin === 'week' && !['block', 'season'].includes(proposal.kind) && <Proposal key={proposal.id} value={proposal} busy={occupied} onConfirm={confirmProposal} onDiscard={discardProposal} />}

      {stage === 'active' && plan.weeks?.[thisWeek] && <div>
        <section className="coach-card"><span className="coach-eyebrow">Selbstauskunft · Kurzfristig</span><h2>Ein Tag sieht anders aus</h2>
          <details className="coach-details"><summary>Kurzfristige Änderung {dirty.daily ? '· ungespeichert' : ''}</summary><form onSubmit={event => { event.preventDefault(); run('Tagesänderung wird gespeichert …', async () => { await request(`/api/coach/daily-overrides/${daily.date}`, 'PUT', { action: daily.action, ...(daily.action === 'skip' ? { available: false } : { available: true }), ...(daily.maxMinutes === '' ? {} : { maxMinutes: Number(daily.maxMinutes) }), note: daily.note }); setDirty(d => ({ ...d, daily: false })); invalidate(); await refreshSnapshot(); setNotice('Tagesänderung gespeichert. Lass den Plan bei Bedarf anpassen.'); }); }}><fieldset disabled={occupied}><div className="coach-form-grid"><Field label="Tag"><input type="date" required value={daily.date} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, date: e.target.value })); }} /></Field><Field label="Änderung"><select value={daily.action} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, action: e.target.value })); }}><option value="normal">Normal / Zeit ändern</option><option value="reduce">Einheit reduzieren</option><option value="skip">Einheit auslassen</option></select></Field><Field label="Heute maximal (Minuten)"><input type="number" min="0" max="1440" step="5" value={daily.maxMinutes} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, maxMinutes: e.target.value })); }} /></Field></div><Field label="Notiz zur Tagesänderung"><textarea maxLength={2000} value={daily.note} onChange={e => { invalidate('daily'); setDaily(d => ({ ...d, note: e.target.value })); }} /></Field><button type="submit">Tagesänderung speichern</button></fieldset></form></details>
        </section></div>}
    </>}

    {!loading && profile && tab === 'season' && <>
      <SeasonGoal goal={profile.goal} />
      {seasonCard}
      {!seasonFirst && jumpCard}
      {stage !== 'setup' && !provider?.configured && <div className="coach-message">Verbinde deinen eigenen API-Zugang, um Vorschläge zu erstellen. <button onClick={() => setTab('provider')}>Provider einrichten</button></div>}
      {anyDirty && <div className="coach-message">Speichere deine offenen Angaben, bevor du einen neuen AI-Vorschlag erstellst.</div>}
      {stage === 'setup' && <SetupChecklist missing={dirty.profile ? [...missing, 'Änderungen speichern'] : missing} providerReady={!!provider?.configured} onProfile={() => setTab('profile')} onProvider={() => setTab('provider')} />}
      {stage === 'start' && !seasonNext && !seasonFirst && <section className="coach-card"><span className="coach-eyebrow">Nächster Schritt</span><h2>Neuen Trainingsblock starten</h2>
        <p className="coach-muted">Ein Trainingsblock dauert meist 4–12 Wochen und endet mit einer Entlastungswoche. Gespeichert wird erst, wenn du ihn übernimmst.</p>
        {wizard}
      </section>}
      {stage === 'ended' && <section className="coach-card" aria-label="Blockrückblick"><span className="coach-eyebrow">Block abgeschlossen · Rückblick</span><h2>So lief dein Block</h2>
        <BlockOverview value={block} chart={review && review.blockId === block.id && <BlockReview key={review.blockId} review={review} busy={occupied} onSave={saveReview} />} />
      </section>}
      {stage === 'ended' && !seasonNext && !seasonFirst && <section className="coach-card"><span className="coach-eyebrow">Nächster Schritt</span><h2>Nächsten Trainingsblock starten</h2>
        <p className="coach-muted">Verlauf, ausgelassene Einheiten und deine Einschätzung gehen als Kontext in die Vorschläge ein.</p>
        {wizard}
      </section>}
      {stage === 'active' && !jumpOpen && <section className="coach-card coach-block-card"><div className="coach-section-heading"><div><span className="coach-eyebrow">{block === current ? 'Aktueller Trainingsblock' : 'Kommender Trainingsblock'}</span><h2>{today < range.start ? `Startet am ${dateLabel(range.start)}` : `Woche ${blockWeek(range, today)} von ${range.weeks}`}</h2></div><span className="coach-badge recommendation">AI-Empfehlung</span></div>
        {keptBlocks.length > 1 && <div className="coach-block-switch" role="group" aria-label="Trainingsblöcke">{keptBlocks.map(item => <button key={item.id} type="button" aria-pressed={item.id === block.id} disabled={occupied}
          onClick={() => { if (item.id !== block.id) showBlock(item); }}><strong>{item.typeName || 'Block'}</strong><small>{dateLabel(item.startDate)} – {dateLabel(blockRange(item).end)}</small></button>)}</div>}
        <BlockOverview value={block} chart={timeline && <BlockTimeline timeline={timeline} selected={week} onSelect={key => { if (dirty.weekly) setError('Speichere zuerst die Verfügbarkeit dieser Woche.'); else if (key !== week) { invalidate(); setWeek(key); } }} />} />
        {openWeeks.length > 0 && <div className="coach-actions"><button className="coach-primary" disabled={!canPlan} onClick={() => planBlockWeeks(block, plan.weeks)}>{blockHasWeeks ? 'Restliche Wochen planen' : 'Alle Wochen planen'} ({openWeeks.length})</button><small className="coach-muted">Mit deiner Standardwoche aus dem Athletenprofil. Ausnahmen trägst du in der jeweiligen Woche ein.</small></div>}
        {planning && <Generating text={planning} />}
        <Hinweise items={planHints} />
        {!blockHasWeeks && <details className="coach-details" open={(proposal?.kind === 'block' && blockOrigin === `replace-${block.id}`) || undefined}><summary>Block neu planen</summary><p className="coach-muted">Solange noch keine Woche geplant ist, kannst du den Block ersetzen.</p>{wizardFor(`replace-${block.id}`, { initialStart: range.start > nextMonday(today) ? range.start : nextMonday(today) })}</details>}
        {confirmDelete === `block-${block.id}` ? <div className="coach-confirm-delete" role="group" aria-label="Trainingsblock löschen">
          <p><strong>{[block.typeName, block.secondaryName && `+ ${block.secondaryName}`].filter(Boolean).join(' ') || 'Trainingsblock'} ({dateLabel(range.start)} – {dateLabel(range.end)}) löschen?</strong> {blockHasWeeks ? `${weeksIn(block).length === 1 ? 'Die geplante Woche' : `Die ${weeksIn(block).length} geplanten Wochen`} und ${blockWorkouts} ${blockWorkouts === 1 ? 'Workout' : 'Workouts'} im Kalender werden entfernt, auch bereits vergangene.` : 'Es ist noch keine Woche geplant.'} Eigene Workouts bleiben.</p>
          <div className="coach-actions"><button className="coach-danger" disabled={occupied} onClick={() => deleteBlock(block)}>Endgültig löschen</button><button disabled={occupied} onClick={() => setConfirmDelete(null)}>Abbrechen</button></div>
        </div> : <div className="coach-actions"><button className="coach-danger" disabled={occupied} onClick={() => setConfirmDelete(`block-${block.id}`)}>Block löschen</button></div>}
      </section>}
    </>}

    {!loading && tab === 'review' && <>
      <CheckInHistory apiBase={apiBase} version={`${dayView?.checkIn?.date || ''}-${plan?.revision ?? ''}-${dayView?.injuries?.length ?? 0}`} />
      {snapshot && <details className="coach-card coach-context"><summary>Datenbasis & Herkunft</summary><div className="coach-provenance"><span className="coach-badge">Berechnet · Trainingsdaten</span><span className="coach-badge athlete">Athlet · Selbstauskunft</span><span className="coach-badge recommendation">AI · Empfehlung</span></div><p className="coach-muted">Fehlende Messwerte bleiben offen. Der Snapshot enthält verdichtete Daten ohne Sensorstreams.</p><div className="coach-quality"><span>FTP: <strong>{snapshot.dataQuality?.ftpConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Maximale Herzfrequenz: <strong>{snapshot.dataQuality?.maxHrConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Leistungsdaten (42 Tage): <strong>{snapshot.dataQuality?.cyclingPowerCoverageLast42Days == null ? '—' : `${fmt(snapshot.dataQuality.cyclingPowerCoverageLast42Days * 100)} %`}</strong></span></div><details className="coach-details"><summary>Kompakten Athlete Snapshot ansehen</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details></details>}
    </>}
    {checkInOpen && dayView && <CheckInDialog apiBase={apiBase} today={dayView} onClose={() => setCheckInOpen(false)} onSaved={savedCheckIn}
      onAdjust={() => { setCheckInOpen(false); adjustToToday(); }} />}
  </div>;
}
