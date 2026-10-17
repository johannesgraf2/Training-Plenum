import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { STEPS, addDays, dateLabel, daysBetween, ftpFromData, paceLabel, parsePace } from './coachOnboarding';
import { localDate } from './workoutModel';

export function Field({ label, children, hint }) {
  return <label className="coach-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

// --- Date field -----------------------------------------------------------------------------------

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
// "17.10.2026", "17.10.26" or ISO as an ISO date; null when it is no real date.
export function parseDate(text) {
  const value = (text || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]].map(Number) : german ? [german[3].length === 2 ? 2000 + Number(german[3]) : Number(german[3]), Number(german[2]), Number(german[1])] : [];
  if (!year) return null;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return addDays(date, 0) === date ? date : null;
}
const germanDate = date => date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '';

/** The days of a month as a calendar grid: "Heute" marks only the real current date, the chosen date looks different. */
export function MonthGrid({ month, value, today, min, onPick }) {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i - offset)).filter((date, i) => i < 35 || date.slice(0, 7) === month);
  return <div className="date-grid" role="grid" aria-label={`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`}>
    {WEEKDAYS.map(day => <span key={day} className="date-weekday" aria-hidden="true">{day}</span>)}
    {days.map(date => {
      const outside = date.slice(0, 7) !== month;
      const classes = ['date-day', outside && 'outside', date === today && 'today', date === value && 'selected'].filter(Boolean).join(' ');
      return <button key={date} type="button" className={classes} disabled={!!min && date < min} aria-current={date === today ? 'date' : undefined}
        aria-pressed={date === value} aria-label={`${dateLabel(date, true)}${date === today ? ', heute' : ''}`} onClick={() => onPick(date)}>{Number(date.slice(8))}</button>;
    })}
  </div>;
}

/** A date input with its own calendar (the browser picker cannot tell today from the same day in other months).
 * value and onChange use ISO dates; typing accepts TT.MM.JJJJ. */
export function DateField({ label, value, min, hint, onChange }) {
  const [text, setText] = useState(germanDate(value));
  const [open, setOpen] = useState(false);
  const today = localDate();
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const box = useRef(null);
  useEffect(() => { if (parseDate(text) !== (value || null)) setText(germanDate(value)); }, [value]);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const type = next => {
    setText(next);
    const date = parseDate(next);
    if (date) { onChange(date); setMonth(date.slice(0, 7)); } else if (!next.trim()) onChange('');
  };
  const shift = months => setMonth(current => { const [y, m] = current.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + months, 1)); return d.toISOString().slice(0, 7); });
  return <div className="date-field" ref={box} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    <label className="coach-field"><span>{label}</span>
      <span className="date-input"><input inputMode="numeric" placeholder="TT.MM.JJJJ" value={text} onChange={e => type(e.target.value)} />
        <button type="button" className="date-toggle" aria-expanded={open} aria-label={`${label}: Kalender öffnen`}
          onClick={() => { setMonth((value || today).slice(0, 7)); setOpen(o => !o); }}><Icon name="calendar" size={15} /></button></span>
      {hint && <small>{hint}</small>}</label>
    {open && <div className="date-popover" role="dialog" aria-label={`${label} wählen`}>
      <div className="date-head"><button type="button" aria-label="Vorheriger Monat" onClick={() => shift(-1)}>‹</button>
        <strong>{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</strong>
        <button type="button" aria-label="Nächster Monat" onClick={() => shift(1)}>›</button></div>
      <MonthGrid month={month} value={value} today={today} min={min} onPick={date => { setText(germanDate(date)); onChange(date); setOpen(false); }} />
      <div className="date-legend"><span><i className="date-mark today" />Heute</span><span><i className="date-mark selected" />Ausgewählt</span>
        <button type="button" onClick={() => setMonth(today.slice(0, 7))}>Zu heute</button></div>
    </div>}
  </div>;
}

