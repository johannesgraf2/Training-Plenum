import React, { useEffect, useState } from 'react';
import { sportLabels } from './sports';
import './CoachToday.css';

// Morning check-in, the daily traffic light and where the day sits in the season.
// The traffic light comes from fixed rules on the server (backend/coach_wellness.py), not from the AI.

export const SCALES = [
  ['wellbeing', 'Wohlbefinden', ['sehr schlecht', 'schlecht', 'ok', 'gut', 'ausgezeichnet']],
  ['recovery', 'Erholung', ['erschöpft', 'müde', 'normal', 'erholt', 'frisch']],
  ['stress', 'Stress', ['entspannt', 'eher ruhig', 'mittel', 'hoch', 'sehr gestresst']],
  ['soreness', 'Muskelkater', ['keiner', 'leicht', 'mittel', 'stark', 'extrem']],
  ['mood', 'Stimmung', ['negativ', 'gedrückt', 'neutral', 'gut', 'euphorisch']],
  ['nutrition', 'Ernährung gestern', ['zu wenig', 'etwas wenig', 'passend', 'etwas viel', 'zu viel']],
];
export const ALCOHOL = ['nein', '1–2 Getränke', 'mehr'];
const REGIONS = [['foot', 'Fuß'], ['ankle', 'Knöchel'], ['shin', 'Schienbein'], ['calf', 'Wade'], ['knee', 'Knie'], ['thigh', 'Oberschenkel'],
  ['hip', 'Hüfte'], ['back', 'Rücken'], ['shoulder', 'Schulter'], ['arm', 'Ellbogen/Hand']];
const INJURY_FIELDS = [
  ['region', 'Wo?', REGIONS],
  ['side', 'Seite', [['left', 'links'], ['right', 'rechts'], ['both', 'beide']]],
  ['timing', 'Wann tut es weh?', [['during', 'während Belastung'], ['outside', 'außerhalb'], ['both', 'beides']]],
  ['onset', 'Beginn', [['immediate', 'sofort beim Start'], ['during', 'im Verlauf'], ['after', 'erst danach']]],
  ['impact', 'Auswirkung aufs Training', [['normal', 'normal trainieren'], ['adjust', 'anpassen'], ['pause', 'pausieren']]],
];
const TIMING = { during: 'während der Belastung', outside: 'außerhalb der Belastung', both: 'während und außerhalb der Belastung' };
const ONSET = { immediate: 'sofort beim Start', during: 'im Verlauf', after: 'erst danach' };
const TRENDS = [['better', 'besser'], ['same', 'gleich'], ['worse', 'schlechter']];
export const LEVELS = { green: 'Grün – alles im Plan', yellow: 'Gelb – etwas zurücknehmen', red: 'Rot – heute schonen' };
const SPORT_NOUNS = { run: 'Laufen', ride: 'Radfahren', swim: 'Schwimmen' };
const SESSION_SPORTS = { ...sportLabels, strength: 'Krafttraining' };

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `timezone=${encodeURIComponent(timezone())}`;
const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const hm = minutes => minutes == null ? '—' : minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')} h` : `${Math.round(minutes)} min`;
const longDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

