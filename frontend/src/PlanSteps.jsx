import React, { useEffect, useRef, useState } from 'react';
import { DateField, Field, PlanTimeline, StepFooter, ThresholdFields, Tiles, YesNo, thresholdChanges, thresholdDraft, thresholdProblem } from './OnboardingUI';
import { Icon } from './icons';
import {
  BACKGROUND_TYPES, DAYS, EQUIPMENT, EVENT_SPORTS, GOALS, HANDLING, INTENSITIES, METRICS, METRIC_NAMES, OPTIONS, PRIORITIES, REPLAN_DEFAULT,
  SPORT_NAMES, SUBTYPES, clockLabel, dateLabel, defaultEnd, defaultStart, eventDates, eventHints, eventSummary, forcedRestPairs, hoursLabel, jobState, recommendedHours,
  dayNames, joinDuration, lastAEvent, newId, splitDuration, splitEvents, weeksLabel, windowHours, windowLabel, windowMinutes,
} from './coachOnboarding';
import { localDate } from './workoutModel';

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const number = value => value === '' || value == null ? null : Number(value);
const typeName = type => BACKGROUND_TYPES.find(([key]) => key === type)?.[1];
// Sports of the plan: ride and run from the goal, strength through the gym setting.
export const planSports = profile => [...profile.goal.sports.filter(s => ['ride', 'run'].includes(s)), ...(profile.preferences.gymAvailability ? ['strength'] : [])];
const TYPE_OF_SPORT = { ride: 'ride', run: 'run', swim: 'swim', strength: 'other', xcski: 'xcski', hyrox: 'hyrox' };

// --- B1 Background ------------------------------------------------------------------------------

export function BackgroundStep({ ctx }) {
  const { profile, background } = ctx.data;
  const sports = profile.sports.filter(s => ['ride', 'run'].includes(s));
  const intervalSports = sports.length ? sports : ['ride'];
  const fromData = { type: TYPE_OF_SPORT[background.mainSport] || null, weeklyHours: background.weeklyHours,
    intervals: Object.fromEntries(intervalSports.map(s => [s, !!background.intervals[s]])) };
  const stored = profile.background?.source ? profile.background : null;
  const [value, setValue] = useState(() => stored ? { ...fromData, ...stored, intervals: { ...fromData.intervals, ...stored.intervals } } : fromData);
  const [editing, setEditing] = useState(!background.hasData || stored?.source === 'athlete');
  const set = patch => setValue(v => ({ ...v, ...patch }));
  // Without data the slider starts at 0 h, which is an answer too.
  const save = source => ctx.complete('background', { background: { type: value.type, weeklyHours: value.weeklyHours ?? (source === 'athlete' ? 0 : null), intervals: value.intervals, source } });
  const hours = value.weeklyHours ?? 0;
  const lastInterval = sport => background.intervals[sport] ? `ja, zuletzt am ${dateLabel(background.intervals[sport])}` : 'nein';
  return <>
    <h2>Dein Hintergrund</h2>
    <p>Erzähl mir von deinem Training – was, wie viel und welche Art.</p>
    {background.hasData && !editing && <section className="onboarding-card" aria-label="Das sehe ich in deinen Daten">
      <h3>Das sehe ich in deinen Daten</h3>
      <dl className="onboarding-facts">
        <div><dt>Zuletzt</dt><dd>{typeName(fromData.type) || 'Gemischt'}</dd></div>
        <div><dt>Ø pro Woche (6 Wochen)</dt><dd>{hoursLabel(background.weeklyHours || 0)}{background.best4WeekHours != null && <small> · stärkste 4 Wochen {hoursLabel(background.best4WeekHours)}</small>}</dd></div>
        {intervalSports.map(sport => <div key={sport}><dt>Intervalle {SPORT_NAMES[sport]} (21 Tage)</dt><dd>{lastInterval(sport)}</dd></div>)}
      </dl>
    </section>}
    {editing && <>
      <h3>Was hast du zuletzt gemacht?</h3>
      <Tiles label="Was hast du zuletzt gemacht?" single items={BACKGROUND_TYPES} isOn={key => value.type === key} onToggle={type => set({ type })} />
      <h3>Wie viele Stunden trainierst du durchschnittlich pro Woche?</h3>
      <p className="coach-muted">Gemeint ist eine typische Trainingswoche der letzten Zeit, nicht die Zeit, die du künftig hast. Die fragt der Coach bei den Verfügbarkeiten.</p>
      <div className="onboarding-slider">
        <button type="button" aria-label="Eine halbe Stunde weniger" onClick={() => set({ weeklyHours: Math.max(0, hours - 0.5) })}>−</button>
        <input type="range" min="0" max="30" step="0.5" aria-label="Durchschnittliche Stunden pro Woche" value={hours} onChange={e => set({ weeklyHours: Number(e.target.value) })} />
        <button type="button" aria-label="Eine halbe Stunde mehr" onClick={() => set({ weeklyHours: Math.min(30, hours + 0.5) })}>+</button>
        <strong>{hoursLabel(hours)}</strong>
      </div>
      <h3>Hast du in den letzten 21 Tagen Intervalle trainiert?</h3>
      {intervalSports.map(sport => <YesNo key={sport} label={SPORT_NAMES[sport]} value={value.intervals[sport]} onChange={yes => set({ intervals: { ...value.intervals, [sport]: yes } })} />)}
    </>}
    <StepFooter onBack={ctx.back} onNext={editing ? () => save('athlete') : () => save('calculated')} nextLabel={editing ? 'Weiter' : 'Stimmt so'} disabled={!value.type} busy={ctx.busy}>
      {background.hasData && !editing && <button type="button" onClick={() => setEditing(true)}>Korrigieren</button>}
    </StepFooter>
  </>;
}

// --- B2 Goal and events -------------------------------------------------------------------------

const blankEvent = () => ({ title: '', sport: 'ride', subtype: null, multiDay: false, startDate: '', endDate: '', allDay: true, time: '', location: '',
  priority: 'A', handling: null, distanceKm: '', days: '', hours: '', minutes: '', finishOnly: false, elevationM: '', description: '' });
