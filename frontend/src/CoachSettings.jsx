import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SourceList } from './CoachOnboarding.jsx';
import { KeyNotice, ProviderForm } from './CoachProvider';
import { DateField, Field, ThresholdFields, Tiles, thresholdChanges, thresholdDraft, thresholdProblem } from './OnboardingUI';
import { EventForm, EventList, WeekPanel, WindowEditor, fittedWish, planSports, weekDraft, weekProblem, weekValues } from './PlanSteps';
import { GOALS, METRICS, SPORT_NAMES, STAGE_SPORTS, dateLabel, lastAEvent, newId, splitEvents, weeksLabel } from './coachOnboarding';
import { localDate } from './workoutModel';
import './CoachOnboarding.css';

// The settings of the coach: the editors of the onboarding, one section at a time. Changes that matter for the plan
// (availability, events, thresholds, sports, plan end) end with "Soll ich deinen Plan daran anpassen?".

export const SECTIONS = [['profile', 'Athletenprofil'], ['training', 'Sportarten im Plan'], ['thresholds', 'Leistungsdaten'],
  ['availability', 'Verfügbarkeiten'], ['events', 'Events & Ziele'], ['sources', 'Datenquellen'], ['provider', 'AI-Provider'],
  ['behavior', 'Coach-Verhalten'], ['plan', 'Plan']];
const AREA_NAMES = { availability: 'deine Verfügbarkeiten', events: 'deine Events', thresholds: 'deine Leistungsdaten', sports: 'die Sportarten im Plan',
  period: 'das Planende' };
const REPLAN_MODES = [['afterReview', 'Nach meinem Wochenrückblick', 'Die nächste Woche wird ausgearbeitet, sobald du den Rückblick abschickst. Fehlt er bis Montag 06:00, plant der Coach ohne ihn.'],
  ['sunday', 'Automatisch Sonntagabend', 'Ab Sonntag 18:00 plant der Coach die nächste Woche, ohne auf den Rückblick zu warten.'],
  ['manual', 'Nur auf Knopfdruck', 'Du startest das Nachplanen im Plan mit „Nächste Woche planen“.']];
