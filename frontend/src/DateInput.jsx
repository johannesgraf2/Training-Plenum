import React, { useState } from 'react';
import { addDays } from './coachOnboarding';
import { localDate } from './workoutModel';

// Compare complete local dates: the 17th of another month is never today.
export default function DateInput({ value, onChange, min, ...props }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || localDate()).slice(0, 7));
  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const today = localDate();
  const move = delta => {
    const date = new Date(`${first}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  };
  return <span className="onboarding-date">
    <input {...props} type="date" value={value} min={min} onChange={onChange} />
    <button type="button" aria-label="Kalender öffnen" aria-expanded={open} onClick={() => { setMonth((value || today).slice(0, 7)); setOpen(v => !v); }}>Kalender</button>
    {open && <span className="onboarding-calendar" role="dialog" aria-label="Datum wählen" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <span className="onboarding-calendar-head"><button type="button" aria-label="Vorheriger Monat" onClick={() => move(-1)}>‹</button>
        <strong>{new Date(`${first}T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" aria-label="Nächster Monat" onClick={() => move(1)}>›</button></span>
      <span className="onboarding-calendar-grid">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => <small key={day}>{day}</small>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
        {Array.from({ length }, (_, i) => {
          const date = addDays(first, i);
          return <button type="button" key={date} disabled={!!min && date < min} aria-label={date} aria-current={date === today ? 'date' : undefined}
            aria-pressed={date === value} className={date === today ? 'today' : ''}
            onClick={() => { onChange({ target: { value: date } }); setOpen(false); }}>{i + 1}</button>;
        })}</span>
      <button type="button" onClick={() => setOpen(false)}>Schließen</button>
    </span>}
  </span>;
}
