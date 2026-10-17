import React, { useEffect, useMemo, useState } from 'react';
import BestEfforts from './BestEfforts';
import RaceGoal from './RaceGoal';
import { isoWeek } from './AICoach';
import { CheckInStrip } from './CoachToday';
import { imageUrl, useAppearance } from './appearance';
import { Icon, sportIcon } from './icons';
import { HomeLandscape } from './Landscape';
import { RecoveryHint, RecoveryTile, planningHint } from './Recovery';
import { SportMark, sportColor, sportLabels } from './sports';
import { SPORT_NAMES, eventDates, eventSummary, splitEvents } from './coachOnboarding';
import { localDate, summary as workoutSummary, workoutOverview } from './workoutModel';
import './Home.css';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const LONG_WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const hm = minutes => { const total = Math.round(minutes || 0); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} h`; };
const km = value => value == null ? '—' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
const shortDate = date => date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const longDay = date => date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const planDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function overviewOf(workout) {
  try { return workoutOverview(workout); } catch (_) { return null; }
}

// Planned minutes are only known for time-based steps; distance steps depend on pace.
const plannedMinutes = workout => (overviewOf(workout)?.time || 0) / 60;
const planLength = workout => { const overview = overviewOf(workout); return overview?.allTimed ? hm(overview.time / 60) : workoutSummary(workout); };
const minutesBySport = acts => Object.entries(acts.reduce((map, a) => ({ ...map, [a.sport]: (map[a.sport] || 0) + (a.duration || 0) }), {}));

const HEIGHTS = { warmup: 40, cooldown: 40, recovery: 30, active: 62, interval: 100 };

function WorkoutProfile({ overview }) {
  const { segments, allTimed, allDistance, time } = overview;
  const peak = Math.max(1, ...segments.map(step => step.power || 0));
  const hasPower = segments.some(step => step.power !== null);
  return <div className="today-profile">
    <div className="today-profile-bars" role="img" aria-label="Intervallprofil des Workouts">
      {segments.map((step, index) => {
        const height = hasPower && step.power !== null ? Math.max(8, step.power / peak * 100) : HEIGHTS[step.intensity] || 50;
        return <i key={index} className={step.intensity === 'interval' ? 'hard' : step.intensity === 'active' ? 'steady' : ''} style={{ flexGrow: allTimed ? step.seconds : allDistance ? step.metres : 1, height: `${height}%` }} />;
      })}
    </div>
    {allTimed && <div className="today-profile-axis"><span>0′</span><span>{Math.round(time / 60)}′</span></div>}
  </div>;
}

// Decorative: the sport is always named in text next to the badge.
function SportBadge({ sport, size = 34 }) {
  return <span className="sport-badge" style={{ '--badge': sportColor(sport), width: size, height: size }}>
    <Icon name={sportIcon(sport)} size={Math.round(size * 0.53)} />
  </span>;
}

function TodayPlan({ workout, coach, onOpen }) {
  const overview = overviewOf(workout);
  const stats = [
    ['Datum', planDate(workout.date)],
    ['Dauer', planLength(workout) || '—'],
    overview?.distance > 0 && ['Distanz', km(overview.distance / 1000)],
    overview?.workTime > 0 && ['Belastung', hm(overview.workTime / 60)],
    overview?.averagePower != null && ['Ø Ziel', `${Math.round(overview.averagePower)} W`],
  ].filter(Boolean);
  return <article className="today-plan">
    <div className="today-plan-top">
      <SportBadge sport={workout.sport} size={44} />
      <div className="today-plan-title">
        <h3>{workout.name || 'Workout'}</h3>
        {workout.notes?.trim() && <p className="today-plan-notes">{workout.notes.trim()}</p>}
      </div>
      {coach && <span className="today-plan-ai" title="Vom AI Coach geplant">KI</span>}
    </div>
    <dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {overview?.segments.length > 0 && <WorkoutProfile overview={overview} />}
    <div className="today-plan-actions"><button type="button" className="home-button" onClick={() => onOpen(workout)}>Workout öffnen</button></div>
  </article>;
}

function ActivityLine({ activity, onOpen }) {
  const extra = [activity.hrAvg && `Ø ${activity.hrAvg} bpm`, activity.power && `${activity.power} W`].filter(Boolean).join(' · ');
  return <button type="button" className="today-done" onClick={() => onOpen(activity)}>
    <SportMark sport={activity.sport} suffix="absolviert" />
    <strong>{activity.title}</strong>
    <span>{hm(activity.duration)} · {km(activity.distance)}{extra && ` · ${extra}`}</span>
  </button>;
}

function Sparkline({ values, sport, w = 92, h = 28 }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values); const range = Math.max(...values) - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v - min) / range * (h - 6)).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} role="img" aria-label={`Herzfrequenz ${min}–${min + range} bpm`}>
    <polyline points={points} fill="none" style={{ stroke: sportColor(sport) }} strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}

function HeroBackdrop({ apiBase, appearance }) {
  if (!appearance.loaded || appearance.background === 'none') return null;
  const photo = appearance.background === 'custom' && imageUrl(apiBase, appearance.backgroundImage);
  return <div className={`home-backdrop${photo ? ' photo' : ''}`} aria-hidden="true">
    {photo ? <img src={photo} alt="" /> : <HomeLandscape />}
  </div>;
}

// One tile per day: what was done, what is still planned, and free days.
function WeekOverview({ week, todayKey, onOpenWorkout, onOpenActivity }) {
  return <div className="home-days">{week.map((day, index) => {
    const done = day.acts.length > 0;
    const state = done ? 'done' : day.plans.length ? (day.future ? 'planned' : 'missed') : 'free';
    const sports = [...new Set((done ? day.acts : day.plans).map(item => item.sport))].slice(0, 2);
    const minutes = done ? day.done : day.planned;
    const names = [...day.acts.map(a => `${a.title} (absolviert)`), ...day.plans.map(w => `${w.name || 'Workout'} (geplant)`)];
    const label = `${LONG_WEEKDAYS[index]}: ${names.length ? names.join(', ') : 'frei'}`;
    const open = done ? () => onOpenActivity(day.acts[0]) : day.plans.length ? () => onOpenWorkout(day.plans[0]) : day.future ? () => onOpenWorkout({ date: day.key }) : null;
    const today = day.key === todayKey;
    const tile = <>
      <span className="home-day-icons">{sports.length ? sports.map(sport => <Icon key={sport} name={sportIcon(sport)} size={sports.length > 1 ? 20 : 26} />)
        : today ? <Icon name="moon" size={20} /> : null}</span>
      {minutes > 0 && <small>{hm(minutes)}</small>}
    </>;
    return <div key={day.key} className={`home-day${today ? ' today' : ''}`}>
      <span className="home-day-name" aria-hidden="true">{today ? 'Heute' : `${day.label}.`}</span>
      {open ? <button type="button" className={`home-day-tile ${state}`} style={{ '--day': sportColor(sports[0]) }} aria-label={label} title={label} onClick={open}>{tile}</button>
        : <span className={`home-day-tile ${state}`} role="img" aria-label={label} title={label}>{tile}</span>}
    </div>;
  })}</div>;
}

function untilLabel(event, todayKey) {
  const days = daysBetween(todayKey, event.startDate);
  if (days < 0) return { value: 'läuft', label: 'gerade' };
  if (days === 0) return { value: 'Heute', label: 'ist Start' };
  if (days < 14) return { value: String(days), label: days === 1 ? 'Tag übrig' : 'Tage übrig' };
  const weeks = Math.floor(days / 7);
  return { value: String(weeks), label: 'Wochen übrig' };
}

// Upcoming events from the coach settings, with the time that is left.
function EventsCard({ events, todayKey, onEdit }) {
  if (!events) return null;
  const upcoming = splitEvents(events, todayKey).upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 4);
  return <section className="home-card home-block" aria-labelledby="home-events">
    <div className="home-block-head"><h2 id="home-events">Events</h2>
      <button type="button" className="home-link" aria-label="Events bearbeiten" onClick={onEdit}>Bearbeiten<Icon name="chevron" size={16} /></button></div>
    {upcoming.length ? <ul className="home-events">{upcoming.map(event => {
      const until = untilLabel(event, todayKey);
      return <li key={event.id}>
        <span className={`home-priority priority-${event.priority.toLowerCase()}`} aria-label={`${event.priority}-Event`}>{event.priority}</span>
        <div className="home-event-text"><strong>{event.title}</strong><span><b>{SPORT_NAMES[event.sport] || event.sport}</b> {eventDates(event)}</span></div>
        <div className="home-event-until"><strong>{until.value}</strong><span>{until.label}</span></div>
      </li>;
    })}</ul> : <div className="home-events-empty"><p className="home-muted">Noch keine Events. Trag deinen nächsten Wettkampf ein, dann zählt die Startseite die Wochen bis dahin.</p>
      <button type="button" className="home-button" onClick={onEdit}><Icon name="plus" size={14} />Event eintragen</button></div>}
  </section>;
}

// Where today sits in the coach plan: phases as one bar, the plan week and the focus of the week.
function TrainingPhase({ plan, todayKey, onOpenCoach }) {
  if (!plan) return null;
  if (!plan.frame) return <section className="home-card home-block" aria-labelledby="home-phase">
    <div className="home-block-head"><h2 id="home-phase">Trainingsphase</h2></div>
    <div className="home-events-empty"><p className="home-muted">Noch kein Trainingsplan. Der AI Coach plant Phasen bis zu deinem Event und arbeitet jede Woche für dich aus.</p>
      <button type="button" className="home-button" onClick={onOpenCoach}>Plan erstellen</button></div>
  </section>;
  const { phases, weeks } = plan;
  const total = weeks.length;
  const first = weeks[0]?.startDate;
  const current = weeks.find(week => week.state === 'current');
  const phase = phases.find(p => p.startDate <= todayKey && todayKey <= p.endDate);
  const elapsed = first ? daysBetween(first, todayKey) / (total * 7) : -1;
  const status = current ? `Woche ${current.number}/${total}` : elapsed < 0 ? `Start ${planDate(first)}` : 'Plan beendet';
  const focus = current?.plan?.focus || current?.focus;
  const target = current?.plan?.targetHours ?? current?.targetHours;
  const facts = current && [current.deload ? 'Entlastungswoche' : 'Belastungswoche', target != null && `Wochenziel ${target.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`].filter(Boolean).join(' · ');
  return <section className="home-card home-block" aria-labelledby="home-phase">
    <div className="home-block-head"><h2 id="home-phase">Trainingsphase</h2>
      <button type="button" className="home-link" onClick={onOpenCoach}>Zum Plan<Icon name="arrow" size={14} /></button></div>
    <h3 className="home-phase-title">Periodisierung</h3>
    <div className="home-phase-bar" role="img" aria-label={`Phasen: ${phases.map(p => `${p.typeName}, ${p.weeks} Wochen`).join(' · ')}`}>
      {phases.map(p => <i key={p.id} className={`${p.blockType}${p.endDate < todayKey ? ' past' : ''}${p === phase ? ' current' : ''}`} style={{ flexGrow: p.weeks }} title={`${p.typeName} · ${p.weeks} Wochen`} />)}
      {elapsed >= 0 && elapsed < 1 && <b className="home-phase-today" style={{ left: `${elapsed * 100}%` }} title="Heute" />}
    </div>
    <div className="home-phase-status"><strong>{phase ? `${phase.typeName}${phase.secondaryName ? ` + ${phase.secondaryName}` : ''}` : current?.phaseName || '—'}</strong><span>{status}</span></div>
    {(focus || phase?.purpose) && <div className="home-focus">
      <h3>Wochenfokus</h3>
      {facts && <span className="home-focus-facts">{facts}</span>}
      <p>{focus || phase.purpose}</p>
    </div>}
  </section>;
}

// The plan from start to end with the events in between.
function Schedule({ plan, todayKey, onEditEvents, onOpenCoach }) {
  const settings = plan?.settings;
  if (!plan?.frame || !settings?.startDate || !settings?.endDate) return null;
  const items = [
    { id: 'start', title: 'Plan startet', date: settings.startDate, meta: planDate(settings.startDate) },
    ...[...plan.events].sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map(event => ({ id: event.id, title: event.title, date: event.startDate, meta: [eventDates(event), eventSummary(event)].filter(Boolean).join(' · '), priority: event.priority })),
    { id: 'end', title: 'Plan endet', date: settings.endDate, meta: planDate(settings.endDate) },
  ];
  return <section className="home-card home-block" aria-labelledby="home-schedule">
    <div className="home-block-head"><h2 id="home-schedule">Zeitplan</h2></div>
    <ol className="home-schedule">{items.map(item => <li key={item.id} className={item.date <= todayKey ? 'reached' : ''}>
      <span className="home-schedule-dot" aria-hidden="true" />
      <div><strong>{item.title}</strong><span>{item.meta}</span></div>
      {item.priority && <span className={`home-priority priority-${item.priority.toLowerCase()}`} aria-label={`${item.priority}-Event`}>{item.priority}</span>}
    </li>)}</ol>
    <div className="home-schedule-actions">
      <button type="button" className="home-link" onClick={onEditEvents}>Events bearbeiten</button>
      <button type="button" className="home-link" onClick={onOpenCoach}>Plan im AI Coach</button>
    </div>
  </section>;
}

export default function Home({ apiBase, activities, plannedWorkouts, workoutLoadError, onReloadWorkouts, onOpenActivity, onOpenWorkout, onEditGoal, bestEffortsYear,
  whoopDays = {}, onOpenWhoop, onOpenCoach, onStartOnboarding, today: day = null, onOpenCheckIn, user = null }) {
  const appearance = useAppearance(apiBase);
  const today = new Date();
  const todayKey = localDate(today);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDate(tomorrow);

  const week = useMemo(() => {
    const now = new Date(`${todayKey}T12:00:00`);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
    return WEEKDAYS.map((label, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = localDate(date);
      const acts = activities.filter(a => localDate(new Date(a.date)) === key);
      const plans = plannedWorkouts.filter(w => w.date === key);
      return { label, key, acts, plans, future: key >= todayKey,
        done: acts.reduce((sum, a) => sum + (a.duration || 0), 0), planned: plans.reduce((sum, w) => sum + plannedMinutes(w), 0) };
    });
  }, [activities, plannedWorkouts, todayKey]);

  const recent = activities.slice(0, 6);
  const recentIds = recent.map(a => a.id).join(',');
  const [sparklines, setSparklines] = useState({});
  useEffect(() => {
    if (!recentIds) return undefined;
    let active = true;
    // Heart-rate outlines are decoration; the table works without them.
    fetch(`${apiBase}/api/activities/sparklines?ids=${encodeURIComponent(recentIds)}`)
      .then(response => (response.ok ? response.json() : {}))
      .then(data => { if (active) setSparklines(data || {}); })
      .catch(() => {});
    return () => { active = false; };
  }, [apiBase, recentIds]);

  // Plan phases and events come from the AI coach; without it these sections stay away.
  const [coach, setCoach] = useState({ plan: null, events: null });
  useEffect(() => {
    let active = true;
    const load = path => fetch(`${apiBase}${path}`).then(response => (response.ok ? response.json() : null)).catch(() => null);
    Promise.all([load(`/api/coach/plan/weeks?timezone=${encodeURIComponent(timezone())}`), load('/api/coach/events')])
      .then(([plan, events]) => { if (active) setCoach({ plan, events: events?.events || null }); });
    return () => { active = false; };
  }, [apiBase]);

  const weekActs = week.flatMap(day => day.acts);
  const done = week.reduce((sum, day) => sum + day.done, 0);
  const target = week.reduce((sum, day) => sum + (day.future ? Math.max(day.done, day.planned) : day.done), 0);
  const openPlans = week.filter(day => day.future).reduce((sum, day) => sum + Math.max(0, day.plans.length - (day.key === todayKey ? day.acts.length : 0)), 0);
  const sessions = weekActs.length + openPlans;
  const distance = weekActs.reduce((sum, a) => sum + (a.distance || 0), 0);
  const calories = weekActs.reduce((sum, a) => sum + (a.calories || 0), 0);
  const bySport = minutesBySport(weekActs);
  const share = target > 0 ? Math.min(1, done / target) : done > 0 ? 1 : 0;

  const todayPlans = plannedWorkouts.filter(w => w.date === todayKey);
  const todayActs = week.find(day => day.key === todayKey)?.acts || [];
  const restDay = !todayPlans.length && !todayActs.length;
  const tomorrowPlans = plannedWorkouts.filter(w => w.date === tomorrowKey);
  const coachIds = new Set((day?.sessions || []).filter(session => session.source === 'coach').map(session => session.id));
  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  const hint = planningHint(whoopDays[todayKey], todayKey, plannedWorkouts);

  const lede = todayPlans.length ? <>Heute steht <strong>{todayPlans[0].name || 'ein Workout'}</strong> auf dem Plan.</>
    : todayActs.length ? <>Heute hast du schon {todayActs.length === 1 ? 'eine Einheit' : `${todayActs.length} Einheiten`} absolviert.</>
    : <>Heute ist Ruhetag.</>;

  return <div className="home">
    <HeroBackdrop apiBase={apiBase} appearance={appearance} />
    <section className="home-hero">
      <div className="home-hero-text">
        <p className="home-kicker">
          <span className="home-week-pill">KW {Number(isoWeek(todayKey).split('-W')[1])}</span>
          <span>Tag {(today.getDay() + 6) % 7 + 1} von 7</span>
          {restDay && <><span aria-hidden="true">·</span><span className="home-kicker-rest">Ruhetag</span></>}
        </p>
        <h1>Hey{firstName ? <> <em>{firstName}</em></> : null}!</h1>
        <p className="home-date">{longDay(today)}</p>
        <p className="home-lede">{lede} Diese Woche hast du <strong className="home-time">{hm(done)}</strong> absolviert{target > done ? <> von geplanten <strong className="home-time">{hm(target)}</strong></> : null}.</p>
      </div>
      <RaceGoal apiBase={apiBase} onEdit={onEditGoal} photo={imageUrl(apiBase, appearance.raceGoalImage)} />
    </section>

    <div className="home-grid">
      <div className="home-main">
        <section className="home-card home-block" aria-labelledby="home-today">
          <div className="home-block-head"><h2 id="home-today">Heute</h2><button type="button" className="home-link" aria-label="Workout planen für heute" onClick={() => onOpenWorkout({ date: todayKey })}>Workout planen<Icon name="arrow" size={14} /></button></div>
          <RecoveryHint hint={hint} onOpenWorkout={onOpenWorkout} onOpenCoach={onOpenCoach} />
          <CheckInStrip today={day} onOpen={onOpenCheckIn} onOpenCoach={onOpenCoach} onStartOnboarding={onStartOnboarding} />
          <div className="home-today">
            {todayPlans.map(workout => <TodayPlan key={workout.id} workout={workout} coach={coachIds.has(workout.id)} onOpen={onOpenWorkout} />)}
            {todayActs.map(activity => <ActivityLine key={activity.id} activity={activity} onOpen={onOpenActivity} />)}
            {restDay && <div className="home-rest">
              <span className="home-rest-icon"><Icon name="moon" size={26} /></span>
              <div><h3>Ruhetag</h3><p>{tomorrowPlans.length ? 'Keine Einheit geplant. Erholung gehört zum Plan – morgen geht’s weiter.' : 'Keine Einheit geplant. Erholung gehört zum Plan.'}</p></div>
              <button type="button" className="home-button" onClick={() => onOpenWorkout({ date: todayKey })}><Icon name="plus" size={14} />Workout hinzufügen</button>
            </div>}
          </div>
          {workoutLoadError && <p role="alert" className="home-error">{workoutLoadError} <button type="button" className="home-link" onClick={onReloadWorkouts}>Erneut laden</button></p>}
        </section>

        <section className="home-card home-block" aria-labelledby="home-week-overview">
          <div className="home-block-head"><h2 id="home-week-overview">Deine Woche im Überblick</h2>
            <span className="home-week-sum">{hm(done)}{target > done && <small> / {hm(target)}</small>}</span></div>
          <WeekOverview week={week} todayKey={todayKey} onOpenWorkout={onOpenWorkout} onOpenActivity={onOpenActivity} />
        </section>

        <EventsCard events={coach.events} todayKey={todayKey} onEdit={onEditGoal} />
        <TrainingPhase plan={coach.plan} todayKey={todayKey} onOpenCoach={onOpenCoach} />
        <Schedule plan={coach.plan} todayKey={todayKey} onEditEvents={onEditGoal} onOpenCoach={onOpenCoach} />

        <section className="home-card home-block" aria-labelledby="home-recent">
          <div className="home-block-head"><h2 id="home-recent">Letzte Aktivitäten</h2></div>
          {activities.length ? <div className="home-table">
            <div className="home-table-head" aria-hidden="true"><span>Datum</span><span>Sport</span><span>Verlauf</span><span>Titel</span><span>Dauer</span><span>Distanz</span><span>Ø HF</span><span>Watt</span><span /></div>
            {recent.map(a => <button type="button" key={a.id} className="home-table-row" onClick={() => onOpenActivity(a)}>
              <span className="home-muted">{shortDate(new Date(a.date))}</span>
              <SportBadge sport={a.sport} />
              <span className="home-table-spark"><Sparkline values={sparklines[a.id]} sport={a.sport} /></span>
              <span className="home-table-title"><strong>{a.title}</strong>{a.notes?.trim() ? <span className="home-table-note">{a.notes.trim().split('\n')[0]}</span> : <SportMark sport={a.sport} />}</span>
              <span className="num">{hm(a.duration)}</span>
              <span className="num">{km(a.distance)}</span>
              <span className="num">{a.hrAvg ?? '—'}</span>
              <span className="num">{a.power ?? '—'}</span>
              <Icon name="chevron" size={16} className="home-table-chevron" />
            </button>)}
          </div> : <p className="home-muted">Noch keine Aktivitäten. Über „Daten“ Garmin Connect verbinden, die Garmin per USB auslesen oder Dateien importieren.</p>}
        </section>
      </div>

      <aside className="home-side">
        <RecoveryTile days={whoopDays} todayKey={todayKey} onOpenWhoop={onOpenWhoop} />
        <section className="home-card home-block" aria-labelledby="home-week-title">
          <div className="home-block-head"><h2 id="home-week-title">Diese Woche</h2></div>
          <div className="home-figures">
            <div>
              <svg className="home-ring" viewBox="0 0 64 64" role="img" aria-label={`${Math.round(share * 100)} % der geplanten Zeit`}>
                <circle cx="32" cy="32" r="26" /><circle cx="32" cy="32" r="26" className="value" strokeDasharray={`${share * 163.4} 164`} />
              </svg>
              <p><strong>{hm(done)}</strong><span>{target > done ? `von ${hm(target)}` : 'Trainingszeit'}</span></p>
            </div>
            <div>
              <span className="home-figure-icon"><Icon name="pin" size={20} /></span>
              <p><strong>{distance.toLocaleString('de-DE', { maximumFractionDigits: 1 })} <small>km</small></strong><span>Distanz</span></p>
            </div>
            <div>
              <span className="home-figure-icon"><Icon name="check" size={20} /></span>
              <p><strong>{weekActs.length}{openPlans > 0 && <small> / {sessions}</small>}</strong><span>Einheiten</span></p>
            </div>
            <div>
              <span className="home-figure-icon warm"><Icon name="flame" size={20} /></span>
              <p><strong>{Math.round(calories).toLocaleString('de-DE')} <small>kcal</small></strong><span>Kalorien</span></p>
            </div>
          </div>
          {bySport.length > 0 && <div className="home-split">
            <div className="home-split-bar">{bySport.map(([sport, minutes]) => <i key={sport} style={{ flexGrow: minutes, background: sportColor(sport) }} />)}</div>
            <div className="home-split-legend">{bySport.map(([sport, minutes]) => <span key={sport}><i style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport} {hm(minutes)}</span>)}</div>
          </div>}
        </section>
        <div className="home-card"><BestEfforts apiBase={apiBase} activities={activities} viewedYear={bestEffortsYear} onOpenActivity={onOpenActivity} /></div>
      </aside>
    </div>
  </div>;
}