const EXCEPTION_KINDS = [['unavailable', 'Keine Zeit'], ['available', 'Weniger Zeit']];
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const number = value => value === '' || value == null ? null : Number(value);
const fmt = value => Number(value || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const listText = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} und ${items.at(-1)}` : items[0] || '';

function Section({ title, intro, children }) {
  return <section className="coach-card settings-section" aria-label={title}><h2>{title}</h2>{intro && <p className="coach-muted">{intro}</p>}{children}</section>;
}

// --- Athlete profile ----------------------------------------------------------------------------

function ProfileSection({ ctx }) {
  const { profile, user } = ctx.data;
  const offered = STAGE_SPORTS.map(([key]) => key);
  const [sports, setSports] = useState(() => profile.sports.filter(sport => offered.includes(sport)));
  const [person, setPerson] = useState({ weight: user.weight ?? '', age: user.age ?? '' });
  const [notes, setNotes] = useState({ limitations: profile.limitations?.notes || '', currentState: profile.currentState?.notes || '' });
  const toggle = sport => setSports(list => list.includes(sport) ? list.filter(s => s !== sport) : offered.filter(s => s === sport || list.includes(s)));
  const save = () => ctx.run('Athletenprofil wird gespeichert …', async () => {
    ctx.update({ user: await ctx.request('/api/user', 'PUT', { weight: number(person.weight), age: number(person.age) }) });
    // Sports the coach does not offer yet stay in the profile.
    await ctx.saveProfile({ sports: [...sports, ...profile.sports.filter(sport => !offered.includes(sport))],
      limitations: { notes: notes.limitations }, currentState: { notes: notes.currentState } });
    ctx.saved('Athletenprofil gespeichert.');
  });
  return <Section title="Athletenprofil" intro="Was du regelmäßig machst und was der Coach über dich wissen sollte.">
    <h3>Deine Sportarten</h3>
    <Tiles label="Sportarten" items={STAGE_SPORTS} isOn={key => sports.includes(key)} onToggle={toggle} />
    <div className="coach-form-grid onboarding-person">
      <Field label="Gewicht (kg)"><input type="number" min="20" max="300" step="0.1" value={person.weight} onChange={e => setPerson(p => ({ ...p, weight: e.target.value }))} /></Field>
      <Field label="Alter"><input type="number" min="1" max="120" step="1" value={person.age} onChange={e => setPerson(p => ({ ...p, age: e.target.value }))} /></Field>
    </div>
    <div className="coach-form-grid">
      <Field label="Einschränkungen"><textarea maxLength={1500} value={notes.limitations} placeholder="Verletzungen, Einschränkungen oder Dinge, die der Coach berücksichtigen soll" onChange={e => setNotes(n => ({ ...n, limitations: e.target.value }))} /></Field>
      <Field label="Aktueller Zustand"><textarea maxLength={1500} value={notes.currentState} placeholder="Was sollte der Coach über deine aktuelle Situation wissen?" onChange={e => setNotes(n => ({ ...n, currentState: e.target.value }))} /></Field>
    </div>
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!ctx.busy || !sports.length} onClick={save}>Athletenprofil speichern</button></div>
  </Section>;
}

// --- Sports of the plan and thresholds ----------------------------------------------------------

function TrainingSection({ ctx }) {
  const { profile, events } = ctx.data;
  const locked = [...new Set(splitEvents(events).upcoming.map(e => e.sport).filter(s => ['ride', 'run'].includes(s)))];
  const [chosen, setChosen] = useState(() => [...new Set([...locked, ...planSports(profile)])]);
  const [metrics, setMetrics] = useState({ ride: profile.metrics.ride || 'power', run: profile.metrics.run || 'pace' });
  const toggle = sport => setChosen(list => list.includes(sport) ? list.filter(s => s !== sport) : [...list, sport]);
  const endurance = ['ride', 'run'].filter(s => chosen.includes(s));
  const save = () => ctx.run('Sportarten werden gespeichert …', async () => {
    await ctx.saveProfile({ goal: { sports: endurance }, preferences: { gymAvailability: chosen.includes('strength') },
      metrics: Object.fromEntries(endurance.map(s => [s, metrics[s]])) });
    ctx.saved('Sportarten im Plan gespeichert.', 'sports');
  });
  return <Section title="Sportarten im Plan" intro={`Was der Coach für dich plant.${locked.length ? ' Sportarten deiner Events sind fest dabei.' : ''}`}>
    <Tiles label="Sportarten im Plan" items={[['ride', 'Radfahren'], ['run', 'Laufen'], ['strength', 'Kraft & Core']]} isOn={key => chosen.includes(key)} onToggle={toggle} locked={key => locked.includes(key)} />
    {endurance.length > 0 && <div className="coach-form-grid">{endurance.map(sport => <Field key={sport} label={`Primärmetrik ${SPORT_NAMES[sport]}`}>
      <select value={metrics[sport]} onChange={e => setMetrics(m => ({ ...m, [sport]: e.target.value }))}>{METRICS[sport].map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>)}</div>}
    {!endurance.length && <p className="coach-muted" role="note">Wähle Radfahren oder Laufen; Kraft läuft im Plan nur mit.</p>}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!ctx.busy || !endurance.length} onClick={save}>Sportarten speichern</button></div>
  </Section>;
}

function ThresholdsSection({ ctx }) {
  const { profile, user } = ctx.data;
  const sports = profile.goal.sports.filter(sport => ['ride', 'run'].includes(sport));
  const [draft, setDraft] = useState(() => thresholdDraft(ctx.data));
  const [maxHr, setMaxHr] = useState(user.maxHr ?? '');
  const problem = thresholdProblem(draft, sports);
  const save = () => ctx.run('Leistungsdaten werden gespeichert …', async () => {
    const changes = thresholdChanges(draft, sports);
    ctx.update({ user: await ctx.request('/api/user', 'PUT', { maxHr: number(maxHr), ...changes.user }) });
    await ctx.saveProfile({ thresholds: changes.thresholds });
    ctx.update({ thresholds: await ctx.request('/api/coach/thresholds') });
    ctx.saved('Leistungsdaten gespeichert.', 'thresholds');
  });
  return <Section title="Leistungsdaten" intro="Damit rechnet der Coach deine Trainingsbereiche. Die Herkunft steht beim Wert.">
    <ThresholdFields draft={draft} sports={sports} onChange={setDraft} />
    <div className="coach-form-grid"><Field label="Max. Herzfrequenz"><input type="number" min="60" max="250" step="1" value={maxHr} onChange={e => setMaxHr(e.target.value)} /></Field></div>
    {problem && <p className="coach-muted" role="note">{problem}</p>}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!ctx.busy || !!problem} onClick={save}>Leistungsdaten speichern</button></div>
  </Section>;
}

// --- Availability -------------------------------------------------------------------------------

function exceptionText(item) {
  const span = item.from === item.to ? dateLabel(item.from, true) : `${dateLabel(item.from)}–${dateLabel(item.to, true)}`;
  return `${span} · ${item.kind === 'unavailable' ? 'keine Zeit' : `höchstens ${item.maxMinutes} min pro Tag`}${item.note ? ` · ${item.note}` : ''}`;
}

/** One-off changes such as holidays or travel: a period without time or with less time per day. */
export function ExceptionEditor({ exceptions, busy, onSave }) {
  const [draft, setDraft] = useState(null);
  const today = localDate();
  const shown = exceptions.filter(item => item.to >= today);
  const set = patch => setDraft(d => ({ ...d, ...patch }));
  const problem = !draft ? null : !draft.from || !draft.to ? 'Bitte Beginn und Ende wählen.' : draft.to < draft.from ? 'Das Ende liegt nicht vor dem Beginn.'
    : draft.to < today ? 'Eine Ausnahme endet heute oder später.'
      : draft.kind === 'available' && !(draft.maxMinutes !== '' && Number(draft.maxMinutes) >= 0 && Number(draft.maxMinutes) <= 1440) ? 'Bitte die Minuten pro Tag angeben (0 bis 1440).' : null;
  const save = () => {
    const item = { id: draft.id || newId('exception'), from: draft.from, to: draft.to, kind: draft.kind,
      maxMinutes: draft.kind === 'available' ? Number(draft.maxMinutes) : null, note: draft.note.trim() };
    onSave([...exceptions.filter(e => e.id !== item.id), item], () => setDraft(null));
  };
  return <>
    <h3>Ausnahmen</h3>
    <p className="coach-muted">Urlaub, Reise oder eine Woche mit weniger Zeit. Sie gelten nur für diesen Zeitraum.</p>
    {shown.length > 0 && <ul className="onboarding-events">{shown.map(item => <li key={item.id}>
      <div><strong>{exceptionText(item)}</strong></div>
      <button type="button" disabled={busy} onClick={() => setDraft({ ...item, maxMinutes: item.maxMinutes ?? '', note: item.note || '' })}>Ändern</button>
      <button type="button" className="coach-danger" disabled={busy} onClick={() => onSave(exceptions.filter(e => e.id !== item.id))}>Löschen</button>
    </li>)}</ul>}
    {draft ? <section className="onboarding-card" aria-label="Ausnahme">
      <div className="onboarding-segments" role="radiogroup" aria-label="Art der Ausnahme">{EXCEPTION_KINDS.map(([key, text]) =>
        <button key={key} type="button" role="radio" aria-checked={draft.kind === key} onClick={() => set({ kind: key })}>{text}</button>)}</div>
      <div className="coach-form-grid">
        <DateField label="Von" min={today} value={draft.from} onChange={from => set({ from })} />
        <DateField label="Bis" min={draft.from || today} value={draft.to} onChange={to => set({ to })} />
        {draft.kind === 'available' && <Field label="Minuten pro Tag"><input type="number" min="0" max="1440" step="5" value={draft.maxMinutes} onChange={e => set({ maxMinutes: e.target.value })} /></Field>}
      </div>
      <Field label="Notiz (optional)"><input maxLength={300} value={draft.note} placeholder="z. B. Urlaub auf Mallorca, Rad dabei" onChange={e => set({ note: e.target.value })} /></Field>
      {problem && <p className="coach-muted" role="note">{problem}</p>}
      <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy || !!problem} onClick={save}>Ausnahme speichern</button><button type="button" onClick={() => setDraft(null)}>Abbrechen</button></div>
    </section> : <button type="button" className="onboarding-add" onClick={() => setDraft({ id: null, kind: 'unavailable', from: today, to: today, maxMinutes: '', note: '' })}>+ Ausnahme eintragen</button>}
  </>;
}

function AvailabilitySection({ ctx }) {
  const { profile, events } = ctx.data;
  const availability = profile.availability;
  const windows = availability.windows || [];
  const [form, setForm] = useState(null);
  const [week, setWeek] = useState(() => weekDraft(availability));
  const maximum = number(week.maxWeeklyHours);
  const problem = weekProblem(windows, maximum);
  const store = (patch, message, done) => ctx.run('Verfügbarkeit wird gespeichert …', async () => {
    await ctx.saveProfile({ availability: patch });
    done?.();
    ctx.saved(message, 'availability');
  });
  const saveWindows = list => store({ windows: list, ...fittedWish(availability, list, availability.maxWeeklyHours) }, 'Zeitfenster gespeichert.', () => setForm(null));
  return <Section title="Verfügbarkeiten" intro="Wann du trainieren kannst. Der Coach plant darin und nutzt nicht jedes Fenster.">
    {!form && <WeekPanel week={week} windows={windows} events={events} background={profile.background} onChange={setWeek}>
      <div className="coach-actions"><button type="button" disabled={!!ctx.busy || !!problem}
        onClick={() => store({ ...weekValues(week, maximum), ...fittedWish(availability, windows, maximum) }, 'Wochenwerte gespeichert.')}>Wochenwerte speichern</button></div>
    </WeekPanel>}
    {!form && <h3>Deine Tage</h3>}
    <WindowEditor windows={windows} sports={planSports(profile)} busy={!!ctx.busy} form={form} onForm={setForm} onSave={saveWindows} />
    {!form && <>
      {problem && <p className="coach-muted" role="note">{problem}</p>}
      <ExceptionEditor exceptions={availability.exceptions || []} busy={!!ctx.busy} onSave={(list, done) => store({ exceptions: list }, 'Ausnahmen gespeichert.', done)} />
    </>}
  </Section>;
}

// --- Events, goal and plan period ---------------------------------------------------------------

function EventsSection({ ctx, planActive }) {
  const { profile, events, settings } = ctx.data;
  const [form, setForm] = useState(null);  // 'new' or the edited event
  const [end, setEnd] = useState(settings?.endDate || '');
  const { upcoming, recent } = splitEvents(events);
  const main = lastAEvent(upcoming);
  const goal = GOALS.some(([key]) => key === profile.goal.type) ? profile.goal.type : null;
  // The goal follows the A event, so the start page and the earlier views show it too.
  const syncGoal = async list => {
    const next = lastAEvent(splitEvents(list).upcoming);
    if (next) await ctx.saveProfile({ goal: { type: 'event', name: next.title, date: next.startDate } });
    else if (profile.goal.type === 'event') await ctx.saveProfile({ goal: { type: 'fitness', name: '', date: null } });
  };
  const saveEvent = body => ctx.run('Event wird gespeichert …', async () => {
    const result = form === 'new' ? await ctx.request('/api/coach/events', 'POST', body) : await ctx.request(`/api/coach/events/${encodeURIComponent(form.id)}`, 'PUT', body);
    ctx.update({ events: result.events }); setForm(null);
    await syncGoal(result.events);
    ctx.saved('Event gespeichert.', 'events');
  });
  const remove = event => ctx.run('Event wird gelöscht …', async () => {
    const result = await ctx.request(`/api/coach/events/${encodeURIComponent(event.id)}`, 'DELETE');
    ctx.update({ events: result.events });
    await syncGoal(result.events);
    ctx.saved(`${event.title} gelöscht.`, 'events');
  });
  const chooseGoal = type => ctx.run('Ziel wird gespeichert …', async () => {
    await ctx.saveProfile({ goal: { type, name: '', date: null } });
    ctx.saved('Ziel gespeichert.', 'events');
  });
  const saveEnd = () => ctx.run('Planende wird gespeichert …', async () => {
    const saved = await ctx.request('/api/coach/plan/settings', 'PUT', { startDate: settings.startDate, endDate: end, replanMode: settings.replanMode });
    ctx.update({ settings: saved.settings });
    ctx.saved('Planende gespeichert.', 'period');
  });
  const endProblem = !end ? 'Bitte ein Planende wählen.' : end <= settings?.startDate ? 'Das Planende muss nach dem Planstart liegen.' : null;
  return <Section title="Events & Ziele" intro="Deine Rennen und Ziele. Der Plan läuft auf dein letztes A-Event hin.">
    {form ? <EventForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? null : form} busy={!!ctx.busy} onSave={saveEvent} onCancel={() => setForm(null)} />
      : <button type="button" className="onboarding-add" onClick={() => setForm('new')}>+ Event hinzufügen</button>}
    {!form && <>
      {main ? <p className="onboarding-hint">Dein Hauptziel: <strong>{main.title}</strong> am {dateLabel(main.startDate, true)}.</p> : <>
        <h3>Ziel ohne Event</h3>
        <Tiles label="Ziel ohne Event" single items={GOALS} isOn={key => goal === key} onToggle={chooseGoal} />
      </>}
      <EventList title="Kommende Events" events={upcoming} busy={!!ctx.busy} onEdit={setForm} onDelete={remove} />
      <EventList title="Kürzliche Events" events={recent} busy={!!ctx.busy} onEdit={setForm} onDelete={remove} />
      {planActive && settings && <>
        <h3>Zeitraum</h3>
        <p className="coach-muted">Der Plan läuft seit {dateLabel(settings.startDate, true)}. Der Start bleibt; für einen neuen Start erstellst du den Plan unter „Plan“ neu.</p>
        <div className="coach-form-grid"><DateField label="Plan endet" hint={endProblem ? undefined : `${weeksLabel(settings.startDate, end)} Plan`}
          min={settings.startDate} value={end} onChange={setEnd} /></div>
        {endProblem && <p className="coach-muted" role="note">{endProblem}</p>}
        <div className="coach-actions"><button type="button" disabled={!!ctx.busy || !!endProblem || end === settings.endDate} onClick={saveEnd}>Planende speichern</button></div>
      </>}
    </>}
  </Section>;
}

// --- Data sources, provider, behavior and the plan itself ---------------------------------------

function SourcesSection({ ctx }) {
  const { snapshot, background } = ctx.data;
  const quality = snapshot?.dataQuality || {};
  return <Section title="Datenquellen" intro="Mit deinen Trainingsdaten plant der Coach passender.">
    <SourceList apiBase={ctx.apiBase} hasData={background.hasData} onChanged={ctx.reloadBackground} />
    {snapshot && <details className="coach-details coach-context"><summary>Datenbasis & Herkunft</summary>
      <div className="coach-provenance"><span className="coach-badge">Berechnet · Trainingsdaten</span><span className="coach-badge athlete">Athlet · Selbstauskunft</span><span className="coach-badge recommendation">AI · Empfehlung</span></div>
      <p className="coach-muted">Fehlende Messwerte bleiben offen. Der Snapshot enthält verdichtete Daten ohne Sensorstreams.</p>
      <div className="coach-quality"><span>FTP: <strong>{quality.ftpConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span><span>Maximale Herzfrequenz: <strong>{quality.maxHrConfigured ? 'konfiguriert' : 'nicht konfiguriert'}</strong></span>
        <span>Leistungsdaten (42 Tage): <strong>{quality.cyclingPowerCoverageLast42Days == null ? '—' : `${fmt(quality.cyclingPowerCoverageLast42Days * 100)} %`}</strong></span></div>
      <details className="coach-details"><summary>Kompakten Athlete Snapshot ansehen</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details>
    </details>}
  </Section>;
}

function Usage({ apiBase, version }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/coach/usage?timezone=${encodeURIComponent(timezone())}`).then(r => r.ok ? r.json() : null).then(data => { if (active) setUsage(data); }).catch(() => {});
    return () => { active = false; };
  }, [apiBase, version]);
  if (!usage) return null;
  const tokens = value => Number(value || 0).toLocaleString('de-DE');
  return <div className="settings-usage" aria-label="Verbrauch diesen Monat"><h3>Verbrauch diesen Monat</h3>
    {usage.calls ? <p>{usage.calls} {usage.calls === 1 ? 'Anfrage' : 'Anfragen'} · {tokens(usage.inputTokens)} Tokens Eingabe, {tokens(usage.outputTokens)} Ausgabe
      {usage.costUsd != null && <> · ca. {Number(usage.costUsd).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</>}</p> : <p className="coach-muted">Noch keine Anfragen in diesem Monat.</p>}
    <small className="coach-muted">Gemessen aus den Antworten deines Providers. Gecachte Eingabe zählt zum vollen Preis, die Kosten sind also eher zu hoch.</small>
  </div>;
}