async function send(apiBase, path, method, body) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Anfrage fehlgeschlagen (${response.status}).`);
  return data;
}

/** The view of one day: GET /api/coach/today. */
export function loadToday(apiBase = '') {
  return fetch(`${apiBase}/api/coach/today?${tzQuery()}`).then(response => {
    if (!response.ok) throw new Error(`Anfrage fehlgeschlagen (${response.status}).`);
    return response.json();
  });
}
export const healInjury = (apiBase, identity) => send(apiBase, `/api/coach/injuries/${encodeURIComponent(identity)}?${tzQuery()}`, 'PUT', { status: 'healed' });

// The dialog opens by itself once a day; "Später" keeps it closed until the next day.
const DISMISSED = 'trainingPlenum.checkInDismissed';
export const checkInDismissed = date => { try { return window.localStorage.getItem(DISMISSED) === date; } catch (_) { return false; } };
export const dismissCheckIn = date => { try { window.localStorage.setItem(DISMISSED, date); } catch (_) { /* private mode */ } };
export const shouldAskCheckIn = today => !!today && !today.checkIn && today.dailyCheckIn !== false && !checkInDismissed(today.date);

function SeasonBar({ segments, date }) {
  if (!segments?.length) return null;
  const total = segments.reduce((sum, segment) => sum + segment.weeks, 0);
  const elapsed = daysBetween(segments[0].startDate, date) / 7;
  return <div className="coach-season-strip today-season" role="img" aria-label={`Saison: ${segments.map(s => `${s.typeName}, ${s.weeks} Wochen`).join(' · ')}`}>
    {segments.map((segment, i) => <div key={i} className={`coach-season-segment ${segment.blockType}${segment.endDate < date ? ' past' : ''}`} style={{ flexGrow: segment.weeks }}
      title={`${segment.typeName} · ${segment.weeks} Wochen`}><strong>{segment.typeName}</strong></div>)}
    {elapsed > 0 && elapsed < total && <i className="coach-season-today" style={{ left: `${elapsed / total * 100}%` }} title="Heute" />}
  </div>;
}

/** Season, block, block week and phase of the day, with WHOOP when a strap delivers. */
export function PeriodHeader({ today, compact = false }) {
  const period = today.period || {};
  const block = period.block;
  const goal = period.goal || {};
  const facts = block ? [block.deload ? (block.phase === 'taper' ? 'Taper-Woche' : 'Entlastungswoche') : 'Belastungswoche',
    block.targetHours != null && `Wochenziel ${fmt(block.targetHours)} h`, block.focus && `Fokus: ${block.focus}`].filter(Boolean) : [];
  return <div className="today-period">
    <div className="today-period-head">
      <div>
        <span className="coach-eyebrow">{longDate(today.date)} · KW {Number(period.week?.split('-W')[1])}</span>
        <h2>{block ? `${block.typeName}${block.secondaryName ? ` + ${block.secondaryName}` : ''} · Woche ${block.weekNumber} von ${block.totalWeeks}` : 'Kein laufender Trainingsblock'}</h2>
        <p className="today-facts">{block ? facts.join(' · ') : 'Im Bereich „Saison“ legst du deinen nächsten Trainingsblock an.'}</p>
      </div>
      {today.whoop && <div className="today-whoop" aria-label="WHOOP">
        <div><strong>{today.whoop.readiness}</strong><span>Readiness</span></div>
        {!compact && today.whoop.sleepMinutes != null && <div><strong>{hm(today.whoop.sleepMinutes)}</strong><span>Schlaf</span></div>}
      </div>}
    </div>
    <SeasonBar segments={period.season?.segments} date={today.date} />
    {period.weeksToGoal != null && goal.date && <p className="today-goal"><strong>Noch {period.weeksToGoal} {period.weeksToGoal === 1 ? 'Woche' : 'Wochen'}</strong> bis {goal.name?.trim() || 'zu deinem Ziel'} · {new Date(`${goal.date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
  </div>;
}