// One bar segment per step of the current part; done steps are filled.
export function Progress({ step }) {
  const current = STEPS.find(s => s.id === step);
  const part = STEPS.filter(s => s.part === current.part);
  const index = part.indexOf(current);
  return <div className="onboarding-progress">
    <span className="coach-eyebrow">{current.part === 'A' ? 'Teil A · Athletenprofil' : 'Teil B · Plan erstellen'} · Schritt {index + 1} von {part.length}</span>
    <div className="onboarding-bar" role="progressbar" aria-label="Fortschritt" aria-valuemin={1} aria-valuemax={part.length} aria-valuenow={index + 1}>
      {part.map((s, i) => <i key={s.id} className={i < index ? 'done' : i === index ? 'current' : ''} />)}
    </div>
  </div>;
}

// Zurück and Weiter, always at the bottom of a step.
export function StepFooter({ onBack, onNext, nextLabel = 'Weiter', disabled, busy, children }) {
  return <footer className="onboarding-footer">
    {onBack ? <button type="button" disabled={busy} onClick={onBack}>Zurück</button> : <span />}
    <div className="onboarding-footer-actions">{children}
      {onNext && <button type="button" className="coach-primary" disabled={busy || disabled} onClick={onNext}>{nextLabel}</button>}</div>
  </footer>;
}

// Tiles that switch on and off (multiple) or pick one (single); a locked tile stays on.
export function Tiles({ label, items, isOn, onToggle, single, locked = () => false, note = () => null }) {
  return <div className="onboarding-tiles" role="group" aria-label={label}>{items.map(([key, name]) => {
    const lock = locked(key);
    return <button type="button" key={key} className="onboarding-tile" aria-pressed={isOn(key)} disabled={lock} onClick={() => onToggle(key)}
      {...(single ? { role: 'radio', 'aria-checked': isOn(key), 'aria-pressed': undefined } : {})}>
      <strong>{name}</strong>{lock && <span className="onboarding-lock"><Icon name="lock" size={13} /> vom Event</span>}
      {note(key) && <small>{note(key)}</small>}
    </button>;
  })}</div>;
}

export function YesNo({ label, value, onChange }) {
  return <div className="onboarding-yesno" role="radiogroup" aria-label={label}><span>{label}</span>
    {[[true, 'Ja'], [false, 'Nein']].map(([option, text]) => <button key={text} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}>{text}</button>)}
  </div>;
}

// --- Thresholds (A3 and B3) ---------------------------------------------------------------------

const PACE_BASIS = { '5km': '5-km-Bestzeit', '10km': '10-km-Bestzeit', '21km': 'Halbmarathon-Bestzeit' };
const MODES = [['calculated', 'Aus deinen Daten'], ['athlete', 'Selbst eintragen'], ['test', 'Testen lassen']];
// Run values the athlete may know: the threshold pace or a 10 km pace, stored with its meaning (no conversion yet).
export const PACE_REFERENCES = [['threshold', 'Schwellenpace', 'Schwellenpace (min/km)', 'Das Tempo, das du etwa eine Stunde halten kannst, z. B. 4:35.'],
  ['10k', '10-km-Pace', '10-km-Pace (min/km)', 'Dein Tempo über 10 km, z. B. 4:50. Es wird als 10-km-Pace gespeichert, nicht als Schwellenpace.']];

// The editable state per sport: how the threshold is set and the entered value.
export function thresholdDraft({ profile, user, thresholds, snapshot }) {
  const ride = profile.thresholds?.ride?.source;
  const suggestion = ftpFromData(snapshot);
  // The profile holds what this onboarding saved; the thresholds endpoint adds the pace the data suggests.
  const run = { ...thresholds?.run, ...profile.thresholds?.run };
  const tenK = run.source === 'athlete' && run.paceSecPerKm == null && run.tenKPaceSecPerKm != null;
  return {
    ride: { mode: ride === 'test' ? 'test' : user?.ftp ? (ride === 'calculated' ? 'calculated' : 'athlete') : suggestion ? 'calculated' : 'athlete',
      ftp: user?.ftp ?? '', suggestion },
    run: { mode: run.source === 'test' ? 'test' : run.paceSecPerKm != null || tenK ? run.source || 'athlete' : run.calculated ? 'calculated' : 'athlete',
      reference: tenK ? '10k' : 'threshold',
      pace: tenK ? paceLabel(run.tenKPaceSecPerKm) : run.paceSecPerKm != null && run.source !== 'calculated' ? paceLabel(run.paceSecPerKm) : '',
      stored: run.paceSecPerKm != null || tenK ? run : null,
      suggestion: run.calculated || (run.source === 'calculated' ? run : null) },
  };
}

