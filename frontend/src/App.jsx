import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import ActivityDetail from './ActivityDetail';
import DataHub, { timeAgo } from './DataHub';
import Dashboard from './Dashboard';
import AICoach, { isoWeek } from './AICoach';
import { CheckInDialog, loadToday, shouldAskCheckIn } from './CoachToday';
import Home from './Home';
import UserMenu from './UserMenu';
import WhoopSync from './WhoopSync';
import { garminRequest } from './GarminSync';
import { ReadinessBadge, WeekRecovery, weekRecovery } from './Recovery';
import WorkoutEditor from './WorkoutEditor';
import { localDate, summary as workoutSummary, workoutTotals } from './workoutModel';
import './Calendar.css';
import { collectDroppedFiles } from './importQueue';
import { SportMark, sportColor, sportLabels } from './sports';
import './App.css';

// ─── API HELPER ───
const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';
// Drag payload for moving a planned workout between calendar days (distinct from file drops).
const WORKOUT_DRAG_TYPE = 'application/x-training-plenum-workout';

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    console.error('API Error:', e);
    throw e;
  }
}

// ─── FORMATTERS ───
const fmt = {
  dur: (m) => { if (m == null) return '—'; m = Math.round(m); const h = Math.floor(m / 60); const min = m % 60; return h ? `${h}h ${min}m` : `${min}m`; },
  durHM: (m) => { if (m == null) return '—'; const s = Math.round(m * 60); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); },
  date: (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }),
  dateFull: (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  time: (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
  timeAxis: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
  pace: (dist, dur) => dist > 0 ? `${(dur / dist).toFixed(1)}` : '—',
  num: (n) => n?.toLocaleString('de-DE') ?? '—',
  hours: (m) => { m = Math.round(m); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`; },
};


// ─── MAIN APP ───
export default function App() {
  const [activities, setActivities] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('home');
  const [selected, setSelected] = useState(null);
  // The data dialog: { view, selection } while open (see DataHub for the views).
  const [hub, setHub] = useState(null);
  const [garmin, setGarmin] = useState(null);
  const [showWhoop, setShowWhoop] = useState(false);
  const [whoopDays, setWhoopDays] = useState({});
  const whoopStamp = useRef(null);
  const [workoutEditor, setWorkoutEditor] = useState(null);
  const [plannedWorkouts, setPlannedWorkouts] = useState([]);
  const [workoutLoadError, setWorkoutLoadError] = useState('');
  const [draggedWorkout, setDraggedWorkout] = useState(null);
  const [dropDate, setDropDate] = useState(null);
  const [moveError, setMoveError] = useState('');
  const [toast, setToast] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [user, setUser] = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [coachTab, setCoachTab] = useState({ tab: 'today', version: 0 });
  // The morning check-in opens by itself on the first visit of the day; the coach and the start page share its result.
  const [today, setToday] = useState(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [todayVersion, setTodayVersion] = useState(0);
  const [coachAdjust, setCoachAdjust] = useState(0);
  // The coach stays mounted once opened, so a running proposal or week planning goes on while the athlete
  // looks at other pages. The nav shows that it is working, and that a result waits once it is done.
  const [coachOpened, setCoachOpened] = useState(false);
  const [coachBusy, setCoachBusy] = useState('');
  const [coachDone, setCoachDone] = useState(false);
  const coachVisible = page === 'coach' && !selected;

  const reloadActivities = useCallback(() => api('/api/activities').then(setActivities, () => {}), []);

  const openActivity = async (activity) => {
    setLoadError('');
    try {
      const full = activity.timeSeries ? activity : await api(`/api/activities/${activity.id}`);
      setSelected(full);
      window.location.hash = `activity/${full.id}`;
    } catch (error) { setLoadError('Aktivität konnte nicht geladen werden: ' + error.message); }
  };

  const deleteActivity = async (id) => {
    await api(`/api/activities/${id}`, { method: 'DELETE' });
    setActivities(current => current.filter(activity => activity.id !== id));
    setSelected(current => current?.id === id ? null : current);
    if (window.location.hash === `#activity/${id}`) window.location.hash = '';
    setToast('Aktivität gelöscht.');
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/user`).then(response => response.ok ? response.json() : null)
      .then(saved => { if (active && saved) setUser(saved); }, () => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const saved = await api('/api/activities');
        if (!active) return;
        setActivities(saved);
        const match = window.location.hash.match(/^#activity\/([\w-]+)$/);
        if (match) {
          const full = await api(`/api/activities/${match[1]}`);
          if (active) setSelected(full);
        }
      } catch (error) {
        if (active) setLoadError('Gespeicherte Aktivitäten konnten nicht geladen werden. ' + error.message);
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api('/api/workouts').then(saved => { if (active) setPlannedWorkouts(saved); })
      .catch(error => { if (active) setWorkoutLoadError('Geplante Workouts konnten nicht geladen werden. ' + error.message); });
    return () => { active = false; };
  }, []);

  // WHOOP recovery days for Today, the calendar and the dashboard. Optional: without
  // a strap (or when the request fails) every view works as before.
  const loadWhoop = useCallback(async () => {
    try {
      const status = await api('/api/whoop');
      const stamp = status?.analytics?.latest ? status.analytics.computedAt || 'computed' : null;
      if (stamp === whoopStamp.current) return;
      whoopStamp.current = stamp;
      if (!stamp) { setWhoopDays({}); return; }
      const first = new Date(); first.setDate(first.getDate() - 399);
      const data = await api(`/api/whoop/days?from=${localDate(first)}&to=${localDate(new Date())}`);
      setWhoopDays(Object.fromEntries((data.days || []).map(day => [day.date, day])));
    } catch { /* recovery data is an extra, not a requirement */ }
  }, []);
  useEffect(() => {
    loadWhoop();
    const timer = setInterval(loadWhoop, 5 * 60 * 1000);
    window.addEventListener('focus', loadWhoop);
    return () => { clearInterval(timer); window.removeEventListener('focus', loadWhoop); };
  }, [loadWhoop]);

  const onboardingPrompted = useRef(false);
  const refreshToday = useCallback(async ask => {
    try {
      const view = await loadToday(API);
      setToday(view);
      if (ask && view.onboardingRequired && !onboardingPrompted.current) {
        onboardingPrompted.current = true;
        setCheckInOpen(false); setPage('coach'); setSelected(null); window.location.hash = '';
      }
      if (ask && shouldAskCheckIn(view)) setCheckInOpen(true);
    } catch { /* the coach is optional; without it the app works as before */ }
  }, []);
  useEffect(() => {
    refreshToday(true);
    // A tab left open overnight asks again on the next morning.
    const onFocus = () => refreshToday(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshToday]);

  // Garmin Connect state for the header button. Optional like WHOOP: without it nothing changes.
  // New activities from the automatic sync or from loading the history show up without a reload.
  const garminStamp = useRef(null);
  const loadGarmin = useCallback(() => garminRequest(API).then(status => {
    const stamp = `${status.lastSyncAt}|${status.history?.result?.imported || 0}`;
    if (garminStamp.current !== null && garminStamp.current !== stamp) reloadActivities();
    garminStamp.current = stamp;
    setGarmin(status);
  }, () => {}), [reloadActivities]);
  useEffect(() => {
    loadGarmin();
    const timer = setInterval(loadGarmin, 5 * 60 * 1000);
    window.addEventListener('focus', loadGarmin);
    return () => { clearInterval(timer); window.removeEventListener('focus', loadGarmin); };
  }, [loadGarmin]);
  const garminChip = !garmin?.connected ? null
    : garmin.needsLogin ? { text: 'Garmin: neu anmelden', tone: 'bad' }
    : garmin.syncing ? { text: 'Garmin · läuft…' }
    : garmin.history?.running ? { text: 'Garmin · lädt nach…' }
    : garmin.lastSyncAt ? { text: `Garmin · ${timeAgo(garmin.lastSyncAt)}` } : null;
  const openHub = (view = 'overview', selection = null) => setHub({ view, selection });

  const reloadWorkouts = () => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); })
    .catch(error => setWorkoutLoadError(error.message));
  // Moves a planned workout to another day: shown immediately, reverted if the server refuses.
  const moveWorkout = async (id, date) => {
    const workout = plannedWorkouts.find(w => w.id === id);
    setDropDate(null); setDraggedWorkout(null);
    if (!workout || workout.locked || workout.date === date) return;
    setMoveError('');
    setPlannedWorkouts(current => current.map(w => w.id === id ? { ...w, date } : w));
    const { id: _id, locked: _locked, ...definition } = workout;
    try {
      const saved = await api(`/api/workouts/${id}`, { method: 'PUT', body: JSON.stringify({ ...definition, date }) });
      setPlannedWorkouts(current => current.map(w => w.id === id ? saved : w));
    } catch (error) {
      setPlannedWorkouts(current => current.map(w => w.id === id ? workout : w));
      setMoveError(`„${workout.name}“ konnte nicht verschoben werden. ${error.message}`);
    }
  };
  useEffect(() => { if (coachVisible) { setCoachOpened(true); setCoachDone(false); } }, [coachVisible]);
  const coachVisibleRef = useRef(coachVisible);
  coachVisibleRef.current = coachVisible;
  const coachBusyChanged = label => {
    setCoachBusy(label);
    if (!label && !coachVisibleRef.current) setCoachDone(true);
  };
  const openCoachPlan = () => { setCoachTab(t => ({ tab: 'today', version: t.version + 1 })); setPage('coach'); setSelected(null); window.location.hash = ''; };
  const checkInSaved = view => { setToday(view); setTodayVersion(v => v + 1); };
  const adjustAfterCheckIn = () => { setCheckInOpen(false); setCoachAdjust(v => v + 1); openCoachPlan(); };
  // Goal, events and availability live in the coach settings.
  const openCoachSettings = section => { setCoachTab(t => ({ tab: 'settings', section, version: t.version + 1 })); setPage('coach'); setSelected(null); window.location.hash = ''; };

  const todayStr = new Date().toDateString();

  // Calendar data
  // Build calendar as weekly rows (for TrainingPeaks-style layout with weekly summary sidebar)
  const calWeeks = useMemo(() => {
    const y = calMonth.getFullYear(); const m = calMonth.getMonth();
    const firstDay = (new Date(y, m, 1).getDay() + 6) % 7; // Monday start
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    // Build flat cells array
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const dayActs = activities.filter(a => { const ad = new Date(a.date); return ad.getFullYear() === y && ad.getMonth() === m && ad.getDate() === d; });
      const plans = plannedWorkouts.filter(workout => workout.date === localDate(date));
      cells.push({ date, day: d, activities: dayActs, plans });
    }
    // Pad end to fill last week
    while (cells.length % 7 !== 0) cells.push(null);

    // Split into weeks and compute summary per week
    const weeks = [];
    for (let w = 0; w < cells.length; w += 7) {
      const weekCells = cells.slice(w, w + 7);
      const weekActs = weekCells.filter(Boolean).flatMap(c => c.activities);
      const summary = {
        count: weekActs.length,
        duration: weekActs.reduce((s, a) => s + (a.duration || 0), 0),
        distance: weekActs.reduce((s, a) => s + (a.distance || 0), 0),
        elevation: weekActs.reduce((s, a) => s + (a.elevation || 0), 0),
        calories: weekActs.reduce((s, a) => s + (a.calories || 0), 0),
        bySport: {},
      };
      weekActs.forEach(a => {
        if (!summary.bySport[a.sport]) summary.bySport[a.sport] = { duration: 0, distance: 0, count: 0 };
        summary.bySport[a.sport].duration += a.duration || 0;
        summary.bySport[a.sport].distance += a.distance || 0;
        summary.bySport[a.sport].count += 1;
      });
      // Planned volume: time-based steps count as hours, distance-only steps are listed separately.
      const planned = { count: 0, duration: 0, distance: 0, bySport: {} };
      weekCells.filter(Boolean).flatMap(c => c.plans).forEach(workout => {
        const totals = workoutTotals(workout);
        planned.count += 1;
        planned.duration += totals.time / 60;
        planned.distance += totals.distance / 1000;
        planned.bySport[workout.sport] = (planned.bySport[workout.sport] || 0) + totals.time / 60;
      });
      weeks.push({ cells: weekCells, summary, planned });
    }
    return weeks;
  }, [calMonth, activities, plannedWorkouts]);
  // Years to pick in the calendar: from the first recorded or planned session up to next year.
  const calYears = useMemo(() => {
    const now = new Date().getFullYear();
    const years = [...activities.map(a => new Date(a.date).getFullYear()), ...plannedWorkouts.map(w => Number(String(w.date).slice(0, 4)))].filter(Number.isFinite);
    const first = Math.min(now - 1, calMonth.getFullYear(), ...years);
    const last = Math.max(now + 1, calMonth.getFullYear(), ...years);
    return Array.from({ length: last - first + 1 }, (_, i) => last - i);
  }, [activities, plannedWorkouts, calMonth]);
  // On a phone the calendar is a list of weeks; opening the current month starts at this week,
  // once the activities are in (they change the height above it), below the header if it stays on top.
  useEffect(() => {
    const now = new Date();
    if (loading || page !== 'calendar' || selected || calMonth.getFullYear() !== now.getFullYear() || calMonth.getMonth() !== now.getMonth()) return;
    if (!window.matchMedia?.('(max-width: 700px)').matches) return;
    const week = document.querySelector('.calendar-day.today')?.closest('.calendar-week');
    if (!week) return;
    const bar = document.querySelector('.app-header');
    const header = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
    window.scrollTo({ top: week.getBoundingClientRect().top + window.scrollY - header });
  }, [loading, page, selected, calMonth]);
  const maxSportDuration = Math.max(1, ...calWeeks.flatMap(w => Object.values(w.summary.bySport).map(sport => sport.duration)));

  // ─── RENDER ───
  return (
    <div className="app"
      onDragOver={event => { if (Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault(); }}
      onDrop={event => {
        event.preventDefault();
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        const selection = collectDroppedFiles(event.dataTransfer).then(files => ({ files }), error => ({ error }));
        setHub({ view: 'files', selection });
      }}>
      <header className="app-header">
        <div className="app-header-start">
          <span className="app-wordmark">Training <em>Plēnum</em></span>
          <nav aria-label="Hauptnavigation" className="app-nav">
            {[['home', 'Startseite'], ['calendar', 'Kalender'], ['dashboard', 'Dashboard'], ['coach', 'AI Coach']].map(([id, label]) => (
              <button key={id} type="button" aria-current={page === id && !selected ? 'page' : undefined}
                onClick={() => { setPage(id); setSelected(null); window.location.hash = ''; }}>{label}
                {id === 'coach' && coachBusy && !coachVisible && <span className="app-nav-status busy" role="img" title={coachBusy} aria-label={`Läuft: ${coachBusy}`} />}
                {id === 'coach' && !coachBusy && coachDone && <span className="app-nav-status done" role="img" title="Der Coach ist fertig" aria-label="Der Coach ist fertig" />}
              </button>
            ))}
          </nav>
        </div>
        <div className="app-header-end">
          <button type="button" className="app-import" onClick={() => openHub()}>
            Daten{garminChip && <small className={`app-import-status${garminChip.tone ? ` ${garminChip.tone}` : ''}`}>{garminChip.text}</small>}
          </button>
          <UserMenu apiBase={API} user={user}
            onSaved={(saved, changed) => { setUser(saved); if (changed) { setProfileVersion(v => v + 1); setToast('Profil gespeichert.'); setTimeout(() => setToast(null), 3000); } }}
            onOpenCoachProfile={() => openCoachSettings('events')} onOpenWhoop={() => setShowWhoop(true)} onOpenGarmin={() => openHub('garmin')} />
        </div>
      </header>

      {loading && <p role="status" className="app-notice">Aktivitäten werden geladen…</p>}
      {loadError && <div role="alert" className="app-notice app-notice-error">{loadError} <button type="button" onClick={() => window.location.reload()}>Erneut versuchen</button></div>}
      {!loading && !loadError && !activities.length && <p className="app-notice">Noch keine Aktivitäten.
        <button type="button" onClick={() => openHub('garmin')}>Garmin Connect verbinden</button>
        <button type="button" onClick={() => openHub('usb')}>Garmin per USB</button>
        <button type="button" onClick={() => openHub('files')}>Dateien importieren</button></p>}
      <main className={`app-main${page === 'calendar' && !selected ? ' app-main-wide' : ''}`}>
        {selected ? (
          <div style={{ padding: '20px 0' }}>
            <ActivityDetail key={selected.id} activity={selected} apiBase={API} onDelete={deleteActivity}
              onBack={() => { setSelected(null); window.location.hash = ''; }} />
          </div>
        ) : page === 'home' ? (
          <Home apiBase={API} activities={activities} plannedWorkouts={plannedWorkouts} workoutLoadError={workoutLoadError}
            onReloadWorkouts={reloadWorkouts} onOpenActivity={openActivity} onOpenWorkout={setWorkoutEditor}
            onEditGoal={() => openCoachSettings('events')} bestEffortsYear={calMonth.getFullYear()}
            whoopDays={whoopDays} onOpenWhoop={() => setShowWhoop(true)} onOpenCoach={openCoachPlan}
            today={today} onOpenCheckIn={() => setCheckInOpen(true)} user={user} />
        ) : page === 'calendar' ? (
          <div className="calendar">
            <div className="calendar-toolbar">
              <h2>{calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2>
              <div className="calendar-pickers">
                <select aria-label="Monat wählen" value={calMonth.getMonth()}
                  onChange={e => setCalMonth(new Date(calMonth.getFullYear(), +e.target.value, 1))}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{new Date(2026, i, 1).toLocaleDateString('de-DE', { month: 'long' })}</option>)}
                </select>
                <select aria-label="Jahr wählen" value={calMonth.getFullYear()}
                  onChange={e => setCalMonth(new Date(+e.target.value, calMonth.getMonth(), 1))}>
                  {calYears.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
              <div className="calendar-nav">
                <button type="button" onClick={() => { const now = new Date(); setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Heute</button>
                <button type="button" aria-label="Vorheriger Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}>‹</button>
                <button type="button" aria-label="Nächster Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}>›</button>
              </div>
            </div>

            {workoutLoadError && <p role="alert" className="calendar-error">{workoutLoadError} <button type="button" onClick={reloadWorkouts}>Erneut laden</button></p>}
            {moveError && <p role="alert" className="calendar-error">{moveError} <button type="button" onClick={() => setMoveError('')}>Schließen</button></p>}

            <div className="calendar-head">
              {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d}>{d}</div>)}
              <div>Woche</div>
            </div>

            {calWeeks.map((week, wi) => {
              const days = week.cells.filter(Boolean);
              const first = days[0].date, last = days[days.length - 1].date;
              const span = `${first.getDate()}.${first.getDate() === last.getDate() ? '' : `–${last.getDate()}.`} ${first.toLocaleDateString('de-DE', { month: 'short' })}`;
              return (
              <div key={wi} className="calendar-week">
                <div className="calendar-week-label">KW {Number(isoWeek(localDate(first)).split('-W')[1])} <span>{span}</span></div>
                {week.cells.map((cell, ci) => {
                  if (!cell) return <div key={`e${wi}-${ci}`} className="calendar-day-empty" />;
                  const isToday = cell.date.toDateString() === todayStr;
                  const cellDate = localDate(cell.date);
                  const carriesWorkout = event => Array.from(event.dataTransfer.types || []).includes(WORKOUT_DRAG_TYPE);
                  return (
                    <div key={`${wi}-${ci}`} className={`calendar-day${isToday ? ' today' : ''}${dropDate === cellDate ? ' calendar-drop-target' : ''}`}
                      data-date={cellDate} role="group" aria-label={`Kalendertag ${fmt.dateFull(cell.date)}`}
                      onDragOver={event => {
                        if (!carriesWorkout(event)) return;
                        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
                        if (dropDate !== cellDate) setDropDate(cellDate);
                      }}
                      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropDate(d => d === cellDate ? null : d); }}
                      onDrop={event => {
                        if (!carriesWorkout(event)) return;
                        event.preventDefault(); event.stopPropagation();
                        moveWorkout(event.dataTransfer.getData(WORKOUT_DRAG_TYPE), cellDate);
                      }}>
                      <div className="calendar-day-header">
                        <span className="calendar-day-weekday" aria-hidden="true">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][ci]}</span>
                        <span className="calendar-day-number">{isToday ? `Heute ${cell.day}` : cell.day === 1 ? `1. ${calMonth.toLocaleDateString('de-DE', { month: 'short' })}` : cell.day}</span>
                        <ReadinessBadge day={whoopDays[cellDate]} />
                        <button type="button" className="calendar-add-workout"
                          aria-label={`Workout am ${cell.date.toLocaleDateString('de-DE')} planen`}
                          title="Workout planen"
                          onClick={() => setWorkoutEditor({ date: localDate(cell.date) })}>+</button>
                      </div>

                      {cell.plans.map(workout => <button type="button" key={workout.id}
                        className={`calendar-planned-workout${draggedWorkout === workout.id ? ' dragging' : ''}`}
                        style={{ '--calendar-sport-color': sportColor(workout.sport) }}
                        aria-label={`${workout.name} am ${cell.date.toLocaleDateString('de-DE')} bearbeiten`}
                        draggable={!workout.locked}
                        title={workout.locked ? 'Wird behalten – im Plan des AI Coach lösen, um die Einheit zu verschieben' : 'Zum Verschieben auf einen anderen Tag ziehen'}
                        onDragStart={event => {
                          event.dataTransfer.setData(WORKOUT_DRAG_TYPE, workout.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggedWorkout(workout.id);
                        }}
                        onDragEnd={() => { setDraggedWorkout(null); setDropDate(null); }}
                        onClick={() => setWorkoutEditor(workout)}>
                        <span className="calendar-plan-heading">{sportLabels[workout.sport] || 'Training'} · <span className="calendar-plan-status">Geplant</span></span>
                        <strong>{workout.name}</strong><small>{workoutSummary(workout)}</small>
                      </button>)}

                      {cell.activities.map(a => (
                        <button type="button" key={a.id} className="calendar-activity" style={{ '--calendar-sport-color': sportColor(a.sport) }} onClick={() => openActivity(a)}>
                          <span className="calendar-plan-heading">{sportLabels[a.sport] || a.sport}</span>
                          <span className="calendar-activity-title">{a.title}</span>
                          <span className="calendar-activity-stats">{fmt.durHM(a.duration)} · {a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                          {(a.hrAvg || a.power) && <small>{[a.hrAvg && `Ø ${a.hrAvg} bpm`, a.power && `${a.power} W`].filter(Boolean).join(' · ')}</small>}
                        </button>
                      ))}
                    </div>
                  );
                })}

                <div className="calendar-summary">
                  <WeekRecovery summary={weekRecovery(week.cells.filter(Boolean).map(cell => localDate(cell.date)), whoopDays)} />
                  {week.planned.count > 0 && (
                    <div className="calendar-summary-planned" aria-label="Geplante Wochenstunden">
                      <div className="calendar-summary-planned-total"><span>Geplant</span><strong>{fmt.hours(week.planned.duration)}</strong></div>
                      <div className="calendar-summary-planned-meta">
                        {week.planned.count} {week.planned.count === 1 ? 'Einheit' : 'Einheiten'}
                        {week.planned.distance > 0 && ` · + ${week.planned.distance.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`}
                      </div>
                      {Object.keys(week.planned.bySport).length > 1 && Object.entries(week.planned.bySport).map(([sport, minutes]) => (
                        <div key={sport} className="calendar-summary-planned-sport">
                          <span className="sport-mark"><i aria-hidden="true" style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport}</span><span>{fmt.hours(minutes)}</span>
                        </div>
                      ))}
                      {week.summary.count > 0 && week.planned.duration > 0 && (
                        <div className="calendar-summary-progress" title={`${fmt.hours(week.summary.duration)} von ${fmt.hours(week.planned.duration)} absolviert`}>
                          <i style={{ width: `${Math.min(100, (week.summary.duration / week.planned.duration) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                  {week.summary.count > 0 ? (<>
                    {Object.entries(week.summary.bySport).map(([sport, data]) => (
                      <div key={sport} className="calendar-summary-sport">
                        <div><span className="sport-mark"><i aria-hidden="true" style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport}</span><strong>{data.distance.toFixed(1)} km</strong></div>
                        <div className="calendar-summary-bar"><i style={{ width: `${(data.duration / maxSportDuration) * 100}%`, background: sportColor(sport) }} /></div>
                      </div>
                    ))}
                    <dl>
                      {[
                        ['Dauer', fmt.durHM(week.summary.duration)],
                        ['Distanz', `${week.summary.distance.toFixed(1)} km`],
                        ...(week.summary.elevation > 0 ? [['Höhenmeter', `${fmt.num(week.summary.elevation)} m`]] : []),
                        ['Kalorien', `${fmt.num(week.summary.calories)} kcal`],
                      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                    </dl>
                  </>) : <p className="calendar-summary-empty">Keine Aktivitäten</p>}
                </div>
              </div>
              );
            })}
          </div>
        ) : page === 'coach' ? null : page === 'dashboard' ? (
          <div className="dashboard-page">
            <Dashboard key={profileVersion} apiBase={API} activities={activities} loading={loading} onOpenActivity={openActivity} onSettingsSaved={setUser} whoopDays={whoopDays} />

            <section className="activity-list" aria-labelledby="all-activities">
              <div className="activity-list-head">
                <h3 id="all-activities">Alle Aktivitäten</h3>
                <span>{activities.length} Einträge</span>
              </div>
              <div className="activity-list-grid activity-list-columns" aria-hidden="true">
                <span>Aktivität</span><span>Datum</span><span>Dauer</span><span>Distanz</span><span>Ø HF</span><span>Leistung</span><span>Quelle</span>
              </div>
              {activities.map(a => (
                <button type="button" key={a.id} className="activity-list-grid activity-list-row" onClick={() => openActivity(a)}>
                  <span className="activity-list-title"><span className="activity-list-name">{a.title}</span><SportMark sport={a.sport} /></span>
                  <span>{fmt.date(a.date)}</span>
                  <span>{fmt.dur(a.duration)}</span>
                  <span>{a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                  <span>{a.hrAvg ?? '—'}</span>
                  <span>{a.power != null ? `${a.power} W` : '—'}</span>
                  <span className="activity-list-source">{a.source}</span>
                </button>
              ))}
            </section>
          </div>
        ) : null}
        {coachOpened && <div hidden={!coachVisible}>
          <AICoach initialTab={coachTab.tab} initialSection={coachTab.section} tabVersion={coachTab.version} adjustVersion={coachAdjust} todayVersion={todayVersion}
            apiBase={API} workouts={plannedWorkouts} onOpenWorkout={setWorkoutEditor}
            onBusyChange={coachBusyChanged} onTodayChanged={setToday}
            onWorkoutsChanged={() => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); })} />
        </div>}
      </main>

      {workoutEditor && <WorkoutEditor apiBase={API} initial={workoutEditor.id ? workoutEditor : null} date={workoutEditor.date} ftp={user?.ftp} maxHr={user?.maxHr}
        onClose={() => setWorkoutEditor(null)}
        onSaved={workout => setPlannedWorkouts(current => [workout, ...current.filter(w => w.id !== workout.id)])}
        onDeleted={id => setPlannedWorkouts(current => current.filter(w => w.id !== id))}
        onImport={() => { setWorkoutEditor(null); openHub(); }} />}
      {hub && <DataHub apiBase={API} initialView={hub.view} initialSelection={hub.selection} activities={activities}
        workouts={plannedWorkouts} workoutLoadError={workoutLoadError}
        onImported={activity => setActivities(current => [activity, ...current.filter(a => a.id !== activity.id)].sort((a, b) => new Date(b.date) - new Date(a.date)))}
        onSynced={reloadActivities}
        onClose={imported => { setHub(null); loadGarmin(); if (imported) { setSelected(null); setPage('dashboard'); window.location.hash = ''; } }}
        onOpen={id => { setHub(null); loadGarmin(); openActivity({ id }); }} />}
      {checkInOpen && today && <CheckInDialog apiBase={API} today={today} onClose={() => setCheckInOpen(false)} onSaved={checkInSaved} onAdjust={adjustAfterCheckIn} />}
      {showWhoop && <WhoopSync apiBase={API} onClose={() => { setShowWhoop(false); loadWhoop(); }} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, background: 'var(--btn-bg)', color: 'var(--btn-fg)', padding: '12px 20px',
          borderRadius: 2, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.3s ease', zIndex: 2000
        }}>{toast}</div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}
