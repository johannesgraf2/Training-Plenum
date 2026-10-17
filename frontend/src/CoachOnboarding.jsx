import React, { useCallback, useEffect, useRef, useState } from 'react';
import DataHub, { garminSummary } from './DataHub';
import { useGarminStatus } from './GarminSync';
import WhoopSync from './WhoopSync';
import { KeyNotice, ProviderForm } from './CoachProvider';
import { Field, Progress, StepFooter, ThresholdFields, Tiles, thresholdChanges, thresholdDraft, thresholdProblem } from './OnboardingUI';
import { AvailabilityStep, BackgroundStep, CreatingStep, GoalStep, PeriodStep, PlanSportsStep, ReadyStep } from './PlanSteps';
import { STAGE_SPORTS, STEPS, startStep } from './coachOnboarding';
import './CoachOnboarding.css';

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const number = value => value === '' || value == null ? null : Number(value);

// --- Part A -------------------------------------------------------------------------------------

function SportsStep({ ctx }) {
  const { profile, background } = ctx.data;
  const offered = STAGE_SPORTS.map(([key]) => key);
  const fromData = new Set(background.recentSports);
  const [chosen, setChosen] = useState(() => {
    const data = offered.filter(sport => fromData.has(sport));
    return ctx.done('sports') || !data.length ? profile.sports.filter(sport => offered.includes(sport)) : data;
  });
  const toggle = sport => setChosen(list => list.includes(sport) ? list.filter(s => s !== sport) : offered.filter(s => s === sport || list.includes(s)));
  // Sports the onboarding does not offer yet stay in the profile.
  const save = () => ctx.complete('sports', { sports: [...chosen, ...profile.sports.filter(sport => !offered.includes(sport))] });
  return <>
    <h2>Deine Sportarten</h2>
    <p>Wähle die Sportarten aus, die du regelmäßig machst.</p>
    <Tiles label="Sportarten" items={STAGE_SPORTS} isOn={key => chosen.includes(key)} onToggle={toggle} note={key => fromData.has(key) ? 'aus deinen Daten' : null} />
    <p className="coach-muted">Schwimmen, XC Ski, Hyrox und Triathlon kommen dazu, sobald ihre Trainingsvorlagen fertig sind.</p>
    <StepFooter onNext={save} disabled={!chosen.length} busy={ctx.busy} />
  </>;
}

/** Garmin, WHOOP and files with their state; a dialog opens to connect or import. onChanged runs after a dialog closed,
 * onConnected learns whether any source is connected. */
export function SourceList({ apiBase, hasData, onChanged, onConnected }) {
  const [dialog, setDialog] = useState(null);
  const [whoop, setWhoop] = useState(null);
  const garmin = useGarminStatus(apiBase, onChanged);
  const loadWhoop = useCallback(() => fetch(`${apiBase}/api/whoop`).then(r => r.ok ? r.json() : null).then(setWhoop).catch(() => setWhoop(null)), [apiBase]);
  useEffect(() => { loadWhoop(); }, [loadWhoop]);
  const close = () => { setDialog(null); onChanged(); loadWhoop(); };
  const garminReady = garmin.status?.connected && !garmin.status.needsLogin;
  const sources = [
    { key: 'garmin', title: 'Garmin', gives: 'Aktivitäten, Workout-Export', connected: garminReady, text: garminSummary(garmin.status).text },
    { key: 'whoop', title: 'WHOOP', gives: 'Erholung, Schlaf', connected: !!whoop?.connected, text: whoop?.connected ? 'Verbunden' : 'Nicht verbunden' },
    { key: 'files', title: 'Dateien & Exporte', gives: 'FIT, GPX, TCX, TrainingPeaks, Strava-Export', connected: hasData,
      text: hasData ? 'Aktivitäten vorhanden' : 'Noch keine Aktivitäten' },
  ];
  const connected = sources.some(source => source.connected);
  useEffect(() => { onConnected?.(connected); }, [connected]);
  return <>
    <ul className="onboarding-sources">{sources.map(source => <li key={source.key}>
      <div><strong>{source.title}</strong><small>{source.gives}</small><span className={source.connected ? 'onboarding-ok' : ''}>{source.text}</span></div>
      <button type="button" onClick={() => setDialog(source.key)}>{source.connected ? 'Öffnen' : 'Verbinden'}</button>
    </li>)}</ul>
    {(dialog === 'garmin' || dialog === 'files') && <DataHub apiBase={apiBase} initialView={dialog} onClose={close} onOpen={close} onSynced={onChanged} />}
    {dialog === 'whoop' && <WhoopSync apiBase={apiBase} onClose={close} />}
  </>;
}