const draftOf = event => ({ ...blankEvent(), ...event, multiDay: !!event.endDate && event.endDate !== event.startDate, time: event.time || '', location: event.location || '',
  distanceKm: event.distanceKm ?? '', elevationM: event.elevationM ?? '', finishOnly: event.targetSeconds == null, ...splitDuration(event.targetSeconds) });

export function eventBody(draft) {
  return { title: draft.title.trim(), sport: draft.sport, subtype: draft.subtype, startDate: draft.startDate, endDate: draft.multiDay ? draft.endDate : null,
    allDay: draft.allDay, time: draft.allDay ? null : draft.time, location: draft.location.trim() || null, priority: draft.priority,
    handling: draft.priority === 'A' ? null : draft.handling || HANDLING[draft.priority][0][0], distanceKm: number(draft.distanceKm),
    targetSeconds: draft.finishOnly ? null : joinDuration(draft), elevationM: number(draft.elevationM), description: draft.description.trim() };
}
function eventProblem(draft) {
  if (!draft.title.trim()) return 'Bitte einen Titel eingeben.';
  if (!draft.startDate) return 'Bitte ein Startdatum wählen.';
  if (draft.multiDay && (!draft.endDate || draft.endDate < draft.startDate)) return 'Das Enddatum darf nicht vor dem Start liegen.';
  if (!draft.allDay && !draft.time) return 'Bitte eine Uhrzeit angeben oder „Ganzer Tag“ wählen.';
  if (draft.distanceKm !== '' && !(Number(draft.distanceKm) >= 0 && Number(draft.distanceKm) <= 10000)) return 'Die Distanz liegt zwischen 0 und 10.000 km.';
  if (draft.elevationM !== '' && !(Number(draft.elevationM) >= 0 && Number(draft.elevationM) <= 100000)) return 'Die Höhenmeter liegen zwischen 0 und 100.000 m.';
  if (!draft.finishOnly && joinDuration(draft) > 60 * 86400) return 'Die Zielzeit beträgt höchstens 60 Tage.';
  return null;
}

/** draft and onDraft keep the unsaved input outside the form, so a step change or closing the wizard loses nothing. */
export function EventForm({ initial, draft: kept, onDraft, busy, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => kept || (initial ? draftOf(initial) : blankEvent()));
  // Every field patch keeps the others, the title included.
  const set = patch => setDraft(d => ({ ...d, ...patch }));
  useEffect(() => { onDraft?.(draft); }, [draft]);
  const problem = eventProblem(draft);
  const hints = problem ? [] : eventHints(eventBody(draft));
  const subtypes = SUBTYPES[draft.sport] || [];
  return <section className="onboarding-card onboarding-event-form" aria-label={initial ? 'Event bearbeiten' : 'Event hinzufügen'}>
    <h3>{initial ? 'Event bearbeiten' : 'Event hinzufügen'}</h3>
    <Field label="Titel"><input maxLength={200} value={draft.title} placeholder="z. B. Frankfurt Marathon oder Ötztaler Radmarathon" onChange={e => set({ title: e.target.value })} /></Field>
    <h4>Sportart</h4>
    <Tiles label="Sportart des Events" single items={EVENT_SPORTS} isOn={key => draft.sport === key} onToggle={sport => set({ sport, subtype: draft.sport === sport ? draft.subtype : null })} />
    {subtypes.length > 1 && <div className="coach-form-grid"><Field label="Ziel (Untertyp)"><select value={draft.subtype || ''} onChange={e => set({ subtype: e.target.value || null })}><option value="">Bitte wählen</option>{subtypes.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field></div>}
    <label className="coach-checkbox"><input type="checkbox" checked={draft.multiDay} onChange={e => set({ multiDay: e.target.checked })} />Mehrtägig</label>
    <div className="coach-form-grid">
      <DateField label={draft.multiDay ? 'Start' : 'Datum'} value={draft.startDate} onChange={startDate => set({ startDate })} />
      {draft.multiDay && <DateField label="Ende" min={draft.startDate || undefined} value={draft.endDate} onChange={endDate => set({ endDate })} />}
    </div>
    <label className="coach-checkbox"><input type="checkbox" checked={draft.allDay} onChange={e => set({ allDay: e.target.checked })} />Ganzer Tag</label>
    <div className="coach-form-grid">
      {!draft.allDay && <Field label="Uhrzeit"><input type="time" value={draft.time} onChange={e => set({ time: e.target.value })} /></Field>}
      <Field label="Ort (optional)"><input maxLength={200} value={draft.location} onChange={e => set({ location: e.target.value })} /></Field>
    </div>
    <h4>Priorität</h4>
    <div className="onboarding-priorities" role="radiogroup" aria-label="Priorität">{Object.entries(PRIORITIES).map(([key, [name, text]]) =>
      <button key={key} type="button" role="radio" aria-checked={draft.priority === key} onClick={() => set({ priority: key, handling: null })}><strong>{key} · {name}</strong><small>{text}</small></button>)}</div>
    {draft.priority !== 'A' && <><h4>Wie soll der Coach damit umgehen?</h4>
      <div className="onboarding-priorities" role="radiogroup" aria-label="Wie soll der Coach damit umgehen?">{HANDLING[draft.priority].map(([key, name, text], index) =>
        <button key={key} type="button" role="radio" aria-checked={(draft.handling || HANDLING[draft.priority][0][0]) === key} onClick={() => set({ handling: key })}><strong>{name}{index === 0 ? ' (Standard)' : ''}</strong><small>{text}</small></button>)}</div></>}
    <div className="coach-form-grid">
      <Field label="Distanz (km)" hint="Bis 10.000 km"><input type="number" min="0" max="10000" step="0.1" inputMode="decimal" value={draft.distanceKm} onChange={e => set({ distanceKm: e.target.value })} /></Field>
      <Field label="Höhenmeter" hint="Bis 100.000 m"><input type="number" min="0" max="100000" step="1" inputMode="numeric" value={draft.elevationM} onChange={e => set({ elevationM: e.target.value })} /></Field>
    </div>
    <h4>Zielzeit</h4>
    <label className="coach-checkbox"><input type="checkbox" checked={draft.finishOnly} onChange={e => set({ finishOnly: e.target.checked })} />Nur ankommen</label>
    {!draft.finishOnly && <div className="onboarding-duration">
      {[['days', 'Tage', 60], ['hours', 'Stunden', 23], ['minutes', 'Minuten', 59]].map(([key, label, max]) =>
        <Field key={key} label={label}><input type="number" min="0" max={max} step="1" inputMode="numeric" value={draft[key]} onChange={e => set({ [key]: e.target.value })} /></Field>)}
    </div>}
    <Field label="Beschreibung (optional)" hint="Geht als Wunsch an den Coach."><textarea maxLength={1500} value={draft.description} onChange={e => set({ description: e.target.value })} /></Field>
    {problem && <p className="coach-muted" role="note">{problem}</p>}
    {hints.map(hint => <p key={hint} className="onboarding-hint" role="note">{hint}</p>)}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!problem || busy} onClick={() => onSave(eventBody(draft))}>Event speichern</button><button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button></div>
  </section>;
}

