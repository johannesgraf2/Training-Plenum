import React from 'react';
import { Icon } from './icons';
import { STEPS, dateLabel, daysBetween, ftpFromData, paceLabel, parsePace } from './coachOnboarding';

export function Field({ label, children, hint }) {
  return <label className="coach-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
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

// The editable state per sport: how the threshold is set and the entered value.
export function thresholdDraft({ profile, user, thresholds, snapshot }) {
  const ride = profile.thresholds?.ride?.source;
  const suggestion = ftpFromData(snapshot);
  // The profile holds what this onboarding saved; the thresholds endpoint adds the pace the data suggests.
  const run = { ...thresholds?.run, ...profile.thresholds?.run };
  return {
    ride: { mode: ride === 'test' ? 'test' : user?.ftp ? (ride === 'calculated' ? 'calculated' : 'athlete') : suggestion ? 'calculated' : 'athlete',
      ftp: user?.ftp ?? '', suggestion },
    run: { mode: run.source === 'test' ? 'test' : run.paceSecPerKm != null ? run.source || 'athlete' : run.calculated ? 'calculated' : 'athlete',
      pace: run.paceSecPerKm != null && run.source !== 'calculated' ? paceLabel(run.paceSecPerKm) : '', stored: run.paceSecPerKm != null ? run : null,
      suggestion: run.calculated || (run.source === 'calculated' ? run : null) },
  };
}

// Problems that keep the step from saving, else null.
export function thresholdProblem(draft, sports) {
  if (sports.includes('ride') && draft.ride.mode === 'athlete' && !(Number(draft.ride.ftp) >= 1 && Number(draft.ride.ftp) <= 1000)) return 'Bitte eine FTP zwischen 1 und 1000 W eintragen oder „Testen lassen“ wählen.';
  if (sports.includes('ride') && draft.ride.mode === 'calculated' && !draft.ride.suggestion && !draft.ride.ftp) return 'Aus deinen Daten lässt sich keine FTP ableiten.';
  if (sports.includes('run') && draft.run.mode === 'athlete' && parsePace(draft.run.pace) == null) return 'Bitte die Schwellenpace als m:ss pro km eintragen (z. B. 4:35) oder „Testen lassen“ wählen.';
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
    thresholds.run = mode === 'test' ? { source: 'test', paceSecPerKm: null, basis: null }
      : mode === 'calculated' ? { source: 'calculated', paceSecPerKm: suggestion.paceSecPerKm, basis: suggestion.basis }
        : { source: 'athlete', paceSecPerKm: parsePace(draft.run.pace), basis: null };
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
    {sports.includes('run') && <ThresholdCard title="Schwellenpace (Laufen)" mode={run.mode} modes={runModes} onMode={mode => set('run', { mode })}>
      {run.mode === 'calculated' && run.suggestion && <p className="onboarding-origin">aus deinen Daten: <strong>{paceLabel(run.suggestion.paceSecPerKm)} /km</strong>, abgeleitet aus {PACE_BASIS[run.suggestion.basis] || 'deinen Bestzeiten'}{ago(run.suggestion.date)}</p>}
      {run.mode === 'athlete' && <Field label="Schwellenpace (min/km)" hint={run.stored?.source === 'athlete' ? 'von dir eingetragen' : 'Das Tempo, das du etwa eine Stunde halten kannst, z. B. 4:35.'}><input inputMode="decimal" placeholder="4:35" value={run.pace} onChange={e => set('run', { pace: e.target.value })} /></Field>}
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
  // Labels near the ends grow inwards so they stay inside the track.
  const side = date => share(date) > 75 ? 'end' : share(date) < 25 ? 'start' : '';
  return <div className="onboarding-timeline" aria-label="Zeitstrahl des Plans">
    <div className="onboarding-timeline-track">{inRange.map(e =>
      <span key={e.id} className={`onboarding-timeline-event priority-${e.priority.toLowerCase()} ${side(e.startDate)}`} style={{ left: `${share(e.startDate)}%` }} title={`${e.title} · ${e.priority}`}>
        {e.priority === 'A' && <em>{e.title}</em>}</span>)}</div>
    <div className="onboarding-timeline-ends"><span>Plan startet {dateLabel(start, true)}</span><span>Plan endet {dateLabel(end, true)}</span></div>
  </div>;
}
