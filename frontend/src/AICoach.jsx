import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDate } from './workoutModel';
import CoachOnboarding from './CoachOnboarding';
import CoachChat from './CoachChat';
import CoachPlan from './CoachPlan';
import CoachSettings, { SECTIONS } from './CoachSettings';
import { CheckInDialog, HintCards, InjuryList, Outlook, PeriodHeader, QuickActions, ReadinessCard, TodaySessions, healInjury, loadToday } from './CoachToday';
import { jobState } from './coachOnboarding';
import './AICoach.css';

export const GOALS = { event: 'Wettkampf / Event', performance: 'Leistung steigern', fitness: 'Allgemeine Ausdauer' };
// Goal types of earlier profiles, before the goal became sport-neutral.
const GOAL_ALIASES = { cycling_event: 'event', running_event: 'event', marathon: 'event', ftp: 'performance', endurance: 'fitness', general_endurance: 'fitness' };
const EVENT_LABELS = { ride: 'Radsport-Event', run: 'Laufwettkampf', swim: 'Schwimmwettkampf' };
const LEGACY_SPORTS = { cycling_event: ['ride'], running_event: ['run'], marathon: ['run'] };
// An event is named after its sport, so the goal reads "Radsport-Event" or "Triathlon".
export function goalLabel(type, sports) {
  const key = GOAL_ALIASES[type] || type;
  const chosen = sports?.length ? sports : LEGACY_SPORTS[type] || [];
  if (key !== 'event') return GOALS[key];
  return chosen.length === 3 ? 'Triathlon' : chosen.length === 1 ? EVENT_LABELS[chosen[0]] : 'Wettkampf';
}
// The coach has three areas; the former tabs open where their content lives now.
const TABS = [['today', 'Heute'], ['plan', 'Plan'], ['settings', 'Einstellungen']];
const FORMER_TABS = { week: ['plan'], season: ['plan'], review: ['plan'], profile: ['settings', 'profile'], provider: ['settings', 'provider'] };
const place = (tab, section) => {
  const [area, part] = FORMER_TABS[tab] || [TABS.some(([key]) => key === tab) ? tab : 'today'];
  return { tab: area, section: SECTIONS.some(([key]) => key === section) ? section : part || 'profile' };
};
const POLL_MS = 1500;
const EMPTY_WORKOUTS = [];
const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `timezone=${encodeURIComponent(timezone())}`;
const ADAPTING = 'Der Coach passt deinen Plan an …';