function ProviderSection({ ctx, provider, onProvider, messages }) {
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  return <Section title="AI-Provider" intro="Deine Anfragen laufen über deinen eigenen Zugang und werden dort abgerechnet.">
    <KeyNotice provider={provider} />
    <ProviderForm provider={provider} disabled={!!ctx.busy} request={ctx.request} run={ctx.run} dirty={dirty} showCost onEdit={() => setDirty(true)}
      onSaved={saved => { onProvider(saved); setDirty(false); setVersion(v => v + 1); ctx.saved('Provider-Einstellungen gespeichert.'); }}
      onTested={() => ctx.saved('Verbindung zum Provider erfolgreich.')}
      onRemoved={saved => { onProvider({ ...provider, ...saved, configured: false, keyLast4: null }); setDirty(false); ctx.saved('API Key entfernt.'); }}>
      {messages}
    </ProviderForm>
    <Usage apiBase={ctx.apiBase} version={version} />
  </Section>;
}

function BehaviorSection({ ctx }) {
  const { profile, settings } = ctx.data;
  const [mode, setMode] = useState(settings?.replanMode || 'afterReview');
  const [dailyCheckIn, setDailyCheckIn] = useState(profile.preferences.dailyCheckIn !== false);
  const save = () => ctx.run('Coach-Verhalten wird gespeichert …', async () => {
    if (settings) ctx.update({ settings: (await ctx.request('/api/coach/plan/settings', 'PUT', { startDate: settings.startDate, endDate: settings.endDate, replanMode: mode })).settings });
    await ctx.saveProfile({ preferences: { dailyCheckIn } });
    ctx.saved('Coach-Verhalten gespeichert.');
  });
  return <Section title="Coach-Verhalten">
    <h3>Wann soll der Coach nachplanen?</h3>
    {settings ? <div className="onboarding-priorities" role="radiogroup" aria-label="Nachplanen">{REPLAN_MODES.map(([key, name, text]) =>
      <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}><strong>{name}</strong><small>{text}</small></button>)}</div>
      : <p className="coach-muted">Das legst du fest, sobald dein Plan steht.</p>}
    <label className="coach-checkbox"><input type="checkbox" checked={dailyCheckIn} onChange={e => setDailyCheckIn(e.target.checked)} />Morgen-Check-in beim ersten Öffnen am Tag anzeigen</label>
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!ctx.busy} onClick={save}>Coach-Verhalten speichern</button></div>
  </Section>;
}

