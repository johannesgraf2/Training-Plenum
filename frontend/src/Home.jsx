import React, { useMemo } from 'react';
import BestEfforts from './BestEfforts';
import RaceGoal from './RaceGoal';
import { isoWeek } from './AICoach';
import { SportMark, sportColor, sportLabels } from './sports';
import { localDate, summary as workoutSummary, workoutOverview } from './workoutModel';
import './Home.css';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const hm = minutes => { const total = Math.round(minutes || 0); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} h`; };
const km = value => value == null ? '—' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
const shortDate = date => date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

function overviewOf(workout) {
  try { return workoutOverview(workout); } catch (_) { return null; }
}

// Planned minutes are only known for time-based steps; distance steps depend on pace.
const plannedMinutes = workout => (overviewOf(workout)?.time || 0) / 60;
const planLength = workout => { const overview = overviewOf(workout); return overview?.allTimed ? hm(overview.time / 60) : workoutSummary(workout); };

const HEIGHTS = { warmup: 40, cooldown: 40, recovery: 30, active: 62, interval: 100 };

function WorkoutProfile({ overview }) {
  const { segments, allTimed, allDistance, time } = overview;
  const peak = Math.max(1, ...segments.map(step => step.power || 0));
  const hasPower = segments.some(step => step.power !== null);
  return <div className="today-profile">
    <div className="today-profile-bars" role="img" aria-label="Intervallprofil des Workouts">
      {segments.map((step, index) => {
        const height = hasPower && step.power !== null ? Math.max(8, step.power / peak * 100) : HEIGHTS[step.intensity] || 50;
        const hard = ['active', 'interval'].includes(step.intensity);
        return <i key={index} className={hard ? 'hard' : ''} style={{ flexGrow: allTimed ? step.seconds : allDistance ? step.metres : 1, height: `${height}%` }} />;
      })}
    </div>
    {allTimed && <div className="today-profile-axis"><span>0:00</span><span>{hm(time / 60).replace(' h', '')}</span></div>}
  </div>;
}

function TodayPlan({ workout, onOpen }) {
  const overview = overviewOf(workout);
  const stats = [
    ['Dauer', planLength(workout) || '—'],
    overview?.distance > 0 && ['Distanz', km(overview.distance / 1000)],
    overview?.workTime > 0 && ['Belastung', hm(overview.workTime / 60)],
    overview?.averagePower != null && ['Ø Ziel', `${Math.round(overview.averagePower)} W`],
  ].filter(Boolean);
  return <article className="today-plan">
    <SportMark sport={workout.sport} suffix="geplant" />
    <div className="today-plan-head">
      <h3>{workout.name || 'Workout'}</h3>
      <dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
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

function DayRow({ label, title, sport, detail, onClick }) {
  return <button type="button" className="home-day-row" onClick={onClick}>
    <span className="home-day-label">{label}</span>
    <span className="home-day-title"><strong>{title}</strong><SportMark sport={sport} /></span>
    <span className="home-day-detail">{detail}</span>
  </button>;
}

function MiniHR({ data, w = 96, h = 28 }) {
  if (!data?.length) return null;
  const vals = data.filter((_, i) => i % 3 === 0).map(d => d.hr).filter(v => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals); const range = Math.max(...vals) - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} aria-hidden="true"><polyline points={pts} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.2" strokeLinejoin="round" /></svg>;
}

export default function Home({ apiBase, activities, plannedWorkouts, workoutLoadError, onReloadWorkouts, onOpenActivity, onOpenWorkout, onEditGoal, bestEffortsYear }) {
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

  const weekActs = week.flatMap(day => day.acts);
  const done = week.reduce((sum, day) => sum + day.done, 0);
  const target = week.reduce((sum, day) => sum + (day.future ? Math.max(day.done, day.planned) : day.done), 0);
  const openPlans = week.filter(day => day.future).reduce((sum, day) => sum + Math.max(0, day.plans.length - (day.key === todayKey ? day.acts.length : 0)), 0);
  const distance = weekActs.reduce((sum, a) => sum + (a.distance || 0), 0);
  const calories = weekActs.reduce((sum, a) => sum + (a.calories || 0), 0);
  const bySport = Object.entries(weekActs.reduce((map, a) => ({ ...map, [a.sport]: (map[a.sport] || 0) + (a.duration || 0) }), {}));
  const scale = Math.max(1, ...week.map(day => Math.max(day.done, day.planned)));

  const todayPlans = plannedWorkouts.filter(w => w.date === todayKey);
  const todayActs = week.find(day => day.key === todayKey)?.acts || [];
  const tomorrowPlans = plannedWorkouts.filter(w => w.date === tomorrowKey);
  const tomorrowActs = activities.filter(a => localDate(new Date(a.date)) === tomorrowKey);
  const upcoming = plannedWorkouts.filter(w => w.date > tomorrowKey).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const lede = todayPlans.length ? <>Heute steht <strong>{todayPlans[0].name || 'ein Workout'}</strong> auf dem Plan.</>
    : todayActs.length ? <>Heute hast du schon {todayActs.length === 1 ? 'eine Einheit' : `${todayActs.length} Einheiten`} absolviert.</>
    : <>Für heute ist nichts geplant.</>;

  return <div className="home">
    <section className="home-hero">
      <div className="home-hero-text">
        <p className="home-kicker">Kalenderwoche {Number(isoWeek(todayKey).split('-W')[1])} · Tag {(today.getDay() + 6) % 7 + 1} von 7</p>
        <h1>{today.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        <p className="home-lede">{lede} Diese Woche hast du <strong>{hm(done)}</strong> absolviert{target > done ? <> von geplanten <strong>{hm(target)}</strong></> : null}.</p>
      </div>
      <figure className="home-week" aria-label="Trainingszeit dieser Woche nach Tagen">
        <div className="home-week-bars">
          {week.map(day => <div key={day.key} title={`${day.label}: ${hm(day.done)} absolviert${day.future && day.planned ? `, ${hm(day.planned)} geplant` : ''}`}>
            {day.future && day.planned > 0 && <i className={`planned${day.key === todayKey ? ' today' : ''}`} style={{ height: `${day.planned / scale * 100}%` }} />}
            {day.done > 0 && <i className="done" style={{ height: `${day.done / scale * 100}%` }} />}
          </div>)}
        </div>
        <div className="home-week-labels">{week.map(day => <span key={day.key} className={day.key === todayKey ? 'today' : ''}>{day.label}</span>)}</div>
        <figcaption><span><i className="done" />absolviert</span><span><i className="planned" />geplant</span></figcaption>
      </figure>
    </section>

    <div className="home-grid">
      <div className="home-main">
        <section className="home-block" aria-labelledby="home-today">
          <div className="home-block-head"><h2 id="home-today">Heute</h2><button type="button" className="home-link" aria-label="Workout planen für heute" onClick={() => onOpenWorkout({ date: todayKey })}>Workout planen</button></div>
          <div className="home-today">
            {todayPlans.map(workout => <TodayPlan key={workout.id} workout={workout} onOpen={onOpenWorkout} />)}
            {todayActs.map(activity => <ActivityLine key={activity.id} activity={activity} onOpen={onOpenActivity} />)}
            {!todayPlans.length && !todayActs.length && <div className="home-empty">
              <p>Du hast heute keine geplanten Workouts.</p>
              <button type="button" className="home-button" onClick={() => onOpenWorkout({ date: todayKey })}>Workout hinzufügen</button>
            </div>}
          </div>
          <div className="home-tomorrow">
            {tomorrowPlans.map(workout => <DayRow key={workout.id} label="Morgen" title={workout.name || 'Workout'} sport={workout.sport} detail={planLength(workout)} onClick={() => onOpenWorkout(workout)} />)}
            {tomorrowActs.map(activity => <DayRow key={activity.id} label="Morgen" title={activity.title} sport={activity.sport} detail={`${hm(activity.duration)} · ${km(activity.distance)}`} onClick={() => onOpenActivity(activity)} />)}
            {!tomorrowPlans.length && !tomorrowActs.length && <div className="home-day-row home-day-empty">
              <span className="home-day-label">Morgen</span>
              <span className="home-muted">Noch nichts geplant.</span>
              <button type="button" className="home-link" aria-label="Workout planen für morgen" onClick={() => onOpenWorkout({ date: tomorrowKey })}>Workout planen</button>
            </div>}
            {upcoming.map(workout => <DayRow key={workout.id} label={shortDate(new Date(`${workout.date}T12:00:00`))} title={workout.name || 'Workout'} sport={workout.sport} detail={planLength(workout)} onClick={() => onOpenWorkout(workout)} />)}
          </div>
          {workoutLoadError && <p role="alert" className="home-error">{workoutLoadError} <button type="button" className="home-link" onClick={onReloadWorkouts}>Erneut laden</button></p>}
        </section>

        <section className="home-block" aria-labelledby="home-recent">
          <div className="home-block-head"><h2 id="home-recent">Letzte Aktivitäten</h2></div>
          {activities.length ? <div className="home-table">
            <div className="home-table-head" aria-hidden="true"><span>Datum</span><span>Einheit</span><span>Dauer</span><span>Distanz</span><span>Ø HF</span><span>Watt</span><span>Herzfrequenz</span></div>
            {activities.slice(0, 6).map(a => <button type="button" key={a.id} className="home-table-row" onClick={() => onOpenActivity(a)}>
              <span className="home-muted">{shortDate(new Date(a.date))}</span>
              <span className="home-table-title"><strong>{a.title}</strong><SportMark sport={a.sport} /></span>
              <span className="num">{hm(a.duration)}</span>
              <span className="num">{km(a.distance)}</span>
              <span className="num">{a.hrAvg ?? '—'}</span>
              <span className="num home-muted">{a.power ?? '—'}</span>
              <span><MiniHR data={a.timeSeries} /></span>
            </button>)}
          </div> : <p className="home-muted">Noch keine Aktivitäten. Über „Datei importieren“ eine FIT-Datei hochladen.</p>}
        </section>
      </div>

      <aside className="home-side">
        <section className="home-block" aria-labelledby="home-week-title">
          <div className="home-block-head"><h2 id="home-week-title">Diese Woche</h2></div>
          <div className="home-figures">
            <div><strong>{hm(done).replace(' h', '')}</strong><span>{target > done ? `Stunden von ${hm(target).replace(' h', '')}` : 'Stunden'}</span></div>
            <div><strong>{distance.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</strong><span>Kilometer</span></div>
            <div><strong>{weekActs.length}{openPlans > 0 && <small> / {weekActs.length + openPlans}</small>}</strong><span>Einheiten</span></div>
            <div><strong>{Math.round(calories).toLocaleString('de-DE')}</strong><span>kcal</span></div>
          </div>
          {bySport.length > 0 && <div className="home-split">
            <div className="home-split-bar">{bySport.map(([sport, minutes]) => <i key={sport} style={{ flexGrow: minutes, background: sportColor(sport) }} />)}</div>
            <div className="home-split-legend">{bySport.map(([sport, minutes]) => <span key={sport}><i style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport} {hm(minutes)}</span>)}</div>
          </div>}
        </section>
        <RaceGoal apiBase={apiBase} onEdit={onEditGoal} />
        <BestEfforts apiBase={apiBase} activities={activities} viewedYear={bestEffortsYear} onOpenActivity={onOpenActivity} />
      </aside>
    </div>
  </div>;
}
