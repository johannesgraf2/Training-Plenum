import React, { useState, useEffect, useMemo, useRef } from 'react';

import ActivityDetail from './ActivityDetail';
import BatchImport from './BatchImport';
import Dashboard from './Dashboard';
import AICoach from './AICoach';
import Home from './Home';
import UserMenu from './UserMenu';
import WorkoutEditor from './WorkoutEditor';
import { localDate, summary as workoutSummary } from './workoutModel';
import './Calendar.css';
import { collectDroppedFiles } from './importQueue';
import { SportMark, sportColor, sportLabels } from './sports';
import './App.css';

// ─── API HELPER ───
const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';
// Drag payload for moving a planned workout between calendar days (distinct from file drops).
const WORKOUT_DRAG_TYPE = 'application/x-training-plenum-workout';

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    console.error('API Error:', e);
    throw e;
  }
}

// ─── FORMATTERS ───
const fmt = {
  dur: (m) => { if (m == null) return '—'; m = Math.round(m); const h = Math.floor(m / 60); const min = m % 60; return h ? `${h}h ${min}m` : `${min}m`; },
  durHM: (m) => { if (m == null) return '—'; const s = Math.round(m * 60); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); },
  date: (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }),
  dateFull: (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  time: (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
  timeAxis: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
  pace: (dist, dur) => dist > 0 ? `${(dur / dist).toFixed(1)}` : '—',
  num: (n) => n?.toLocaleString('de-DE') ?? '—',
};


// ─── CLIENT-SIDE CSV PARSER ───
function parseCSVClient(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { session: {}, timeSeries: [] };

  // Parse header — normalize column names
  const rawHeaders = lines[0].split(/[,;\t]/);
  const headers = rawHeaders.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));

  // Build column index map — support many common column name variants
  const colMap = {};
  const aliases = {
    hr: ['hr', 'heart_rate', 'heartrate', 'heart', 'bpm', 'puls', 'herzfrequenz', 'hf'],
    speed: ['speed', 'velocity', 'geschwindigkeit', 'tempo', 'kmh', 'km_h', 'pace'],
    power: ['power', 'watts', 'watt', 'leistung', 'w'],
    cadence: ['cadence', 'cad', 'trittfrequenz', 'rpm', 'spm', 'schrittfrequenz'],
    elevation: ['elevation', 'altitude', 'alt', 'hhe', 'hoehe', 'ele', 'elev'],
    distance: ['distance', 'dist', 'distanz', 'km', 'strecke', 'total_distance'],
    time: ['time', 'timestamp', 'zeit', 'elapsed', 'seconds', 'sec', 'elapsed_time', 'duration'],
    lat: ['lat', 'latitude', 'breitengrad'],
    lng: ['lng', 'lon', 'long', 'longitude', 'laengengrad'],
    calories: ['calories', 'cal', 'kcal', 'kalorien'],
    temperature: ['temperature', 'temp', 'temperatur'],
  };

  headers.forEach((h, i) => {
    for (const [key, names] of Object.entries(aliases)) {
      if (names.some(n => h === n || h.includes(n))) {
        if (!colMap[key]) colMap[key] = i;
      }
    }
  });

  // Parse rows into time-series data points
  const timeSeries = [];
  const hrs = [], speeds = [], powers = [], cadences = [], elevations = [];
  let totalDist = 0;

  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(/[,;\t]/);
    if (cols.length < 2) continue;

    const getNum = (key) => {
      const idx = colMap[key];
      if (idx == null || idx >= cols.length) return null;
      const v = parseFloat(cols[idx].trim());
      return isNaN(v) ? null : v;
    };

    const point = { time: (r - 1) * 5 };

    // Try to use actual time column
    const timeVal = getNum('time');
    if (timeVal != null) point.time = timeVal;

    const hr = getNum('hr');
    if (hr != null && hr > 20 && hr < 250) { point.hr = Math.round(hr); hrs.push(hr); }

    const spd = getNum('speed');
    if (spd != null && spd >= 0) { point.speed = +spd.toFixed(1); speeds.push(spd); }

    const pwr = getNum('power');
    if (pwr != null && pwr >= 0) { point.power = Math.round(pwr); powers.push(pwr); }

    const cad = getNum('cadence');
    if (cad != null && cad >= 0) { point.cadence = Math.round(cad); cadences.push(cad); }

    const elev = getNum('elevation');
    if (elev != null) { point.elevation = +elev.toFixed(1); elevations.push(elev); }

    const dist = getNum('distance');
    if (dist != null) totalDist = dist;

    const lat = getNum('lat');
    const lng = getNum('lng');
    if (lat != null) point.lat = lat;
    if (lng != null) point.lng = lng;

    timeSeries.push(point);
  }

  // Compute session summary from parsed data
  const lastTime = timeSeries.length > 0 ? timeSeries[timeSeries.length - 1].time : 0;
  const durationMin = Math.max(1, Math.round(lastTime / 60)) || Math.round(timeSeries.length * 5 / 60);

  // Elevation gain
  let elevGain = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) elevGain += diff;
  }

  const session = {
    duration: durationMin,
    distance: totalDist > 0 ? +(totalDist > 1000 ? totalDist / 1000 : totalDist).toFixed(2) : (speeds.length > 0 ? +(speeds.reduce((a, b) => a + b, 0) / speeds.length * durationMin / 60).toFixed(2) : 0),
    hrAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    hrMax: hrs.length > 0 ? Math.round(Math.max(...hrs)) : null,
    power: powers.length > 0 ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : null,
    cadence: cadences.length > 0 ? Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length) : null,
    elevation: elevGain > 0 ? Math.round(elevGain) : null,
    speedAvg: speeds.length > 0 ? +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1) : null,
    calories: durationMin * 8,
    dataPoints: timeSeries.length,
    columnsFound: Object.keys(colMap),
  };

  return { session, timeSeries };
}