function PlanSection({ ctx, planActive, onEndPlan, onNewPlan }) {
  const [confirm, setConfirm] = useState(null);  // 'end' or 'new'
  if (!planActive) return <Section title="Plan" intro="Ziel, Zeitraum und Verfügbarkeiten, dann legt der Coach Phasen fest und arbeitet die ersten 3 Wochen aus.">
    <div className="coach-actions"><button type="button" className="coach-primary" onClick={onNewPlan}>Plan erstellen</button></div>
  </Section>;
  return <Section title="Plan" intro="Ein neuer Plan beginnt mit deinen gespeicherten Angaben; du prüfst sie vor dem Erstellen.">
    {confirm ? <div className="coach-confirm-delete" role="group" aria-label={confirm === 'end' ? 'Plan beenden' : 'Plan neu erstellen'}>
      <p><strong>{confirm === 'end' ? 'Plan beenden?' : 'Plan neu erstellen?'}</strong> Ab heute entfallen die geplanten Einheiten und die kommenden Wochen. Vergangene Wochen und eigene Workouts bleiben, der Coach-Chat beginnt neu.</p>
      <div className="coach-actions"><button type="button" className="coach-danger" disabled={!!ctx.busy} onClick={() => { setConfirm(null); (confirm === 'end' ? onEndPlan : onNewPlan)(); }}>
        {confirm === 'end' ? 'Plan beenden' : 'Beenden und neu erstellen'}</button><button type="button" onClick={() => setConfirm(null)}>Abbrechen</button></div>
    </div> : <div className="coach-actions"><button type="button" onClick={() => setConfirm('new')}>Plan neu erstellen</button>
      <button type="button" className="coach-danger" onClick={() => setConfirm('end')}>Plan beenden</button></div>}
  </Section>;
}