// Problems that keep the step from saving, else null.
export function thresholdProblem(draft, sports) {
  if (sports.includes('ride') && draft.ride.mode === 'athlete' && !(Number(draft.ride.ftp) >= 1 && Number(draft.ride.ftp) <= 1000)) return 'Bitte eine FTP zwischen 1 und 1000 W eintragen oder „Testen lassen“ wählen.';
  if (sports.includes('ride') && draft.ride.mode === 'calculated' && !draft.ride.suggestion && !draft.ride.ftp) return 'Aus deinen Daten lässt sich keine FTP ableiten.';
  if (sports.includes('run') && draft.run.mode === 'athlete' && parsePace(draft.run.pace) == null) {
    return `Bitte die ${draft.run.reference === '10k' ? '10-km-Pace' : 'Schwellenpace'} als m:ss pro km eintragen (z. B. ${draft.run.reference === '10k' ? '4:50' : '4:35'}) oder „Testen lassen“ wählen.`;
  }
  return null;
}

// The writes for the profile thresholds and the athlete settings (FTP).
export function thresholdChanges(draft, sports) {
  const thresholds = {}, user = {};
  if (sports.includes('ride')) {
    thresholds.ride = { source: draft.ride.mode };
    if (draft.ride.mode === 'athlete') user.ftp = Number(draft.ride.ftp);
    if (draft.ride.mode === 'calculated' && draft.ride.suggestion) user.ftp = draft.ride.suggestion.ftp;
  }
  if (sports.includes('run')) {
    const { mode, suggestion } = draft.run;
    const tenK = mode === 'athlete' && draft.run.reference === '10k';
    thresholds.run = mode === 'test' ? { source: 'test', paceSecPerKm: null, basis: null, tenKPaceSecPerKm: null }
      : mode === 'calculated' ? { source: 'calculated', paceSecPerKm: suggestion.paceSecPerKm, basis: suggestion.basis, tenKPaceSecPerKm: null }
        : { source: 'athlete', paceSecPerKm: tenK ? null : parsePace(draft.run.pace), basis: null, tenKPaceSecPerKm: tenK ? parsePace(draft.run.pace) : null };
  }
  return { thresholds, user };
}

function ThresholdCard({ title, mode, modes, onMode, children }) {
  return <div className="onboarding-threshold"><h4>{title}</h4>
    <div className="onboarding-segments" role="radiogroup" aria-label={title}>{modes.map(([key, text]) =>
      <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => onMode(key)}>{text}</button>)}</div>
    {children}
  </div>;
}

