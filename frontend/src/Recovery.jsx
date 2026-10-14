import React, { useEffect, useRef, useState } from 'react';
import { localDate, workoutOverview } from './workoutModel';
import './Recovery.css';

// WHOOP recovery views for planning. Every value is the app's own approximation
// from the strap's raw data (backend/whoop_analytics.py), not a WHOOP score.

export const BAND_COLORS = { green: 'var(--success)', yellow: 'var(--warning)', red: 'var(--danger)' };
export const BAND_LABELS = { green: 'grün', yellow: 'gelb', red: 'rot' };
const CONFIDENCE = { calibrating: 'kalibriert', provisional: 'vorläufig', solid: 'verlässlich' };
const hm = minutes => (minutes == null ? '—' : `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')} h`);
const number = (value, digits = 0) => (Number.isFinite(value) ? value.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '—');
const weekdayName = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long' });
const shortDay = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const addDays = (key, days) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); };

export const calibrated = day => !!day && day.confidence !== 'calibrating';

/** HRV of the night relative to the baseline before it, in percent. */
export function hrvDeviation(day) {
  const mean = day?.hrvBaseline?.mean;
  return day?.hrv != null && mean ? Math.round((day.hrv / mean - 1) * 100) : null;
}

/** HRV below the personal normal range (baseline ± 1 SD), once the baseline is calibrated. */
export const hrvBelowBand = day => calibrated(day) && day.hrv != null && day.hrvBaseline?.low != null && day.hrv < day.hrvBaseline.low;

/** A planned workout with interval steps counts as hard. */
export function isHard(workout) {
  try { return workoutOverview(workout).segments.some(step => step.intensity === 'interval'); } catch (_) { return false; }
}

/**
 * Rule-based hint for today's plan:
 * red readiness with a hard session -> keep it easy or swap; red without one -> keep it easy;
 * HRV below its normal range with a hard session -> reduce intensity if it feels hard.
 * Returns null when there is nothing to say (no data, calibrating, or green).
 */
export function planningHint(day, todayKey, plannedWorkouts) {
  if (!calibrated(day)) return null;
  const today = plannedWorkouts.filter(workout => workout.date === todayKey);
  const hard = today.find(isHard);
  const swap = hard && [1, 2, 3].map(offset => addDays(todayKey, offset))
    .find(key => !plannedWorkouts.some(workout => workout.date === key && isHard(workout)));
  const swapText = swap ? ` oder mit ${weekdayName(swap)} tauschen` : '';
  if (day.band === 'red' && hard) {
    return { tone: 'red', workout: hard, title: 'Heute lieber locker',
      text: `Readiness ${day.readiness} (rot). Für heute ist „${hard.name || 'ein Intervalltraining'}“ geplant: besser locker trainieren${swapText}.` };
  }
  if (day.band === 'red') {
    return { tone: 'red', title: 'Erholung hat Vorrang',
      text: `Readiness ${day.readiness} (rot). ${today.length ? 'Halte die geplante Einheit locker.' : 'Gut, dass heute nichts Hartes ansteht.'}` };
  }
  if (hrvBelowBand(day) && hard) {
    return { tone: 'yellow', workout: hard, title: 'HRV unter deinem Normalbereich',
      text: `HRV ${number(day.hrv)} ms, dein Normalbereich liegt bei ${number(day.hrvBaseline.low)}–${number(day.hrvBaseline.high)} ms. Wenn sich „${hard.name || 'die Einheit'}“ schwer anfühlt: Intensität reduzieren${swapText}.` };
  }
  return null;
}

/** Averages for one calendar week: readiness, HRV and the HRV baseline over the same nights. */
export function weekRecovery(keys, days) {
  const nights = keys.map(key => days[key]).filter(Boolean);
  const scored = nights.filter(day => day.readiness != null);
  const hrv = nights.filter(day => day.hrv != null && day.hrvBaseline?.mean);
  if (!scored.length && !hrv.length) return null;
  const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
  const hrvMean = hrv.length ? mean(hrv.map(day => day.hrv)) : null;
  const baseMean = hrv.length ? mean(hrv.map(day => day.hrvBaseline.mean)) : null;
  return { readiness: scored.length ? Math.round(mean(scored.map(day => day.readiness))) : null, nights: nights.length,
    hrv: hrvMean, hrvDeviation: hrvMean != null ? Math.round((hrvMean / baseMean - 1) * 100) : null };
}

