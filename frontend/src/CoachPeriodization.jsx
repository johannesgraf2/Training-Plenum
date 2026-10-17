import React, { useState } from 'react';
import { request } from './CoachChat';
import { addDays, dateLabel, daysBetween } from './coachOnboarding';

const TYPES = [['grundlage', 'Grundlage'], ['vo2max', 'VO2max'], ['schwelle', 'Schwelle'], ['aufbau', 'Aufbau'],
  ['wettkampfspezifisch', 'Wettkampfspezifisch'], ['taper', 'Taper'], ['uebergang', 'Übergang'], ['wiedereinstieg', 'Wiedereinstieg'], ['custom', 'Eigener Block']];
const fmt = value => Number(value || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const tzQuery = () => `timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`;
const shiftedDate = (date, days) => { try { return addDays(date, days); } catch (_) { return ''; } };

export function WeeklyHoursChart({ weeks }) {
  const [chosen, setChosen] = useState(null);
  if (!weeks.length) return null;
  const width = Math.max(640, weeks.length * 20), height = 230, left = 48, bottom = 194;
  const high = Math.max(1, ...weeks.map(w => w.targetHours || 0));
  const step = (width - left - 12) / weeks.length;
  const y = hours => bottom - hours / high * 166;
  const selected = weeks.find(w => w.week === chosen);
  return <section className="coach-card plan-hours" aria-label="Trainingsstunden bis zum Ziel">
    <h3>Trainingsstunden bis zum Ziel</h3>
    <p className="coach-muted">Zielstunden je Woche · Belastung, Entlastung und Taper</p>
    <div className="plan-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="img" aria-label="Wochen auf der horizontalen Achse, Trainingsstunden auf der vertikalen Achse">
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1={left} x2={width - 10} y1={y(high * f)} y2={y(high * f)} className="plan-chart-grid" />
        <text x={left - 8} y={y(high * f) + 4} textAnchor="end">{fmt(high * f)}</text></g>)}
      <text x="4" y="14">Stunden</text>
      {weeks.map((week, i) => <g key={week.week}>
        <rect x={left + i * step + 1} y={y(week.targetHours || 0)} width={Math.max(2, step - 3)} height={Math.max(1, bottom - y(week.targetHours || 0))}
          className={`plan-chart-bar ${week.phase === 'taper' ? 'taper' : week.deload ? 'recovery' : 'load'}`} tabIndex="0" role="button"
          aria-label={`Woche ${week.number}: ${fmt(week.targetHours)} Stunden, ${week.phase === 'taper' ? 'Taper' : week.deload ? 'Entlastung' : 'Belastung'}`}
          onFocus={() => setChosen(week.week)} onMouseEnter={() => setChosen(week.week)} onClick={() => setChosen(week.week)}
          onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setChosen(week.week); } }}>
          <title>Woche {week.number} · {dateLabel(week.startDate)} · {fmt(week.targetHours)} h · {week.phaseName}</title></rect>
        {(i === 0 || i === weeks.length - 1 || (i + 1) % Math.max(1, Math.ceil(weeks.length / 15)) === 0) && <text x={left + (i + .5) * step} y={bottom + 18} textAnchor="middle">{week.number}</text>}
      </g>)}
      <text x={width - 12} y={height - 4} textAnchor="end">Woche</text>
    </svg></div>
    <div className="plan-chart-legend"><span><i className="load" />Belastung</span><span><i className="recovery" />Entlastung</span><span><i className="taper" />Taper</span></div>
    <p aria-live="polite">{selected ? `Woche ${selected.number} ab ${dateLabel(selected.startDate, true)}: ${fmt(selected.targetHours)} h · ${selected.phaseName}` : 'Wähle eine Woche für die genauen Zielstunden.'}</p>
    <details className="coach-details"><summary>Zielstunden als Tabelle</summary><table className="coach-table"><thead><tr><th>Woche</th><th>Ab</th><th>Phase</th><th>Zielstunden</th><th>Status</th></tr></thead>
      <tbody>{weeks.map(w => <tr key={w.week}><td>{w.number}</td><td>{dateLabel(w.startDate, true)}</td><td>{w.phaseName}{w.phase === 'taper' ? ' · Taper' : w.deload ? ' · Entlastung' : ''}</td><td>{fmt(w.targetHours)} h</td><td>{w.plan ? 'Ausgearbeitet' : 'Vorgemerkt'}</td></tr>)}</tbody></table></details>
  </section>;
}

