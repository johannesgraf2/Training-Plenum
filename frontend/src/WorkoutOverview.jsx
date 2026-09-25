import React, { useState } from 'react';
import { clock, intensityLabels, intensityZone, stepDescription, summary, workoutOverview, zoneLabels } from './workoutModel';

const colors = { warmup: 'var(--line-strong)', active: 'var(--blue)', interval: 'var(--accent)', recovery: 'var(--line)', cooldown: 'var(--line-strong)' };
const zoneColors = { endurance: 'var(--blue)', tempo: 'var(--zone-tempo)', sweetspot: 'var(--zone-sweetspot)', threshold: 'var(--zone-threshold)', vo2: 'var(--zone-vo2)' };
const minutes = seconds => `${+(seconds / 60).toFixed(1)} min`;
const kilometres = metres => `${(metres / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km`;

// Work steps are coloured by zone once FTP (power) or maximum heart rate is known.
function stepZone(step, ftp, maxHr) {
  if (!['active', 'interval'].includes(step.intensity)) return null;
  if (step.target.type === 'power' && ftp > 0) return intensityZone(step.power / ftp, 'power');
  if (step.target.type === 'heart_rate' && maxHr > 0) return intensityZone((step.target.low + step.target.high) / 2 / maxHr, 'heart_rate');
  return null;
}