function SourcesStep({ ctx }) {
  const [connected, setConnected] = useState(false);
  return <>
    <h2>Verbinde deine Daten</h2>
    <p>Mit deinen Trainingsdaten füllt der Coach vieles vor und plant passender. Du kannst den Schritt auch überspringen; dann fragt er nach.</p>
    <SourceList apiBase={ctx.apiBase} hasData={ctx.data.background.hasData} onChanged={ctx.reloadBackground} onConnected={setConnected} />
    <StepFooter onBack={ctx.back} onNext={() => ctx.complete('sources')} nextLabel={connected ? 'Weiter' : 'Überspringen'} busy={ctx.busy} />
  </>;
}

function ThresholdsStep({ ctx }) {
  const { profile, user } = ctx.data;
  const sports = profile.sports.filter(sport => ['ride', 'run'].includes(sport));
  const [person, setPerson] = useState({ weight: user.weight ?? '', age: user.age ?? '', maxHr: user.maxHr ?? '' });
  const [draft, setDraft] = useState(() => thresholdDraft(ctx.data));
  const problem = thresholdProblem(draft, sports);
  const save = () => {
    const changes = thresholdChanges(draft, sports);
    ctx.complete('thresholds', { thresholds: changes.thresholds }, { weight: number(person.weight), age: number(person.age), maxHr: number(person.maxHr), ...changes.user });
  };
  return <>
    <h2>Deine Leistungsdaten</h2>
    <p>Damit rechnet der Coach deine Trainingsbereiche. Fehlt ein Wert, trägst du ihn selbst ein oder lässt ihn in der ersten Planwoche testen.</p>
    <div className="coach-form-grid onboarding-person">
      <Field label="Gewicht (kg)"><input type="number" min="20" max="300" step="0.1" value={person.weight} onChange={e => setPerson(p => ({ ...p, weight: e.target.value }))} /></Field>
      <Field label="Alter"><input type="number" min="1" max="120" step="1" value={person.age} onChange={e => setPerson(p => ({ ...p, age: e.target.value }))} /></Field>
      <Field label="Max. Herzfrequenz"><input type="number" min="60" max="250" step="1" value={person.maxHr} onChange={e => setPerson(p => ({ ...p, maxHr: e.target.value }))} /></Field>
    </div>
    <ThresholdFields draft={draft} sports={sports} onChange={setDraft} />
    {problem && <p className="coach-muted" role="note">{problem}</p>}
    <StepFooter onBack={ctx.back} onNext={save} disabled={!!problem} busy={ctx.busy} />
  </>;
}

function ProviderStep({ ctx }) {
  const { provider } = ctx.data;
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  return <>
    <h2>Dein AI-Provider</h2>
    <p>Deine Anfragen laufen über deinen eigenen Zugang und werden dort abgerechnet.</p>
    <KeyNotice provider={provider} />
    <ProviderForm provider={provider} disabled={!!ctx.busy} request={ctx.request} run={ctx.run} dirty={dirty} showCost
      onEdit={() => { setDirty(true); setNotice(''); }}
      onSaved={saved => { ctx.update({ provider: saved }); setDirty(false); setNotice('Provider gespeichert. Teste jetzt die Verbindung.'); }}
      onTested={() => setNotice('Verbindung zum Provider erfolgreich.')}
      onRemoved={saved => { ctx.update({ provider: { ...provider, ...saved, configured: false, keyLast4: null } }); setDirty(false); setNotice('API Key entfernt.'); }}>
      {notice && <div role="status" className="coach-message success">{notice}</div>}
    </ProviderForm>
    {!provider.configured && <p className="coach-muted">Ohne Provider kannst du weitermachen. Vor „Plan erstellen“ brauchst du ihn aber.</p>}
    <StepFooter onBack={ctx.back} onNext={() => ctx.complete('provider')} nextLabel={provider.configured ? 'Weiter' : 'Überspringen'} busy={ctx.busy} />
  </>;
}

const PAGES = { sports: SportsStep, sources: SourcesStep, thresholds: ThresholdsStep, provider: ProviderStep, background: BackgroundStep, goal: GoalStep,
  planSports: PlanSportsStep, period: PeriodStep, availability: AvailabilityStep, ready: ReadyStep, creating: CreatingStep };

