import React, { useEffect, useState } from 'react';
import { GOALS } from './AICoach';
import { localDate } from './workoutModel';

const DAY = 86400000;
const noon = value => new Date(`${value}T12:00:00`);

export function daysUntil(date, today = localDate()) {
  return Math.round((noon(date) - noon(today)) / DAY);
}

function countdown(days) {
  if (days === 0) return { value: 'Heute', label: 'ist Wettkampftag' };
  if (days === 1) return { value: '1', label: 'Tag bis zum Start' };
  if (days < 0) return { value: String(-days), label: -days === 1 ? 'Tag seit dem Wettkampf' : 'Tage seit dem Wettkampf' };
  return { value: String(days), label: days >= 21 ? `Tage bis zum Start · gut ${Math.floor(days / 7)} Wochen` : 'Tage bis zum Start' };
}

// The race goal lives in the athlete profile (edited in the AI Coach); the start page only shows it.
export default function RaceGoal({ apiBase, onEdit }) {
  const [state, setState] = useState({ status: 'loading' });
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

  const goal = state.goal;
  const hasGoal = !!(goal && (goal.name?.trim() || goal.date));
  const days = hasGoal && goal.date ? daysUntil(goal.date) : null;
  const count = days === null ? null : countdown(days);
  return <section className="home-block race-goal" aria-labelledby="race-goal-title">
    <div className="home-block-head">
      <h2 id="race-goal-title">Wettkampfziel</h2>
      {hasGoal && <button type="button" className="home-link" onClick={onEdit}>Bearbeiten</button>}
    </div>
    {state.status === 'loading' && <p className="home-muted" role="status">Wird geladen…</p>}
    {state.status === 'error' && <p className="home-muted" role="alert">{state.error}</p>}
    {state.status === 'ready' && (hasGoal ? <div className="race-goal-body">
      {count && <div className="race-goal-count"><strong>{count.value}</strong><span>{count.label}</span></div>}
      <h3>{goal.name?.trim() || GOALS[goal.type] || 'Dein Wettkampf'}</h3>
      <dl>
        {goal.date && <div><dt>Datum</dt><dd>{noon(goal.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>}
        {GOALS[goal.type] && goal.name?.trim() && <div><dt>Art</dt><dd>{GOALS[goal.type]}</dd></div>}
        {goal.target && <div><dt>Ziel</dt><dd>{goal.target}</dd></div>}
      </dl>
      {!goal.date && <button type="button" className="home-link" onClick={onEdit}>Datum eintragen</button>}
    </div> : <div className="race-goal-empty">
      <p>Wofür trainierst du? Trag deinen Wettkampf ein, dann zählt die Startseite die Tage bis zum Start herunter.</p>
      <button type="button" className="home-button" onClick={onEdit}>Wettkampfziel eintragen</button>
    </div>)}
  </section>;
}
