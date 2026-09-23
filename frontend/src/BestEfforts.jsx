import React, { useEffect, useMemo, useState } from 'react';
import './BestEfforts.css';

const TARGETS = { ride: [[30, '30 Sek.'], [60, '1 Min.'], [180, '3 Min.'], [300, '5 Min.'], [600, '10 Min.'], [1200, '20 Min.'], [3600, '60 Min.']], run: [[400, '400 m'], [1000, '1 km'], [5000, '5 km'], [10000, '10 km'], [21000, '21 km']] };

export function effortValue(value, sport) {
  if (!Number.isFinite(value)) return '—';
  if (sport === 'ride') return `${Math.round(value).toLocaleString('de-DE')} W`;
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function BestEfforts({ apiBase, activities, viewedYear, onOpenActivity }) {
  const [sport, setSport] = useState('ride');
  const [period, setPeriod] = useState(String(viewedYear));
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  const requestKey = `${sport}/${period}/${timezone}`;
  useEffect(() => { setPeriod(String(viewedYear)); }, [viewedYear]);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ requestKey, status: 'loading' });
    const query = new URLSearchParams({ sport, year: period, timezone });
    fetch(`${apiBase}/api/best-efforts?${query}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Die Bestwerte konnten nicht geladen werden.');
        if (!controller.signal.aborted) setResult({ requestKey, status: 'ready', payload });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ requestKey, status: 'error', error: error.message });
      });
    return () => controller.abort();
  }, [apiBase, sport, period, timezone, requestKey, activities, retry]);
  const years = useMemo(() => Array.from(new Set([Number(viewedYear), new Date().getFullYear(), ...activities.map(a => new Date(a.date).getFullYear())])).filter(Number.isFinite).sort((a, b) => b - a), [activities, viewedYear]);
  const ready = result?.requestKey === requestKey && result.status === 'ready';
  const error = result?.requestKey === requestKey && result.status === 'error';
  const efforts = new Map((ready ? result.payload.efforts : []).map(effort => [effort.target, effort]));
  const any = ready && result.payload.efforts.some(effort => effort.value != null);
  return <section className="best-efforts" aria-label="Persönliche Bestwerte">
    <div className="best-efforts-heading"><h3>Bestwerte</h3><select aria-label="Zeitraum für Bestwerte" value={period} onChange={event => setPeriod(event.target.value)}>
      {years.map(year => <option key={year} value={year}>{year}</option>)}
      <option value="all">All-Time</option>
    </select></div>
    <div className="best-efforts-sports" role="group" aria-label="Sportart für Bestwerte">
      {[['ride', 'Radfahren'], ['run', 'Laufen']].map(([key, label]) => <button type="button" key={key} aria-pressed={sport === key} onClick={() => setSport(key)}>{label}</button>)}
    </div>
    <p className="best-efforts-caption">{sport === 'ride' ? 'Beste Ø Leistung' : 'Schnellste Zeit'} · {period === 'all' ? 'All-Time' : period}</p>
    {!ready && !error && <p className="best-efforts-status" role="status">Bestwerte werden berechnet…</p>}
    {error && <div className="best-efforts-status" role="alert">{result.error} <button type="button" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</button></div>}
    {ready && <>
      <table aria-label={sport === 'ride' ? 'Bestleistungen Radfahren' : 'Bestzeiten Laufen'}><thead><tr><th>{sport === 'ride' ? 'Dauer' : 'Distanz'}</th><th>{sport === 'ride' ? 'Leistung' : 'Zeit'}</th><th>Datum</th></tr></thead><tbody>
        {TARGETS[sport].map(([target, label]) => {
          const effort = efforts.get(target);
          const activity = effort?.activity;
          return <tr key={target}><th scope="row">{label}</th><td className="best-efforts-value">{effortValue(effort?.value, sport)}</td><td>{activity ? <button type="button" className="best-efforts-link" title={activity.title} aria-label={`${label}: ${activity.title} öffnen`} onClick={() => onOpenActivity(activity)}>{new Date(activity.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', ...(period === 'all' ? { year: '2-digit' } : {}) })} ↗</button> : '—'}</td></tr>;
        })}
      </tbody></table>
      {!any && <p className="best-efforts-status">{sport === 'ride' ? 'Noch keine ausreichend langen Aufzeichnungen mit Leistungsdaten' : 'Noch keine ausreichend langen Läufe mit Distanzdaten'} {period === 'all' ? 'vorhanden.' : `für ${period}.`}</p>}
      {any && <p className="best-efforts-hint">{sport === 'ride' ? 'Aus durchgehenden Leistungsdaten.' : 'Aus aufgezeichneten Distanzen, inklusive Pausen.'} Datum anklicken, um die Aktivität zu öffnen.</p>}
    </>}
  </section>;
}