const bandOf = score => (score == null ? null : score < 34 ? 'red' : score < 67 ? 'yellow' : 'green');

export function ReadinessRing({ day, size = 64 }) {
  const score = day?.readiness;
  const circumference = 2 * Math.PI * 26;
  return <svg className="recovery-ring" width={size} height={size} viewBox="0 0 64 64" role="img"
    aria-label={score != null ? `Readiness ${score} von 100, ${BAND_LABELS[day.band]}` : 'Readiness wird noch kalibriert'}>
    <circle cx="32" cy="32" r="26" className="track" />
    {score != null && <circle cx="32" cy="32" r="26" className="value" style={{ stroke: BAND_COLORS[day.band] }}
      strokeDasharray={`${score / 100 * circumference} ${circumference}`} transform="rotate(-90 32 32)" />}
    <text x="32" y="38" textAnchor="middle">{score ?? '…'}</text>
  </svg>;
}

/** "Erholung" tile for the start page. Hidden when there is no WHOOP data at all. */
export function RecoveryTile({ days, todayKey, onOpenWhoop }) {
  const keys = Object.keys(days || {}).sort();
  if (!keys.length) return null;
  const day = days[todayKey];
  const latest = days[keys[keys.length - 1]];
  const deviation = hrvDeviation(day);
  return <section className="home-card home-block recovery-tile" aria-labelledby="home-recovery">
    <div className="home-block-head"><h2 id="home-recovery">Erholung</h2>
      {onOpenWhoop && <button type="button" className="home-link" onClick={onOpenWhoop}>WHOOP</button>}</div>
    {!day ? <p className="home-muted">Für heute ist noch keine Nacht ausgewertet. Zuletzt: {shortDay(latest.date)}.</p> : <>
      <div className="recovery-summary">
        <ReadinessRing day={day} />
        <p><strong>{day.readiness != null ? `Readiness ${BAND_LABELS[day.band]}` : 'Kalibrierung läuft'}</strong>
          <span>{day.readiness != null ? `${CONFIDENCE[day.confidence]} · ${day.nights} Nächte` : `${Math.min(day.nights, 4)} von 4 Nächten, danach gibt es eine Zahl`}</span></p>
      </div>
      <dl className="recovery-figures">
        <div><dt>HRV</dt><dd>{day.hrv != null ? `${number(day.hrv)} ms` : '—'}{deviation != null && <small className={deviation < 0 ? 'down' : 'up'}> {deviation > 0 ? '+' : ''}{deviation} %</small>}</dd></div>
        <div><dt>Ruhepuls</dt><dd>{day.rhr != null ? `${number(day.rhr)} bpm` : '—'}</dd></div>
        <div><dt>Schlaf</dt><dd>{hm(day.sleep?.minutes)}</dd></div>
        <div><dt>Schlafschuld</dt><dd>{hm(day.sleepDebtMinutes)}</dd></div>
      </dl>
    </>}
    <p className="recovery-note">Eigene Näherung aus den WHOOP-Rohdaten, kein offizieller Score.</p>
  </section>;
}

export function RecoveryHint({ hint, onOpenWorkout, onOpenCoach }) {
  if (!hint) return null;
  return <div className={`recovery-hint recovery-hint-${hint.tone}`} role="note">
    <div><strong>{hint.title}</strong><p>{hint.text}</p></div>
    <div className="recovery-hint-actions">
      {hint.workout && <button type="button" className="home-link" onClick={() => onOpenWorkout(hint.workout)}>Workout öffnen</button>}
      {onOpenCoach && <button type="button" className="home-link" onClick={onOpenCoach}>Im AI Coach anpassen</button>}
    </div>
  </div>;
}