// Read file as text in the browser
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsText(file);
  });
}

// ─── STRAVA EXPORT PARSER ───
// Parses the activities.csv from a Strava data export
function parseStravaExportCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header — Strava uses comma-separated with quoted fields
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseCSVLine(lines[0]);

  // Build column index
  const col = (name) => {
    const idx = headers.indexOf(name);
    return idx;
  };

  // Map Strava activity types to our sport types
  const sportMap = {
    'Ride': 'ride', 'Virtual Ride': 'ride', 'E-Bike Ride': 'ride',
    'Run': 'run', 'Virtual Run': 'run', 'Trail Run': 'run',
    'Swim': 'swim', 'Open Water Swim': 'swim',
    'Hike': 'run', 'Walk': 'run',
    'Workout': 'run', 'Weight Training': 'run',
    'Backcountry Ski': 'run', 'Alpine Ski': 'run',
    'Nordic Ski': 'run', 'Snowboard': 'run',
  };

  const activities = [];

  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    const cols = parseCSVLine(lines[r]);

    const getVal = (name) => {
      const idx = col(name);
      if (idx < 0 || idx >= cols.length) return null;
      const v = cols[idx]?.trim();
      if (!v || v === '') return null;
      return v;
    };

    const getNum = (name) => {
      const v = getVal(name);
      if (v == null) return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };

    const actType = getVal('Activity Type') || 'Ride';
    const sport = sportMap[actType] || 'run';

    // Parse Strava date format: "Apr 7, 2017, 3:14:03 PM"
    const dateStr = getVal('Activity Date');
    let date = new Date();
    if (dateStr) {
      try { date = new Date(dateStr); } catch (_) {}
      if (isNaN(date.getTime())) date = new Date();
    }

    // Strava uses "Moving Time" in seconds (second occurrence in CSV)
    // and "Distance" in meters (second occurrence)
    // The CSV has duplicate column names — we need the second set
    const movingTimeIdx = headers.indexOf('Moving Time');
    const movingTime = movingTimeIdx >= 0 ? parseFloat(cols[movingTimeIdx]) : null;

    // Distance — find the second "Distance" column (in meters)
    const distIdx1 = headers.indexOf('Distance');
    const distIdx2 = headers.indexOf('Distance', distIdx1 + 1);
    const distMeters = distIdx2 >= 0 ? parseFloat(cols[distIdx2]) : (distIdx1 >= 0 ? parseFloat(cols[distIdx1]) : null);

    const duration = movingTime ? Math.round(movingTime / 60) : (getNum('Elapsed Time') ? Math.round(getNum('Elapsed Time') / 60) : 0);
    const distKm = distMeters && !isNaN(distMeters) ? +(distMeters / 1000).toFixed(2) : 0;

    const hrAvg = getNum('Average Heart Rate');
    const hrMax = getNum('Max Heart Rate');
    const power = getNum('Average Watts');
    const cadence = getNum('Average Cadence');
    const elevation = getNum('Elevation Gain');
    const calories = getNum('Calories');
    const maxSpeed = getNum('Max Speed');

    // Skip activities with no meaningful data
    if (duration < 1 && distKm < 0.01) continue;

    activities.push({
      id: `strava_${getVal('Activity ID') || r}`,
      date: date.toISOString(),
      sport,
      title: getVal('Activity Name') || `${actType}`,
      activityType: actType,
      duration,
      distance: distKm,
      hrAvg: hrAvg ? Math.round(hrAvg) : null,
      hrMax: hrMax ? Math.round(hrMax) : null,
      power: power ? Math.round(power) : null,
      cadence: cadence ? Math.round(cadence) : null,
      elevation: elevation ? Math.round(elevation) : null,
      calories: calories ? Math.round(calories) : (duration > 0 ? Math.round(duration * (sport === 'ride' ? 8 : 10)) : null),
      speedAvg: distKm > 0 && duration > 0 ? +(distKm / (duration / 60)).toFixed(1) : null,
      maxSpeed: maxSpeed ? +(maxSpeed * 3.6).toFixed(1) : null, // m/s → km/h
      tags: [actType.toLowerCase().replace(/\s+/g, '-')],
      notes: getVal('Activity Description') || '',
      timeSeries: [], // .fit files needed for time series
      source: getVal('Filename') ? '.fit' : 'strava-csv',
      stravaFile: getVal('Filename') || null,
      weight: getNum('Athlete Weight'),
    });
  }

  return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Check if a CSV is a Strava export (has specific Strava column names)
function isStravaExportCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  return firstLine.includes('Activity ID') && firstLine.includes('Activity Type') && firstLine.includes('Relative Effort');
}

