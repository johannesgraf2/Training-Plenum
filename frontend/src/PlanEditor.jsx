import React, { useEffect, useRef, useState } from 'react';
import { request } from './CoachChat';
import { Icon } from './icons';
import { SCALE_STEPS, add, body, editorState, grow, layout, move, remove, setTaper, shrink, volumeBody, weekChoice } from './phaseEditing';

const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const addWeeks = (date, weeks) => new Date(Date.parse(`${date}T12:00:00Z`) + weeks * 7 * 86400000).toISOString().slice(0, 10);
const weeksText = n => `${n} ${n === 1 ? 'Woche' : 'Wochen'}`;
const tzQuery = () => `timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`;

/** "Ändern" on the phase overview: move, lengthen, shorten, add and remove blocks and pick the taper, applied with fixed
 * rules by the server (PUT /api/coach/plan/phases), no AI. */
export function PhaseEditor({ apiBase, overview, onSaved, onCancel }) {
  const [state, setState] = useState(() => editorState(overview));
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const types = overview.blockTypes || [];
  const name = type => types.find(t => t.id === type)?.name || (type === 'taper' ? 'Taper' : type);
  const first = overview.weeks[0]?.startDate;
  const { starts, gaps, free, over } = layout(state.items, state.total);
  const apply = change => { setError(''); setState(change); };
  const payload = body(state);
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await request(apiBase, `/api/coach/plan/phases?${tzQuery()}`, 'PUT', payload)); } catch (e) { setError(e.message); setBusy(false); }
  };
  const gapRow = gap => gap.weeks !== 0 && <li key={`gap-${gap.before}`} className={`plan-editor-gap${gap.weeks < 0 ? ' over' : ''}`}>
    {gap.weeks > 0 ? `${weeksText(gap.weeks)} ohne Block` : `${weeksText(-gap.weeks)} doppelt belegt`}</li>;
  return <section className="plan-editor" aria-label="Blöcke ändern">
    <p className="coach-muted">Verlängern verschiebt die folgenden Blöcke bis an den Taper. Der Block vor einem A-Event bleibt an dessen Datum. Vergangene Wochen bleiben.</p>
    {state.events.length > 0 && <div className="plan-editor-taper"><span>Taper vor dem A-Event</span>
      <div className="onboarding-segments" role="radiogroup" aria-label="Taperwochen">{[1, 2, 3].map(n =>
        <button key={n} type="button" role="radio" aria-checked={state.taperWeeks === n} onClick={() => apply(setTaper(state, n))}>{weeksText(n)}</button>)}</div>
      <small>Der Taper endet direkt vor dem Event; der Plan davor wird von dort rückwärts aufgebaut, mit drei Belastungswochen und einer Entlastungswoche.</small></div>}
    <ol className="plan-editor-list">{state.items.map((item, i) => {
      const start = addWeeks(first, starts[i]);
      const end = addWeeks(first, starts[i] + item.weeks) ;
      const sunday = new Date(Date.parse(`${end}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const fixed = item.locked || item.anchor != null;
      return <React.Fragment key={item.key}>{gaps.filter(g => g.before === i).map(gapRow)}
        <li className={`plan-editor-item ${item.blockType}${item.locked ? ' locked' : ''}`}>
          <span className={`coach-season-dot ${item.blockType}`} aria-hidden="true" />
          <div className="plan-editor-name"><strong>{name(item.blockType)}</strong>
            <small>{shortDate(start)} – {shortDate(sunday)}{item.event ? ` · bis „${item.event}“` : ''}{item.locked ? ' · vorbei' : ''}{!item.id ? ' · neu' : ''}</small></div>
          <div className="plan-editor-weeks" role="group" aria-label={`Dauer ${name(item.blockType)}`}>
            <button type="button" aria-label={`${name(item.blockType)} kürzer`} disabled={item.locked || (item.anchor != null && item.blockType === 'taper')} onClick={() => apply(shrink(state, i))}>−</button>
            <span>{weeksText(item.weeks)}</span>
            <button type="button" aria-label={`${name(item.blockType)} länger`} disabled={item.locked || (item.anchor != null && item.blockType === 'taper')} onClick={() => apply(grow(state, i))}>+</button>
          </div>
          <div className="plan-editor-actions">
            <button type="button" aria-label={`${name(item.blockType)} früher`} disabled={fixed || i === 0} onClick={() => apply(move(state, i, -1))}><Icon name="up" size={14} /></button>
            <button type="button" aria-label={`${name(item.blockType)} später`} disabled={fixed || i === state.items.length - 1} onClick={() => apply(move(state, i, 1))}><Icon name="down" size={14} /></button>
            <button type="button" className="coach-danger" aria-label={`${name(item.blockType)} entfernen`} disabled={fixed || item.minWeeks > 1} onClick={() => apply(remove(state, i))}><Icon name="trash" size={14} /></button>
          </div>
        </li></React.Fragment>;
    })}{gaps.filter(g => g.before === state.items.length).map(gapRow)}</ol>
    <div className="plan-editor-add">
      <select aria-label="Neuer Block" value={adding} onChange={e => setAdding(e.target.value)}><option value="">Block hinzufügen …</option>
        {types.filter(t => !t.endsByGoal).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <button type="button" disabled={!adding} onClick={() => { apply(add(state, adding, types.find(t => t.id === adding)?.defaultWeeks)); setAdding(''); }}>Hinzufügen</button>
    </div>
    {state.message && <p className={`coach-message${state.conflict ? ' error' : ''}`} role={state.conflict ? 'alert' : 'status'}>{state.message}</p>}
    {(free > 0 || over > 0) && <p className="coach-muted" role="note">{free > 0 ? `Noch ${weeksText(free)} ohne Block: verlängere einen Block oder füge einen hinzu.` : `${weeksText(over)} doppelt belegt: verkürze einen Block.`}</p>}
    {error && <div role="alert" className="coach-message error">{error}</div>}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy || !payload} onClick={save}>Blöcke speichern</button>
      <button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button></div>
  </section>;
}

// Weekly hours of the plan up to its end: bars per week (worked-out target or outlined target), lighter for deload and
// taper weeks. Phase names sit below the axis, so the phases never depend on color alone.
const CHART = { height: 210, left: 40, right: 8, top: 18, bottom: 46 };
const TEXT_WIDTH = 6.2;  // Rough width of a 10 px label character, to decide whether a phase name fits.
// The width the chart really has, so its text keeps its size on phones and wide screens.
function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
function niceStep(maximum) {
  return [1, 2, 2.5, 5, 10, 20].find(step => maximum / step <= 5) || 20;
}

// The phase name, shortened with a dot when its span is too narrow.
const phaseLabel = (name, span) => name.length * TEXT_WIDTH <= span ? name : `${name.slice(0, Math.max(2, Math.floor(span / TEXT_WIDTH) - 1))}.`;

const percent = scale => `${Math.round(scale * 100)} %`;
const RHYTHM = ['load', 'deload'];

/** One week of the chart by hand: load or recovery and its hours, the suggestion next to it. */
function WeekVolumeEditor({ week, busy, error, onSave, onReset, onClose }) {
  const [kind, setKind] = useState(week.kind);
  const [hours, setHours] = useState(week.athleteHours ?? '');
  const own = week.athleteKind != null || week.athleteHours != null;
  const value = hours === '' ? null : Number(hours);
  const invalid = value != null && !(value >= 0 && value <= week.maxHours);
  const changed = kind !== week.kind || value !== (week.athleteHours ?? null);
  return <section className="plan-week-editor" aria-label={`Woche ${week.number} anpassen`}>
    <div className="plan-week-editor-head"><div><strong>Woche {week.number} · {shortDate(week.startDate)}</strong>
      <small className="coach-muted">Phase {week.phaseName || '—'} (ändern über „Phasen ändern“)</small></div>
      <button type="button" onClick={onClose}>Schließen</button></div>
    {week.state === 'past' ? <p className="coach-muted">Vergangene Wochen bleiben, wie sie waren.</p> : <>
      {RHYTHM.includes(week.defaultKind) ? <div className="coach-toggles" role="group" aria-label="Art der Woche">
        <button type="button" className="coach-toggle" aria-pressed={kind === 'load'} onClick={() => setKind('load')}>Belastung</button>
        <button type="button" className="coach-toggle" aria-pressed={kind === 'deload'} onClick={() => setKind('deload')}>Erholung</button>
      </div> : <p className="coach-muted">{week.defaultKind === 'taper' ? 'Taper-Woche' : 'Übergangswoche'}: Belastung oder Erholung wählst du in den übrigen Phasen.</p>}
      <label className="plan-week-editor-hours">Stunden
        <input type="number" min="0" max={week.maxHours} step="0.25" placeholder={fmt(week.suggestedHours)} value={hours} onChange={e => setHours(e.target.value)} /></label>
      <small className="coach-muted">Vorschlag {fmt(week.suggestedHours)} h{kind !== week.kind ? ' (vor dem Wechsel)' : ''} · höchstens {fmt(week.maxHours)} h verfügbar. Leer lassen = Vorschlag.</small>
      {invalid && <p className="coach-muted" role="note">Die Stunden liegen zwischen 0 und {fmt(week.maxHours)}.</p>}
      {week.plan && <p className="coach-muted">Diese Woche ist schon ausgearbeitet. Nach dem Übernehmen arbeitet „Plan anpassen“ sie neu aus.</p>}
      {error && <div role="alert" className="coach-message error">{error}</div>}
      <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy || invalid || !changed} onClick={() => onSave(weekChoice(week, kind, hours))}>Übernehmen</button>
        {own && <button type="button" disabled={busy} onClick={onReset}>Auf Vorschlag zurücksetzen</button>}</div>
    </>}
  </section>;
}

export function WeekHoursChart({ overview, today, apiBase, disabled, onSaved }) {
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [scale, setScale] = useState(overview.volume?.scale ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wrap, width] = useWidth();
  const editable = !!overview.volume && !!onSaved;
  // A worked-out week shows the hours of its sessions, so a skipped or shortened session lowers its bar.
  const weeks = overview.weeks.map(w => ({ ...w, hours: w.plan?.calculatedHours ?? w.plan?.targetHours ?? w.targetHours, target: w.plan?.targetHours ?? w.targetHours,
    own: w.athleteKind != null || w.athleteHours != null }));
  if (!weeks.length || !weeks.some(w => w.hours != null)) return null;
  const save = async (nextScale, change) => {
    setBusy(true); setError('');
    try {
      const result = await request(apiBase, `/api/coach/plan/volume?${tzQuery()}`, 'PUT', volumeBody(overview, nextScale, change));
      setSelected(null);
      onSaved(result);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const stored = overview.volume?.scale ?? 1;
  const step = direction => setScale(value => SCALE_STEPS[Math.min(SCALE_STEPS.length - 1, Math.max(0, SCALE_STEPS.indexOf(value) + direction))] ?? 1);
  const { height, left, right, top, bottom } = CHART;
  const plotW = width - left - right, plotH = height - top - bottom;
  const peak = Math.max(...weeks.map(w => w.hours || 0), 1);
  const tick = niceStep(peak);
  const ceiling = Math.ceil(peak / tick) * tick;
  const slot = plotW / weeks.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = hours => top + plotH - (hours / ceiling) * plotH;
  const ticks = Array.from({ length: Math.round(ceiling / tick) + 1 }, (_, i) => i * tick);
  const labelEvery = Math.ceil(weeks.length / Math.max(4, Math.floor(plotW / 28)));
  const phases = overview.phases.map(p => ({ ...p, from: weeks.findIndex(w => w.startDate === p.startDate) })).filter(p => p.from >= 0);
  const events = (overview.events || []).filter(e => e.planWeek >= 1 && e.planWeek <= weeks.length);
  const shown = hover != null ? weeks[hover] : null;
  const open = i => { if (editable && !disabled) { setError(''); setSelected(i); } };
  return <figure className="plan-hours" aria-label="Wochenstunden bis zum Ziel">
    <figcaption><span className="coach-eyebrow">Wochen · Stunden und Belastung</span>
      <span className="plan-hours-legend"><span><i className="load" />Belastung</span><span><i className="deload" />Erholung &amp; Taper</span>
        {editable && <span><i className="own" />Eigene Woche</span>}</span></figcaption>
    {editable && <div className="plan-hours-scale">
      <span>Umfang aller Wochen</span>
      <div className="plan-editor-weeks" role="group" aria-label="Umfang aller Wochen">
        <button type="button" aria-label="Weniger Umfang" disabled={busy || scale <= SCALE_STEPS[0]} onClick={() => step(-1)}>−</button>
        <span>{percent(scale)}</span>
        <button type="button" aria-label="Mehr Umfang" disabled={busy || scale >= SCALE_STEPS.at(-1)} onClick={() => step(1)}>+</button>
      </div>
      {scale !== stored && <button type="button" className="coach-primary" disabled={busy || disabled} onClick={() => save(scale)}>Übernehmen</button>}
      <small className="coach-muted">Tippe auf eine Woche, um nur diese Woche zu ändern: Belastung oder Erholung und ihre Stunden. Den Schwerpunkt (z. B. VO2max) änderst du oben mit „Phasen ändern“.</small>
    </div>}
    <div className="plan-hours-wrap" ref={wrap}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Geplante Stunden pro Woche, ${weeks.length} Wochen, höchstens ${fmt(peak)} h`}
        onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t} className="plan-hours-grid"><line x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
          <text x={left - 6} y={y(t) + 3} textAnchor="end">{fmt(t)}{t === ceiling ? ' h' : ''}</text></g>)}
        {weeks.map((w, i) => {
          const x = left + i * slot + (slot - barW) / 2;
          const value = w.hours || 0;
          const h = Math.max(0, y(0) - y(value));
          const r = Math.min(3, barW / 2, h);
          const kind = w.deload ? 'deload' : 'load';
          return <g key={w.week}>
            {h > 0 && <path className={`plan-hours-bar ${kind}${w.state === 'past' ? ' past' : ''}${w.own ? ' own' : ''}${hover === i || selected === i ? ' active' : ''}`}
              d={`M${x},${y(0)} V${y(value) + r} Q${x},${y(value)} ${x + r},${y(value)} H${x + barW - r} Q${x + barW},${y(value)} ${x + barW},${y(value) + r} V${y(0)} Z`} />}
            {w.state === 'current' && <path className="plan-hours-today" d={`M${x + barW / 2 - 4},${top - 12} h8 l-4,6 z`}><title>Diese Woche</title></path>}
            {(i % labelEvery === 0) && <text className="plan-hours-x" x={x + barW / 2} y={y(0) + 12} textAnchor="middle">{w.number}</text>}
            <rect className={`plan-hours-hit${editable ? ' editable' : ''}`} x={left + i * slot} y={top - 14} width={slot} height={plotH + 14} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
              onClick={() => open(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } }}
              tabIndex={0} role={editable ? 'button' : undefined}
              aria-label={`Woche ${w.number}: ${fmt(w.hours)} h, ${w.phaseName || 'ohne Phase'}${w.deload ? ', Erholung' : ''}${w.own ? ', eigene Woche' : ''}`} />
          </g>;
        })}
        {events.map(e => { const x = left + (e.planWeek - 1) * slot + slot / 2; return <g key={e.id} className={`plan-hours-event ${e.priority}`}>
          <line x1={x} x2={x} y1={top - 4} y2={y(0)} /><text x={x} y={top - 6} textAnchor="middle">{e.priority}</text><title>{`${e.title} (${e.priority})`}</title></g>; })}
        <line className="plan-hours-axis" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {phases.map(p => { const x1 = left + p.from * slot + 1, x2 = left + (p.from + p.weeks) * slot - 1; return <g key={p.id} className="plan-hours-phase">
          <line className={p.blockType} x1={x1} x2={x2} y1={y(0) + 20} y2={y(0) + 20} />
          {x2 - x1 > 3 * TEXT_WIDTH && <text x={(x1 + x2) / 2} y={y(0) + 34} textAnchor="middle">{phaseLabel(p.typeName, x2 - x1)}<title>{p.typeName}</title></text>}</g>; })}
      </svg>
      {shown && selected == null && <div className="plan-hours-tip" role="status" style={{ left: `${Math.min(80, Math.max(8, (left + (hover + 0.5) * slot) / width * 100))}%` }}>
        <strong>Woche {shown.number} · {fmt(shown.hours)} h</strong>
        {shown.plan && Math.abs(shown.hours - shown.target) >= 0.05 && <span>Ziel {fmt(shown.target)} h</span>}
        <span>{shortDate(shown.startDate)} · {shown.phaseName || '—'}{shown.deload ? ' · Erholung' : ''}</span>
        <span>{shown.plan ? 'ausgearbeitet' : shown.state === 'past' ? 'vorbei' : 'vorgemerkt'}{shown.own ? ' · eigene Woche' : ''}</span></div>}
    </div>
    {selected != null && <WeekVolumeEditor key={weeks[selected].week} week={weeks[selected]} busy={busy || disabled} error={error}
      onSave={change => save(stored, change)} onReset={() => save(stored, { week: weeks[selected].week, kind: null, hours: null })}
      onClose={() => setSelected(null)} />}
    {selected == null && error && <div role="alert" className="coach-message error">{error}</div>}
    <details className="plan-hours-table"><summary>Als Tabelle</summary>
      <table className="coach-table"><thead><tr><th>Woche</th><th>Beginn</th><th>Phase</th><th>Stunden</th></tr></thead>
        <tbody>{weeks.map(w => <tr key={w.week}><td>{w.number}</td><td>{shortDate(w.startDate)}</td><td>{w.phaseName || '—'}{w.deload ? ' · Erholung' : ''}</td><td>{fmt(w.hours)} h{w.own ? ' · eigene' : ''}</td></tr>)}</tbody></table>
    </details>
  </figure>;
}