export function ThresholdFields({ draft, sports, onChange }) {
  const set = (sport, patch) => onChange({ ...draft, [sport]: { ...draft[sport], ...patch } });
  const { ride, run } = draft;
  const rideModes = MODES.filter(([key]) => key !== 'calculated' || ride.suggestion || ride.mode === 'calculated');
  const runModes = MODES.filter(([key]) => key !== 'calculated' || run.suggestion);
  const ago = date => date ? ` vom ${dateLabel(date)}` : '';
  return <div className="onboarding-thresholds">
    {sports.includes('ride') && <ThresholdCard title="FTP (Rad)" mode={ride.mode} modes={rideModes} onMode={mode => set('ride', { mode })}>
      {ride.mode === 'calculated' && <p className="onboarding-origin">{ride.suggestion ? <>aus deinen Daten: <strong>{ride.suggestion.ftp} W</strong>, abgeleitet aus {ride.suggestion.basis}</> : <>aus deinen Daten: <strong>{ride.ftp} W</strong></>}</p>}
      {ride.mode === 'athlete' && <Field label="FTP in Watt" hint={ride.ftp ? 'von dir eingetragen' : undefined}><input type="number" min="1" max="1000" inputMode="numeric" value={ride.ftp} onChange={e => set('ride', { ftp: e.target.value })} /></Field>}
      {ride.mode === 'test' && <p className="coach-muted">Der Coach plant einen FTP-Test in die erste Planwoche. Bis zum Ergebnis sind die Radziele nach Gefühl (RPE) angegeben.</p>}
    </ThresholdCard>}
    {sports.includes('run') && <ThresholdCard title="Laufen: Schwellenpace oder 10-km-Pace" mode={run.mode} modes={runModes} onMode={mode => set('run', { mode })}>
      {run.mode === 'calculated' && run.suggestion && <p className="onboarding-origin">aus deinen Daten: <strong>{paceLabel(run.suggestion.paceSecPerKm)} /km</strong>, abgeleitet aus {PACE_BASIS[run.suggestion.basis] || 'deinen Bestzeiten'}{ago(run.suggestion.date)}</p>}
      {run.mode === 'athlete' && (() => {
        const [key, , label, hint] = PACE_REFERENCES.find(([id]) => id === run.reference);
        return <>
          <div className="onboarding-segments" role="radiogroup" aria-label="Welchen Wert kennst du?">{PACE_REFERENCES.map(([id, name]) =>
            <button key={id} type="button" role="radio" aria-checked={run.reference === id} onClick={() => set('run', { reference: id })}>{name}</button>)}</div>
          <Field label={label} hint={run.stored?.source === 'athlete' && (run.stored.tenKPaceSecPerKm != null) === (key === '10k') ? 'von dir eingetragen' : hint}>
            <input inputMode="decimal" placeholder={key === '10k' ? '4:50' : '4:35'} value={run.pace} onChange={e => set('run', { pace: e.target.value })} /></Field>
        </>;
      })()}
      {run.mode === 'test' && <p className="coach-muted">Der Coach plant einen 30-min-Lauftest in die erste Planwoche. Bis zum Ergebnis sind die Laufziele nach Gefühl (RPE) angegeben.</p>}
    </ThresholdCard>}
  </div>;
}

// --- Plan timeline (B4, B6) ---------------------------------------------------------------------

export function PlanTimeline({ start, end, events }) {
  if (!start || !end || end <= start) return null;
  const span = daysBetween(start, end);
  const inRange = events.filter(e => (e.endDate || e.startDate) >= start && e.startDate <= end);
  const share = date => Math.min(100, Math.max(0, daysBetween(start, date) / span * 100));
  // Labels near the ends grow inwards so they stay inside the track; A events above the line, B and C below it.
  const side = date => share(date) > 75 ? 'end' : share(date) < 25 ? 'start' : '';
  const below = inRange.some(e => e.priority !== 'A');
  // Close labels of the same side take turns between two rows.
  const rows = {};
  ['A', 'BC'].forEach(group => inRange.filter(e => group.includes(e.priority)).sort((x, y) => x.startDate.localeCompare(y.startDate))
    .reduce((last, e) => { rows[e.id] = last && share(e.startDate) - last.at < 22 && !last.second; return { at: share(e.startDate), second: rows[e.id] }; }, null));
  return <div className={`onboarding-timeline${below ? ' with-below' : ''}`} aria-label="Zeitstrahl des Plans">
    <div className="onboarding-timeline-track">{inRange.map(e =>
      <span key={e.id} className={`onboarding-timeline-event priority-${e.priority.toLowerCase()} ${side(e.startDate)}${rows[e.id] ? ' second-row' : ''}`} style={{ left: `${share(e.startDate)}%` }} title={`${e.title} · ${e.priority} · ${dateLabel(e.startDate, true)}`}>
        <em>{e.priority !== 'A' && <b>{e.priority}</b>}{e.title}</em></span>)}</div>
    <div className="onboarding-timeline-ends"><span>Plan startet {dateLabel(start, true)}</span><span>Plan endet {dateLabel(end, true)}</span></div>
  </div>;
}