/** Coloured dot and readiness value for a calendar day header. */
export function ReadinessBadge({ day }) {
  if (!day) return null;
  const parts = [day.readiness != null ? `Readiness ${day.readiness} (${BAND_LABELS[day.band]})` : 'Readiness: Kalibrierung läuft',
    day.hrv != null && `HRV ${number(day.hrv)} ms`, day.rhr != null && `Ruhepuls ${number(day.rhr)} bpm`,
    day.sleep?.minutes != null && `Schlaf ${hm(day.sleep.minutes)}`].filter(Boolean);
  return <span className="calendar-readiness" title={parts.join(' · ')} aria-label={parts.join(', ')}
    style={{ '--band': BAND_COLORS[day.band] || 'var(--muted)' }}>
    <i aria-hidden="true" />{day.readiness ?? ''}
  </span>;
}

export function WeekRecovery({ summary }) {
  if (!summary) return null;
  return <div className="calendar-summary-recovery" aria-label="Erholung dieser Woche">
    <span>Erholung</span>
    <div>{summary.readiness != null && <strong style={{ color: BAND_COLORS[bandOf(summary.readiness)] }}>Ø {summary.readiness}</strong>}
      {summary.hrv != null && <small>HRV Ø {number(summary.hrv)} ms{summary.hrvDeviation != null && ` (${summary.hrvDeviation > 0 ? '+' : ''}${summary.hrvDeviation} %)`}</small>}</div>
  </div>;
}

// ─── Dashboard ───

const fullDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Consecutive local dates ending today, so the chart shares the fitness chart's time axis. */
export function dateRange(todayKey, count) {
  return Array.from({ length: count }, (_, index) => addDays(todayKey, index - count + 1));
}