export default function WorkoutOverview({ workout, selectedPath, onSelect, disabled, ftp, maxHr }) {
  const [hovered, setHovered] = useState(null);
  let overview;
  try { if (workout) overview = workoutOverview(workout); } catch (_) { /* Editing may temporarily leave a field incomplete. */ }
  if (!overview || !overview.segments.length) return <section className="workout-overview workout-overview-empty" aria-label="Gesamtübersicht">
    <h3>Gesamtübersicht</h3><p>Vervollständige die Schritte, um dein Trainingsprofil zu sehen.</p>
  </section>;
  const { segments, allTimed, allDistance, allPower, time, distance, workTime, recoveryTime, workDistance, recoveryDistance, averagePower } = overview;
  const hasPower = segments.some(step => step.power !== null);
  const zones = segments.map(step => stepZone(step, Number(ftp), Number(maxHr)));
  const legendZones = Object.keys(zoneColors).filter(zone => zones.includes(zone));
  const unzonedWork = segments.some((step, index) => step.intensity === 'interval' && !zones[index]);
  const workSegments = segments.filter(step => ['active', 'interval'].includes(step.intensity));
  const paceRanges = workSegments.map(step => step.target.type === 'pace' ? `${clock(step.target.low)}${step.target.high !== step.target.low ? `–${clock(step.target.high)}` : ''} /km` : null);
  const runningPace = paceRanges.length && paceRanges.every(Boolean) ? (new Set(paceRanges).size === 1 ? paceRanges[0] : 'Variabel') : '—';
  const highest = Math.max(100, ...segments.map(step => step.target.type === 'power' ? step.target.high : 0));
  const ceiling = Math.ceil(highest / 100) * 100;
  const left = 48, width = 1050, top = 22, bottom = 167, height = bottom - top;
  const unitWidth = width / (allTimed ? time : allDistance ? distance : segments.length);
  const current = hovered !== null ? segments[hovered] : segments.find(step => step.path === selectedPath);
  const activate = path => { if (!disabled) onSelect(path); };
  return <section className="workout-overview" aria-label="Gesamtübersicht">
    <div className="workout-overview-heading"><div><span className="workout-eyebrow">Gesamtübersicht</span><h3>{hasPower ? 'Dein Leistungsprofil' : 'Dein Trainingsablauf'}</h3></div><span className="workout-chart-instruction">Block anklicken, um ihn zu bearbeiten</span></div>
    <div className="workout-metrics">
      <div><span>{allTimed ? 'Gesamtdauer' : allDistance ? 'Gesamtdistanz' : 'Geplante Abschnitte'}</span><strong>{allTimed ? minutes(time) : allDistance ? kilometres(distance) : summary(workout)}</strong></div>
      <div><span>{allTimed || allDistance ? 'Belastung' : 'Belastung nach Zeit'}</span><strong>{allDistance ? kilometres(workDistance) : minutes(workTime)}</strong></div>
      <div><span>{allTimed || allDistance ? 'Erholung' : 'Erholung nach Zeit'}</span><strong>{allDistance ? kilometres(recoveryDistance) : minutes(recoveryTime)}</strong></div>
      <div><span>{workout.sport === 'run' ? 'Zielpace · Belastung' : 'Ø Zielleistung'}</span><strong>{workout.sport === 'run' ? runningPace : averagePower === null ? '—' : `${Math.round(averagePower)} W`}</strong></div>
    </div>
    <div className="workout-chart-scroll"><svg className="workout-profile" viewBox="0 0 1110 207" role="group" aria-label={allTimed ? 'Trainingsprofil über die gesamte Dauer' : allDistance ? 'Trainingsprofil über die gesamte Distanz' : 'Trainingsprofil in Schrittfolge'}>
      <title>Jeder Balken ist ein Trainingsabschnitt. Wiederholungen sind einzeln dargestellt.</title>
      {[0, 0.5, 1].map(fraction => <g key={fraction} aria-hidden="true"><line x1={left} x2={left + width} y1={bottom - height * fraction} y2={bottom - height * fraction} style={{ stroke: 'var(--bd-e5edf5)' }} strokeDasharray={fraction ? '3 4' : undefined} />{hasPower && <text x={left - 10} y={bottom - height * fraction + 4} textAnchor="end">{Math.round(ceiling * fraction)}</text>}</g>)}
      {hasPower && <text x="7" y="12" aria-hidden="true">W</text>}
      {segments.map((step, index) => {
        const x = left + (allTimed ? step.start : allDistance ? step.startDistance : index) * unitWidth;
        const blockWidth = (allTimed ? step.seconds : allDistance ? step.metres : 1) * unitWidth;
        // Unspecified/non-power targets use a neutral strip, never a fabricated watt value.
        const blockHeight = step.power === null ? (hasPower ? 20 : 105) : Math.max(2, step.power / ceiling * height);
        const y = bottom - blockHeight;
        const label = `${step.name || intensityLabels[step.intensity]}${step.repetition ? ` · Wiederholung ${step.repetition}` : ''}: ${stepDescription(step)}`;
        const selected = selectedPath === step.path;
        return <g key={index} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} aria-label={`${label} bearbeiten`} aria-pressed={selected}
          onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}
          onClick={() => activate(step.path)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(step.path); } }}>
          <title>{label}</title>
          <rect x={x} y={top} width={blockWidth} height={height} fill="transparent" />
          <rect className="workout-profile-bar" x={x + Math.min(1, blockWidth / 10)} y={y} width={Math.max(.1, blockWidth - Math.min(2, blockWidth / 5))} height={blockHeight} rx="2"
            style={{ fill: step.power === null && hasPower ? 'var(--bg-e2e8f0)' : zoneColors[zones[index]] || colors[step.intensity] || colors.active }} stroke={selected ? 'var(--ink)' : step.power === null && hasPower ? 'var(--muted-2)' : 'none'} strokeWidth={selected ? 2 : 1} strokeDasharray={step.power === null && hasPower ? '3 3' : undefined} />
          {blockWidth > 49 && <text x={x + blockWidth / 2} y={step.power === null && hasPower ? y - 6 : y + 18} className={step.power !== null && step.power / ceiling > .5 && zones[index] !== 'sweetspot' ? 'workout-bar-light' : 'workout-bar-dark'} textAnchor="middle" pointerEvents="none">{step.power === null ? (hasPower ? '—' : step.seconds !== null ? minutes(step.seconds) : step.duration.type === 'open' ? 'Lap' : `${step.duration.value} m`) : `${Math.round(step.power)} W`}</text>}
        </g>;
      })}
      {[0, .25, .5, .75, 1].map((fraction, i) => <text key={i} x={left + width * fraction} y="190" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} aria-hidden="true">{allTimed ? clock(Math.round(time * fraction)) : allDistance ? kilometres(distance * fraction) : fraction === 0 ? 'Start' : fraction === 1 ? 'Ende' : ''}</text>)}
    </svg></div>
    <div className="workout-chart-caption"><div className="workout-chart-legend"><span><i style={{ background: colors.warmup }} />Auf-/Abwärmen</span>{legendZones.map(zone => <span key={zone}><i style={{ background: zoneColors[zone] }} />{zoneLabels[zone]}</span>)}{(unzonedWork || !legendZones.length) && <span><i style={{ background: colors.interval }} />Belastung</span>}<span><i style={{ background: colors.recovery }} />Erholung</span>{hasPower && !allPower && <span><i style={{ background: 'var(--bg-e2e8f0)' }} />Ohne Wattziel</span>}</div><span>{allTimed ? 'Zeitachse · min:ss' : allDistance ? 'Distanzachse · km' : 'Schrittfolge · gleiche Breite je Abschnitt'}</span></div>
    <div className="workout-chart-detail" aria-live="polite">{current ? <><strong>{current.name || intensityLabels[current.intensity]}{current.repetition ? ` · Wiederholung ${current.repetition}` : ''}</strong><span>{stepDescription(current)}</span></> : <span>Mit Maus oder Tastatur einen Abschnitt auswählen, um Dauer und Ziel zu sehen.</span>}</div>
    {!allTimed && <p className="workout-hint">{allDistance ? 'Die Balkenbreite entspricht der Distanz. Die Gesamtdauer hängt von deinem Tempo ab.' : 'Für Distanz- und offene Schritte ist die Dauer noch unbekannt. Die Breite zeigt hier die Reihenfolge, keine geschätzte Zeit.'}</p>}
    {hasPower && <p className="workout-chart-note">Balkenhöhe: Wattziel, bei Bereichen deren Mittelwert. Ø Zielleistung wird nur bei durchgehend zeitbasierten Wattvorgaben berechnet.</p>}
  </section>;
}