export function ReadinessCard({ readiness, time, children }) {
  return <section className={`coach-card today-readiness ${readiness.level}`} aria-label="Tagesampel">
    <span className={`today-light ${readiness.level}`} aria-hidden="true" />
    <div>
      <span className="coach-eyebrow">Tagesampel{time ? ` · ${time}` : ''} · aus Check-in, Beschwerden und WHOOP · feste Regeln, keine KI</span>
      <h3>{LEVELS[readiness.level]}</h3>
      {readiness.reasons.length > 0 ? <ul className="today-reasons">{readiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        : <p className="coach-muted">Keine Warnsignale. Viel Spaß beim Training!</p>}
      {readiness.notes?.length > 0 && <p className="coach-muted">{readiness.notes.join(' ')}</p>}
      {children}
    </div>
  </section>;
}

export function TodaySessions({ sessions }) {
  if (!sessions?.length) return <p className="coach-muted">Heute ist nichts geplant.</p>;
  return <ul className="today-sessions">{sessions.map(session => <li key={session.id} className={`sport-${session.sport}`}>
    <span className="today-session-tag">{SESSION_SPORTS[session.sport] || session.sport}{session.hard ? <b> · hart</b> : ''}</span>
    <strong>{session.name}</strong>
    <small>{hm(session.durationMin)} · {session.source === 'coach' ? 'vom Coach' : 'eigenes Workout'}{session.locked ? ' · fixiert' : ''}</small>
  </li>)}</ul>;
}

export function InjuryList({ injuries, busy, onHeal }) {
  if (!injuries?.length) return null;
  return <section className="coach-card" aria-label="Aktive Beschwerden"><span className="coach-eyebrow">Aktive Beschwerden · deine Angabe</span>
    {injuries.map(injury => <div key={injury.id} className="today-injury">
      <div><h3>{injury.label} · {injury.pain}/10{injury.severe ? ' · schont' : ''}</h3>
        <p className="coach-muted">Seit {shortDate(injury.startDate)} · {TIMING[injury.timing]}, {ONSET[injury.onset]} · Verlauf {injury.history.map(h => h.pain).join(' → ')}
          {injury.affectedSports.length > 0 && <><br />{injury.severe ? 'Der Coach plant gerade kein' : 'Der Coach hält es locker beim'} {injury.affectedSports.map(sport => SPORT_NOUNS[sport]).join(' und ')}.</>}</p></div>
      {onHeal && <button type="button" disabled={busy} onClick={() => onHeal(injury)}>Ist ausgeheilt</button>}
    </div>)}
  </section>;
}

function Chips({ label, hint, options, value, onPick }) {
  return <fieldset className="checkin-question"><legend>{label}{hint && <span>{hint}</span>}</legend>
    <div className={`checkin-chips${options.length > 5 ? ' wrap' : ''}`}>{options.map(([key, text]) => <button key={key} type="button" className="checkin-chip" aria-pressed={value === key} onClick={() => onPick(key)}>{text}</button>)}</div>
  </fieldset>;
}

function PainSlider({ label, value, onChange }) {
  return <label className="checkin-question checkin-pain"><span>{label}<small>0 = keine, 10 = stärkste</small></span>
    <span className="checkin-range"><input type="range" min="0" max="10" value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))} /><output>{value}/10</output></span>
  </label>;
}

const answersOf = checkIn => checkIn ? Object.fromEntries([...SCALES.map(([key]) => key), 'alcohol'].map(key => [key, checkIn[key]])) : {};