export function BlockEditor({ overview, apiBase, onSaved, onClose }) {
  const [phases, setPhases] = useState(() => overview.phases.map(p => ({ id: p.id, blockType: p.blockType, secondaryFocus: p.secondaryFocus || null,
    purpose: p.purpose || '', startDate: p.startDate, weeks: p.weeks })));
  const [taperWeeks, setTaperWeeks] = useState(overview.settings.taperWeeks || 1);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const align = (list, from = 1) => list.map((p, index) => {
    if (index >= from) p.startDate = shiftedDate(list[index - 1].startDate, Number(list[index - 1].weeks) * 7);
    return p;
  });
  const update = (index, patch) => setPhases(list => {
    const next = list.map(p => ({ ...p })); next[index] = { ...next[index], ...patch };
    return patch.startDate || (patch.weeks && Number.isInteger(Number(patch.weeks)) && Number(patch.weeks) > 0) ? align(next, index + 1) : next;
  });
  const move = (index, direction) => setPhases(list => {
    const next = list.map(p => ({ ...p })), start = list[0].startDate;
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    next[0].startDate = start; return align(next);
  });
  const add = index => setPhases(list => {
    const next = list.map(p => ({ ...p }));
    next.splice(index, 0, { id: null, blockType: 'vo2max', secondaryFocus: null, purpose: 'Eigener VO2max-Block',
      startDate: index === 0 ? list[0].startDate : shiftedDate(next[index - 1].startDate, Number(next[index - 1].weeks) * 7), weeks: 1 });
    return align(next);
  });
  const changeTaper = count => {
    const diff = count - taperWeeks;
    setTaperWeeks(count);
    setPhases(list => {
      const next = list.map(p => ({ ...p }));
      next.forEach((p, index) => { if (p.blockType === 'taper' && index > 0) { next[index - 1].weeks = Number(next[index - 1].weeks) - diff; p.weeks = count; } });
      return align(next);
    });
  };
  const invalid = phases.some(p => !p.startDate || !Number.isInteger(Number(p.weeks)) || Number(p.weeks) < 1);
  const total = phases.reduce((sum, p) => sum + Number(p.weeks || 0), 0);
  const first = overview.weeks[0]?.startDate;
  const expected = first ? Math.floor(daysBetween(first, overview.settings.endDate) / 7) + 1 : 0;
  async function save() {
    setBusy(true); setError('');
    try {
      await request(apiBase, '/api/coach/plan/phases', 'PUT', { revision: overview.revision, taperWeeks,
        phases: phases.map(p => ({ ...p, weeks: Number(p.weeks) })) });
      await onSaved(); onClose();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return <section className="coach-card plan-block-editor" aria-label="Trainingsblöcke bearbeiten">
    <h3>Trainingsblöcke bearbeiten</h3>
    <p>Verschieben oder verlängern verschiebt die folgenden Blöcke. Gleiche den Umfang anderer Blöcke so an, dass alle Wochen bis zum festen Planende gefüllt sind. Lücken, Überlappungen und Konflikte mit A-Events werden beim Speichern angezeigt.</p>
    <p className="coach-muted">Die Zielstunden werden aus deinem bisherigen Trainingsumfang mit 3 Belastungswochen und einer Entlastungswoche rückwärts vom Taper aufgebaut. Bereits ausgearbeitete Einheiten bleiben erhalten und werden zur Prüfung markiert.</p>
    {overview.events.some(e => e.priority === 'A') && <label className="coach-field"><span>Taper vor A-Events</span><select value={taperWeeks} onChange={e => changeTaper(Number(e.target.value))} disabled={busy}>
      <option value={1}>1 Woche</option><option value={2}>2 Wochen</option></select></label>}
    <ol>{phases.map((p, index) => <li key={p.id || `new-${index}`}>
      <div className="coach-form-grid">
        <label className="coach-field"><span>Blocktyp {index + 1}</span><select disabled={busy} value={p.blockType} onChange={e => update(index, { blockType: e.target.value })}>{TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="coach-field"><span>Start Block {index + 1}</span><input type="date" value={p.startDate} disabled={busy} onChange={e => update(index, { startDate: e.target.value })} /></label>
        <label className="coach-field"><span>Dauer Block {index + 1} (Wochen)</span><input type="number" min="1" step="1" value={p.weeks} disabled={busy} onChange={e => update(index, { weeks: e.target.value })} /></label>
        <label className="coach-field"><span>Ziel Block {index + 1}</span><input maxLength={200} value={p.purpose} disabled={busy} onChange={e => update(index, { purpose: e.target.value })} /></label>
      </div>
      <div className="coach-actions"><button type="button" disabled={busy || !index} aria-label={`Block ${index + 1} nach vorne`} onClick={() => move(index, -1)}>↑</button>
        <button type="button" disabled={busy || index === phases.length - 1} aria-label={`Block ${index + 1} nach hinten`} onClick={() => move(index, 1)}>↓</button>
        <button type="button" disabled={busy} onClick={() => add(index)}>Block davor hinzufügen</button>
        <button type="button" disabled={busy || phases.length === 1} onClick={() => setPhases(list => align(list.filter((_, i) => i !== index).map((s, i) => ({ ...s, ...(i === 0 ? { startDate: first } : {}) }))))}>Block entfernen</button></div>
    </li>)}</ol>
    <button type="button" disabled={busy} onClick={() => add(phases.length)}>+ Eigenen Block hinzufügen</button>
    <p role="status">{total} von {expected} Wochen belegt{total !== expected ? ` · Bitte ${Math.abs(expected - total)} Wochen ${total > expected ? 'an anderer Stelle kürzen' : 'ergänzen'}.` : ''}</p>
    {error && <p role="alert" className="coach-message error">{error}</p>}
    <div className="coach-actions"><button type="button" className="coach-primary" disabled={busy || invalid} onClick={save}>Blockplanung speichern</button><button type="button" disabled={busy} onClick={onClose}>Abbrechen</button></div>
  </section>;
}

export function GenerationControl({ overview, apiBase, disabled, onSaved, onJob }) {
  const [count, setCount] = useState(overview.settings?.generationWeeks || 3);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(generate) {
    setBusy(true); setError('');
    try {
      const { startDate, endDate, replanMode } = overview.settings;
      await request(apiBase, '/api/coach/plan/settings', 'PUT', { startDate, endDate, replanMode, generationWeeks: Number(count) });
      if (generate) {
        const result = await request(apiBase, `/api/coach/plan/create?${tzQuery()}`, 'POST', {});
        onJob?.(result.job);
      }
      await onSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const valid = Number.isInteger(Number(count)) && Number(count) >= 1;
  return <section className="coach-card plan-generation" aria-label="Auszuarbeitende Wochen">
    <h3>Wie viele Wochen möchtest du ausarbeiten?</h3>
    <label className="coach-field"><span>Anzahl auszuarbeitender Wochen</span><input type="number" min="1" step="1" value={count} onChange={e => setCount(e.target.value)} /></label>
    <p className="coach-muted">Ab der aktuellen Woche oder deinem späteren Planstart. Bereits ausgearbeitete Wochen bleiben erhalten. Die Übersicht der Phasen und Zielstunden reicht weiter bis zum Planende.</p>
    <div className="coach-actions"><button type="button" disabled={disabled || busy || !valid} onClick={() => save(false)}>Anzahl speichern</button>
      <button type="button" className="coach-primary" disabled={disabled || busy || !valid} onClick={() => save(true)}>Wochen ausarbeiten</button></div>
    {error && <p role="alert" className="coach-message error">{error}</p>}
  </section>;
}