/** How many weeks ahead get worked out with sessions: three by default, more if the athlete wants. */
export function HorizonSetting({ apiBase, overview, disabled, onSaved, onRebuild }) {
  const stored = overview.horizonWeeks || 3;
  const [value, setValue] = useState(stored);
  const [rebuilding, setRebuilding] = useState(false);
  const worked = overview.weeks.filter(w => w.plan && w.state !== 'past').length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const maximum = Math.max(stored, overview.weeks.filter(w => w.state !== 'past').length);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const { startDate, endDate, replanMode } = overview.settings;
      await request(apiBase, '/api/coach/plan/settings', 'PUT', { startDate, endDate, replanMode, horizonWeeks: value });
      onSaved(value);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return <section className="coach-card plan-horizon" aria-label="Wochen ausarbeiten">
    <div><span className="coach-eyebrow">Ausarbeiten</span><h3>Wie viele Wochen im Voraus?</h3>
      <p className="coach-muted">So viele Wochen bekommen konkrete Einheiten im Kalender. Die Phasen und Zielstunden bis zum Ziel bleiben davon unberührt.</p></div>
    <div className="plan-horizon-control">
      <div className="plan-editor-weeks" role="group" aria-label="Wochen im Voraus">
        <button type="button" aria-label="Eine Woche weniger" disabled={value <= 1} onClick={() => setValue(v => v - 1)}>−</button>
        <span>{weeksText(value)}</span>
        <button type="button" aria-label="Eine Woche mehr" disabled={value >= maximum} onClick={() => setValue(v => v + 1)}>+</button>
      </div>
      <button type="button" className="coach-primary" disabled={disabled || busy || value === stored} onClick={save}>Übernehmen</button>
    </div>
    {value !== stored && <p className="coach-muted">Standard sind 3 Wochen. Nach dem Übernehmen arbeitet der Coach fehlende Wochen aus.</p>}
    {error && <div role="alert" className="coach-message error">{error}</div>}
    {onRebuild && worked > 0 && <div className="plan-rebuild">
      {rebuilding ? <div className="coach-message" role="group" aria-label="Neu ausarbeiten bestätigen">
        <span>Alle {worked === 1 ? 'ausgearbeitete Woche' : `${worked} ausgearbeiteten Wochen`} neu ausarbeiten? Der Coach plant jede Woche komplett neu nach
          ihrer Phase und den aktuellen Leitlinien. Einheiten mit „Behalten“ und vergangene Tage bleiben. Du bekommst einen Vorschlag; in den Kalender
          kommt er erst mit „Übernehmen“.</span>
        <button type="button" className="coach-primary" disabled={disabled} onClick={() => { setRebuilding(false); onRebuild(); }}>Neu ausarbeiten</button>
        <button type="button" onClick={() => setRebuilding(false)}>Abbrechen</button></div>
        : <><button type="button" disabled={disabled} onClick={() => setRebuilding(true)}>Alle Wochen neu ausarbeiten</button>
          <small className="coach-muted">Alle Einheiten der ausgearbeiteten Wochen neu generieren lassen, z. B. nach geänderten Werten oder Leitlinien.</small></>}
    </div>}
  </section>;
}