/** The morning check-in. Saves through POST /api/coach/check-ins and then shows the traffic light of the day. */
export function CheckInDialog({ apiBase = '', today, onClose, onSaved, onAdjust }) {
  const own = injury => injury.startDate === today.date;
  const [answers, setAnswers] = useState(() => answersOf(today.checkIn));
  // Editing today's check-in starts without a new complaint; the one entered earlier is listed below.
  const [pain, setPain] = useState(today.checkIn ? false : null);
  const [injury, setInjury] = useState({ pain: 3 });
  const [updates, setUpdates] = useState(() => Object.fromEntries((today.injuries || []).map(item => [item.id, { pain: item.pain, trend: null, healed: false }])));
  const [notes, setNotes] = useState(today.checkIn?.notes || '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const injuries = today.injuries || [];
  const missing = [...SCALES.map(([key]) => key), 'alcohol'].filter(key => answers[key] == null).length
    + injuries.filter(item => !own(item) && !updates[item.id].healed && !updates[item.id].trend).length
    + (pain == null ? 1 : 0)
    + (pain ? INJURY_FIELDS.filter(([key]) => injury[key] == null).length : 0);
  const set = (key, value) => setAnswers(current => ({ ...current, [key]: value }));
  const update = (identity, patch) => setUpdates(current => ({ ...current, [identity]: { ...current[identity], ...patch } }));

  async function save() {
    setTried(true);
    if (missing) return;
    setBusy(true); setError('');
    try {
      const view = await send(apiBase, `/api/coach/check-ins?${tzQuery()}`, 'POST', {
        date: today.date, ...answers, notes: notes.trim(), newInjury: pain ? injury : null,
        injuryUpdates: injuries.map(item => ({ id: item.id, pain: updates[item.id].healed ? 0 : updates[item.id].pain, trend: updates[item.id].trend, healed: updates[item.id].healed })),
      });
      setResult(view); onSaved?.(view);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const previous = today.previousCheckIn;
  const body = result ? <>
    <ReadinessCard readiness={result.readiness} />
    <section className="coach-card"><span className="coach-eyebrow">Heute</span><TodaySessions sessions={result.sessions} /></section>
    {result.readiness.level !== 'green' && (result.weekPlanned
      ? <p className="coach-muted">Der Coach kann deine Woche an den Check-in anpassen. Du siehst vorher, was sich ändert, und übernimmst nur, was passt.</p>
      : <p className="coach-muted">Für diese Woche hat der Coach keinen Plan. Halte geplante Einheiten heute locker.</p>)}
  </> : <>
    <div className="checkin-intro"><span className="coach-muted">Etwa 20 Sekunden. Tippe einfach an.</span>
      {previous && !today.checkIn && <button type="button" className="checkin-link" onClick={() => setAnswers(answersOf(previous))}>Wie am {shortDate(previous.date)}</button>}</div>
    {SCALES.map(([key, label, options]) => <Chips key={key} label={label} options={options.map((text, i) => [i + 1, text])} value={answers[key]} onPick={value => set(key, value)} />)}
    <Chips label="Alkohol gestern" options={ALCOHOL.map((text, i) => [i, text])} value={answers.alcohol} onPick={value => set('alcohol', value)} />
    {injuries.map(item => <div key={item.id} className="checkin-injury">
      <Chips label={item.label} hint={own(item) ? `heute eingetragen · ${item.pain}/10` : `seit ${shortDate(item.startDate)} · zuletzt ${item.pain}/10`}
        options={own(item) ? [] : TRENDS} value={updates[item.id].trend} onPick={value => update(item.id, { trend: value, healed: false })} />
      {!updates[item.id].healed && <PainSlider label="Schmerz heute" value={updates[item.id].pain} onChange={value => update(item.id, { pain: value })} />}
      <button type="button" className="checkin-chip checkin-healed" aria-pressed={updates[item.id].healed} onClick={() => update(item.id, { healed: !updates[item.id].healed })}>{updates[item.id].healed ? '✓ ausgeheilt' : 'Ist ausgeheilt'}</button>
    </div>)}
    <Chips label={injuries.length ? 'Neue Schmerzen oder Verletzung?' : 'Schmerzen oder Verletzung?'} options={[[false, 'nein'], [true, 'ja']]} value={pain} onPick={setPain} />
    {pain && <div className="checkin-injury">
      {INJURY_FIELDS.map(([key, label, options]) => <Chips key={key} label={label} options={options} value={injury[key]} onPick={value => setInjury(current => ({ ...current, [key]: value }))} />)}
      <PainSlider label="Wie stark?" value={injury.pain} onChange={value => setInjury(current => ({ ...current, pain: value }))} />
    </div>}
    <label className="checkin-question checkin-notes"><span>Notiz (optional)</span><textarea maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
  </>;

  return <div className="checkin-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="checkin-dialog" role="dialog" aria-modal="true" aria-label="Morgen-Check-in">
      <div className="checkin-head"><span className="coach-eyebrow">{result ? 'Check-in gespeichert' : 'Guten Morgen · Morgen-Check-in'}</span><PeriodHeader today={result || today} compact /></div>
      <div className="checkin-body">{body}{error && <div role="alert" className="coach-message error">{error}</div>}</div>
      <div className="checkin-foot">
        {result ? <>
          <span />
          <div className="checkin-actions">{result.readiness.level !== 'green' && result.weekPlanned && onAdjust && <button type="button" className="coach-primary" onClick={() => onAdjust(result)}>Woche anpassen lassen</button>}
            <button type="button" className={result.readiness.level === 'green' || !result.weekPlanned || !onAdjust ? 'coach-primary' : ''} onClick={onClose}>{result.readiness.level === 'green' ? 'Los geht’s' : 'Wie geplant weiter'}</button></div>
        </> : <>
          <button type="button" className="checkin-link" onClick={() => { dismissCheckIn(today.date); onClose(); }}>Später</button>
          {tried && missing > 0 && <span className="checkin-missing">Noch {missing} offen</span>}
          <button type="button" className="coach-primary" disabled={busy} onClick={save}>{busy ? 'Wird gespeichert …' : 'Fertig'}</button>
        </>}
      </div>
    </div>
  </div>;
}

const ROWS = [...SCALES.slice(0, 5), ['nutrition', 'Ernährung', SCALES[5][2]]];

/** The check-ins of the last four weeks and the complaints in that time. */
export function CheckInHistory({ apiBase = '', version = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/coach/check-ins?${tzQuery()}`).then(response => response.ok ? response.json() : Promise.reject(new Error(`Anfrage fehlgeschlagen (${response.status}).`)))
      .then(value => { if (active) setData(value); }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiBase, version]);
  const checkIns = (data?.checkIns || []).filter(c => c.version === 2).reverse();
  return <>
    <section className="coach-card" aria-label="Check-in-Verlauf"><span className="coach-eyebrow">Morgen-Check-ins · letzte 4 Wochen</span><h2>Wie ging es dir?</h2>
      {error && <div role="alert" className="coach-message error">{error}</div>}
      {data && !checkIns.length && <p className="coach-muted">Noch keine Morgen-Check-ins in diesem Zeitraum.</p>}
      {checkIns.length > 0 && <div className="today-table-wrap"><table className="today-table">
        <thead><tr><th>Tag</th><th>Ampel</th>{ROWS.map(([key, label]) => <th key={key}>{label}</th>)}<th>Alkohol</th></tr></thead>
        <tbody>{checkIns.map(c => <tr key={c.date}><td>{shortDate(c.date)}</td>
          <td>{c.readiness ? <span className={`today-dot ${c.readiness.level}`} title={LEVELS[c.readiness.level]} aria-label={LEVELS[c.readiness.level]} /> : '—'}</td>
          {ROWS.map(([key, , options]) => <td key={key}>{options[c[key] - 1] || '—'}</td>)}<td>{ALCOHOL[c.alcohol] || '—'}</td></tr>)}</tbody>
      </table></div>}
    </section>
    {data?.injuries?.length > 0 && <section className="coach-card" aria-label="Beschwerden"><span className="coach-eyebrow">Beschwerden · letzte 4 Wochen</span>
      {data.injuries.map(injury => <p key={injury.id} className="today-injury-line"><strong>{injury.label}</strong> · {injury.status === 'healed' ? `ausgeheilt am ${shortDate(injury.endDate)}` : 'aktiv'} · Verlauf {injury.history.map(h => `${shortDate(h.date)} ${h.pain}`).join(' → ')}</p>)}
    </section>}
  </>;
}

/** Compact line for the start page: open check-in or the traffic light of the day. */
export function CheckInStrip({ today, onOpen, onOpenCoach }) {
  if (!today || today.dailyCheckIn === false && !today.checkIn) return null;
  if (!today.checkIn) return <div className="today-strip open"><span><strong>Morgen-Check-in offen.</strong> Wie geht es dir heute?</span><button type="button" onClick={onOpen}>Jetzt ausfüllen</button></div>;
  const level = today.readiness.level;
  return <div className={`today-strip ${level}`}><span className={`today-dot ${level}`} aria-hidden="true" /><span><strong>{LEVELS[level]}</strong>{today.readiness.reasons.length ? ` · ${today.readiness.reasons[0]}` : ''}</span>
    <button type="button" onClick={onOpenCoach}>Zum Coach</button></div>;
}
