import React, { useEffect, useRef, useState } from 'react';
import { GOALS } from './AICoach';
import { IMAGE_TYPES, removeImage, uploadImage } from './appearance';
import { Icon } from './icons';
import { GoalScene } from './Landscape';
import { localDate } from './workoutModel';

const DAY = 86400000;
const noon = value => new Date(`${value}T12:00:00`);
const monday = date => new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7, 12);

export function daysUntil(date, today = localDate()) {
  return Math.round((noon(date) - noon(today)) / DAY);
}

function countdown(days) {
  if (days === 0) return { value: 'Heute', label: 'ist Wettkampftag' };
  if (days === 1) return { value: '1', label: 'Tag bis zum Start' };
  if (days < 0) return { value: String(-days), label: -days === 1 ? 'Tag seit dem Wettkampf' : 'Tage seit dem Wettkampf' };
  return { value: String(days), label: days >= 21 ? `Tage bis zum Start · gut ${Math.floor(days / 7)} Wochen` : 'Tage bis zum Start' };
}

// One tick per calendar week from this week to the race week; month starts are marked, a few of them labelled.
export function raceWeeks(date, today = localDate()) {
  const first = monday(noon(today));
  const count = Math.round((monday(noon(date)) - first) / (7 * DAY)) + 1;
  if (count < 2 || count > 157) return null;
  const weeks = Array.from({ length: count }, (_, index) => {
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index * 7, 12);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12);
    const firstOfMonth = start.getDate() === 1 ? start : end.getMonth() !== start.getMonth() ? end : null;
    return { start, monthStart: index > 0 ? firstOfMonth : null };
  });
  const starts = weeks.map((week, index) => week.monthStart && index).filter(Boolean);
  const every = Math.max(1, Math.ceil(starts.length / 4));
  const labels = starts.filter((_, i) => i % every === 0).map(index => ({
    index, text: weeks[index].monthStart.toLocaleDateString('de-DE', { month: 'short' }).replace('.', ''),
  }));
  return { weeks, labels };
}

function Timeline({ date }) {
  const timeline = raceWeeks(date);
  if (!timeline) return null;
  const { weeks, labels } = timeline;
  const grid = { gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` };
  return <div className="race-goal-timeline" role="img" aria-label={`Noch ${weeks.length - 1} Wochen bis zur Rennwoche`}>
    <div className="race-goal-timeline-ends"><span>Heute</span><span>Start</span></div>
    <div className="race-goal-ticks" style={grid}>
      {weeks.map((item, index) => <i key={index} className={index === 0 ? 'now' : index === weeks.length - 1 ? 'race' : item.monthStart ? 'month' : ''} />)}
    </div>
    <div className="race-goal-months" style={grid} aria-hidden="true">
      {labels.map(label => <span key={label.index} style={{ gridColumn: `${label.index + 1} / span ${Math.min(8, weeks.length - label.index)}` }}>{label.text}</span>)}
    </div>
  </div>;
}

// The race goal lives in the athlete profile (edited in the AI Coach); the start page shows it with an optional photo.
export default function RaceGoal({ apiBase, onEdit, photo }) {
  const [state, setState] = useState({ status: 'loading' });
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/athlete-profile`)
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Das Wettkampfziel konnte nicht geladen werden.');
        if (active) setState({ status: 'ready', goal: payload.goal || {} });
      })
      .catch(error => { if (active) setState({ status: 'error', error: error.message }); });
    return () => { active = false; };
  }, [apiBase]);

  async function changePhoto(action) {
    setBusy(true); setPhotoError('');
    try { await action(); } catch (error) { setPhotoError(error.message); } finally { setBusy(false); }
  }

  const goal = state.goal;
  const hasGoal = !!(goal && (goal.name?.trim() || goal.date));
  const days = hasGoal && goal.date ? daysUntil(goal.date) : null;
  const count = days === null ? null : countdown(days);
  const title = goal?.name?.trim() || GOALS[goal?.type] || 'Dein Wettkampf';
  return <section className="home-card home-block race-goal" aria-labelledby="race-goal-title">
    <div className="home-block-head">
      <h2 id="race-goal-title">Wettkampfziel</h2>
      {hasGoal && <button type="button" className="home-link" onClick={onEdit}>Bearbeiten<Icon name="arrow" size={14} /></button>}
    </div>
    {state.status === 'loading' && <p className="home-muted" role="status">Wird geladen…</p>}
    {state.status === 'error' && <p className="home-muted" role="alert">{state.error}</p>}
    {state.status === 'ready' && (hasGoal ? <div className="race-goal-body">
      <div className="race-goal-photo">
        {photo ? <img src={photo} alt="" /> : <GoalScene />}
        <div className="race-goal-caption">
          <h3>{title}</h3>
          {GOALS[goal.type] && goal.name?.trim() && <span>{GOALS[goal.type]}</span>}
        </div>
        <div className="race-goal-photo-actions">
          <button type="button" aria-label={photo ? 'Zielfoto ändern' : 'Zielfoto hinzufügen'} title={photo ? 'Zielfoto ändern' : 'Zielfoto hinzufügen'} disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="camera" size={16} /></button>
          {photo && <button type="button" aria-label="Zielfoto entfernen" title="Zielfoto entfernen" disabled={busy} onClick={() => changePhoto(() => removeImage(apiBase, 'race-goal'))}><Icon name="trash" size={16} /></button>}
        </div>
        <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(',')} hidden
          onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) changePhoto(() => uploadImage(apiBase, 'race-goal', file)); }} />
      </div>
      {photoError && <p className="home-error" role="alert">{photoError}</p>}
      <div className="race-goal-details">
        {count && <div className="race-goal-count"><strong>{count.value}</strong><span>{count.label}</span></div>}
        {days > 0 && <Timeline date={goal.date} />}
        <dl>
          {goal.date && <div><dt>Datum</dt><dd>{noon(goal.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>}
        </dl>
        {!goal.date && <button type="button" className="home-link" onClick={onEdit}>Datum eintragen</button>}
      </div>
    </div> : <div className="race-goal-empty">
      <p>Wofür trainierst du? Trag deinen Wettkampf ein, dann zählt die Startseite die Tage bis zum Start herunter.</p>
      <button type="button" className="home-button" onClick={onEdit}>Wettkampfziel eintragen</button>
    </div>)}
  </section>;
}
