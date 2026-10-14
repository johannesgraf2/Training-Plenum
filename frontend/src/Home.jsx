import React, { useEffect, useMemo, useState } from 'react';
import BestEfforts from './BestEfforts';
import RaceGoal from './RaceGoal';
import { isoWeek } from './AICoach';
import { imageUrl, useAppearance } from './appearance';
import { Icon, sportIcon } from './icons';
import { HomeLandscape } from './Landscape';
import { RecoveryHint, RecoveryTile, planningHint } from './Recovery';
import { SportMark, sportColor, sportLabels } from './sports';
import { localDate, summary as workoutSummary, workoutOverview } from './workoutModel';
import './Home.css';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const hm = minutes => { const total = Math.round(minutes || 0); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} h`; };
const km = value => value == null ? '—' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
const shortDate = date => date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const longDay = date => date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

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

function PlanCard({ workout, onOpen }) {
  const overview = overviewOf(workout);
  return <button type="button" className="plan-card" onClick={() => onOpen(workout)}>
    <span className="plan-card-top"><span className="plan-card-sport"><SportBadge sport={workout.sport} size={32} />{sportLabels[workout.sport] || workout.sport || 'Training'}</span><strong>{planLength(workout)}</strong></span>
    <span className="plan-card-title">{workout.name || 'Workout'}</span>
    {overview?.segments.length > 0 && <WorkoutProfile overview={overview} />}
  </button>;
}

function DayRow({ label, title, sport, detail, onClick }) {
  return <button type="button" className="home-day-row" onClick={onClick}>
    <span className="home-day-label">{label}</span>
    <span className="home-day-title"><strong>{title}</strong><SportMark sport={sport} /></span>
    <span className="home-day-detail">{detail}</span>
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

function WeekChart({ week, todayKey }) {
  const peak = Math.max(60, ...week.map(day => Math.max(day.done, day.planned)));
  const step = peak > 360 ? 2 : 1;
  const top = Math.ceil(peak / 60 / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => top - i * step);
  const pct = minutes => `${minutes / (top * 60) * 100}%`;
  const sports = [...new Set(week.flatMap(day => day.acts.map(a => a.sport)))];
  const anyPlanned = week.some(day => day.future && day.planned > day.done);
  return <>
    <div className="home-week-chart">
      <div className="home-week-axis" aria-hidden="true">{ticks.map(tick => <span key={tick}>{tick} h</span>)}</div>
      <div className="home-week-bars" style={{ '--rows': top / step }}>
        {week.map(day => {
          const rest = day.key === todayKey && !day.acts.length && !day.plans.length;
          return <div key={day.key} className={day.key === todayKey ? 'today' : ''}
            title={`${day.label}: ${hm(day.done)} absolviert${day.future && day.planned ? `, ${hm(day.planned)} geplant` : ''}`}>
            {day.future && day.planned > day.done && <i className="planned" style={{ height: pct(day.planned) }} />}
            {day.done > 0 && <span className="done" style={{ height: pct(day.done) }}>
              {minutesBySport(day.acts).map(([sport, minutes]) => <i key={sport} style={{ flexGrow: minutes, background: sportColor(sport) }} />)}
            </span>}
            {rest && <Icon name="moon" size={16} label="Ruhetag" className="home-week-rest" />}
          </div>;
        })}
      </div>
    </div>
    <div className="home-week-labels">{week.map(day => <span key={day.key} className={day.key === todayKey ? 'today' : ''}>{day.key === todayKey ? 'Heute' : day.label}</span>)}</div>
    <figcaption>
      {sports.map(sport => <span key={sport}><i style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport}</span>)}
      {anyPlanned && <span><i className="planned" />geplant</span>}
    </figcaption>
  </>;
}

export default function Home({ apiBase, activities, plannedWorkouts, workoutLoadError, onReloadWorkouts, onOpenActivity, onOpenWorkout, onEditGoal, bestEffortsYear,
  whoopDays = {}, onOpenWhoop, onOpenCoach }) {
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
  const tomorrowActs = activities.filter(a => localDate(new Date(a.date)) === tomorrowKey);
  const upcoming = plannedWorkouts.filter(w => w.date > tomorrowKey).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const tomorrowMinutes = tomorrowPlans.reduce((sum, w) => sum + plannedMinutes(w), 0);
  const hint = planningHint(whoopDays[todayKey], todayKey, plannedWorkouts);

  const lede = todayPlans.length ? <>Heute steht <strong>{todayPlans[0].name || 'ein Workout'}</strong> auf dem Plan.</>
    : todayActs.length ? <>Heute hast du schon {todayActs.length === 1 ? 'eine Einheit' : `${todayActs.length} Einheiten`} absolviert.</>
    : <>Heute ist Ruhetag.</>;
  const [weekday, ...dateParts] = longDay(today).split(', ');

  return <div className="home">
    <HeroBackdrop apiBase={apiBase} appearance={appearance} />
    <section className="home-hero">
      <div className="home-hero-text">
        <p className="home-kicker">
          <span className="home-week-pill">KW {Number(isoWeek(todayKey).split('-W')[1])}</span>
          <span>Tag {(today.getDay() + 6) % 7 + 1} von 7</span>
          {restDay && <><span aria-hidden="true">·</span><span className="home-kicker-rest">Ruhetag</span></>}
        </p>
        <h1><span>{weekday}, </span><em>{dateParts.join(', ')}</em></h1>
        <p className="home-lede">{lede} Diese Woche hast du <strong className="home-time">{hm(done)}</strong> absolviert{target > done ? <> von geplanten <strong className="home-time">{hm(target)}</strong></> : null}.</p>
      </div>
      <RaceGoal apiBase={apiBase} onEdit={onEditGoal} photo={imageUrl(apiBase, appearance.raceGoalImage)} />
    </section>

    <div className="home-grid">
      <div className="home-main">
        <section className="home-card home-block" aria-labelledby="home-today">
          <div className="home-block-head"><h2 id="home-today">Heute</h2><button type="button" className="home-link" aria-label="Workout planen für heute" onClick={() => onOpenWorkout({ date: todayKey })}>Workout planen<Icon name="arrow" size={14} /></button></div>
          <RecoveryHint hint={hint} onOpenWorkout={onOpenWorkout} onOpenCoach={onOpenCoach} />
          <div className="home-today">
            {todayPlans.map(workout => <TodayPlan key={workout.id} workout={workout} onOpen={onOpenWorkout} />)}
            {todayActs.map(activity => <ActivityLine key={activity.id} activity={activity} onOpen={onOpenActivity} />)}
            {restDay && <div className="home-rest">
              <span className="home-rest-icon"><Icon name="moon" size={26} /></span>
              <div><h3>Ruhetag</h3><p>{tomorrowPlans.length ? 'Keine Einheit geplant. Erholung gehört zum Plan – morgen geht’s weiter.' : 'Keine Einheit geplant. Erholung gehört zum Plan.'}</p></div>
              <button type="button" className="home-button" onClick={() => onOpenWorkout({ date: todayKey })}><Icon name="plus" size={14} />Workout hinzufügen</button>
            </div>}
          </div>
          <div className="home-tomorrow">
            <div className="home-subhead"><h3>Morgen</h3><span>{longDay(tomorrow)}{tomorrowMinutes > 0 && ` · ${hm(tomorrowMinutes)} geplant`}</span></div>
            {tomorrowPlans.length > 0 && <div className="plan-cards">{tomorrowPlans.map(workout => <PlanCard key={workout.id} workout={workout} onOpen={onOpenWorkout} />)}</div>}
            {tomorrowActs.map(activity => <DayRow key={activity.id} label="Morgen" title={activity.title} sport={activity.sport} detail={`${hm(activity.duration)} · ${km(activity.distance)}`} onClick={() => onOpenActivity(activity)} />)}
            {!tomorrowPlans.length && !tomorrowActs.length && <div className="home-day-row home-day-empty">
              <span className="home-muted">Noch nichts geplant.</span>
              <button type="button" className="home-link" aria-label="Workout planen für morgen" onClick={() => onOpenWorkout({ date: tomorrowKey })}>Workout planen</button>
            </div>}
          </div>
          {upcoming.length > 0 && <div className="home-upcoming">
            <div className="home-subhead"><h3>Demnächst</h3></div>
            {upcoming.map(workout => <DayRow key={workout.id} label={shortDate(new Date(`${workout.date}T12:00:00`))} title={workout.name || 'Workout'} sport={workout.sport} detail={planLength(workout)} onClick={() => onOpenWorkout(workout)} />)}
          </div>}
          {workoutLoadError && <p role="alert" className="home-error">{workoutLoadError} <button type="button" className="home-link" onClick={onReloadWorkouts}>Erneut laden</button></p>}
        </section>

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
          </div> : <p className="home-muted">Noch keine Aktivitäten. Über „Datei importieren / exportieren“ eine FIT-Datei hochladen.</p>}
        </section>
      </div>

      <aside className="home-side">
        <RecoveryTile days={whoopDays} todayKey={todayKey} onOpenWhoop={onOpenWhoop} />
        <figure className="home-week home-card" aria-label="Trainingszeit dieser Woche nach Tagen">
          <div className="home-week-head"><span>Wochenumfang</span><strong>{hm(done).replace(' h', '')}{target > done && <small> / {hm(target)}</small>}</strong></div>
          <WeekChart week={week} todayKey={todayKey} />
        </figure>
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