export function isoWeek(date = localDate()) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  // Whole days since 1 January; d is at noon, so the half day must not round a full week up.
  const week = Math.ceil((Math.floor((d - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekStart(week) {
  const [year, weekNumber] = week.split('-W').map(Number);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (weekNumber - 1) * 7);
  return d.toISOString().slice(0, 10);
}

// Without a plan, Heute invites to build it; a started onboarding continues.
function OnboardingStart({ profile, onStart }) {
  const started = (profile.onboarding?.completed || []).some(step => step !== 'created');
  return <section className="coach-card coach-onboarding-start" aria-label="Plan bauen">
    <span className="coach-eyebrow">Ca. 5 Minuten</span><h2>Lass uns deinen Plan bauen</h2>
    <p className="coach-muted">Sportarten, Leistungsdaten, Ziel und Zeitfenster – danach legt der Coach Phasen fest und plant die ersten 3 Wochen.</p>
    <div className="coach-actions"><button type="button" className="coach-primary" onClick={onStart}>{started ? 'Weitermachen' : "Los geht's"}</button></div>
  </section>;
}

export default function AICoach({ initialTab = 'today', initialSection, tabVersion = 0, adjustVersion = 0, todayVersion = 0, apiBase = '', workouts = EMPTY_WORKOUTS,
  onWorkoutsChanged, onOpenWorkout, onBusyChange, onTodayChanged }) {
  const [view, setView] = useState(() => place(initialTab, initialSection));
  // The app keeps the coach mounted between pages; a new tabVersion asks it to show initialTab again.
  const shownTabVersion = useRef(tabVersion);
  useEffect(() => {
    if (shownTabVersion.current === tabVersion) return;
    shownTabVersion.current = tabVersion; setView(place(initialTab, initialSection));
  }, [tabVersion, initialTab, initialSection]);
  const { tab, section } = view;
  const setTab = (next, part) => setView(v => ({ tab: next, section: part || v.section }));
  const [profile, setProfile] = useState(null);
  const [provider, setProvider] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayView, setDayView] = useState(null);  // The day view: check-in, traffic light, period and sessions.
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [reloads, setReloads] = useState(0);  // A finished or closed onboarding loads the coach again.
  const [chat, setChat] = useState(null);  // The open coach chat: {ref, message, key}.
  const [job, setJob] = useState(null);  // Rolling replanning or adapting the plan, read with jobState.
  const [planProposal, setPlanProposal] = useState(null);  // An adjustment of the worked-out weeks after a job.
  const [reviewWeek, setReviewWeek] = useState(null);
  const [planVersion, setPlanVersion] = useState(0);
  const [adaptPending, setAdaptPending] = useState([]);  // Changed settings the athlete has not answered "Plan anpassen?" for.
  const jobTimer = useRef(null);
  const pending = useRef(false);

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || data.message || `Anfrage fehlgeschlagen (${response.status}).`), { status: response.status, data });
    return data;
  }
  async function run(label, action) {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e.message || 'Die Anfrage konnte nicht abgeschlossen werden.'); }
    finally { pending.current = false; setBusy(''); }
  }
  const adapting = job?.kind === 'adapt' && job.status === 'running';
  useEffect(() => { onBusyChange?.(busy || (adapting ? ADAPTING : '')); }, [busy, adapting]);
  useEffect(() => () => clearTimeout(jobTimer.current), []);
  // Answers can arrive out of order while a job runs next to the athlete's changes: keep the newest plan.
  const keepNewer = next => setPlan(p => (p?.revision ?? -1) > next.revision ? p : next);
  async function afterPlanChange() {
    keepNewer(await request('/api/coach/plan')); setPlanVersion(v => v + 1);
    await Promise.resolve(onWorkoutsChanged?.()).catch(() => {});
  }
  // Replanning and adapting run on the server; the coach follows the job and shows the result when it is done.
  function followJob(data) {
    const kind = data.kind || 'advance';
    const state = { ...jobState({ job: data }), kind };
    setJob(state);
    clearTimeout(jobTimer.current);
    if (state.status === 'running' && state.id) {
      jobTimer.current = setTimeout(() => request(`/api/coach/plan/${kind === 'adapt' ? 'adapt' : 'advance'}/${encodeURIComponent(state.id)}`)
        .then(next => followJob(next.job), e => setJob({ ...state, status: 'failed', error: e.message })), POLL_MS);
    } else if (state.status === 'done') {
      const result = data.result || {};
      if (kind === 'adapt') {
        setNotice(result.proposalId ? `${result.frameChanged ? 'Phasen neu festgelegt. ' : ''}Prüfe unten die Anpassung deiner ausgearbeiteten Wochen.`
          : `${result.frameChanged ? 'Phasen neu festgelegt. ' : ''}Die ausgearbeiteten Wochen passen weiter zu deinen Einstellungen.`);
      } else setNotice(`Woche ${result.weekNumber} geplant – ${fmt(result.calculatedHours)} h${result.focus ? `, Fokus ${result.focus}` : ''}.`);
      if (result.proposalId) setPlanProposal(result.proposalId);
      afterPlanChange().catch(() => {});
    } else if (state.status === 'failed') {
      setError(`${kind === 'adapt' ? 'Der Plan konnte nicht angepasst werden' : 'Die nächste Woche konnte nicht geplant werden'}: ${state.error || 'unbekannter Fehler'}`);
    }
  }
  function startJob(path, body, quiet) {
    request(`${path}?${tzQuery()}`, 'POST', body)
      .then(data => { if (data.job) followJob(data.job); }, e => { if (e.status === 409 && e.data?.job) followJob(e.data.job); else if (!quiet) setError(e.message); });
  }
  const startAdvance = trigger => startJob('/api/coach/plan/advance', { trigger }, trigger === 'auto');
  function startAdapt(changes) {
    setTab('plan'); setError(''); setNotice(''); setAdaptPending([]);
    startJob('/api/coach/plan/adapt', { changes: [...new Set([...changes, ...adaptPending])] });
  }
  function openChat(ref = null, message = null) { setChat({ ref, message, key: Date.now() }); }

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([request('/api/athlete-profile'), request('/api/ai-provider'), request(`/api/coach/plan?${tzQuery()}`)])
      .then(([p, ai, saved]) => {
        if (cancelled) return;
        setProfile(p); setProvider(ai); setPlan(saved);
        // There is no server scheduler: opening the coach works out a week that is due by the replan mode.
        if (saved.frame?.status === 'active' && ai.configured) startAdvance('auto');
      })
      .catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // apiBase selects the backend; individual writes refresh their own state.
  }, [apiBase, reloads]);

  const workoutsById = useMemo(() => Object.fromEntries(workouts.map(workout => [workout.id, workout])), [workouts]);
  const planActive = plan?.frame?.status === 'active';
  const planToday = planActive && !!dayView?.period?.planWeek;
  const todaySession = (dayView?.sessions || []).find(session => session.source === 'coach');
  const todayRef = todaySession ? { kind: 'session', week: isoWeek(dayView.date), sessionId: todaySession.id, label: `Heute · ${todaySession.name}` }
    : dayView ? { kind: 'week', week: isoWeek(dayView.date), sessionId: null, label: 'Diese Woche' } : null;
  // The day view follows plan and calendar changes and check-ins saved elsewhere in the app.
  async function refreshToday() {
    try { const next = await loadToday(apiBase); setDayView(next); onTodayChanged?.(next); return next; } catch (_) { return null; }
  }
  useEffect(() => { if (!loading) refreshToday(); }, [apiBase, loading, todayVersion, plan?.revision, workouts]);
  function savedCheckIn(next) { setDayView(next); onTodayChanged?.(next); }
  // Changes to the day go through the coach chat; without a plan the plan area invites to build one.
  function adjustToToday() {
    if (!planActive) { setTab('plan'); return; }
    setTab('today'); openChat(todayRef, null);
  }
  // The app asks for an adjustment after the morning check-in; it starts once the coach has loaded.
  const shownAdjust = useRef(0);
  const [adjustPending, setAdjustPending] = useState(false);
  useEffect(() => { if (adjustVersion !== shownAdjust.current) { shownAdjust.current = adjustVersion; setAdjustPending(true); } }, [adjustVersion]);
  useEffect(() => {
    if (!adjustPending || loading || !plan) return;
    setAdjustPending(false); adjustToToday();
  }, [adjustPending, loading, plan]);
  async function heal(injury) {
    await run('Beschwerde wird aktualisiert …', async () => {
      const next = await healInjury(apiBase, injury.id); setDayView(next); onTodayChanged?.(next);
      setNotice(`${injury.label} als ausgeheilt gespeichert.`);
    });
  }
  // Settings were saved: profile, plan and day view follow.
  function settingsChanged() {
    request('/api/athlete-profile').then(setProfile).catch(() => {});
    afterPlanChange().catch(() => {});
  }
  const restartOnboarding = async () => {
    const completed = (profile.onboarding?.completed || []).filter(step => !['period', 'ready', 'created'].includes(step));
    setProfile(await request('/api/athlete-profile', 'PUT', { onboarding: { completed } }));
  };
  async function endPlan() {
    await run('Plan wird beendet …', async () => {
      const result = await request(`/api/coach/plan/reset?${tzQuery()}`, 'POST', {});
      setPlan(result); setPlanProposal(null); setChat(null); setPlanVersion(v => v + 1); setAdaptPending([]);
      await restartOnboarding();
      await Promise.resolve(onWorkoutsChanged?.()).catch(() => {});
      setNotice(`Plan beendet.${result.deletedWorkouts ? ` ${result.deletedWorkouts} ${result.deletedWorkouts === 1 ? 'Workout wurde' : 'Workouts wurden'} aus dem Kalender entfernt.` : ''} Vergangene Wochen bleiben im Verlauf.`);
    });
  }
  // A new plan starts the onboarding again at the period, with everything else already filled in.
  async function newPlan() {
    await run('Neuer Plan wird vorbereitet …', async () => {
      if (planActive) {
        setPlan(await request(`/api/coach/plan/reset?${tzQuery()}`, 'POST', {})); setPlanProposal(null); setChat(null); setAdaptPending([]);
        await Promise.resolve(onWorkoutsChanged?.()).catch(() => {});
      }
      await restartOnboarding();
      setOnboarding(true);
    });
  }

  const messages = <>
    {error && <div role="alert" className="coach-message error">{error}{!profile && !loading && <button onClick={() => window.location.reload()}>Erneut laden</button>}</div>}
    {notice && <div role="status" className="coach-message success">{notice}</div>}
    {busy && <div role="status" className="coach-message"><span className="coach-spinner" />{busy}</div>}
  </>;

  return <div className="ai-coach">
    <header className="coach-heading"><div><span className="coach-eyebrow">Training Plēnum / Dein Training, mit Kontext</span><h1>AI Coach <span className="coach-beta">BYOK</span></h1><p>Deine Trainingsdaten. Deine Ziele. Ein Plan, den du freigibst.</p></div><button type="button" className={`coach-connection ${provider?.configured ? 'ready' : ''}`} title="AI Provider und Modell einstellen" onClick={() => setTab('settings', 'provider')}><i />{provider?.configured ? `Provider verbunden · ${provider.model}` : 'Provider einrichten'}</button></header>
    <nav className="coach-tabs" aria-label="AI Coach Bereiche">{TABS.map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}{key === 'today' && dayView && !dayView.checkIn && dayView.dailyCheckIn && <span className="coach-tab-dot" aria-label="Check-in offen" />}</button>)}</nav>
    {messages}
    {loading && <p role="status" className="coach-muted">Athletenkontext wird geladen …</p>}

    {!loading && profile && tab === 'today' && <>
      {!planActive && <OnboardingStart profile={profile} onStart={() => setOnboarding(true)} />}
      {dayView ? <>
        <section className="coach-card coach-today-period"><PeriodHeader today={dayView} /></section>
        {dayView.checkIn ? <ReadinessCard readiness={dayView.readiness} time="heute">
          <div className="coach-actions"><button type="button" disabled={!!busy} onClick={() => setCheckInOpen(true)}>Check-in ändern</button></div>
          {planToday && <QuickActions level={dayView.readiness.level} disabled={!!busy} onAsk={message => openChat(todayRef, message)} />}
        </ReadinessCard> : <div className="coach-message coach-checkin-open"><span><strong>Dein Morgen-Check-in fehlt noch.</strong> Mit ihm weiß der Coach, wie es dir heute geht.</span><button type="button" disabled={!!busy} onClick={() => setCheckInOpen(true)}>Check-in ausfüllen</button></div>}
        {planToday && <HintCards hints={dayView.hints} onReview={key => { setReviewWeek({ week: key, key: Date.now() }); setTab('plan'); }} onPlan={() => setTab('plan')} />}
        <section className="coach-card"><span className="coach-eyebrow">Heute</span><TodaySessions sessions={dayView.sessions} />
          <div className="coach-actions"><button type="button" onClick={() => setTab('plan')}>Zum Plan</button></div></section>
        {planToday && <Outlook days={dayView.outlook} />}
        <InjuryList injuries={dayView.injuries} busy={!!busy} onHeal={heal} />
      </> : <p role="status" className="coach-muted">Dein Tag wird geladen …</p>}
    </>}

    {!loading && profile && tab === 'plan' && <CoachPlan apiBase={apiBase} version={`${plan?.revision ?? ''}-${planVersion}`} workoutsById={workoutsById} advance={job}
      proposalId={planProposal} reviewWeek={reviewWeek} pendingChanges={adaptPending} onAsk={openChat} onStart={() => setOnboarding(true)} onAdvance={() => startAdvance('manual')}
      onAdapt={startAdapt} onJob={followJob} onChanged={() => afterPlanChange().catch(e => setError(e.message))} onOpenWorkout={onOpenWorkout} />}

    {!loading && profile && tab === 'settings' && <CoachSettings apiBase={apiBase} section={section} onSection={part => setTab('settings', part)} planActive={planActive}
      provider={provider} pending={adaptPending} onPending={setAdaptPending} onProvider={setProvider} onChanged={settingsChanged} onAdapt={startAdapt} onEndPlan={endPlan} onNewPlan={newPlan} />}

    {checkInOpen && dayView && <CheckInDialog apiBase={apiBase} today={dayView} onClose={() => setCheckInOpen(false)} onSaved={savedCheckIn}
      onAdjust={planActive ? () => { setCheckInOpen(false); adjustToToday(); } : undefined} />}
    {onboarding && <CoachOnboarding apiBase={apiBase} onClose={() => { setOnboarding(false); setReloads(n => n + 1); }}
      onCreated={() => { setOnboarding(false); setTab('plan'); setReloads(n => n + 1); onWorkoutsChanged?.(); }} />}
    {!loading && planActive && ['today', 'plan'].includes(tab) && !chat && <button type="button" className="coach-ask" onClick={() => openChat()}>Coach fragen</button>}
    {chat && <CoachChat apiBase={apiBase} providerReady={!!provider?.configured} start={chat} onClose={() => setChat(null)}
      onProviderSettings={() => { setChat(null); setTab('settings', 'provider'); }}
      onChanged={async () => { await afterPlanChange(); refreshToday(); }} />}
  </div>;
}
