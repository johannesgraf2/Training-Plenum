import React, { useEffect, useRef, useState } from 'react';
import { fitFileName, garminWorkoutName, intensityLabels, intervalBlock, newStep, newWorkout, powerStep, stepDescription, summary, targetLabels, toDraft, toWorkout, workoutTemplates, workoutTotals } from './workoutModel';
import WorkoutOverview from './WorkoutOverview';
import './WorkoutEditor.css';

const targetDefaults = { none: {}, pace: { low: '4:00', high: '4:10', mode: 'range' }, speed: { low: '25', high: '30', mode: 'range' }, heart_rate: { low: '130', high: '150', mode: 'range' }, power: { low: '180', high: '180', mode: 'single' }, cadence: { low: '80', high: '95', mode: 'range' } };

function StepFields({ step, onChange, label, inRepeat = false }) {
  const target = step.target;
  const single = target.mode === 'single';
  const unit = { pace: 'min:ss/km', speed: 'km/h', heart_rate: 'bpm', power: 'W', cadence: 'rpm' }[target.type];
  return <><div className="workout-fields">
    {!inRepeat && <label className="workout-field-full">Schritttyp<select aria-label={`${label}: Intensität`} value={step.intensity} onChange={e => onChange({ ...step, intensity: e.target.value })}>
      {Object.entries(intensityLabels).map(([value, text]) => <option key={value} value={value}>{value === 'interval' ? 'Intervalle mit Pause' : value === 'active' ? 'Konstant / Aktiv' : text}</option>)}
    </select></label>}
    <label>Schrittende<select aria-label={`${label}: Schrittende`} value={step.duration.type} onChange={e => onChange({ ...step, duration: { type: e.target.value, value: e.target.value === 'time' ? '5:00' : e.target.value === 'distance' ? '1000' : '' } })}>
      <option value="time">Zeit</option><option value="distance">Distanz</option><option value="open">Lap-Taste / offen</option>
    </select></label>
    {step.duration.type !== 'open' && <label>{step.duration.type === 'time' ? 'Dauer (min:ss)' : 'Distanz (m)'}<input aria-label={`${label}: Dauer`} inputMode={step.duration.type === 'time' ? 'text' : 'decimal'} value={step.duration.value} onChange={e => onChange({ ...step, duration: { ...step.duration, value: e.target.value } })} /></label>}
    <label>Ziel<select aria-label={`${label}: Ziel`} value={target.type} onChange={e => onChange({ ...step, target: { type: e.target.value, ...targetDefaults[e.target.value] } })}>
      {Object.entries(targetLabels).map(([value, text]) => <option key={value} value={value}>{value === 'power' ? 'Leistung (Watt)' : text}</option>)}
    </select></label>
    {target.type !== 'none' && <>
      <label>Vorgabe<select aria-label={`${label}: Zielmodus`} value={target.mode || 'range'} onChange={e => onChange({ ...step, target: { ...target, mode: e.target.value, high: e.target.value === 'single' ? target.low : target.high } })}><option value="single">Fester Wert</option><option value="range">Zielbereich</option></select></label>
      <label className={single ? 'workout-field-full workout-exact-target' : ''}>{single ? `${targetLabels[target.type]} (${unit})` : `${target.type === 'pace' ? 'Schneller' : 'Von'} (${unit})`}<input aria-label={`${label}: ${single ? 'Zielwert' : 'Ziel von'}`} value={target.low} inputMode={target.type === 'pace' ? 'text' : 'decimal'} onChange={e => onChange({ ...step, target: { ...target, low: e.target.value, ...(single ? { high: e.target.value } : {}) } })} /></label>
      {!single && <label>{target.type === 'pace' ? 'Langsamer' : 'Bis'} ({unit})<input aria-label={`${label}: Ziel bis`} value={target.high} inputMode={target.type === 'pace' ? 'text' : 'decimal'} onChange={e => onChange({ ...step, target: { ...target, high: e.target.value } })} /></label>}
    </>}
  </div><details className="workout-step-details"><summary>Weitere Einstellungen</summary><div className="workout-fields">
    {inRepeat && <label>Intensität<select aria-label={`${label}: Intensität`} value={step.intensity} onChange={e => onChange({ ...step, intensity: e.target.value })}>
      {Object.entries(intensityLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>}
    <label>Schrittname (optional)<input aria-label={`${label}: Name`} value={step.name} placeholder={intensityLabels[step.intensity]} maxLength={80} onChange={e => onChange({ ...step, name: e.target.value })} /></label>
  </div></details></>;
}

function Controls({ index, length, label, onMove, onRemove }) {
  return <div className="workout-step-actions">
    <button type="button" aria-label={`${label} nach oben`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
    <button type="button" aria-label={`${label} nach unten`} disabled={index === length - 1} onClick={() => onMove(1)}>↓</button>
    <button type="button" aria-label={`${label} entfernen`} onClick={onRemove}>Entfernen</button>
  </div>;
}

export default function WorkoutEditor({ apiBase, initial, date, onClose, onSaved, onDeleted, onImport }) {
  const [draft, setDraft] = useState(() => toDraft(initial || newWorkout(date)));
  const [recordId, setRecordId] = useState(initial?.id);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(toDraft(initial || newWorkout(date))));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState('');
  const [selectedPath, setSelectedPath] = useState(null);
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const stepRefs = useRef({});
  const dirty = JSON.stringify(draft) !== savedSnapshot;
  const close = () => { if (!busy) dirty ? setConfirm('close') : onClose(); };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameRef.current?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')).filter(e => e.getClientRects().length);
      if (!elements.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); previousFocus?.focus(); };
  }, []);

  const change = next => { setDraft(next); setStatus(''); setError(''); setConfirm(''); };
  const setSteps = steps => { setSelectedPath(null); change({ ...draft, steps }); };
  const replace = (index, block) => change({ ...draft, steps: draft.steps.map((s, i) => i === index ? block : s) });
  const makeIntervals = step => {
    const defaults = toDraft({ steps: [intervalBlock(draft.sport)] }).steps[0];
    return { ...defaults, steps: [{ ...step, intensity: 'interval', target: step.target.type === 'none' && draft.sport === 'ride' ? defaults.steps[0].target : step.target }, defaults.steps[1]] };
  };
  const selectStep = path => { setSelectedPath(path); stepRefs.current[path]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); };
  const move = (list, index, delta) => { const result = [...list]; [result[index], result[index + delta]] = [result[index + delta], result[index]]; return result; };
  let preview;
  try { preview = toWorkout(draft); } catch (_) { /* Incomplete values are expected during editing. */ }
  const totals = preview && workoutTotals(preview);

  async function request(action) {
    setBusy(action); setError(''); setStatus(''); setConfirm('');
    try {
      const payload = toWorkout(draft);
      const url = action === 'export' ? '/api/workouts/export' : `/api/workouts${recordId ? `/${recordId}` : ''}`;
      const response = await fetch(`${apiBase}${url}`, { method: action === 'save' && recordId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Anfrage fehlgeschlagen (HTTP ${response.status}).`);
      }
      if (action === 'save') {
        const saved = await response.json();
        setRecordId(saved.id); setSavedSnapshot(JSON.stringify(draft)); onSaved(saved);
        setStatus('Workout gespeichert. Du kannst es auf der Startseite wieder öffnen.');
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fitFileName(payload);
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('FIT-Datei geprüft und Download gestartet. Unten findest du die USB-Anleitung.');
      }
    } catch (err) { setError(err instanceof TypeError ? 'Der Server ist nicht erreichbar. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.' : err.message); }
    finally { setBusy(''); }
  }

  async function remove() {
    setBusy('delete'); setError('');
    try {
      const response = await fetch(`${apiBase}/api/workouts/${recordId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Workout konnte nicht gelöscht werden. Bitte erneut versuchen.');
      onDeleted(recordId); onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }

  return <div className="workout-backdrop">
    <section className="workout-dialog" role="dialog" aria-modal="true" aria-labelledby="workout-editor-title" ref={dialogRef}>
      <header className="workout-header"><div><span className="workout-eyebrow">Workout-Builder</span><h2 id="workout-editor-title">{recordId ? 'Workout bearbeiten' : 'Workout hinzufügen'}</h2><p>Überblick behalten. Belastung und Erholung gezielt planen.</p></div><button type="button" className="workout-close" onClick={close} disabled={!!busy} aria-label="Workout-Editor schließen">✕</button></header>
      <div className="workout-body">
        <fieldset className="workout-setup" disabled={!!busy}><div className="workout-basics"><label className="workout-name">Workout-Name<input ref={nameRef} value={draft.name} placeholder="z. B. Intervalle am Dienstag" maxLength={80} onChange={e => change({ ...draft, name: e.target.value })} /></label>
            <label>Sportart<select aria-label="Workout-Sportart" value={draft.sport} onChange={e => change({ ...draft, sport: e.target.value })}><option value="run">Laufen</option><option value="ride">Radfahren</option></select></label>
            <label>Trainingsdatum<input type="date" value={draft.date} onChange={e => change({ ...draft, date: e.target.value })} /></label>
          </div><div className="workout-template-heading"><strong>{draft.sport === 'run' ? 'Lauf-Vorlagen' : 'Rad-Vorlagen'}</strong><span>Ersetzt den Ablauf · alle Werte sind anpassbar</span></div><div className="workout-templates">{workoutTemplates.filter(template => template.sport === draft.sport).map(template => <button type="button" className="workout-template" key={template.id} onClick={() => { setSelectedPath(null); change(toDraft(template.create(draft.date))); }}>
            <span className="workout-template-bars" aria-hidden="true">{template.bars.map((height, index) => <i key={index} style={{ height: height * 4 }} />)}</span><strong>{template.title}</strong><small>{template.subtitle}</small>
          </button>)}</div><p className="workout-template-note">{draft.sport === 'run' ? 'Lauf-Vorlagen: 2 km Einlaufen + Distanzintervalle + 1 km Auslaufen. Pace und Trabpausen lassen sich frei anpassen.' : 'Intervall-Vorlagen: je 10 min Auf- und Abwärmen. Bei 40/20: drei Serien à sieben Wiederholungen, dazwischen je 5 min Serienpause.'}</p></fieldset>
        <WorkoutOverview workout={preview} selectedPath={selectedPath} onSelect={selectStep} disabled={!!busy} />
        <fieldset className="workout-edit-panel" disabled={!!busy}>
          <div className="workout-section-title"><h3>Trainingsschritte bearbeiten</h3><span className="workout-hint">Änderungen erscheinen direkt im Profil</span></div>
          <div className="workout-steps">{draft.steps.map((block, index) => {
            const label = `Schritt ${index + 1}`;
            if (block.kind === 'repeat') return <section className="workout-repeat" key={index} aria-label={`Wiederholungsblock ${index + 1}`}>
              <div className="workout-step-heading"><div><strong>{index + 1} · Intervalle</strong><label className="workout-repeat-count">Wiederholungen <input type="number" min="2" max="99" aria-label={`Block ${index + 1}: Wiederholungen`} value={block.count} onChange={e => replace(index, { ...block, count: e.target.value })} /> ×</label></div><Controls index={index} length={draft.steps.length} label={`Block ${index + 1}`} onMove={delta => setSteps(move(draft.steps, index, delta))} onRemove={() => setSteps(draft.steps.filter((_, i) => i !== index))} /></div>
              <p className="workout-interval-help">Jede Wiederholung enthält die folgenden Abschnitte, einschließlich der letzten Pause.</p>
              <div className="workout-repeat-steps">{block.steps.map((step, childIndex) => {
                const childLabel = `Schritt ${index + 1}.${childIndex + 1}`;
                const path = `${index}.${childIndex}`;
                return <article className={`workout-step ${step.intensity} ${selectedPath === path ? 'workout-step-selected' : ''}`} key={childIndex} ref={element => { stepRefs.current[path] = element; }}>
                  <div className="workout-step-heading"><strong>{step.intensity === 'recovery' ? 'Pause / Erholung' : ['active', 'interval'].includes(step.intensity) ? 'Belastung' : intensityLabels[step.intensity]}</strong><Controls index={childIndex} length={block.steps.length} label={childLabel} onMove={delta => { setSelectedPath(null); replace(index, { ...block, steps: move(block.steps, childIndex, delta) }); }} onRemove={() => { setSelectedPath(null); replace(index, { ...block, steps: block.steps.filter((_, i) => i !== childIndex) }); }} /></div>
                  {step.name && <p className="workout-interval-name">{step.name}</p>}
                  <StepFields step={step} label={childLabel} inRepeat onChange={next => replace(index, { ...block, steps: block.steps.map((s, i) => i === childIndex ? next : s) })} />
                </article>;
              })}</div>
              {!block.steps.length && <p className="workout-empty">Füge mindestens einen Schritt zum Block hinzu.</p>}
              <button type="button" className="workout-text-button" onClick={() => replace(index, { ...block, steps: [...block.steps, toDraft({ steps: [newStep()] }).steps[0]] })}>+ Schritt im Block</button>
            </section>;
            return <article className={`workout-step ${block.intensity} ${selectedPath === String(index) ? 'workout-step-selected' : ''}`} key={index} ref={element => { stepRefs.current[String(index)] = element; }}>
              <div className="workout-step-heading"><strong>{index + 1} · {intensityLabels[block.intensity]}</strong><Controls index={index} length={draft.steps.length} label={label} onMove={delta => setSteps(move(draft.steps, index, delta))} onRemove={() => setSteps(draft.steps.filter((_, i) => i !== index))} /></div>
              <StepFields step={block} label={label} onChange={next => replace(index, next.intensity === 'interval' && block.intensity !== 'interval' ? makeIntervals(next) : next)} />
              {block.intensity === 'interval' && <button type="button" className="workout-text-button" onClick={() => replace(index, makeIntervals(block))}>+ Pause und Wiederholungen hinzufügen</button>}
            </article>;
          })}</div>
          {!draft.steps.length && <p className="workout-empty">Füge einen Schritt oder Wiederholungsblock hinzu.</p>}
          <div className="workout-add-actions"><button type="button" onClick={() => setSteps([...draft.steps, toDraft({ steps: [draft.sport === 'ride' ? powerStep('active', 600, 180) : newStep()] }).steps[0]])}>+ Konstanter Abschnitt</button><button type="button" onClick={() => setSteps([...draft.steps, toDraft({ steps: [intervalBlock(draft.sport)] }).steps[0]])}>+ Intervalle mit Pause</button></div>
          <p className="workout-hint">Zeit in min:ss, Distanz in Metern. Bis zu 50 FIT-Schritte inklusive Wiederholungsmarkern.</p>
        </fieldset>
        <aside className="workout-preview"><div className="workout-preview-card"><span className="workout-eyebrow">Dein Ablauf</span><h3>{draft.name || 'Neues Workout'}</h3>
          {preview ? <><p className="workout-total">{summary(preview) || 'Noch keine Dauer'}</p><p className="workout-hint">Zeit- und Distanzabschnitte werden addiert. Offene Schritte enden mit der Lap-Taste.</p>
            <ol className="workout-timeline">{preview.steps.map((block, index) => <li key={index} className={block.kind === 'repeat' ? 'repeat' : block.intensity}>
              {block.kind === 'repeat' ? <><strong>↻ {block.count} × wiederholen</strong><ol>{block.steps.map((step, i) => <li key={i}><strong>{step.name || intensityLabels[step.intensity]}</strong><span>{stepDescription(step)}</span></li>)}</ol></> : <><strong>{block.name || intensityLabels[block.intensity]}</strong><span>{stepDescription(block)}</span></>}
            </li>)}</ol><p className={`workout-hint ${totals.fitSteps > 50 ? 'workout-limit' : ''}`}>{totals.fitSteps} / 50 FIT-Schritte</p></> : <p className="workout-hint">Vervollständige die Werte, um den Ablauf zu sehen.</p>}
        </div>
        <div className="workout-transfer"><h3>Auf deine Garmin</h3>
          {garminWorkoutName(draft) && <p className="workout-export-name">Name auf deiner Garmin<strong>{garminWorkoutName(draft)}</strong></p>}
          <ol><li>FIT-Datei herunterladen.</li><li>Garmin per USB verbinden und die Datei in <strong>GARMIN/NewFiles</strong> kopieren.</li><li>Gerät sicher auswerfen. Das Workout mit dem passenden Datum im Trainingsmenü auswählen.</li></ol>
          <p>Das Trainingsdatum steht automatisch am Anfang des Workout-Namens und im Dateinamen. Ein Kalendereintrag auf der Garmin wird dadurch nicht erstellt.</p>
          <p>Erfordert ein Gerät mit Unterstützung für strukturierte Workouts. Speicherzugriff und unterstützte Ziele hängen vom Modell ab.</p><a href="https://support.garmin.com/en-GB/?faq=AXV7LuWgc73v21nq6nbDa6" target="_blank" rel="noreferrer">Garmin-Anleitung ↗</a></div>
        {onImport && !recordId && <div className="workout-import"><p>Training bereits absolviert?</p><button type="button" disabled={!!busy} onClick={() => dirty ? setConfirm('import') : onImport()}>Aktivitätsdatei importieren</button></div>}
        </aside>
      </div>
      <footer className="workout-footer">
        {error && <p className="workout-error" role="alert">{error}</p>}
        {status && <p className="workout-success" role="status">✓ {status}</p>}
        {confirm && <div className="workout-confirm" role="alert"><span>{confirm === 'delete' ? 'Dieses geplante Workout löschen?' : 'Ungespeicherte Änderungen verwerfen?'}</span><button disabled={!!busy} onClick={() => setConfirm('')}>Weiter bearbeiten</button><button disabled={!!busy} onClick={() => confirm === 'delete' ? remove() : confirm === 'import' ? onImport() : onClose()}>{confirm === 'delete' ? 'Workout löschen' : 'Verwerfen'}</button></div>}
        <div className="workout-footer-actions"><span className="workout-save-state">{busy ? busy === 'export' ? 'FIT-Datei wird erstellt und geprüft …' : 'Wird gespeichert …' : dirty ? 'Ungespeicherte Änderungen' : recordId ? 'Gespeichertes Workout' : 'Neues Workout'}</span>
          {recordId && <button className="workout-delete" disabled={!!busy} onClick={() => setConfirm('delete')}>Löschen</button>}
          <button disabled={!!busy} onClick={() => request('save')}>Workout speichern</button><button className="workout-primary" disabled={!!busy} onClick={() => request('export')}>↓ Garmin FIT herunterladen</button>
        </div>
      </footer>
    </section>
  </div>;
}