// ─── UPLOAD MODAL ───
const UploadModal = ({ onClose, onUpload, onBulkImport }) => {
  const [step, setStep] = useState(1);
  const [sport, setSport] = useState('ride');
  const [method, setMethod] = useState('file');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState(null);
  const [preview, setPreview] = useState(null); // parsed preview data
  const [stravaPreview, setStravaPreview] = useState(null); // strava export preview
  const [importProgress, setImportProgress] = useState(null); // { done, total }
  const [manual, setManual] = useState({ title: '', duration: '', distance: '', hrAvg: '', notes: '' });
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const handleFile = async (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['fit', 'gpx', 'tcx', 'csv'].includes(ext) && !f.name.toLowerCase().endsWith('.fit.gz')) {
      setFile(null);
      setError('Nicht unterstütztes Format. Bitte .fit, .fit.gz, .gpx, .tcx oder .csv hochladen.');
      return;
    }
    setFile(f);
    setExistingId(null);
    setError('');
    setPreview(null);
    setStravaPreview(null);

    if (ext === 'csv') {
      try {
        const text = await readFileAsText(f);

        // Check if this is a Strava export
        if (isStravaExportCSV(text)) {
          const activities = parseStravaExportCSV(text);
          if (activities.length === 0) {
            setError('Keine Aktivitäten in der Strava-Exportdatei gefunden.');
            setFile(null);
            return;
          }
          // Build summary stats
          const bySport = {};
          let totalDist = 0, totalDur = 0;
          const years = new Set();
          activities.forEach(a => {
            const s = a.sport;
            if (!bySport[s]) bySport[s] = { count: 0, distance: 0, duration: 0 };
            bySport[s].count++;
            bySport[s].distance += a.distance || 0;
            bySport[s].duration += a.duration || 0;
            totalDist += a.distance || 0;
            totalDur += a.duration || 0;
            years.add(new Date(a.date).getFullYear());
          });
          const sortedYears = [...years].sort();
          setStravaPreview({
            activities,
            total: activities.length,
            bySport,
            totalDist,
            totalDur,
            yearRange: sortedYears.length > 1 ? `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}` : `${sortedYears[0]}`,
          });
          setStep(3); // Jump to Strava import step
          return;
        }

        // Regular CSV
        const parsed = parseCSVClient(text);
        if (parsed.timeSeries.length === 0) {
          setError('CSV-Datei enthält keine verwertbaren Daten. Erwartete Spalten: hr, speed, power, cadence, elevation, distance, time');
          setFile(null);
          return;
        }
        setPreview(parsed);
      } catch (e) {
        setError('Fehler beim Lesen der CSV-Datei: ' + e.message);
        setFile(null);
      }
    }
  };

  const handleUpload = async () => {
    setUploading(true);
    setExistingId(null);
    setError('');
    const ext = file?.name?.split('.').pop().toLowerCase();

    if (method === 'file' && file) {
      // ── CSV: use client-side parsed data ──
      if (ext === 'csv' && preview) {
        const { session, timeSeries } = preview;
        const act = {
          id: `csv_${Date.now()}`,
          date: new Date().toISOString(),
          sport,
          title: file.name.replace(/\.\w+$/, '').replace(/[_-]/g, ' '),
          duration: session.duration,
          distance: session.distance,
          hrAvg: session.hrAvg,
          hrMax: session.hrMax,
          power: session.power,
          cadence: session.cadence,
          elevation: session.elevation,
          calories: session.calories,
          speedAvg: session.speedAvg,
          tags: [],
          notes: '',
          timeSeries,
          source: '.csv',
        };

        // Also try to send to backend
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('sport', sport);
          const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
          if (res.ok) {
            const backendData = await res.json();
            onUpload(backendData);
            setUploading(false);
            return;
          }
        } catch (_) { /* backend not available, use client-parsed data */ }

        onUpload(act);
        setUploading(false);
        return;
      }

      // Import recordings with the backend parser.
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('sport', sport);
        const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          setExistingId(data.existing_id || null);
          throw new Error(data.error || 'Upload fehlgeschlagen');
        }
        onUpload(data);
      } catch (e) {
        // For binary formats (fit/gpx/tcx) we need the backend parser
        // Show error if backend is not available
        setError(e instanceof TypeError ? 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen und erneut versuchen.' : e.message);
        setUploading(false);
        return;
      }
    } else {
      // ── Manual entry ──
      const duration = parseInt(manual.duration) || 30;
      const act = {
        id: `man_${Date.now()}`, date: new Date().toISOString(), sport,
        title: manual.title || 'Workout', duration,
        distance: parseFloat(manual.distance) || 0,
        hrAvg: parseInt(manual.hrAvg) || null, hrMax: (parseInt(manual.hrAvg) || 140) + 25,
        power: null, cadence: null, elevation: null,
        calories: duration * 8, tags: [], notes: manual.notes,
        timeSeries: [], source: 'manuell',
      };

      // Try backend first
      try {
        const res = await fetch(`${API}/api/activities/manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(act),
        });
        if (res.ok) {
          const backendData = await res.json();
          onUpload(backendData);
          setUploading(false);
          return;
        }
      } catch (_) { /* backend not available */ }

      onUpload(act);
    }
    setUploading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-ffffff)', borderRadius: 12, width: step === 3 ? 560 : 500, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', transition: 'width 0.2s' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--bd-e5e7eb)' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{step === 3 ? 'Strava-Import' : 'Workout hinzufügen'}</h2>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>{step === 3 ? 'Datenvorschau' : `Schritt ${step} von 2`}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {step === 1 && <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-6b7280)', textTransform: 'uppercase', letterSpacing: '0.06em',  marginBottom: 8 }}>Aktivitätstyp</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {['run', 'ride', 'swim'].map(s => (
                <button key={s} onClick={() => setSport(s)} style={{
                  flex: 1, padding: '14px 8px', borderRadius: 8, border: `2px solid ${sport === s ? sportColor(s) : 'var(--line)'}`,
                  background: sport === s ? 'var(--tint)' : 'var(--surface)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s'
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: sport === s ? 'var(--ink)' : 'var(--muted)' }}>{sportLabels[s]}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-6b7280)', textTransform: 'uppercase', letterSpacing: '0.06em',  marginBottom: 8 }}>Methode</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[['file', 'Datei hochladen'], ['manual', 'Manuell eingeben']].map(([k, l]) => (
                <button key={k} onClick={() => setMethod(k)} style={{
                  flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${method === k ? '#1e40af' : 'var(--bd-e5e7eb)'}`,
                  background: method === k ? 'var(--bg-eff6ff)' : 'var(--bg-ffffff)', color: method === k ? 'var(--fg-1e40af)' : 'var(--fg-6b7280)',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                }}>{l}</button>
              ))}
            </div>
            <button onClick={() => setStep(2)} style={{
              width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#1e40af', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer'
            }}>Weiter</button>

            {/* Strava Import divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 12px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--bg-e5e7eb)' }} />
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>oder</span>
              <div style={{ flex: 1, height: 1, background: 'var(--bg-e5e7eb)' }} />
            </div>
            <button onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.csv';
              input.onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };
              input.click();
            }} style={{
              width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', background: 'var(--bg-ffffff)', color: 'var(--fg-374151)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
              <span style={{ fontSize: 16 }}>🔶</span>
              Strava-Export importieren (activities.csv)
            </button>
          </>}

          {step === 2 && method === 'file' && <>
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${drag ? '#1e40af' : file ? '#22c55e' : 'var(--bd-d1d5db)'}`,
                borderRadius: 10, padding: '36px 20px', textAlign: 'center', cursor: 'pointer',
                background: drag ? 'var(--bg-eff6ff)' : file ? 'var(--bg-f0fdf4)' : 'var(--bg-fafafa)', transition: 'all 0.2s', marginBottom: 16
              }}
            >
              <input ref={fileRef} type="file" accept=".fit,.FIT,.fit.gz,.gz,.gpx,.tcx,.csv" aria-label="Aktivitätsdatei auswählen" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              {file ? <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
                <div style={{ color: 'var(--fg-6b7280)', fontSize: 12 }}>{(file.size / 1024).toFixed(1)} KB</div>
              </> : <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Datei hierher ziehen oder klicken</div>
                <div style={{ color: '#9ca3af', fontSize: 12 }}>.fit, .fit.gz, .gpx, .tcx, .csv</div>
              </>}
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, padding: '8px 12px', background: 'var(--bg-fef2f2)', borderRadius: 6, border: '1px solid var(--bd-fecaca)' }}>{error}{existingId && <button style={{ display: 'block', marginTop: 8 }} onClick={async () => { try { onUpload(await api(`/api/activities/${existingId}`), true); } catch (e) { setError(e.message); } }}>Vorhandene Aktivität öffnen</button>}</div>}

            {/* CSV Preview Panel */}
            {preview && (
              <div style={{ background: 'var(--bg-f8fafc)', borderRadius: 8, border: '1px solid var(--bd-e2e8f0)', padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-1e40af)', textTransform: 'uppercase', letterSpacing: '0.06em',  marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  ✓ CSV geparst — Vorschau
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  {[
                    preview.session.duration && { l: 'Dauer', v: `${preview.session.duration} min` },
                    preview.session.distance && { l: 'Distanz', v: `${preview.session.distance} km` },
                    preview.session.hrAvg && { l: 'Ø HF', v: `${preview.session.hrAvg} bpm` },
                    preview.session.hrMax && { l: 'Max HF', v: `${preview.session.hrMax} bpm` },
                    preview.session.power && { l: 'Ø Leistung', v: `${preview.session.power} W` },
                    preview.session.cadence && { l: 'Trittfrequenz', v: `${preview.session.cadence}` },
                    preview.session.elevation && { l: 'Höhenmeter', v: `${preview.session.elevation} m` },
                    preview.session.speedAvg && { l: 'Ø Speed', v: `${preview.session.speedAvg} km/h` },
                    { l: 'Datenpunkte', v: preview.session.dataPoints },
                  ].filter(Boolean).map((s, i) => (
                    <div key={i} style={{ padding: '6px 8px', background: 'var(--bg-ffffff)', borderRadius: 6, border: '1px solid var(--bd-e5e7eb)' }}>
                      <div style={{ fontSize: 9, color: '#9ca3af',  textTransform: 'uppercase' }}>{s.l}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-1e293b)' }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-6b7280)' }}>
                  Erkannte Spalten: {preview.session.columnsFound?.join(', ') || '—'}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep(1); setPreview(null); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', background: 'var(--bg-ffffff)', color: 'var(--fg-6b7280)', fontSize: 14, cursor: 'pointer' }}>Zurück</button>
              <button onClick={handleUpload} disabled={!file || uploading} style={{
                flex: 2, padding: 12, borderRadius: 8, border: 'none',
                background: file ? (preview ? '#22c55e' : '#1e40af') : 'var(--bg-d1d5db)',
                color: file ? '#fff' : '#9ca3af', fontSize: 14, fontWeight: 600, cursor: file ? 'pointer' : 'default',
                opacity: uploading ? 0.7 : 1
              }}>{uploading ? 'Wird verarbeitet…' : preview ? 'Daten übernehmen' : 'Hochladen & Parsen'}</button>
            </div>
          </>}

          {step === 2 && method === 'manual' && <>
            {[['title', 'Titel', 'text', 'z.B. Morgenlauf'], ['duration', 'Dauer (Minuten)', 'number', 'z.B. 45'], ['distance', 'Distanz (km)', 'number', 'z.B. 8.5'], ['hrAvg', 'Ø Herzfrequenz', 'number', 'z.B. 148']].map(([k, l, t, p]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em',  display: 'block', marginBottom: 5 }}>{l}</label>
                <input type={t} placeholder={p} value={manual[k]} onChange={e => setManual(prev => ({ ...prev, [k]: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', fontSize: 13, outline: 'none' }} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em',  display: 'block', marginBottom: 5 }}>Notizen</label>
              <textarea value={manual.notes} onChange={e => setManual(p => ({ ...p, notes: e.target.value }))} placeholder="Wie war das Training?" rows={3}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', background: 'var(--bg-ffffff)', color: 'var(--fg-6b7280)', fontSize: 14, cursor: 'pointer' }}>Zurück</button>
              <button onClick={handleUpload} disabled={uploading} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: '#1e40af', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {uploading ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </>}

          {/* ── Step 3: Strava Export Import ── */}
          {step === 3 && stravaPreview && <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>🔶</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1e293b)' }}>Strava-Export erkannt!</div>
              <div style={{ fontSize: 13, color: 'var(--fg-6b7280)', marginTop: 4 }}>{file?.name} · {stravaPreview.yearRange}</div>
            </div>

            {/* Summary stats */}
            <div style={{ background: 'var(--bg-f8fafc)', borderRadius: 10, border: '1px solid var(--bd-e2e8f0)', padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ background: 'var(--bg-ffffff)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--bd-e5e7eb)' }}>
                  <div style={{ fontSize: 10, color: '#9ca3af',  textTransform: 'uppercase' }}>Aktivitäten</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg-1e40af)' }}>{stravaPreview.total.toLocaleString()}</div>
                </div>
                <div style={{ background: 'var(--bg-ffffff)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--bd-e5e7eb)' }}>
                  <div style={{ fontSize: 10, color: '#9ca3af',  textTransform: 'uppercase' }}>Gesamtdistanz</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg-22c55e)' }}>{Math.round(stravaPreview.totalDist).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af' }}>km</span></div>
                </div>
              </div>

              {/* Sport breakdown */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-6b7280)', textTransform: 'uppercase',  letterSpacing: '0.05em', marginBottom: 8 }}>Aufschlüsselung nach Sportart</div>
              {Object.entries(stravaPreview.bySport).sort((a, b) => b[1].count - a[1].count).map(([sport, data]) => (
                <div key={sport} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--bd-f3f4f6)' }}>
                  <SportMark sport={sport} />
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--fg-6b7280)' }}>
                    <span>{data.count}x</span>
                    <span>{Math.round(data.distance).toLocaleString()} km</span>
                    <span>{fmt.dur(data.duration)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Import progress or button */}
            {importProgress ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-6b7280)', marginBottom: 6 }}>
                  <span>Importiere Aktivitäten…</span>
                  <span style={{ fontWeight: 600 }}>{importProgress.done} / {importProgress.total}</span>
                </div>
                <div style={{ height: 8, background: 'var(--bg-e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(importProgress.done / importProgress.total) * 100}%`, background: '#22c55e', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setStep(1); setStravaPreview(null); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--bd-e5e7eb)', background: 'var(--bg-ffffff)', color: 'var(--fg-6b7280)', fontSize: 14, cursor: 'pointer' }}>Abbrechen</button>
                <button onClick={async () => {
                  const acts = stravaPreview.activities;
                  const batchSize = 50;
                  setImportProgress({ done: 0, total: acts.length });
                  for (let i = 0; i < acts.length; i += batchSize) {
                    const batch = acts.slice(i, i + batchSize);
                    await new Promise(r => setTimeout(r, 30)); // Small delay for UI update
                    setImportProgress({ done: Math.min(i + batchSize, acts.length), total: acts.length });
                  }
                  onBulkImport(acts);
                }} style={{
                  flex: 2, padding: 12, borderRadius: 8, border: 'none',
                  background: '#22c55e', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer'
                }}>
                  Alle {stravaPreview.total} Aktivitäten importieren
                </button>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ───
export default function App() {
  const [activities, setActivities] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('home');
  const [selected, setSelected] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [workoutEditor, setWorkoutEditor] = useState(null);
  const [plannedWorkouts, setPlannedWorkouts] = useState([]);
  const [workoutLoadError, setWorkoutLoadError] = useState('');
  const [draggedWorkout, setDraggedWorkout] = useState(null);
  const [dropDate, setDropDate] = useState(null);
  const [moveError, setMoveError] = useState('');
  const [legacyUpload, setLegacyUpload] = useState(false);
  const [incomingDrop, setIncomingDrop] = useState(null);
  const [toast, setToast] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [user, setUser] = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [coachTab, setCoachTab] = useState({ tab: 'plan', version: 0 });

  const handleUpload = (act, existing = false) => {
    setActivities(prev => [act, ...prev.filter(a => a.id !== act.id)].sort((a, b) => new Date(b.date) - new Date(a.date)));
    setSelected(act);
    window.location.hash = `activity/${act.id}`;
    setShowUpload(false);
    setLegacyUpload(false);
    setToast(existing ? 'Vorhandene Aktivität geöffnet.' : 'Workout erfolgreich hochgeladen!');
    setTimeout(() => setToast(null), 3000);
  };

  const handleBulkImport = (acts) => {
    // Replace all data with imported Strava activities (remove demo data)
    setActivities(acts.sort((a, b) => new Date(b.date) - new Date(a.date)));
    setShowUpload(false);
    setLegacyUpload(false);
    setToast(`${acts.length} Aktivitäten aus Strava importiert!`);
    setTimeout(() => setToast(null), 4000);
  };

  const openActivity = async (activity) => {
    setLoadError('');
    try {
      const full = activity.timeSeries ? activity : await api(`/api/activities/${activity.id}`);
      setSelected(full);
      window.location.hash = `activity/${full.id}`;
    } catch (error) { setLoadError('Aktivität konnte nicht geladen werden: ' + error.message); }
  };

  const deleteActivity = async (id) => {
    await api(`/api/activities/${id}`, { method: 'DELETE' });
    setActivities(current => current.filter(activity => activity.id !== id));
    setSelected(current => current?.id === id ? null : current);
    if (window.location.hash === `#activity/${id}`) window.location.hash = '';
    setToast('Aktivität gelöscht.');
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/user`).then(response => response.ok ? response.json() : null)
      .then(saved => { if (active && saved) setUser(saved); }, () => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const saved = await api('/api/activities');
        if (!active) return;
        setActivities(saved);
        const match = window.location.hash.match(/^#activity\/([\w-]+)$/);
        if (match) {
          const full = await api(`/api/activities/${match[1]}`);
          if (active) setSelected(full);
        }
      } catch (error) {
        if (active) setLoadError('Gespeicherte Aktivitäten konnten nicht geladen werden. ' + error.message);
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api('/api/workouts').then(saved => { if (active) setPlannedWorkouts(saved); })
      .catch(error => { if (active) setWorkoutLoadError('Geplante Workouts konnten nicht geladen werden. ' + error.message); });
    return () => { active = false; };
  }, []);

  const reloadWorkouts = () => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); })
    .catch(error => setWorkoutLoadError(error.message));
  // Moves a planned workout to another day: shown immediately, reverted if the server refuses.
  const moveWorkout = async (id, date) => {
    const workout = plannedWorkouts.find(w => w.id === id);
    setDropDate(null); setDraggedWorkout(null);
    if (!workout || workout.locked || workout.date === date) return;
    setMoveError('');
    setPlannedWorkouts(current => current.map(w => w.id === id ? { ...w, date } : w));
    const { id: _id, locked: _locked, ...definition } = workout;
    try {
      const saved = await api(`/api/workouts/${id}`, { method: 'PUT', body: JSON.stringify({ ...definition, date }) });
      setPlannedWorkouts(current => current.map(w => w.id === id ? saved : w));
    } catch (error) {
      setPlannedWorkouts(current => current.map(w => w.id === id ? workout : w));
      setMoveError(`„${workout.name}“ konnte nicht verschoben werden. ${error.message}`);
    }
  };
  const openCoachProfile = () => { setCoachTab(t => ({ tab: 'profile', version: t.version + 1 })); setPage('coach'); setSelected(null); window.location.hash = ''; };

  const todayStr = new Date().toDateString();

  // Calendar data
  // Build calendar as weekly rows (for TrainingPeaks-style layout with weekly summary sidebar)
  const calWeeks = useMemo(() => {
    const y = calMonth.getFullYear(); const m = calMonth.getMonth();
    const firstDay = (new Date(y, m, 1).getDay() + 6) % 7; // Monday start
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    // Build flat cells array
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const dayActs = activities.filter(a => { const ad = new Date(a.date); return ad.getFullYear() === y && ad.getMonth() === m && ad.getDate() === d; });
      const plans = plannedWorkouts.filter(workout => workout.date === localDate(date));
      cells.push({ date, day: d, activities: dayActs, plans });
    }
    // Pad end to fill last week
    while (cells.length % 7 !== 0) cells.push(null);

    // Split into weeks and compute summary per week
    const weeks = [];
    for (let w = 0; w < cells.length; w += 7) {
      const weekCells = cells.slice(w, w + 7);
      const weekActs = weekCells.filter(Boolean).flatMap(c => c.activities);
      const summary = {
        count: weekActs.length,
        duration: weekActs.reduce((s, a) => s + (a.duration || 0), 0),
        distance: weekActs.reduce((s, a) => s + (a.distance || 0), 0),
        elevation: weekActs.reduce((s, a) => s + (a.elevation || 0), 0),
        calories: weekActs.reduce((s, a) => s + (a.calories || 0), 0),
        bySport: {},
      };
      weekActs.forEach(a => {
        if (!summary.bySport[a.sport]) summary.bySport[a.sport] = { duration: 0, distance: 0, count: 0 };
        summary.bySport[a.sport].duration += a.duration || 0;
        summary.bySport[a.sport].distance += a.distance || 0;
        summary.bySport[a.sport].count += 1;
      });
      weeks.push({ cells: weekCells, summary });
    }
    return weeks;
  }, [calMonth, activities, plannedWorkouts]);
  const maxSportDuration = Math.max(1, ...calWeeks.flatMap(w => Object.values(w.summary.bySport).map(sport => sport.duration)));

  // ─── RENDER ───
  return (
    <div className="app"
      onDragOver={event => { if (Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault(); }}
      onDrop={event => {
        event.preventDefault();
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        const selection = collectDroppedFiles(event.dataTransfer).then(files => ({ files }), error => ({ error }));
        setIncomingDrop(selection);
        setLegacyUpload(false);
        setShowUpload(true);
      }}>
      <header className="app-header">
        <div className="app-header-start">
          <span className="app-wordmark">Training <em>Plēnum</em></span>
          <nav aria-label="Hauptnavigation" className="app-nav">
            {[['home', 'Startseite'], ['calendar', 'Kalender'], ['dashboard', 'Dashboard'], ['coach', 'AI Coach']].map(([id, label]) => (
              <button key={id} type="button" aria-current={page === id && !selected ? 'page' : undefined}
                onClick={() => { setPage(id); setSelected(null); window.location.hash = ''; }}>{label}</button>
            ))}
          </nav>
        </div>
        <div className="app-header-end">
          <button type="button" className="app-import" onClick={() => setShowUpload(true)}>Datei importieren</button>
          <UserMenu apiBase={API} user={user}
            onSaved={(saved, changed) => { setUser(saved); if (changed) { setProfileVersion(v => v + 1); setToast('Profil gespeichert.'); setTimeout(() => setToast(null), 3000); } }}
            onOpenCoachProfile={openCoachProfile} />
        </div>
      </header>

      {loading && <p role="status" className="app-notice">Aktivitäten werden geladen…</p>}
      {loadError && <div role="alert" className="app-notice app-notice-error">{loadError} <button type="button" onClick={() => window.location.reload()}>Erneut versuchen</button></div>}
      {!loading && !loadError && !activities.length && <p className="app-notice">Noch keine Aktivitäten. Über „Datei importieren“ eine FIT-Datei hochladen.</p>}
      <main className={`app-main${page === 'calendar' && !selected ? ' app-main-wide' : ''}`}>
        {selected ? (
          <div style={{ padding: '20px 0' }}>
            <ActivityDetail key={selected.id} activity={selected} apiBase={API} onDelete={deleteActivity}
              onBack={() => { setSelected(null); window.location.hash = ''; }} />
          </div>
        ) : page === 'home' ? (
          <Home apiBase={API} activities={activities} plannedWorkouts={plannedWorkouts} workoutLoadError={workoutLoadError}
            onReloadWorkouts={reloadWorkouts} onOpenActivity={openActivity} onOpenWorkout={setWorkoutEditor}
            onEditGoal={openCoachProfile} bestEffortsYear={calMonth.getFullYear()} />
        ) : page === 'calendar' ? (
          <div className="calendar">
            <div className="calendar-toolbar">
              <h2>{calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2>
              <select aria-label="Monat wählen" value={`${calMonth.getFullYear()}-${calMonth.getMonth()}`}
                onChange={e => { const [y, m] = e.target.value.split('-'); setCalMonth(new Date(+y, +m, 1)); }}>
                {Array.from({ length: 12 }, (_, i) => {
                  const d = new Date(calMonth.getFullYear(), i, 1);
                  return <option key={i} value={`${d.getFullYear()}-${i}`}>{d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>;
                })}
              </select>
              <div className="calendar-nav">
                <button type="button" onClick={() => { const now = new Date(); setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Heute</button>
                <button type="button" aria-label="Vorheriger Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}>‹</button>
                <button type="button" aria-label="Nächster Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}>›</button>
              </div>
            </div>

            {workoutLoadError && <p role="alert" className="calendar-error">{workoutLoadError} <button type="button" onClick={reloadWorkouts}>Erneut laden</button></p>}
            {moveError && <p role="alert" className="calendar-error">{moveError} <button type="button" onClick={() => setMoveError('')}>Schließen</button></p>}

            <div className="calendar-head">
              {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d}>{d}</div>)}
              <div>Woche</div>
            </div>

            {calWeeks.map((week, wi) => (
              <div key={wi} className="calendar-week">
                {week.cells.map((cell, ci) => {
                  if (!cell) return <div key={`e${wi}-${ci}`} className="calendar-day-empty" />;
                  const isToday = cell.date.toDateString() === todayStr;
                  const cellDate = localDate(cell.date);
                  const carriesWorkout = event => Array.from(event.dataTransfer.types || []).includes(WORKOUT_DRAG_TYPE);
                  return (
                    <div key={`${wi}-${ci}`} className={`calendar-day${isToday ? ' today' : ''}${dropDate === cellDate ? ' calendar-drop-target' : ''}`}
                      data-date={cellDate} role="group" aria-label={`Kalendertag ${fmt.dateFull(cell.date)}`}
                      onDragOver={event => {
                        if (!carriesWorkout(event)) return;
                        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
                        if (dropDate !== cellDate) setDropDate(cellDate);
                      }}
                      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropDate(d => d === cellDate ? null : d); }}
                      onDrop={event => {
                        if (!carriesWorkout(event)) return;
                        event.preventDefault(); event.stopPropagation();
                        moveWorkout(event.dataTransfer.getData(WORKOUT_DRAG_TYPE), cellDate);
                      }}>
                      <div className="calendar-day-header">
                        <span className="calendar-day-number">{isToday ? `Heute ${cell.day}` : cell.day === 1 ? `1. ${calMonth.toLocaleDateString('de-DE', { month: 'short' })}` : cell.day}</span>
                        <button type="button" className="calendar-add-workout"
                          aria-label={`Workout am ${cell.date.toLocaleDateString('de-DE')} planen`}
                          title="Workout planen"
                          onClick={() => setWorkoutEditor({ date: localDate(cell.date) })}>+</button>
                      </div>

                      {cell.plans.map(workout => <button type="button" key={workout.id}
                        className={`calendar-planned-workout${draggedWorkout === workout.id ? ' dragging' : ''}`}
                        style={{ '--calendar-sport-color': sportColor(workout.sport) }}
                        aria-label={`${workout.name} am ${cell.date.toLocaleDateString('de-DE')} bearbeiten`}
                        draggable={!workout.locked}
                        title={workout.locked ? 'Fixiert – im AI Coach lösen, um die Einheit zu verschieben' : 'Zum Verschieben auf einen anderen Tag ziehen'}
                        onDragStart={event => {
                          event.dataTransfer.setData(WORKOUT_DRAG_TYPE, workout.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggedWorkout(workout.id);
                        }}
                        onDragEnd={() => { setDraggedWorkout(null); setDropDate(null); }}
                        onClick={() => setWorkoutEditor(workout)}>
                        <span className="calendar-plan-heading">{sportLabels[workout.sport] || 'Training'} · <span className="calendar-plan-status">Geplant</span></span>
                        <strong>{workout.name}</strong><small>{workoutSummary(workout)}</small>
                      </button>)}

                      {cell.activities.map(a => (
                        <button type="button" key={a.id} className="calendar-activity" style={{ '--calendar-sport-color': sportColor(a.sport) }} onClick={() => openActivity(a)}>
                          <span className="calendar-plan-heading">{sportLabels[a.sport] || a.sport}</span>
                          <span className="calendar-activity-title">{a.title}</span>
                          <span className="calendar-activity-stats">{fmt.durHM(a.duration)} · {a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                          {(a.hrAvg || a.power) && <small>{[a.hrAvg && `Ø ${a.hrAvg} bpm`, a.power && `${a.power} W`].filter(Boolean).join(' · ')}</small>}
                        </button>
                      ))}
                    </div>
                  );
                })}

                <div className="calendar-summary">
                  {week.summary.count > 0 ? (<>
                    {Object.entries(week.summary.bySport).map(([sport, data]) => (
                      <div key={sport} className="calendar-summary-sport">
                        <div><span className="sport-mark"><i aria-hidden="true" style={{ background: sportColor(sport) }} />{sportLabels[sport] || sport}</span><strong>{data.distance.toFixed(1)} km</strong></div>
                        <div className="calendar-summary-bar"><i style={{ width: `${(data.duration / maxSportDuration) * 100}%`, background: sportColor(sport) }} /></div>
                      </div>
                    ))}
                    <dl>
                      {[
                        ['Dauer', fmt.durHM(week.summary.duration)],
                        ['Distanz', `${week.summary.distance.toFixed(1)} km`],
                        ...(week.summary.elevation > 0 ? [['Höhenmeter', `${fmt.num(week.summary.elevation)} m`]] : []),
                        ['Kalorien', `${fmt.num(week.summary.calories)} kcal`],
                      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                    </dl>
                  </>) : <p className="calendar-summary-empty">Keine Aktivitäten</p>}
                </div>
              </div>
            ))}
          </div>
        ) : page === 'coach' ? (
          <AICoach key={coachTab.version} initialTab={coachTab.tab} apiBase={API} workouts={plannedWorkouts} onOpenWorkout={setWorkoutEditor}
            onWorkoutsChanged={() => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); })} />
        ) : page === 'dashboard' ? (
          <div className="dashboard-page">
            <Dashboard key={profileVersion} apiBase={API} activities={activities} loading={loading} onOpenActivity={openActivity} />

            <section className="activity-list" aria-labelledby="all-activities">
              <div className="activity-list-head">
                <h3 id="all-activities">Alle Aktivitäten</h3>
                <span>{activities.length} Einträge</span>
              </div>
              <div className="activity-list-grid activity-list-columns" aria-hidden="true">
                <span>Aktivität</span><span>Datum</span><span>Dauer</span><span>Distanz</span><span>Ø HF</span><span>Leistung</span><span>Quelle</span>
              </div>
              {activities.map(a => (
                <button type="button" key={a.id} className="activity-list-grid activity-list-row" onClick={() => openActivity(a)}>
                  <span className="activity-list-title"><span className="activity-list-name">{a.title}</span><SportMark sport={a.sport} /></span>
                  <span>{fmt.date(a.date)}</span>
                  <span>{fmt.dur(a.duration)}</span>
                  <span>{a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                  <span>{a.hrAvg ?? '—'}</span>
                  <span>{a.power != null ? `${a.power} W` : '—'}</span>
                  <span className="activity-list-source">{a.source}</span>
                </button>
              ))}
            </section>
          </div>
        ) : null}
      </main>

      {/* Upload Modal */}
      {workoutEditor && <WorkoutEditor apiBase={API} initial={workoutEditor.id ? workoutEditor : null} date={workoutEditor.date}
        onClose={() => setWorkoutEditor(null)}
        onSaved={workout => setPlannedWorkouts(current => [workout, ...current.filter(w => w.id !== workout.id)])}
        onDeleted={id => setPlannedWorkouts(current => current.filter(w => w.id !== id))}
        onImport={() => { setWorkoutEditor(null); setLegacyUpload(false); setShowUpload(true); }} />}
      {showUpload && !legacyUpload && <BatchImport apiBase={API} initialSelection={incomingDrop}
        onImported={activity => setActivities(current => [activity, ...current.filter(a => a.id !== activity.id)].sort((a, b) => new Date(b.date) - new Date(a.date)))}
        onClose={() => { setShowUpload(false); setIncomingDrop(null); setSelected(null); setPage('dashboard'); window.location.hash = ''; }}
        onLegacy={() => { setLegacyUpload(true); setIncomingDrop(null); }}
        onOpen={id => { setShowUpload(false); setIncomingDrop(null); openActivity({ id }); }} />}
      {showUpload && legacyUpload && <UploadModal onClose={() => { setShowUpload(false); setLegacyUpload(false); }} onUpload={handleUpload} onBulkImport={handleBulkImport} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, background: 'var(--btn-bg)', color: 'var(--btn-fg)', padding: '12px 20px',
          borderRadius: 2, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.3s ease', zIndex: 2000
        }}>{toast}</div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}