const PAGES = { profile: ProfileSection, training: TrainingSection, thresholds: ThresholdsSection, availability: AvailabilitySection, events: EventsSection,
  sources: SourcesSection, behavior: BehaviorSection };

/** The settings area. onChanged runs after every save, onAdapt(changes) starts adapting the plan. pending are the
 * plan-relevant changes since the last answer to "Plan anpassen?"; the host keeps them, so they outlast this area. */
export default function CoachSettings({ apiBase = '', section = 'profile', onSection, planActive, provider, pending = [], onPending, onProvider, onChanged, onAdapt,
  onEndPlan, onNewPlan }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const tz = `timezone=${encodeURIComponent(timezone())}`;

  const request = useCallback(async (path, method = 'GET', body) => {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || `Anfrage fehlgeschlagen (${response.status}).`), { status: response.status, data: result });
    return result;
  }, [apiBase]);
  const run = useCallback(async (label, action) => {
    if (running.current) return false;
    running.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); return true; } catch (e) { setError(e.message || 'Die Anfrage konnte nicht abgeschlossen werden.'); return false; }
    finally { running.current = false; setBusy(''); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.all(['/api/athlete-profile', '/api/user', '/api/coach/events', '/api/coach/plan/settings', '/api/coach/thresholds', `/api/athlete-snapshot?${tz}`,
      `/api/coach/onboarding?${tz}`].map(path => request(path)))
      .then(([profile, user, events, settings, thresholds, snapshot, background]) => {
        if (!cancelled) setData({ profile, user, events: events.events, settings: settings.settings, thresholds, snapshot, background });
      })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // A retry loads everything again.
  }, [request, attempt]);

  const update = patch => setData(d => ({ ...d, ...patch }));
  const saveProfile = async patch => { const profile = await request('/api/athlete-profile', 'PUT', patch); update({ profile }); return profile; };
  const saved = (message, area) => {
    setNotice(message);
    if (area && planActive) onPending(list => [...new Set([...list, area])]);
    onChanged?.();
  };
  const reloadBackground = useCallback(() => request(`/api/coach/onboarding?${tz}`).then(background => setData(d => d && { ...d, background })).catch(() => {}), [request]);
  const later = () => run('Wird gespeichert …', async () => {
    await request('/api/coach/plan/adapt', 'POST', { changes: pending, later: true });
    onPending([]); onChanged?.();
    setNotice('Gut, später. Der Plan erinnert dich daran.');
  });

  const ctx = data && { apiBase, data, request, run, busy, update, saveProfile, saved, reloadBackground };
  const messages = <>
    {error && <div role="alert" className="coach-message error">{error}{!data && <button type="button" onClick={() => setAttempt(a => a + 1)}>Erneut laden</button>}</div>}
    {notice && <div role="status" className="coach-message success">{notice}</div>}
    {busy && <div role="status" className="coach-message"><span className="coach-spinner" />{busy}</div>}
  </>;
  const Page = PAGES[section];
  const reframe = pending.some(area => ['events', 'period'].includes(area));
  return <div className="coach-settings">
    <nav className="settings-nav" aria-label="Einstellungen">{SECTIONS.map(([key, label]) =>
      <button key={key} type="button" aria-current={section === key ? 'page' : undefined} onClick={() => onSection(key)}>{label}</button>)}</nav>
    {pending.length > 0 && <section className="coach-card coach-next settings-adapt" aria-label="Plan anpassen">
      <span className="coach-eyebrow">Plan</span><h2>Soll ich deinen Plan daran anpassen?</h2>
      <p className="coach-muted">Du hast {listText(pending.map(area => AREA_NAMES[area]))} geändert. Ich prüfe die ausgearbeiteten Wochen{reframe ? ' und lege die Phasen danach neu fest' : ''}. Änderungen an den Wochen siehst du vorher.</p>
      {!provider?.configured && <p className="coach-muted">Dafür braucht der Coach deinen AI-Provider.</p>}
      <div className="coach-actions"><button type="button" className="coach-primary" disabled={!!busy || !provider?.configured} onClick={() => onAdapt(pending)}>Ja, Plan anpassen</button>
        <button type="button" disabled={!!busy} onClick={later}>Später</button></div>
    </section>}
    {section !== 'provider' && messages}
    {!data && !error && <p role="status" className="coach-muted">Einstellungen werden geladen …</p>}
    {section === 'provider' && provider && <ProviderSection ctx={ctx || { apiBase, request, run, busy, saved }} provider={provider} onProvider={onProvider} messages={messages} />}
    {section === 'plan' && <PlanSection ctx={{ busy }} planActive={planActive} onEndPlan={onEndPlan} onNewPlan={onNewPlan} />}
    {ctx && Page && <Page key={`${section}-${attempt}`} ctx={ctx} planActive={planActive} />}
  </div>;
}