/** HRV with its normal range on top, readiness bars below; same x geometry as FitnessChart. */
export function RecoveryChart({ keys, days }) {
  const [hover, setHover] = useState(null);
  const [width, setWidth] = useState(600);
  const frame = useRef(null);
  useEffect(() => {
    if (!frame.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const right = width - 10;
  const x = index => 57 + (keys.length > 1 ? index / (keys.length - 1) : 0.5) * (right - 57);
  const values = keys.flatMap(key => { const day = days[key]; return day ? [day.hrv, day.hrvBaseline?.low, day.hrvBaseline?.high] : []; }).filter(Number.isFinite);
  const low = Math.max(0, Math.floor((Math.min(...values, 40) - 5) / 10) * 10);
  const high = Math.ceil((Math.max(...values, 60) + 5) / 10) * 10;
  const y = value => 126 - (value - low) / (high - low) * 110;
  const path = points => points.map(([index, value], position) => `${position ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const series = key => keys.map((day, index) => [index, days[day]?.[key]]);
  const hrvPoints = series('hrv').filter(([, value]) => value != null);
  const band = keys.map((key, index) => [index, days[key]?.hrvBaseline]).filter(([, base]) => base);
  const bandPath = band.length > 1 ? `${path(band.map(([index, base]) => [index, base.high]))} ${band.slice().reverse().map(([index, base]) => `L${x(index).toFixed(1)} ${y(base.low).toFixed(1)}`).join(' ')} Z` : '';
  const barWidth = Math.max(1, (right - 57) / Math.max(1, keys.length) - 1);
  const index = hover == null ? null : Math.min(hover, keys.length - 1);
  const active = index == null ? null : days[keys[index]];
  const describe = (key, day) => (day ? [fullDate(key), day.readiness != null ? `Readiness ${day.readiness}` : 'Readiness kalibriert',
    day.hrv != null && `HRV ${number(day.hrv)} ms${day.hrvBaseline ? ` (Normalbereich ${number(day.hrvBaseline.low)}–${number(day.hrvBaseline.high)})` : ''}`,
    day.rhr != null && `Ruhepuls ${number(day.rhr)} bpm`].filter(Boolean).join(' · ') : `${fullDate(key)}: keine Daten`);
  const pick = event => {
    const box = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - box.left) / box.width * width - 57) / (right - 57);
    setHover(Math.max(0, Math.min(keys.length - 1, Math.round(position * (keys.length - 1)))));
  };
  const keyboard = event => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -keys.length, End: keys.length };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setHover(Math.max(0, Math.min(keys.length - 1, (index ?? keys.length - 1) + moves[event.key])));
  };
  const ticks = [low, Math.round((low + high) / 2), high];
  const recorded = keys.filter(key => days[key]);
  return <div className="analysis-chart recovery-chart" ref={frame}>
    <svg viewBox={`0 0 ${width} 220`} role="img" aria-label="HRV mit Normalbereich und Readiness pro Tag" tabIndex="0"
      onMouseMove={pick} onClick={pick} onMouseLeave={() => setHover(null)} onKeyDown={keyboard} onBlur={() => setHover(null)}>
      {ticks.map(value => <g key={value}><line x1="57" x2={right} y1={y(value)} y2={y(value)} className="recovery-grid" /><text x="48" y={y(value) + 4} textAnchor="end">{value === high ? `${value} ms` : value}</text></g>)}
      {bandPath && <path className="recovery-band" d={bandPath} />}
      {hrvPoints.length > 1 && <path className="recovery-hrv" d={path(hrvPoints)} />}
      {hrvPoints.length === 1 && <circle className="recovery-dot" cx={x(hrvPoints[0][0])} cy={y(hrvPoints[0][1])} r="3" />}
      <text x="57" y="154">Readiness</text>
      <line x1="57" x2={right} y1="196" y2="196" className="recovery-grid" />
      {keys.map((key, position) => { const day = days[key]; return day?.readiness != null
        ? <rect key={key} x={Math.max(57, Math.min(right - barWidth, x(position) - barWidth / 2))} y={196 - day.readiness * 0.36} width={barWidth} height={day.readiness * 0.36} style={{ fill: BAND_COLORS[day.band] }} /> : null; })}
      <text x={right} y="214" textAnchor="end">Heute</text>
      {index != null && <line className="recovery-marker" x1={x(index)} x2={x(index)} y1="14" y2="196" />}
    </svg>
    <div className="analysis-chart-caption" aria-live="polite">{index != null ? describe(keys[index], active) : 'Diagramm berühren oder mit den Pfeiltasten auswählen für genaue Werte.'}</div>
    <details className="analysis-data"><summary>Werte als Tabelle</summary><div className="analysis-table-scroll"><table>
      <caption>Erholung pro Nacht</caption>
      <thead><tr><th>Tag</th><th>Readiness</th><th>HRV</th><th>Normalbereich</th><th>Ruhepuls</th><th>Schlaf</th></tr></thead>
      <tbody>{recorded.slice().reverse().map(key => { const day = days[key]; return <tr key={key}><th scope="row">{fullDate(key)}</th>
        <td>{day.readiness ?? '—'}</td><td>{day.hrv != null ? `${number(day.hrv)} ms` : '—'}</td>
        <td>{day.hrvBaseline ? `${number(day.hrvBaseline.low)}–${number(day.hrvBaseline.high)}` : '—'}</td>
        <td>{day.rhr != null ? `${number(day.rhr)} bpm` : '—'}</td><td>{hm(day.sleep?.minutes)}</td></tr>; })}</tbody>
    </table></div></details>
  </div>;
}

const average = values => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);

export function RecoverySummary({ keys, days }) {
  const today = days[keys[keys.length - 1]];
  const week = keys.slice(-7).map(key => days[key]).filter(Boolean);
  const hrv = average(week.map(day => day.hrv).filter(Number.isFinite));
  const base = average(week.map(day => day.hrvBaseline?.mean).filter(Number.isFinite));
  const rhr = average(week.map(day => day.rhr).filter(Number.isFinite));
  return <div className="fitness-kpi recovery-kpi">
    <div><span>Readiness heute</span><strong style={{ color: BAND_COLORS[today?.band] }}>{today?.readiness ?? '—'}</strong></div>
    <div><span>HRV Ø 7 Nächte</span><b>{hrv != null ? `${number(hrv)} ms` : '—'}</b>{hrv != null && base ? <small>{Math.round((hrv / base - 1) * 100) >= 0 ? '+' : ''}{Math.round((hrv / base - 1) * 100)} % zur Baseline</small> : null}</div>
    <div><span>Ruhepuls Ø 7 Nächte</span><b>{rhr != null ? `${number(rhr)} bpm` : '—'}</b></div>
  </div>;
}