// The guided onboarding: part A (athlete profile) and part B (create the plan), one step per screen.
// Every step saves its inputs, so closing loses nothing and the wizard resumes at the first open step.
export default function CoachOnboarding({ apiBase = '', onClose, onCreated }) {
  const [data, setData] = useState(null);
  const [step, setStep] = useState(null);
  const [returnTo, setReturnTo] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const sheet = useRef(null);
  const drafts = useRef({});

  const request = useCallback(async (path, method = 'GET', body) => {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || `Anfrage fehlgeschlagen (${response.status}).`), { status: response.status, data: result });
    return result;
  }, [apiBase]);
  const run = useCallback(async (label, action) => {
    if (pending.current) return false;
    pending.current = true; setBusy(label); setError('');
    try { await action(); return true; } catch (e) { setError(e.message || 'Die Anfrage konnte nicht abgeschlossen werden.'); return false; }
    finally { pending.current = false; setBusy(''); }
  }, []);
  const tz = `timezone=${encodeURIComponent(timezone())}`;

  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.all(['/api/athlete-profile', '/api/user', '/api/ai-provider', `/api/coach/onboarding?${tz}`, '/api/coach/events', '/api/coach/plan/settings',
      '/api/coach/thresholds', `/api/athlete-snapshot?${tz}`].map(path => request(path)))
      .then(([profile, user, provider, background, events, settings, thresholds, snapshot]) => {
        if (cancelled) return;
        setData({ profile, user, provider, background, events: events.events, settings: settings.settings, thresholds, snapshot });
        setStep(current => current || startStep(profile, provider));
      })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // A retry loads everything again.
  }, [request, attempt]);
  useEffect(() => { sheet.current?.scrollTo?.({ top: 0 }); }, [step]);

  const update = patch => setData(d => ({ ...d, ...patch }));
  const reloadBackground = useCallback(() => request(`/api/coach/onboarding?${tz}`).then(background => setData(d => d && { ...d, background })).catch(() => {}), [request]);
  const go = (target, back = null) => { setError(''); setReturnTo(back); setStep(target); };
  const next = from => {
    if (returnTo) return go(returnTo);
    const index = STEPS.findIndex(s => s.id === from);
    go(STEPS[index + 1]?.id || 'creating');
  };
  const back = () => { const index = STEPS.findIndex(s => s.id === step); if (index > 0) go(STEPS[index - 1].id); };
  const done = id => (data.profile.onboarding?.completed || []).includes(id);
  // Saves the step's profile changes (and athlete settings), marks it done and moves on.
  const saveProfile = async (patch, id) => {
    const completed = [...new Set([...(data.profile.onboarding?.completed || []), ...(id ? [id] : [])])];
    const profile = await request('/api/athlete-profile', 'PUT', { ...patch, ...(id ? { onboarding: { completed } } : {}) });
    setData(d => ({ ...d, profile }));
    return profile;
  };
  const complete = (id, patch = {}, user = null) => run('Wird gespeichert …', async () => {
    if (user) { const saved = await request('/api/user', 'PUT', user); setData(d => ({ ...d, user: saved })); }
    await saveProfile(patch, id);
    next(id);
  });
  const close = () => { if (!busy) onClose(); };

  const ctx = data && { drafts: drafts.current, apiBase, data, request, run, busy, update, reloadBackground, go, back, done, complete, saveProfile, onCreated,
    returning: !!returnTo, setError };
  const Page = step && PAGES[step];
  return <div className="onboarding-backdrop" onKeyDown={event => { if (event.key === 'Escape' && event.target.closest('.onboarding-sheet')) close(); }}>
    <section ref={sheet} className="onboarding-sheet" role="dialog" aria-modal="true" aria-label="Plan bauen">
      <header className="onboarding-header">
        {step && step !== 'creating' ? <Progress step={step} /> : <span className="coach-eyebrow">Dein Plan</span>}
        <button type="button" className="onboarding-close" disabled={!!busy || step === 'creating'} onClick={close} aria-label="Schließen, später weitermachen">×</button>
      </header>
      {error && <div role="alert" className="coach-message error">{error}{!data && <button type="button" onClick={() => setAttempt(a => a + 1)}>Erneut laden</button>}</div>}
      {busy && <div role="status" className="coach-message"><span className="coach-spinner" />{busy}</div>}
      {!data && !error && <p role="status" className="coach-muted">Deine Daten werden geladen …</p>}
      {ctx && Page && <div className="onboarding-step" key={step}><Page ctx={ctx} /></div>}
    </section>
  </div>;
}