export function EventList({ title, events, busy, onEdit, onDelete }) {
  if (!events.length) return null;
  return <><h3>{title}</h3><ul className="onboarding-events">{events.map(event => <li key={event.id}>
    <span className={`onboarding-priority priority-${event.priority.toLowerCase()}`}>{event.priority}</span>
    <div><strong>{event.title}</strong><small>{eventDates(event)} · {eventSummary(event)}</small></div>
    <button type="button" disabled={busy} onClick={() => onEdit(event)}>Bearbeiten</button>
    <button type="button" className="coach-danger" disabled={busy} onClick={() => onDelete(event)}>Löschen</button>
  </li>)}</ul></>;
}

export function GoalStep({ ctx }) {
  const { profile, events } = ctx.data;
  // The open form ('new' or the edited event) and its unsaved input stay in the wizard across steps.
  const { form, draft } = ctx.eventForm || { form: null, draft: null };
  const setForm = next => ctx.setEventForm(next ? { form: next, draft: null } : null);
  const [goal, setGoal] = useState(ctx.done('goal') && GOALS.some(([key]) => key === profile.goal.type) ? profile.goal.type : null);
  const { upcoming, recent } = splitEvents(events);
  const main = lastAEvent(upcoming);
  const saveEvent = body => ctx.run('Event wird gespeichert …', async () => {
    const result = form === 'new' ? await ctx.request('/api/coach/events', 'POST', body) : await ctx.request(`/api/coach/events/${encodeURIComponent(form.id)}`, 'PUT', body);
    ctx.update({ events: result.events }); setForm(null);
  });
  const remove = event => ctx.run('Event wird gelöscht …', async () => {
    const result = await ctx.request(`/api/coach/events/${encodeURIComponent(event.id)}`, 'DELETE');
    ctx.update({ events: result.events });
  });
  // The goal follows the A event so the earlier coach views show it too.
  const save = () => ctx.complete('goal', { goal: main ? { type: 'event', name: main.title, date: main.startDate } : { type: goal, name: '', date: null } });
  return <>
    <h2>Dein Ziel</h2>
    <p>Überprüfe deine kommenden Events und füge fehlende Rennen oder Ziele hinzu.</p>
    {form ? <EventForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? null : form} draft={draft} busy={!!ctx.busy} onSave={saveEvent} onCancel={() => setForm(null)}
      onDraft={next => ctx.setEventForm(current => current && { ...current, draft: next })} />
      : <button type="button" className="onboarding-add" onClick={() => setForm('new')}>+ Event hinzufügen</button>}
    {!form && <>
      {main ? <p className="onboarding-hint">Dein Hauptziel: <strong>{main.title}</strong> am {dateLabel(main.startDate, true)}. Der Plan läuft darauf hin.</p> : <>
        <h3>Oder setze dir ein Ziel</h3>
        <Tiles label="Ziel ohne Event" single items={GOALS} isOn={key => goal === key} onToggle={setGoal} />
      </>}
      <EventList title="Kommende Events" events={upcoming} busy={!!ctx.busy} onEdit={setForm} onDelete={remove} />
      <EventList title="Kürzliche Events" events={recent} busy={!!ctx.busy} onEdit={setForm} onDelete={remove} />
      {recent.length > 0 && <p className="coach-muted">Kürzliche Events verschieben den Planstart, damit Erholung eingeplant ist.</p>}
    </>}
    <StepFooter onBack={ctx.back} onNext={form ? null : save} disabled={!main && !goal} busy={ctx.busy} />
  </>;
}

// --- B3 Sports of the plan ----------------------------------------------------------------------

