import React, { useEffect, useMemo, useState } from 'react';
import BestEfforts from './BestEfforts';
import './Dashboard.css';

const SPORTS = { ride: ['Radfahren', '#3b82f6'], run: ['Laufen', '#22a879'], swim: ['Schwimmen', '#06b6d4'], walking: ['Gehen', '#e7a838'], hiking: ['Wandern', '#a78bfa'], multisport: ['Multisport', '#8b5cf6'] };
const ZONE_COLORS = ['#94a3b8', '#3b82f6', '#20b89a', '#e7b345', '#f28352', '#e25578', '#9762d9'];
const number = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '—';
const hours = value => value == null ? '—' : `${number(value / 3600, 1)} h`;
const dateLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const shortDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short' });
const range = week => week ? `${dateLabel(week.key)}–${dateLabel(week.end)}${week.key.slice(0, 4) === week.end.slice(0, 4) ? ` ${week.end.slice(0, 4)}` : ` (${week.key.slice(0, 4)}/${week.end.slice(0, 4)})`}` : '';
const sum = values => values.reduce((total, value) => total + (value || 0), 0);
const knownTotal = (rows, key) => rows.some(row => row.known[key]) || rows.every(row => !row.count) ? sum(rows.map(row => row[key])) : null;

function Toggle({ label, value, onChange, options }) {
  return <div className="analysis-toggle" role="group" aria-label={label}>{options.map(([key, text]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div>;
}

function Card({ title, eyebrow, extra, children, className = '' }) {
  return <section className={`analysis-card ${className}`} aria-label={title}>
    <header className="analysis-card-header"><div>{eyebrow && <span className="analysis-eyebrow">{eyebrow}</span>}<h3>{title}</h3></div>{extra}</header>
    {children}
  </section>;
}

export function BarChart({ rows, series, unit, label, digits = 0, calendar, emptyText = 'Für diesen Zeitraum sind keine Messwerte vorhanden.' }) {
  const [hover, setHover] = useState(null);
  const totals = rows.map(row => sum(series.map(item => row[item.key])));
  const maximum = Math.max(1, ...totals) * 1.15;
  const step = 520 / Math.max(1, rows.length);
  const dense = rows.length > 16;
  const width = Math.min(46, step * (dense ? .76 : .58));
  const ticks = [];
  if (dense && calendar) {
    const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    rows.forEach((row, index) => {
      // Thursday assigns each weekly bar to its main month; clamp weeks
      // straddling New Year to the selected calendar year's boundaries.
      let date = new Date(`${row.key}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 3);
      if (calendar !== 'all') date = new Date(Math.max(Date.UTC(Number(calendar), 0, 1), Math.min(Date.UTC(Number(calendar), 11, 31), date.getTime())));
      const text = calendar === 'all' ? String(date.getUTCFullYear()) : months[date.getUTCMonth()];
      const previous = ticks[ticks.length - 1];
      if (previous?.text === text) previous.end = index;
      else ticks.push({ text, start: index, end: index });
    });
  }
  const available = rows.some(row => series.some(item => Number.isFinite(row[item.key])));
  const describe = row => `${row.description || row.label}: ${row.future ? 'noch ausstehend' : series.map(item => `${item.label} ${number(row[item.key], digits)} ${unit}`).join(' · ')}${row.partial ? ' · unvollständige Daten' : ''}`;
  return <div className={`analysis-chart${dense ? ' analysis-chart-dense' : ''}`}>
    {!available ? <div className="analysis-empty">{emptyText}</div> : <>
      <svg viewBox="0 0 600 220" role="img" aria-label={label}>
        {[0, .5, 1].map(fraction => <g key={fraction}><line x1="57" x2="590" y1={176 - fraction * 140} y2={176 - fraction * 140} stroke="#e8edf3" strokeDasharray={fraction ? '3 4' : undefined} /><text x="48" y={180 - fraction * 140} textAnchor="end">{number(maximum * fraction, maximum < 10 ? 1 : 0)}</text></g>)}
        <text x="57" y="18">{unit}</text>
        {rows.map((row, index) => {
          let offset = 0;
          const missing = series.every(item => !Number.isFinite(row[item.key]));
          return <g key={row.key} tabIndex="0" aria-label={describe(row)} onClick={() => setHover(row.key)} onMouseEnter={() => setHover(row.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(row.key)} onBlur={() => setHover(null)}>
            <title>{describe(row)}</title>
            <rect x={60 + index * step} y="28" width={step} height="148" fill={hover === row.key ? '#e9eff7' : row.future ? '#f3f5f8' : 'transparent'} rx={dense ? 0 : 5} />
            {series.map(item => {
              const value = row[item.key] || 0;
              const height = value / maximum * 140;
              offset += height;
              return <rect key={item.key} x={60 + index * step + (step - width) / 2} y={176 - offset} width={width} height={height} fill={item.color} rx={series.length === 1 ? Math.min(4, width / 3) : 0} opacity={hover && hover !== row.key ? .6 : 1} />;
            })}
            {missing && !row.future && <line x1={60 + (index + .5) * step - Math.min(3, width / 2)} x2={60 + (index + .5) * step + Math.min(3, width / 2)} y1="169" y2="169" stroke="#94a3b8" />}
            {dense && row.partial && !missing && <circle cx={60 + (index + .5) * step} cy={172 - offset} r="1.6" fill="#c08432" />}
            {!ticks.length && (!dense || index % Math.ceil(rows.length / 10) === 0) && <text x={60 + (index + .5) * step} y="201" textAnchor="middle">{row.label}{row.partial ? '*' : ''}</text>}
          </g>;
        })}
        {ticks.map((tick, index) => <text className={`analysis-calendar-tick${index % 2 ? ' analysis-axis-secondary' : ''}`} key={`${tick.text}-${tick.start}`} x={60 + (tick.start + tick.end + 1) / 2 * step} y="201" textAnchor="middle">{tick.text}</text>)}
      </svg>
      <div className="analysis-chart-caption" aria-live="polite">{hover && rows.some(row => row.key === hover) ? describe(rows.find(row => row.key === hover)) : 'Balken berühren oder auswählen für genaue Werte.'}</div>
      {(rows.some(row => row.future) || (dense && rows.some(row => row.partial))) && <div className="analysis-chart-legend">{rows.some(row => row.future) && <span><i className="analysis-future-key" />Noch ausstehend</span>}{dense && rows.some(row => row.partial) && <span><i className="analysis-partial-key" />Teildaten</span>}</div>}
      <details className="analysis-data"><summary>Werte als Tabelle</summary><div className="analysis-table-scroll"><table><caption>{label}</caption><thead><tr><th>Zeitraum</th>{series.map(item => <th key={item.key}>{item.label} ({unit})</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.description || row.label}{row.partial ? ' *' : ''}</th>{series.map(item => <td key={item.key}>{row.future ? 'Ausstehend' : number(row[item.key], digits)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </div>;
}

function SportShare({ rows }) {
  const total = sum(rows.map(row => row.seconds));
  let cursor = 0;
  const sorted = [...rows].sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
  const gradient = sorted.filter(row => row.seconds > 0).map(row => {
    const start = cursor;
    cursor += row.seconds / total * 100;
    return `${SPORTS[row.key]?.[1] || '#94a3b8'} ${start}% ${cursor}%`;
  }).join(', ');
  return <>
    <div className="sport-share-ring" style={{ background: total ? `conic-gradient(${gradient})` : '#e8edf3' }} role="img" aria-label={`Trainingszeit nach Sportart: ${sorted.map(row => `${SPORTS[row.key]?.[0] || row.key} ${hours(row.seconds)}`).join(', ')}`}><div><strong>{hours(total)}</strong><span>Trainingszeit</span></div></div>
    <div className="sport-share-legend">{sorted.map(row => <div key={row.key}><i style={{ background: SPORTS[row.key]?.[1] || '#94a3b8' }} /><span>{SPORTS[row.key]?.[0] || row.key}</span><strong>{hours(row.seconds)}</strong><small>{total && row.seconds != null ? `${number(row.seconds / total * 100, 1)} %` : '—'}</small></div>)}</div>
    {!total && <p className="analysis-note">Noch keine Trainingszeiten im gewählten Zeitraum.</p>}
    {rows.some(row => row.known.seconds < row.count) && <p className="analysis-note">Anteile nur aus Einheiten mit bekannter Dauer.</p>}
  </>;
}

function ZoneCard({ type, weeks, threshold, onSettings, year }) {
  const hr = type === 'hr';
  const title = hr ? 'Zeit in Herzfrequenz-Zonen' : 'Zeit in Leistungszonen';
  const zoneKey = hr ? 'hrZones' : 'powerZones';
  const names = hr ? ['≤60 %', '60–70 %', '70–80 %', '80–90 %', '>90 %'] : ['≤55 %', '55–75 %', '75–90 %', '90–105 %', '105–120 %', '120–150 %', '>150 %'];
  const series = names.map((name, index) => ({ key: `z${index}`, label: `Z${index + 1}`, color: ZONE_COLORS[index] }));
  const rows = weeks.map(week => ({ key: week.key, label: week.label, future: week.future, description: `${week.label} · ${range(week)}`, ...Object.fromEntries(series.map((item, index) => [item.key, week.known[type] || !week.count ? week[zoneKey][index] / 3600 : null])) }));
  const measured = sum(weeks.map(week => sum(week[zoneKey])));
  return <Card title={title} eyebrow={hr ? 'Intensität · alle gewählten Sportarten' : 'Intensität · nur Radfahren'} extra={<span className="analysis-badge">pro Woche</span>}>
    {threshold ? <>
      <div className="analysis-card-value">{hours(measured)} <span>mit zugeordneten Messwerten</span></div>
      <BarChart rows={rows} series={series} unit="h" digits={2} calendar={year} label={`${title} pro Woche`} />
      <div className="zone-legend">{names.map((name, index) => <span key={name}><i style={{ background: ZONE_COLORS[index] }} /><b>Z{index + 1}</b> {name}</span>)}</div>
      <p className="analysis-note">{hr ? `Anteil der HFmax (${number(threshold)} bpm).` : `Anteil der FTP (${number(threshold)} W); 0 W zählt zu Z1.`} Grenzwerte zählen zur niedrigeren Zone. Nur aufgezeichnete Zeitintervalle, Lücken über 30 s ausgenommen.</p>
    </> : <div className="analysis-setup-empty"><span>{hr ? '♥' : 'ϟ'}</span><p>{hr ? 'Mit deiner maximalen Herzfrequenz wird die Intensitätsverteilung sichtbar.' : 'Hinterlege deine FTP, um deine Trainingszeit auf sieben Leistungszonen aufzuteilen.'}</p><button type="button" onClick={onSettings}>{hr ? 'HFmax hinterlegen' : 'FTP hinterlegen'} →</button></div>}
  </Card>;
}

export default function Dashboard({ apiBase, activities, loading, onOpenActivity }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [sport, setSport] = useState('all');
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState({ ftp: '', maxHr: '' });
  const [saveState, setSaveState] = useState({});
  const [annualMetric, setAnnualMetric] = useState('distance');
  const [tssMode, setTssMode] = useState('week');
  const [dayWeekKey, setDayWeekKey] = useState(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  const requestKey = `${year}/${sport}/${retry}`;
  useEffect(() => {
    if (loading) return undefined;
    const controller = new AbortController();
    setResult({ status: 'loading', requestKey });
    fetch(`${apiBase}/api/analytics?${new URLSearchParams({ year, sport, timezone })}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Die Analysen konnten nicht geladen werden.');
        if (!controller.signal.aborted) setResult({ status: 'ready', requestKey, payload });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ status: 'error', requestKey, error: error.message });
      });
    return () => controller.abort();
  }, [apiBase, year, sport, timezone, activities, loading, retry, requestKey]);
  const ready = result?.requestKey === requestKey && result.status === 'ready';
  const data = ready ? result.payload : null;
  const years = useMemo(() => Array.from(new Set([new Date().getFullYear(), ...activities.map(a => new Date(a.date).getFullYear())])).filter(Number.isFinite).sort((a, b) => b - a), [activities]);
  const weeks = data?.weeks || [];
  const lastWeek = weeks.find(week => week.key === dayWeekKey) || [...weeks].reverse().find(week => !week.future) || weeks[0];
  const periodDescription = year === 'all' ? 'im gesamten Zeitraum' : `im Jahr ${year}`;
  const openSettings = () => { setDraft({ ftp: data?.settings.ftp ?? '', maxHr: data?.settings.maxHr ?? '' }); setSaveState({}); setSettingsOpen(true); };
  const save = async event => {
    event.preventDefault();
    setSaveState({ saving: true });
    try {
      const response = await fetch(`${apiBase}/api/user`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ftp: draft.ftp === '' ? null : Number(draft.ftp), maxHr: draft.maxHr === '' ? null : Number(draft.maxHr) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Speichern fehlgeschlagen.');
      setSettingsOpen(false);
      setSaveState({ message: 'Analysewerte gespeichert.' });
      setRetry(value => value + 1);
    } catch (error) { setSaveState({ error: error.message }); }
  };
  const weeklyRows = (metric, divisor = 1) => weeks.map(week => ({ key: week.key, label: week.label, future: week.future, description: `${week.label} · ${range(week)}`, value: week[metric] == null ? null : week[metric] / divisor, partial: week.known[metric] < week.count }));
  const tssRows = tssMode === 'week' ? weeklyRows('tss') : (lastWeek?.days || []).map(day => ({ key: day.key, label: shortDate(day.key), future: day.future, description: `${shortDate(day.key)} ${dateLabel(day.key)}`, value: day.tss, partial: day.known.tss < day.count }));
  const scope = year === 'all' ? 'All-Time' : year;
  const sportName = sport === 'all' ? 'Alle Sportarten' : SPORTS[sport][0];
  return <div className="athlete-dashboard">
    <header className="analysis-heading"><div><span className="analysis-eyebrow">Dein Training in Zahlen</span><h2>Dashboard</h2><p>Umfang, Entwicklung und Intensität im Blick.</p></div><div className="analysis-filters"><label>Zeitraum<select value={year} onChange={event => { setYear(event.target.value); setDayWeekKey(null); }} aria-label="Analysezeitraum">{years.map(value => <option key={value} value={value}>{value}</option>)}<option value="all">All-Time</option></select></label><label>Sportart<select value={sport} onChange={event => setSport(event.target.value)} aria-label="Sportart für Wochenanalysen"><option value="all">Alle Sportarten</option>{Object.entries(SPORTS).map(([key, [name]]) => <option key={key} value={key}>{name}</option>)}</select></label><button type="button" className="analysis-settings-button" onClick={openSettings} disabled={!data}>FTP &amp; Zonen</button></div></header>
    {settingsOpen && <form className="analysis-settings" onSubmit={save}>
      <div><h3>Deine Analysewerte</h3><p>Diese Werte werden für den gesamten gewählten Zeitraum verwendet. Historische FTP-Änderungen werden nicht berücksichtigt.</p></div>
      <label>FTP (W)<input type="number" min="1" max="1000" step="1" placeholder="Deine FTP" value={draft.ftp} onChange={event => setDraft({ ...draft, ftp: event.target.value })} /></label>
      <label>HFmax (bpm)<input type="number" min="60" max="250" step="1" placeholder="Deine HFmax" value={draft.maxHr} onChange={event => setDraft({ ...draft, maxHr: event.target.value })} /></label>
      <button type="submit" disabled={saveState.saving}>{saveState.saving ? 'Speichert…' : 'Speichern'}</button><button type="button" className="analysis-cancel" onClick={() => setSettingsOpen(false)} disabled={saveState.saving}>Abbrechen</button>
      {saveState.error && <p role="alert">{saveState.error}</p>}
    </form>}
    {saveState.message && <p className="analysis-note" role="status">{saveState.message}</p>}
    {!ready && result?.status !== 'error' && <div className="analysis-loading" role="status">Trainingsanalysen werden geladen… Beim ersten Aufruf werden die Aufzeichnungen ausgewertet.</div>}
    {result?.requestKey === requestKey && result.status === 'error' && <div className="analysis-loading" role="alert">{result.error} <button type="button" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</button></div>}
    {data && <>
      <div className="analysis-summary">{[
        ['Trainingseinheiten', number(data.totals.count), 'count', '#345e91'],
        ['Trainingszeit', hours(data.totals.seconds), 'seconds', '#278c78'],
        ['Distanz', `${number(data.totals.distance, 1)} km`, 'distance', '#5b6cc1'],
        ['Höhenmeter', `${number(data.totals.elevation)} m`, 'elevation', '#c08432'],
      ].map(([label, value, key, color]) => <div key={key}><span>{label}</span><strong style={{ color }}>{value}</strong><small>{scope} · {sportName}{key !== 'count' && data.totals.known[key] < data.totals.count ? ' · teilweise erfasst' : ''}</small></div>)}</div>
      {!data.totals.count && <p className="analysis-empty-banner">Keine Aktivitäten für diese Auswahl. Wähle ein anderes Jahr oder importiere deine Trainingsdateien.</p>}
      <div className="analysis-overview-grid">
        <Card title="Dein Sportarten-Mix" eyebrow={`Zeitanteil · ${scope}`} extra={<span className="analysis-badge">alle Sportarten</span>}><SportShare rows={data.sportShare} /></Card>
        <Card title="Radfahren im Jahresvergleich" eyebrow="Alle Jahre mit Raddaten" className="analysis-wide" extra={<Toggle label="Kennzahl für Jahresvergleich" value={annualMetric} onChange={setAnnualMetric} options={[[ 'distance', 'Kilometer' ], [ 'elevation', 'Höhenmeter' ]]} />}>
          <div className="analysis-card-value">{number(knownTotal(data.cyclingYears, annualMetric), annualMetric === 'distance' ? 1 : 0)} {annualMetric === 'distance' ? 'km' : 'm'} <span>in {data.cyclingYears.length} Jahren</span></div>
          <BarChart rows={data.cyclingYears.map(row => ({ key: row.key, label: row.key, value: row[annualMetric], partial: row.known[annualMetric] < row.count }))} series={[{ key: 'value', label: annualMetric === 'distance' ? 'Distanz' : 'Höhenmeter', color: annualMetric === 'distance' ? '#5a8ee3' : '#24a594' }]} unit={annualMetric === 'distance' ? 'km' : 'm'} digits={annualMetric === 'distance' ? 1 : 0} label={`Radfahren: ${annualMetric === 'distance' ? 'Kilometer' : 'Höhenmeter'} je Jahr`} />
          <p className="analysis-note">Alle importierten Rad-Einheiten. Das laufende Jahr ist noch unvollständig; * markiert fehlende Messwerte.</p>
        </Card>
        <BestEfforts apiBase={apiBase} activities={activities} viewedYear={year} onOpenActivity={onOpenActivity} />
        <Card title="Trainingsumfang" eyebrow={`${sportName} · ${scope}`} className="analysis-wide" extra={<span className="analysis-badge">{year === 'all' ? 'Gesamter Zeitraum' : 'Januar–Dezember'}</span>}>
          <div className="analysis-card-value">{hours(knownTotal(weeks, 'seconds'))} <span>{periodDescription}</span></div>
          <BarChart rows={weeklyRows('seconds', 3600)} series={[{ key: 'value', label: 'Trainingszeit', color: '#728ac7' }]} unit="h" digits={1} calendar={year} label="Trainingszeit pro Woche" />
          <p className="analysis-note">{year === 'all' ? 'Der gesamte gespeicherte Zeitraum' : `Januar bis Dezember ${year}`} · ein Balken pro Kalenderwoche. Genaue Wochenwerte findest du am Balken und in der Tabelle.</p>
        </Card>
      </div>
      <div className="analysis-week-toolbar"><div><h3>Deine Trainingswochen</h3><p>{sportName} · {scope} · Montag bis Sonntag · {timezone}</p></div><span className="analysis-badge">{weeks.length} Kalenderwochen im Überblick</span></div>
      <div className="analysis-week-grid">
        <Card title="Verbrauchte Kalorien" eyebrow="Energie · pro Woche" extra={<span className="analysis-badge">kcal</span>}>
          <div className="analysis-card-value">{number(knownTotal(weeks, 'calories'))} <span>kcal {periodDescription}</span></div>
          <BarChart rows={weeklyRows('calories')} series={[{ key: 'value', label: 'Energie', color: '#e7a354' }]} unit="kcal" calendar={year} label="Verbrauchte Kalorien pro Woche" />
          <p className="analysis-note">Gespeicherte Aktivitätskalorien, je nach Quelle gemessen oder geschätzt. * = nicht alle Einheiten enthalten Kalorien.</p>
        </Card>
        <Card title="Trainingsbelastung · TSS" eyebrow="Radfahren · aus Leistungsdaten" extra={<Toggle label="TSS Ansicht" value={tssMode} onChange={setTssMode} options={[[ 'week', 'Woche' ], [ 'day', 'Tag' ]]} />}>
          {tssMode === 'day' && <label className="analysis-day-selector">Woche für Tagesansicht<select aria-label="Woche für TSS-Tagesansicht" value={lastWeek?.key || ''} onChange={event => setDayWeekKey(event.target.value)}>{weeks.map(week => <option key={week.key} value={week.key}>{week.label} · {range(week)}</option>)}</select></label>}
          {data.settings.ftp ? <><div className="analysis-card-value">{number(knownTotal(tssMode === 'day' ? lastWeek?.days || [] : weeks, 'tss'))} <span>{tssMode === 'day' ? range(lastWeek) : `TSS ${periodDescription}`}</span></div><BarChart rows={tssRows} series={[{ key: 'value', label: 'TSS', color: '#8b79cc' }]} unit="TSS" calendar={tssMode === 'week' ? year : undefined} label={tssMode === 'day' ? 'TSS pro Tag' : 'TSS pro Woche'} /><p className="analysis-note">Geschätzt mit FTP {number(data.settings.ftp)} W und normalisierter Leistung. Nur Rad-Einheiten mit mindestens 95 % Leistungsabdeckung. * = nicht alle Einheiten auswertbar; für Laufen wird kein TSS berechnet.</p></> : <div className="analysis-setup-empty"><span>↗</span><p>Wie viel Belastung steckt in deinem Training? Hinterlege deine FTP für die TSS-Auswertung.</p><button type="button" onClick={openSettings}>FTP hinterlegen →</button></div>}
        </Card>
        <ZoneCard type="hr" weeks={weeks} year={year} threshold={data.settings.maxHr} onSettings={openSettings} />
        <ZoneCard type="power" weeks={weeks} year={year} threshold={data.settings.ftp} onSettings={openSettings} />
      </div>
      <details className="analysis-method"><summary>So werden die Analysen berechnet</summary><p>Zeitanteile basieren auf der gespeicherten Trainingsdauer (bei FIT: Timerzeit). Multisport-Einheiten werden nach ihren Sportabschnitten aufgeteilt. Jahre und Wochen richten sich nach dem lokalen Startdatum; Wochen am Jahresrand enthalten nur Einheiten des gewählten Jahres.</p><p>Zonenzeiten entstehen aus dem Zeitabstand aufeinanderfolgender Messpunkte. Fehlende Werte, Lücken über 30 Sekunden und Sportwechsel werden nicht überbrückt. Zonenzeiten können deshalb kleiner als die Trainingsdauer sein. Die HF-Zonen verwenden ein einfaches Fünf-Zonen-Modell relativ zur HFmax.</p><p>TSS = Stunden × (normalisierte Leistung / FTP)² × 100. Die normalisierte Leistung basiert auf vollständigen 30-Sekunden-Fenstern. Historische Werte verwenden die aktuell hinterlegte FTP; kurze Aufzeichnungen sind weniger aussagekräftig. <a href="https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power" target="_blank" rel="noreferrer">Berechnungsgrundlage bei TrainingPeaks ↗</a></p><p>Ein Strich bedeutet fehlende Daten, 0 eine leere Trainingswoche oder einen aufgezeichneten Nullwert. Bei Teildaten wird nur die bekannte Summe angezeigt. Die Bestwerte haben zusätzlich eine eigene Sportarten- und Jahresauswahl.</p></details>
    </>}
  </div>;
}
