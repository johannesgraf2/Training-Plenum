import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FTP, createLibraryWorkout, libraryKeyTarget, libraryPhases, libraryProfile, librarySummary, libraryTags, phaseIndex, searchLibrary, workoutLibrary } from './workoutLibraryData';

function Profile({ entry }) {
  return <svg className="library-profile" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
    {libraryProfile(entry).map((segment, index) => <rect key={index} className={[segment.intensity, segment.zone && `zone-${segment.zone}`].filter(Boolean).join(' ')} x={segment.x * 100} width={Math.max(segment.width * 100, 0.4)} y={24 - segment.level * 24} height={segment.level * 24} />)}
  </svg>;
}

function Card({ entry, athlete, date, onApply, showPhase }) {
  const key = libraryKeyTarget(entry, athlete);
  return <button type="button" className="library-card" onClick={() => onApply(createLibraryWorkout(entry, date, athlete))} aria-label={`Vorlage ${entry.title} übernehmen`}>
    {showPhase && entry.phase && <span className={`library-phase ${entry.phase}`}>{libraryPhases[entry.phase].label}</span>}
    <Profile entry={entry} />
    <strong>{entry.title}</strong>
    <small>{[librarySummary(entry, date, athlete), key].filter(Boolean).join(' · ')}</small>
  </button>;
}

export default function WorkoutLibrary({ sport: initialSport, date, ftp, maxHr, onApply, onClose }) {
  const [sport, setSport] = useState(initialSport);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [phase, setPhase] = useState('');
  const [ftpInput, setFtpInput] = useState(ftp ? String(ftp) : '');
  const [hrInput, setHrInput] = useState(maxHr ? String(maxHr) : '');
  const searchRef = useRef(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const athlete = { ftp: ftpInput, maxHr: hrInput };
  const results = searchLibrary({ query, sport, tag, phase });
  const sportTags = useMemo(() => Object.keys(libraryTags).filter(key => workoutLibrary.some(entry => entry.sport === sport && entry.tags.includes(key))), [sport]);

  const families = [], singles = [];
  results.forEach(entry => {
    if (!entry.family) { singles.push(entry); return; }
    const group = families.find(f => f.key === entry.family);
    if (group) group.entries.push(entry);
    else families.push({ key: entry.family, title: entry.familyTitle, note: entry.note, tags: entry.tags, entries: [entry] });
  });
  families.forEach(group => group.entries.sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase)));
  const reset = () => { setQuery(''); setTag(''); setPhase(''); };

  return <div className="library">
    <div className="library-header">
      <div><span className="workout-eyebrow">Vorlagen-Bibliothek</span><h3>{workoutLibrary.length} Beispiel-Einheiten</h3>
        <p>Nach Tags oder Blockphase filtern. Progressionen zeigen Start, Mitte und Ende eines Trainingsblocks. Die Vorlage ersetzt den aktuellen Ablauf, alle Werte bleiben anpassbar.</p></div>
      <button type="button" onClick={onClose}>← Zurück zum Workout</button>
    </div>
    <div className="library-controls">
      <label className="library-search">Suchen<input ref={searchRef} type="search" aria-label="Vorlagen durchsuchen" value={query} placeholder="z. B. vo2max, threshold, base, 4x4, Block-Ende" onChange={e => setQuery(e.target.value)} /></label>
      <div className="library-sport" role="group" aria-label="Sportart der Vorlagen">
        {[['ride', 'Rad'], ['run', 'Laufen'], ['swim', 'Schwimmen']].map(([value, label]) => <button type="button" key={value} aria-pressed={sport === value} onClick={() => { setSport(value); setTag(''); }}>{label} ({workoutLibrary.filter(e => e.sport === value).length})</button>)}
      </div>
      {sport === 'swim' ? null : sport === 'ride'
        ? <label className="library-athlete">FTP (W)<input type="number" min="50" max="1000" aria-label="FTP für Vorlagen" value={ftpInput} placeholder={String(DEFAULT_FTP)} onChange={e => setFtpInput(e.target.value)} /></label>
        : <label className="library-athlete">HFmax (bpm)<input type="number" min="100" max="240" aria-label="HFmax für Vorlagen" value={hrInput} placeholder="z. B. 190" onChange={e => setHrInput(e.target.value)} /></label>}
    </div>
    <p className="library-athlete-note">{sport === 'swim'
      ? 'Schwimmziele beziehen sich auf dein CSS-Tempo (Critical Swim Speed): „CSS +5 s“ heißt 5 s pro 100 m langsamer. Die Vorgabe steht im Schrittnamen, die Uhr zeigt keine Pace an. Bahnlänge: 25 m.'
      : sport === 'ride'
      ? Number(ftpInput) > 0 ? `Watt werden aus ${Number(ftpInput)} W FTP berechnet.` : `Keine FTP hinterlegt: Watt werden mit ${DEFAULT_FTP} W FTP berechnet. Trag deine FTP ein, um sie anzupassen.`
      : Number(hrInput) > 0 ? `Herzfrequenzziele werden aus ${Number(hrInput)} bpm HFmax berechnet.` : 'Ohne HFmax werden Läufe ohne Herzfrequenzziel angelegt.'}</p>
    <div className="library-chips" role="group" aria-label="Nach Tag filtern">
      <button type="button" aria-pressed={!tag} onClick={() => setTag('')}>Alle Typen</button>
      {sportTags.map(key => <button type="button" key={key} aria-pressed={tag === key} onClick={() => setTag(tag === key ? '' : key)}>{libraryTags[key].label}</button>)}
    </div>
    <div className="library-chips" role="group" aria-label="Nach Blockphase filtern">
      <button type="button" aria-pressed={!phase} onClick={() => setPhase('')}>Alle Phasen</button>
      {Object.entries(libraryPhases).map(([key, { label }]) => <button type="button" key={key} className={`library-phase-chip ${key}`} aria-pressed={phase === key} onClick={() => setPhase(phase === key ? '' : key)}>{label}</button>)}
    </div>
    <p className="library-count" role="status">{results.length === 1 ? '1 Einheit' : `${results.length} Einheiten`}</p>
    {!results.length && <div className="library-empty"><p>Keine Vorlage passt zu deiner Suche.</p><button type="button" onClick={reset}>Filter zurücksetzen</button></div>}
    {families.length > 0 && <section className="library-section" aria-label="Blockprogressionen">
      <h4>Blockprogressionen</h4>
      {families.map(group => <article className="library-family" key={group.key}>
        <div className="library-family-heading"><strong>{group.title}</strong><span className="library-tags">{group.tags.map(t => <span key={t}>{libraryTags[t].label}</span>)}</span><p>{group.note}</p></div>
        <div className="library-cards">{group.entries.map(entry => <Card key={entry.id} entry={entry} athlete={athlete} date={date} onApply={onApply} showPhase />)}</div>
      </article>)}
    </section>}
    {singles.length > 0 && <section className="library-section" aria-label="Einzeleinheiten">
      <h4>Einzeleinheiten</h4>
      <div className="library-cards library-singles">{singles.map(entry => <div key={entry.id} className="library-single">
        <Card entry={entry} athlete={athlete} date={date} onApply={onApply} />
        <span className="library-tags">{entry.tags.map(t => <span key={t}>{libraryTags[t].label}</span>)}</span>
      </div>)}</div>
    </section>}
  </div>;
}