export function PlanSportsStep({ ctx }) {
  const { profile, events } = ctx.data;
  const locked = [...new Set(splitEvents(events).upcoming.map(e => e.sport).filter(s => ['ride', 'run'].includes(s)))];
  const [chosen, setChosen] = useState(() => [...new Set([...locked, ...(ctx.done('planSports') ? planSports(profile)
    : profile.sports.filter(s => ['ride', 'run', 'strength'].includes(s)))])]);
  const [metrics, setMetrics] = useState({ ride: profile.metrics.ride || 'power', run: profile.metrics.run || 'pace' });
  const [draft, setDraft] = useState(() => thresholdDraft(ctx.data));
  const toggle = sport => setChosen(list => list.includes(sport) ? list.filter(s => s !== sport) : [...list, sport]);
  const endurance = ['ride', 'run'].filter(s => chosen.includes(s));
  const problem = !endurance.length ? 'Wähle Radfahren oder Laufen; Kraft läuft im Plan nur mit.' : thresholdProblem(draft, endurance);
  const save = () => {
    const changes = thresholdChanges(draft, endurance);
    ctx.complete('planSports', { goal: { sports: endurance }, preferences: { gymAvailability: chosen.includes('strength') },
      metrics: Object.fromEntries(endurance.map(s => [s, metrics[s]])), thresholds: changes.thresholds }, Object.keys(changes.user).length ? changes.user : null);
  };
  const items = [['ride', 'Radfahren'], ['run', 'Laufen'], ['strength', 'Kraft & Core']];
  return <>
    <h2>Welche Sportarten willst du trainieren?</h2>
    <p>Wähle die Sportarten, die du trainieren willst.{locked.length ? ' Sportarten deiner Events sind fest dabei.' : ''}</p>
    <Tiles label="Sportarten im Plan" items={items} isOn={key => chosen.includes(key)} onToggle={toggle} locked={key => locked.includes(key)} />
    {endurance.length > 0 && <><h3>Details</h3>
      <div className="coach-form-grid">{endurance.map(sport => <Field key={sport} label={`Primärmetrik ${SPORT_NAMES[sport]}`}>
        <select value={metrics[sport]} onChange={e => setMetrics(m => ({ ...m, [sport]: e.target.value }))}>{METRICS[sport].map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>)}</div>
      <ThresholdFields draft={draft} sports={endurance} onChange={setDraft} /></>}
    {problem && <p className="coach-muted" role="note">{problem}</p>}
    <StepFooter onBack={ctx.back} onNext={save} disabled={!!problem} busy={ctx.busy} />
  </>;
}

// --- B4 Period ----------------------------------------------------------------------------------

export function PeriodStep({ ctx }) {
  const { events, settings } = ctx.data;
  const today = localDate();
  // A plan made anew after an earlier one starts again from the defaults.
  const saved = settings?.startDate >= today ? settings : null;
  const [start, setStart] = useState(() => saved?.startDate || defaultStart(events, today));
  const [end, setEnd] = useState(() => saved?.endDate || defaultEnd(saved?.startDate || defaultStart(events, today), events));
  const main = lastAEvent(events);
  const mainEnd = main && (main.endDate || main.startDate);
  const problem = !start || !end ? 'Bitte Start und Ende wählen.' : end <= start ? 'Das Planende muss nach dem Planstart liegen.' : null;
  const save = () => ctx.run('Zeitraum wird gespeichert …', async () => {
    const saved = await ctx.request('/api/coach/plan/settings', 'PUT', { startDate: start, endDate: end, replanMode: settings?.replanMode || REPLAN_DEFAULT });
    ctx.update({ settings: saved.settings });
    await ctx.saveProfile({}, 'period');
    ctx.go(ctx.returning ? 'ready' : 'availability');
  });
  return <>
    <h2>Zeitraum</h2>
    <p>Wähle Start- und Enddatum deines Plans.</p>
    <div className="coach-form-grid">
      <DateField label="Plan startet" hint="Vorgabe: der nächste Montag oder nach der Erholung von einem kürzlichen Event." min={today} value={start} onChange={setStart} />
      <DateField label="Plan endet" hint={main ? `Vorgabe: Ende von ${main.title}.` : 'Vorgabe: 12 Wochen nach dem Start. Eine feste Obergrenze gibt es nicht.'} min={start || today} value={end} onChange={setEnd} />
    </div>
    {!problem && <p className="onboarding-hint">{weeksLabel(start, end)} Plan</p>}
    <PlanTimeline start={start} end={end} events={events} />
    {!problem && mainEnd && end > mainEnd && <p className="onboarding-hint">Nach dem A-Event plane ich Erholung und danach Grundlage bis zum Planende.</p>}
    {problem && <p className="coach-muted" role="note">{problem}</p>}
    <StepFooter onBack={ctx.back} onNext={save} disabled={!!problem} busy={ctx.busy} />
  </>;
}

// --- B5 Availability ----------------------------------------------------------------------------

function sportDefaults(sport) {
  if (sport === 'strength') return { equipment: ['bodyweight'] };
  return Object.fromEntries((OPTIONS[sport] || []).map(([key]) => [key, true]));
}

export function AvailabilityForm({ day, initial, sports, busy, onSave, onCancel }) {
  const [page, setPage] = useState(1);
  const [value, setValue] = useState(() => ({ kind: 'available', allDay: false, from: '18:00', to: '19:30', sports: {}, group: null, ...initial,
    from: initial?.from || '18:00', to: initial?.to || '19:30' }));
  const [copyDays, setCopyDays] = useState([]);
  const set = patch => setValue(v => ({ ...v, ...patch }));
  const available = value.kind === 'available';
  const timeProblem = !value.allDay && (!value.from || !value.to || value.to <= value.from) ? 'Das Ende muss nach dem Beginn liegen.' : null;
  const groupProblem = value.group && value.allDay ? 'Gruppentraining braucht eine feste Uhrzeit.' : null;
  const chosen = Object.keys(value.sports);
  const groupSport = value.group?.sport;
  const toggleSport = sport => set({ sports: chosen.includes(sport) ? Object.fromEntries(Object.entries(value.sports).filter(([key]) => key !== sport)) : { ...value.sports, [sport]: sportDefaults(sport) } });
  const setOption = (sport, patch) => set({ sports: { ...value.sports, [sport]: { ...value.sports[sport], ...patch } } });
  const finish = () => {
    const window = { kind: value.kind, allDay: value.allDay, from: value.allDay ? null : value.from, to: value.allDay ? null : value.to,
      sports: available ? value.sports : {}, group: available ? value.group : null };
    onSave([{ ...window, id: initial?.id || newId('window'), day }, ...copyDays.map(other => ({ ...window, id: newId('window'), day: other }))]);
  };
  const dayName = DAYS.find(([key]) => key === day)[2];
  const copies = dayNames(copyDays);
  const copyNote = copies.length > 0 && <p className="onboarding-copy-note" role="status">Beim Speichern gilt diese Verfügbarkeit mit Zeitfenster und Sportarten auch für {copies.join(', ')}.</p>;
  return <section className="onboarding-card" aria-label={initial ? 'Verfügbarkeit ändern' : 'Neue Verfügbarkeit'}>
    <span className="coach-eyebrow">{dayName}{copies.length ? ` + ${dayNames(copyDays, 1).join(', ')}` : ''} · Schritt {page} von {available ? 2 : 1}</span>
    {page === 1 ? <>
      <h3>Wann trainierst du?</h3>
      <div className="onboarding-segments" role="radiogroup" aria-label="Art">{[['available', 'Verfügbar'], ['unavailable', 'Nicht verfügbar']].map(([key, text]) =>
        <button key={key} type="button" role="radio" aria-checked={value.kind === key} onClick={() => set({ kind: key, ...(key === 'unavailable' ? { group: null } : {}) })}>{text}</button>)}</div>
      <label className="coach-checkbox"><input type="checkbox" checked={value.allDay} onChange={e => set({ allDay: e.target.checked })} />Den ganzen Tag</label>
      {!value.allDay && <div className="coach-form-grid">
        <Field label="Von"><input type="time" value={value.from} onChange={e => set({ from: e.target.value })} /></Field>
        <Field label="Bis"><input type="time" value={value.to} onChange={e => set({ to: e.target.value })} /></Field>
      </div>}
      {available && <>
        <label className="coach-checkbox"><input type="checkbox" checked={!!value.group} onChange={e => set({ group: e.target.checked ? { sport: sports.find(s => s !== 'strength') || sports[0], intensity: 'moderate', note: '' } : null })} />Gruppentraining (fester Termin, der Coach plant drumherum)</label>
        {value.group && <div className="coach-form-grid">
          <Field label="Sportart"><select value={value.group.sport} onChange={e => set({ group: { ...value.group, sport: e.target.value } })}>{sports.map(s => <option key={s} value={s}>{SPORT_NAMES[s]}</option>)}</select></Field>
          <Field label="Intensität"><select value={value.group.intensity} onChange={e => set({ group: { ...value.group, intensity: e.target.value } })}>{INTENSITIES.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
          <Field label="Notiz (optional)"><input maxLength={300} value={value.group.note} placeholder="z. B. Vereinsausfahrt" onChange={e => set({ group: { ...value.group, note: e.target.value } })} /></Field>
        </div>}
      </>}
      <h4>Auch für andere Tage übernehmen</h4>
      <div className="coach-toggles" role="group" aria-label="Auch für andere Tage übernehmen">{DAYS.filter(([key]) => key !== day).map(([key, short]) =>
        <button key={key} type="button" className="coach-toggle" aria-pressed={copyDays.includes(key)} onClick={() => setCopyDays(list => list.includes(key) ? list.filter(d => d !== key) : [...list, key])}>{copyDays.includes(key) ? '✓ ' : ''}{short}</button>)}</div>
      {copyNote}
      {(timeProblem || groupProblem) && <p className="coach-muted" role="note">{timeProblem || groupProblem}</p>}
      <div className="coach-actions">
        {available ? <button type="button" className="coach-primary" disabled={!!timeProblem || !!groupProblem} onClick={() => { if (groupSport && !chosen.includes(groupSport)) toggleSport(groupSport); setPage(2); }}>Weiter</button>
          : <button type="button" className="coach-primary" disabled={!!timeProblem || busy} onClick={finish}>Speichern</button>}
        <button type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </> : <>
      <h3>Welche Sportarten?</h3>
      {sports.map(sport => <div key={sport} className="onboarding-window-sport">
        <label className="coach-checkbox"><input type="checkbox" checked={chosen.includes(sport)} disabled={sport === groupSport} onChange={() => toggleSport(sport)} />{SPORT_NAMES[sport]}{sport === groupSport ? ' (Gruppentraining)' : ''}</label>
        {chosen.includes(sport) && OPTIONS[sport] && <div className="coach-toggles" role="group" aria-label={`Optionen ${SPORT_NAMES[sport]}`}>{OPTIONS[sport].map(([key, name]) =>
          <button key={key} type="button" className="coach-toggle" aria-pressed={!!value.sports[sport][key]} onClick={() => setOption(sport, { [key]: !value.sports[sport][key] })}>{name}</button>)}</div>}
        {chosen.includes(sport) && sport === 'strength' && <div className="coach-toggles" role="group" aria-label="Equipment">{EQUIPMENT.map(([key, name]) => {
          const list = value.sports.strength.equipment;
          return <button key={key} type="button" className="coach-toggle" aria-pressed={list.includes(key)} onClick={() => setOption('strength', { equipment: list.includes(key) ? list.filter(e => e !== key) : [...list, key] })}>{name}</button>;
        })}</div>}
      </div>)}
      {!chosen.length && <p className="coach-muted" role="note">Wähle mindestens eine Sportart.</p>}
      {copyNote}
      <div className="coach-actions"><button type="button" className="coach-primary" disabled={!chosen.length || busy} onClick={finish}>Speichern</button><button type="button" onClick={() => setPage(1)}>Zurück</button></div>
    </>}
  </section>;
}

// The wished hours of earlier profiles may not exceed what the windows hold.
export function fittedWish(availability, windows, maxWeeklyHours) {
  const cap = Math.floor(Math.min(windowHours(windows), maxWeeklyHours ?? Infinity, 80) * 100) / 100;
  return Object.fromEntries(['preferredWeeklyHours', 'indoorWeeklyHours'].filter(key => availability[key] != null && availability[key] > cap).map(key => [key, cap]));
}

/** The windows per weekday; form ({day, window}) opens the editor, onSave(list, saved) stores the whole list. After a save
 * the days it reached are marked and named, so copying to other days is visible. */
export function WindowEditor({ windows, sports, busy, form, onForm, onSave }) {
  const minutes = windowMinutes(windows);
  const [saved, setSaved] = useState(null);  // { ids, days } of the last save
  if (form) return <AvailabilityForm day={form.day} initial={form.window} sports={sports} busy={busy}
    onSave={list => {
      const next = form.window ? [...windows.map(w => w.id === form.window.id ? list[0] : w), ...list.slice(1)] : [...windows, ...list];
      setSaved({ ids: list.map(w => w.id), days: list.map(w => w.day) });
      onSave(next);
    }} onCancel={() => onForm(null)} />;
  return <>{saved && <p className="onboarding-hint" role="status">Gespeichert für {dayNames(saved.days).join(', ')}.</p>}
  <ul className="onboarding-days">{DAYS.map(([day, , name]) => <li key={day} className={saved?.days.includes(day) ? 'saved' : undefined}>
    <div className="onboarding-day-head"><strong>{name}</strong>{minutes[day] > 0 && <small>{clockLabel(minutes[day])} h</small>}
      <button type="button" onClick={() => onForm({ day, window: null })}>+ Neue Verfügbarkeit</button></div>
    {windows.filter(w => w.day === day).map(window => <div key={window.id} className={`onboarding-window ${window.kind}${saved?.ids.includes(window.id) ? ' new' : ''}`}>
      <span>{windowLabel(window)}</span>
      <button type="button" onClick={() => onForm({ day, window })}>Ändern</button>
      <button type="button" className="coach-danger" disabled={busy} onClick={() => { setSaved(null); onSave(windows.filter(w => w.id !== window.id)); }}>Löschen</button>
    </div>)}
  </li>)}</ul></>;
}

/** Several weekdays at once; "Keine Präferenz" clears them. */
function DayPicker({ label, days, hint, onChange }) {
  const toggle = day => onChange(days.includes(day) ? days.filter(d => d !== day) : DAYS.map(([key]) => key).filter(key => key === day || days.includes(key)));
  return <div className="onboarding-day-picker"><span>{label}</span>
    <div className="coach-toggles" role="group" aria-label={label}>
      <button type="button" className="coach-toggle" aria-pressed={!days.length} onClick={() => onChange([])}>Keine Präferenz</button>
      {DAYS.map(([day, short, name]) => <button key={day} type="button" className="coach-toggle" aria-pressed={days.includes(day)} aria-label={name} onClick={() => toggle(day)}>{short}</button>)}
    </div>{hint && <small>{hint}</small>}</div>;
}

/** The time budget, rest days and long days for the whole week, as strings and lists while editing. Two days in a row
 * without time make two rest days in a row unavoidable, so "keine zwei Ruhetage hintereinander" cannot be chosen then. */
export function WeekFields({ week, total, forced = [], onChange }) {
  const set = patch => onChange({ ...week, ...patch });
  const avoid = week.noConsecutiveRestDays && !forced.length;
  const pairs = forced.map(pair => pair.map(day => DAYS.find(([key]) => key === day)[1]).join(' und ')).join(', ');
  return <>
    <div className="coach-form-grid">
      <Field label="Maximal verfügbare Trainingszeit pro Woche (h)" hint={`Zeitliche Obergrenze: So viel Zeit kannst du höchstens aufbringen. Das ist keine Empfehlung, so viel zu trainieren. Leer = Summe der Zeitfenster (${hoursLabel(total)}).`}>
        <input type="number" min="0" max="80" step="0.5" placeholder={String(Math.round(total * 10) / 10)} value={week.maxWeeklyHours} onChange={e => set({ maxWeeklyHours: e.target.value })} /></Field>
    </div>
    <DayPicker label="Bevorzugte Ruhetage" days={week.restDays} onChange={restDays => set({ restDays })}
      hint="Mehrere möglich. Der Coach legt Ruhetage bevorzugt auf diese Tage. Anders als „nicht verfügbar“ bleibt der Tag offen, wenn es passt." />
    <div className="onboarding-day-picker"><span>Zwei Ruhetage hintereinander</span>
      <div className="coach-toggles" role="group" aria-label="Zwei Ruhetage hintereinander">
        <button type="button" className="coach-toggle" aria-pressed={!avoid} onClick={() => set({ noConsecutiveRestDays: false })}>Erlaubt</button>
        <button type="button" className="coach-toggle" aria-pressed={avoid} disabled={forced.length > 0} onClick={() => set({ noConsecutiveRestDays: true })}>Vermeiden</button>
      </div>
      <small>{forced.length ? `Nicht möglich: An ${pairs} hast du keine Zeit. Deine Verfügbarkeit hat Vorrang.`
        : 'Mit „Vermeiden“ folgen nie zwei Ruhetage aufeinander, auch nicht über den Wochenwechsel von Sonntag auf Montag. Liegen zwei bevorzugte Ruhetage nebeneinander, nimmt der Coach nur einen davon.'}</small>
    </div>
    <DayPicker label="Tage für lange Einheiten" days={week.longDays} onChange={longDays => set({ longDays })}
      hint="Mehrere Tage möglich. Der Coach plant die lange Einheit an einem davon, nicht an jedem." />
  </>;
}
const dayList = (list, single) => list?.length ? list : single ? [single] : [];
export const weekDraft = availability => ({ maxWeeklyHours: availability.maxWeeklyHours ?? '', restDays: dayList(availability.restDays, availability.restDay),
  longDays: dayList(availability.longDays, availability.longDay), noConsecutiveRestDays: !!availability.noConsecutiveRestDays });
export const weekValues = (week, maximum, windows = []) => ({ maxWeeklyHours: maximum, restDays: week.restDays, longDays: week.longDays,
  noConsecutiveRestDays: !!week.noConsecutiveRestDays && !forcedRestPairs(windows).length });

/** The coach's weekly hours for the A event: the AI's answer when there is one (asked once per event, goal and training
 * base), else fixed rules; the static table when the server cannot be asked. */
function useRecommendation(request, events, background) {
  const [state, setState] = useState({ value: null, asking: false, failed: false });
  const key = JSON.stringify([events.filter(e => e.priority === 'A').map(e => [e.id, e.subtype, e.startDate, e.distanceKm, e.elevationM, e.targetSeconds, e.description]),
    background?.weeklyHours ?? null]);
  useEffect(() => {
    if (!request) return undefined;
    let active = true;
    request('/api/coach/volume/recommendation').then(value => {
      if (!active) return;
      setState({ value, asking: value.canAsk, failed: false });
      if (value.canAsk) request('/api/coach/volume/recommendation', 'POST', {})
        .then(answer => active && setState({ value: answer, asking: false, failed: false }))
        .catch(() => active && setState(s => ({ ...s, asking: false, failed: true })));
    }).catch(() => active && setState({ value: null, asking: false, failed: true }));
    return () => { active = false; };
  }, [request, key]);
  return state;
}

/** "Für die ganze Woche": time budget and preferred days with the recommendation, the budget and the average so far kept
 * apart, and what can still change later in the week plan. */
export function WeekPanel({ week, windows, events, background, request, onChange, children }) {
  const [info, setInfo] = useState(false);
  const total = windowHours(windows);
  const maximum = number(week.maxWeeklyHours);
  const effective = maximum == null ? total : Math.min(total, maximum);
  const { value, asking } = useRecommendation(request, events, background);
  const fallback = recommendedHours(events);
  const recommendation = value?.event ? value.recommendation : null;
  const label = value?.event ? `„${value.event.title}“${value.event.goal === 'targetTime' ? ' mit Zielzeit' : ''}` : fallback?.label;
  const minimum = recommendation?.minHours ?? fallback?.hours;
  const available = windows.length ? effective : maximum;
  const hint = windows.length && minimum && effective < minimum ? `Für ${label} empfehle ich mindestens ${hoursLabel(minimum)}/Woche, du hast ${hoursLabel(effective)} eingetragen.` : null;
  return <section className="onboarding-week-panel" aria-label="Für die ganze Woche">
    <h3>Für die ganze Woche</h3>
    <div className="onboarding-info">
      <button type="button" className="onboarding-info-button" aria-expanded={info} onClick={() => setInfo(i => !i)}><Icon name="info" size={15} />Kann ich das später anpassen?</button>
      {info && <p>Hier trägst du deine üblichen Zeiten ein, die Grundlage für jede Woche. Im Wochenplan kannst du später jederzeit einzelne Einheiten spontan verschieben, tauschen oder auslassen, etwa wenn ein Termin dazwischenkommt („Woche anpassen“ oder direkt an der Einheit). Einmalige Ausnahmen wie Urlaub trägst du in den Einstellungen ein. Deine Grundverfügbarkeit hier bleibt davon unberührt.</p>}
    </div>
    <WeekFields week={week} total={total} forced={forcedRestPairs(windows)} onChange={onChange} />
    <div className="onboarding-hours" aria-label="Wochenstunden">
      {minimum != null && <div className="recommended"><strong>mind. {hoursLabel(minimum)}</strong>Minimum für {label}</div>}
      {recommendation && <div className="recommended"><strong>Ø {hoursLabel(recommendation.averageHours)}</strong>empfohlen im Schnitt pro Woche</div>}
      {recommendation && <div className="recommended"><strong>{hoursLabel(recommendation.peakHours)}</strong>stärkste Woche vor dem Taper</div>}
      <div className="budget"><strong>{available != null ? hoursLabel(available) : '–'}</strong>maximal verfügbare Zeit pro Woche</div>
      {background?.weeklyHours != null && <div><strong>{hoursLabel(background.weeklyHours)}</strong>bisher im Durchschnitt pro Woche</div>}
    </div>
    {asking && <p className="coach-muted" role="status">Der Coach rechnet deine Empfehlung …</p>}
    {recommendation && !asking && <p className="coach-muted onboarding-recommendation"><span className={`coach-badge${recommendation.source === 'aiRecommendation' ? ' recommendation' : ''}`}>
      {recommendation.source === 'aiRecommendation' ? 'AI · Empfehlung' : 'Richtwert'}</span> {recommendation.rationale}</p>}
    {minimum != null && <p className="coach-muted">Die Empfehlung ist eine Orientierung, kein Zeitbudget. Der Plan steigt von deinem bisherigen Umfang gleichmäßig bis zur stärksten Woche kurz vor dem Event, höchstens bis zu deiner verfügbaren Zeit.</p>}
    {hint && <p className="onboarding-hint warning" role="note">{hint}</p>}
    {children}
  </section>;
}
export const weekProblem = (windows, maximum) => !windows.some(w => w.kind === 'available') ? 'Trage mindestens ein Zeitfenster ein, in dem du trainieren kannst.'
  : maximum != null && !(maximum > 0 && maximum <= 80) ? 'Die maximalen Stunden liegen zwischen 0 und 80.' : null;

export function AvailabilityStep({ ctx }) {
  const { profile, events } = ctx.data;
  const availability = profile.availability;
  const windows = availability.windows || [];
  const sports = planSports(profile);
  const [form, setForm] = useState(null);  // { day, window }
  const [week, setWeek] = useState(() => weekDraft(availability));
  const maximum = number(week.maxWeeklyHours);
  const weekPatch = list => ({ ...weekValues(week, maximum, list), ...fittedWish(availability, list, maximum) });
  const saveWindows = list => ctx.run('Verfügbarkeit wird gespeichert …', async () => {
    await ctx.saveProfile({ availability: { windows: list, ...fittedWish(availability, list, number(availability.maxWeeklyHours)) } });
    setForm(null);
  });
  const problem = weekProblem(windows, maximum);
  return <>
    <h2>Verfügbarkeiten</h2>
    <p>Sag mir, wann du trainieren kannst. Einmalige Ausnahmen wie Urlaub trägst du später ein.</p>
    {!form && <WeekPanel week={week} windows={windows} events={events} background={profile.background} request={ctx.request} onChange={setWeek} />}
    {!form && <h3>Deine Tage</h3>}
    <WindowEditor windows={windows} sports={sports} busy={!!ctx.busy} form={form} onForm={setForm} onSave={saveWindows} />
    {!form && problem && <p className="coach-muted" role="note">{problem}</p>}
    <StepFooter onBack={ctx.back} onNext={form ? null : () => ctx.complete('availability', { availability: weekPatch(windows) })} disabled={!!problem} busy={ctx.busy} />
  </>;
}

// --- B6 Ready -----------------------------------------------------------------------------------

function Summary({ title, step, ctx, children }) {
  return <section className="onboarding-summary"><div className="onboarding-summary-head"><h3>{title}</h3><button type="button" onClick={() => ctx.go(step, 'ready')}>Ändern</button></div>{children}</section>;
}

export function ReadyStep({ ctx }) {
  const { profile, events, settings, provider } = ctx.data;
  const background = profile.background || {};
  const sports = planSports(profile);
  const windows = profile.availability.windows || [];
  const minutes = windowMinutes(windows);
  const maximum = profile.availability.maxWeeklyHours;
  const { restDays, longDays, noConsecutiveRestDays } = weekDraft(profile.availability);
  const inPlan = settings ? events.filter(e => (e.endDate || e.startDate) >= settings.startDate && e.startDate <= settings.endDate) : [];
  const intervals = Object.entries(background.intervals || {}).map(([sport, yes]) => `${SPORT_NAMES[sport]} ${yes ? 'ja' : 'nein'}`).join(', ');
  const start = () => ctx.run('Wird gespeichert …', async () => { await ctx.saveProfile({}, 'ready'); ctx.go('creating'); });
  return <>
    <h2>Bereit</h2>
    <p>Überprüfe deine Einstellungen und ich lege los.</p>
    <Summary title="Bisherige Aktivität" step="background" ctx={ctx}><p>{[typeName(background.type), background.weeklyHours != null && `Ø ${hoursLabel(background.weeklyHours)} pro Woche`, intervals && `Intervalle: ${intervals}`].filter(Boolean).join(' · ') || 'Noch offen'}</p></Summary>
    <Summary title="Enthaltene Sportarten" step="planSports" ctx={ctx}><div className="onboarding-chips">{sports.map(sport =>
      <span key={sport} className="onboarding-chip">{SPORT_NAMES[sport]}{profile.metrics[sport] && sport !== 'strength' ? ` · ${METRIC_NAMES[profile.metrics[sport]]}` : ''}</span>)}</div></Summary>
    <Summary title="Verfügbarkeiten" step="availability" ctx={ctx}>
      <div className="onboarding-week">{DAYS.map(([day, short]) => <div key={day}><span>{short}</span><strong>{minutes[day] ? clockLabel(minutes[day]) : '–'}</strong></div>)}</div>
      <p>{hoursLabel(windowHours(windows))} in deinen Zeitfenstern{maximum != null ? ` · höchstens ${hoursLabel(maximum)} verfügbar` : ''}</p>
      {(restDays.length > 0 || longDays.length > 0 || noConsecutiveRestDays) && <p>{[restDays.length && `Ruhetage: ${dayNames(restDays).join(', ')}`,
        noConsecutiveRestDays && 'keine zwei hintereinander', longDays.length && `Lange Einheiten: ${dayNames(longDays).join(', ')}`].filter(Boolean).join(' · ')}</p>}
    </Summary>
    <Summary title="Zeitplan" step="period" ctx={ctx}>
      {settings ? <><PlanTimeline start={settings.startDate} end={settings.endDate} events={events} />
        <ul className="onboarding-plan-events">{inPlan.map(e => <li key={e.id}><span className={`onboarding-priority priority-${e.priority.toLowerCase()}`}>{e.priority}</span>{e.title} · {eventDates(e)} · {eventSummary(e)}</li>)}</ul>
        <p>{weeksLabel(settings.startDate, settings.endDate)} · {dateLabel(settings.startDate, true)} bis {dateLabel(settings.endDate, true)}</p></> : <p>Noch offen</p>}
    </Summary>
    {!provider.configured && <div className="coach-message">Zum Erstellen braucht der Coach deinen AI-Provider. <button type="button" onClick={() => ctx.go('provider', 'ready')}>AI-Provider verbinden</button></div>}
    <StepFooter onBack={ctx.back} onNext={start} nextLabel="Los geht's" disabled={!provider.configured || !settings} busy={ctx.busy} />
  </>;
}

// --- B7 Creating --------------------------------------------------------------------------------

const POLL_MS = 1500;
const STATUS_TEXT = { done: '✓', failed: '✗', running: '…', pending: '' };

export function CreatingStep({ ctx }) {
  const [job, setJob] = useState(() => jobState({ status: 'running' }));
  const [attempt, setAttempt] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const finish = async () => {
      await ctx.saveProfile({}, 'created').catch(() => {});
      if (!cancelled) ctx.onCreated();
    };
    const follow = state => {
      if (cancelled) return;
      setJob(state);
      if (state.status === 'done') finish();
      else if (state.status === 'running' && state.id) timer.current = setTimeout(poll(state.id), POLL_MS);
      else if (state.status === 'running') setJob({ ...state, status: 'failed', error: 'Der Server hat keinen Auftrag für die Planerstellung zurückgegeben.' });
    };
    const fail = error => {
      if (cancelled) return;
      // A creation that is already running is followed; one that already finished counts as done.
      if (error.status === 409 && error.data?.job) return follow(jobState(error.data));
      if (error.status === 409 && /bereits erstellt/.test(error.message)) return follow(jobState({ status: 'done' }));
      setJob(state => ({ ...state, status: 'failed', error: error.status === 404 || error.status === 405
        ? 'Die Planerstellung ist auf diesem Server noch nicht verfügbar. Bitte TrainHub aktualisieren.' : error.message }));
    };
    const poll = id => () => ctx.request(`/api/coach/plan/create/${encodeURIComponent(id)}`).then(data => follow(jobState(data)), fail);
    setJob(jobState({ status: 'running' }));
    // Start, end and replanning were saved in B4; the server reads them from the plan settings.
    ctx.request(`/api/coach/plan/create?timezone=${encodeURIComponent(timezone())}`, 'POST', {}).then(data => follow(jobState(data)), fail);
    return () => { cancelled = true; clearTimeout(timer.current); };
    // A retry starts the creation again; the server continues at the missing step.
  }, [attempt]);
  return <>
    <h2>{job.status === 'done' ? 'Dein Plan ist aktiv' : 'Plan wird erstellt'}</h2>
    <p>{job.status === 'failed' ? 'Bisher Erstelltes bleibt erhalten.' : 'Das dauert ein bis zwei Minuten. Die Workouts der ersten 3 Wochen landen direkt im Kalender.'}</p>
    <ol className="onboarding-create" aria-live="polite">{job.steps.map(step => <li key={step.key} className={step.status}>
      <span aria-hidden="true">{step.status === 'running' ? <span className="coach-spinner" /> : STATUS_TEXT[step.status]}</span>{step.label}
      {step.status === 'done' && <span className="visually-hidden"> erledigt</span>}</li>)}</ol>
    {job.status === 'failed' && <div role="alert" className="coach-message error">{job.error || 'Die Planerstellung ist fehlgeschlagen.'}
      <button type="button" onClick={() => setAttempt(a => a + 1)}>Erneut versuchen</button></div>}
    {job.status === 'failed' && <StepFooter onBack={() => ctx.go('ready')} />}
  </>;
}
