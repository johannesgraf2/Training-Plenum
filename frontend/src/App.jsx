import React, { useState, useEffect, useMemo, useRef } from 'react';

import ActivityDetail from './ActivityDetail';
import BatchImport from './BatchImport';
import BestEfforts from './BestEfforts';
import Dashboard from './Dashboard';
import AICoach from './AICoach';
import WorkoutEditor, { PlannedWorkoutRows } from './WorkoutEditor';
import { localDate, summary as workoutSummary } from './workoutModel';
import './Calendar.css';
import { collectDroppedFiles } from './importQueue';

// ─── API HELPER ───
const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

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

const sportLabels = { run: 'Laufen', ride: 'Radfahren', swim: 'Schwimmen', multisport: 'Multisport', walking: 'Gehen', hiking: 'Wandern' };
const sportEmoji = { run: '🏃', ride: '🚴', swim: '🏊' };
const sportColors = { run: '#22c55e', ride: '#3b82f6', swim: '#06b6d4' };

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
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: step === 3 ? 560 : 500, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', transition: 'width 0.2s' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{step === 3 ? 'Strava-Import' : 'Workout hinzufügen'}</h2>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>{step === 3 ? 'Datenvorschau' : `Schritt ${step} von 2`}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {step === 1 && <>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono'", marginBottom: 8 }}>Aktivitätstyp</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {['run', 'ride', 'swim'].map(s => (
                <button key={s} onClick={() => setSport(s)} style={{
                  flex: 1, padding: '14px 8px', borderRadius: 8, border: `2px solid ${sport === s ? sportColors[s] : '#e5e7eb'}`,
                  background: sport === s ? sportColors[s] + '10' : '#fff', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{sportEmoji[s]}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: sport === s ? sportColors[s] : '#6b7280' }}>{sportLabels[s]}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono'", marginBottom: 8 }}>Methode</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[['file', 'Datei hochladen'], ['manual', 'Manuell eingeben']].map(([k, l]) => (
                <button key={k} onClick={() => setMethod(k)} style={{
                  flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${method === k ? '#1e40af' : '#e5e7eb'}`,
                  background: method === k ? '#eff6ff' : '#fff', color: method === k ? '#1e40af' : '#6b7280',
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
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>oder</span>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            </div>
            <button onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.csv';
              input.onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };
              input.click();
            }} style={{
              width: '100%', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151',
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
                border: `2px dashed ${drag ? '#1e40af' : file ? '#22c55e' : '#d1d5db'}`,
                borderRadius: 10, padding: '36px 20px', textAlign: 'center', cursor: 'pointer',
                background: drag ? '#eff6ff' : file ? '#f0fdf4' : '#fafafa', transition: 'all 0.2s', marginBottom: 16
              }}
            >
              <input ref={fileRef} type="file" accept=".fit,.FIT,.fit.gz,.gz,.gpx,.tcx,.csv" aria-label="Aktivitätsdatei auswählen" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              {file ? <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
                <div style={{ color: '#6b7280', fontSize: 12 }}>{(file.size / 1024).toFixed(1)} KB</div>
              </> : <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Datei hierher ziehen oder klicken</div>
                <div style={{ color: '#9ca3af', fontSize: 12 }}>.fit, .fit.gz, .gpx, .tcx, .csv</div>
              </>}
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>{error}{existingId && <button style={{ display: 'block', marginTop: 8 }} onClick={async () => { try { onUpload(await api(`/api/activities/${existingId}`), true); } catch (e) { setError(e.message); } }}>Vorhandene Aktivität öffnen</button>}</div>}

            {/* CSV Preview Panel */}
            {preview && (
              <div style={{ background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono'", marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    <div key={i} style={{ padding: '6px 8px', background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: "'IBM Plex Mono'", textTransform: 'uppercase' }}>{s.l}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: "'IBM Plex Mono'" }}>
                  Erkannte Spalten: {preview.session.columnsFound?.join(', ') || '—'}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep(1); setPreview(null); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 14, cursor: 'pointer' }}>Zurück</button>
              <button onClick={handleUpload} disabled={!file || uploading} style={{
                flex: 2, padding: 12, borderRadius: 8, border: 'none',
                background: file ? (preview ? '#22c55e' : '#1e40af') : '#d1d5db',
                color: file ? '#fff' : '#9ca3af', fontSize: 14, fontWeight: 600, cursor: file ? 'pointer' : 'default',
                opacity: uploading ? 0.7 : 1
              }}>{uploading ? 'Wird verarbeitet…' : preview ? 'Daten übernehmen' : 'Hochladen & Parsen'}</button>
            </div>
          </>}

          {step === 2 && method === 'manual' && <>
            {[['title', 'Titel', 'text', 'z.B. Morgenlauf'], ['duration', 'Dauer (Minuten)', 'number', 'z.B. 45'], ['distance', 'Distanz (km)', 'number', 'z.B. 8.5'], ['hrAvg', 'Ø Herzfrequenz', 'number', 'z.B. 148']].map(([k, l, t, p]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'IBM Plex Mono'", display: 'block', marginBottom: 5 }}>{l}</label>
                <input type={t} placeholder={p} value={manual[k]} onChange={e => setManual(prev => ({ ...prev, [k]: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none' }} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'IBM Plex Mono'", display: 'block', marginBottom: 5 }}>Notizen</label>
              <textarea value={manual.notes} onChange={e => setManual(p => ({ ...p, notes: e.target.value }))} placeholder="Wie war das Training?" rows={3}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 14, cursor: 'pointer' }}>Zurück</button>
              <button onClick={handleUpload} disabled={uploading} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: '#1e40af', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {uploading ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </>}

          {/* ── Step 3: Strava Export Import ── */}
          {step === 3 && stravaPreview && <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>🔶</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Strava-Export erkannt!</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{file?.name} · {stravaPreview.yearRange}</div>
            </div>

            {/* Summary stats */}
            <div style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: "'IBM Plex Mono'", textTransform: 'uppercase' }}>Aktivitäten</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1e40af' }}>{stravaPreview.total.toLocaleString()}</div>
                </div>
                <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: "'IBM Plex Mono'", textTransform: 'uppercase' }}>Gesamtdistanz</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{Math.round(stravaPreview.totalDist).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af' }}>km</span></div>
                </div>
              </div>

              {/* Sport breakdown */}
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontFamily: "'IBM Plex Mono'", letterSpacing: '0.05em', marginBottom: 8 }}>Aufschlüsselung nach Sportart</div>
              {Object.entries(stravaPreview.bySport).sort((a, b) => b[1].count - a[1].count).map(([sport, data]) => (
                <div key={sport} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{sportEmoji[sport] || '🏋️'}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{sportLabels[sport] || sport}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280', fontFamily: "'IBM Plex Mono'" }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                  <span>Importiere Aktivitäten…</span>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontWeight: 600 }}>{importProgress.done} / {importProgress.total}</span>
                </div>
                <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(importProgress.done / importProgress.total) * 100}%`, background: '#22c55e', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setStep(1); setStravaPreview(null); setFile(null); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 14, cursor: 'pointer' }}>Abbrechen</button>
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

// ─── MINI HR CHART ───
const MiniHR = ({ data, w = 80, h = 28 }) => {
  if (!data?.length) return null;
  const vals = data.filter((_, i) => i % 3 === 0).map(d => d.hr).filter(v => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals); const max = Math.max(...vals); const range = max - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke="#ef4444" strokeWidth="1.2" opacity="0.6" /></svg>;
};

// ─── MAIN APP ───
export default function App() {
  const [activities, setActivities] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [selected, setSelected] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [workoutEditor, setWorkoutEditor] = useState(null);
  const [plannedWorkouts, setPlannedWorkouts] = useState([]);
  const [workoutLoadError, setWorkoutLoadError] = useState('');
  const [legacyUpload, setLegacyUpload] = useState(false);
  const [incomingDrop, setIncomingDrop] = useState(null);
  const [toast, setToast] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [user] = useState({ name: 'Johannes Graf', sport: 'cycling' });

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

  // Today / Tomorrow activities
  useEffect(() => {
    let active = true;
    api('/api/workouts').then(saved => { if (active) setPlannedWorkouts(saved); })
      .catch(error => { if (active) setWorkoutLoadError('Geplante Workouts konnten nicht geladen werden. ' + error.message); });
    return () => { active = false; };
  }, []);

  const today = new Date();
  const todayStr = today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();
  const todayActs = activities.filter(a => new Date(a.date).toDateString() === todayStr);
  const tomorrowActs = activities.filter(a => new Date(a.date).toDateString() === tomorrowStr);
  const todayPlans = plannedWorkouts.filter(w => w.date === localDate(today));
  const tomorrowPlans = plannedWorkouts.filter(w => w.date === localDate(tomorrow));
  const otherPlans = plannedWorkouts.filter(w => w.date !== localDate(today) && w.date !== localDate(tomorrow)).sort((a, b) => b.date.localeCompare(a.date));

  // Weekly stats
  const thisWeekActs = useMemo(() => {
    const start = new Date(today);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return activities.filter(a => new Date(a.date) >= start && new Date(a.date) < end);
  }, [activities]);

  const weekStats = useMemo(() => ({
    count: thisWeekActs.length,
    duration: thisWeekActs.reduce((s, a) => s + (a.duration || 0), 0),
    distance: thisWeekActs.reduce((s, a) => s + (a.distance || 0), 0),
    calories: thisWeekActs.reduce((s, a) => s + (a.calories || 0), 0),
  }), [thisWeekActs]);

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

  // ─── RENDER ───
  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8' }}
      onDragOver={event => { if (Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault(); }}
      onDrop={event => {
        event.preventDefault();
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        const selection = collectDroppedFiles(event.dataTransfer).then(files => ({ files }), error => ({ error }));
        setIncomingDrop(selection);
        setLegacyUpload(false);
        setShowUpload(true);
      }}>
      {/* TOP NAV BAR — TrainingPeaks style */}
      <header className="app-header" style={{ background: '#1e293b', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: 'linear-gradient(135deg, #3b82f6, #1e40af)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>T</span>
            </div>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>TRAINHUB</span>
          </div>
          <nav style={{ display: 'flex', gap: 4 }}>
            {[['home', 'Startseite'], ['calendar', 'Kalender'], ['dashboard', 'Dashboard'], ['coach', 'AI Coach']].map(([id, label]) => (
              <button key={id} onClick={() => { setPage(id); setSelected(null); window.location.hash = ''; }} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: page === id && !selected ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: page === id && !selected ? '#fff' : '#94a3b8',
                fontSize: 13, fontWeight: page === id ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => setShowUpload(true)} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #3b82f6', background: 'transparent',
            color: '#60a5fa', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5
          }}>+ Upload</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>JG</div>
            <span style={{ color: '#cbd5e1', fontSize: 13 }}>{user.name}</span>
          </div>
        </div>
      </header>

      {/* User bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#475569' }}>JG</div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{user.name}</span>
        </div>
      </div>

      {loading && <p role="status" style={{ padding: 20 }}>Aktivitäten werden geladen…</p>}
      {loadError && <div role="alert" style={{ padding: 16, margin: 16, background: '#fef2f2', color: '#b91c1c' }}>{loadError} <button onClick={() => window.location.reload()}>Erneut versuchen</button></div>}
      {!loading && !loadError && !activities.length && <div style={{ padding: 24, textAlign: 'center' }}>Noch keine Aktivitäten. Über „+ Upload“ eine FIT-Datei importieren.</div>}
      {/* MAIN CONTENT */}
      <div style={{ maxWidth: page === 'calendar' ? 'none' : 1340, margin: '0 auto', padding: page === 'calendar' ? '0' : '0 16px', transition: 'max-width 0.2s' }}>
        {selected ? (
          <div style={{ padding: '20px 0' }}>
            <ActivityDetail key={selected.id} activity={selected} apiBase={API} onDelete={deleteActivity}
              onBack={() => { setSelected(null); window.location.hash = ''; }} />
          </div>
        ) : page === 'home' ? (
          /* ─── STARTSEITE (3-column TrainingPeaks layout) ─── */
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 20, padding: '20px 0', alignItems: 'start' }}>
            {/* LEFT COLUMN — Trainingspläne, Veranstaltungen, Ziele */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Trainingspläne */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>Trainingspläne</h3>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px', lineHeight: 1.5 }}>Übertriff dich selbst mit diesen Trainingsplänen.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['Schwelle verbessern', 'Grundlagenausdauer', '100km Fahrt', 'Intervalltraining', 'Krafttraining'].map(p => (
                    <span key={p} style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid #1e40af', color: '#1e40af', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>{p}</span>
                  ))}
                </div>
              </div>

              {/* Veranstaltungen */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Veranstaltungen</h3>
                  <span style={{ color: '#9ca3af', cursor: 'pointer' }}>+</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>🏆</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Wofür trainierst du?</div>
                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>Behalte bevorstehende Ereignisse im Blick.</div>
                  </div>
                </div>
                <button style={{ padding: '7px 16px', borderRadius: 20, border: '1px solid #1e40af', background: '#fff', color: '#1e40af', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Ereignis hinzufügen</button>
              </div>

              {/* Ziele */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Ziele</h3>
                  <span style={{ color: '#9ca3af', cursor: 'pointer' }}>+</span>
                </div>
                <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, margin: '0 0 8px' }}>Bleiben Sie auf Kurs, indem Sie Trainingsziele hinzufügen.</p>
                <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', lineHeight: 1.5 }}>
                  Beispiele:<br />
                  Arbeite an einem gleichmäßigen Tritt<br />
                  Dehne dich nach jeder Fahrt
                </div>
                <button style={{ marginTop: 10, padding: '7px 16px', borderRadius: 20, border: '1px solid #1e40af', background: '#fff', color: '#1e40af', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Ziel hinzufügen</button>
              </div>
            </div>

            {/* CENTER COLUMN — Heute / Morgen */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Heute */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e7eb' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Heute</h3>
                  <button aria-label="Workout für heute hinzufügen" onClick={() => setWorkoutEditor({ date: localDate(today) })} style={{ color: '#1e40af', cursor: 'pointer', fontSize: 22, border: 0, background: 'none' }}>+</button>
                </div>
                <PlannedWorkoutRows workouts={todayPlans} onOpen={setWorkoutEditor} />
                {todayActs.length > 0 ? todayActs.map(a => (
                  <div key={a.id} onClick={() => openActivity(a)} style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{sportEmoji[a.sport]}</span>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                      </div>
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>{fmt.time(a.date)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280' }}>
                      <span>⏱ {fmt.dur(a.duration)}</span>
                      <span>📏 {a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                      {a.hrAvg && <span>❤️ {a.hrAvg} bpm</span>}
                      {a.power && <span>⚡ {a.power} W</span>}
                    </div>
                  </div>
                )) : todayPlans.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                    <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 14 }}>Du hast heute keine geplanten Workouts.</p>
                    <button onClick={() => setWorkoutEditor({ date: localDate(today) })} style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none', background: '#1e40af', color: '#fff',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer'
                    }}>Workout hinzufügen</button>
                  </div>
                ) : null}
              </div>

              {/* Morgen */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e7eb' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Morgen</h3>
                  <button aria-label="Workout für morgen hinzufügen" onClick={() => setWorkoutEditor({ date: localDate(tomorrow) })} style={{ color: '#1e40af', cursor: 'pointer', fontSize: 22, border: 0, background: 'none' }}>+</button>
                </div>
                <PlannedWorkoutRows workouts={tomorrowPlans} onOpen={setWorkoutEditor} />
                {tomorrowActs.length > 0 ? tomorrowActs.map(a => (
                  <div key={a.id} onClick={() => openActivity(a)} style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span>{sportEmoji[a.sport]}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>⏱ {fmt.dur(a.duration)} · 📏 {a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</div>
                  </div>
                )) : tomorrowPlans.length === 0 ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                    <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 14 }}>Du hast morgen keine geplanten Workouts.</p>
                    <button onClick={() => setWorkoutEditor({ date: localDate(tomorrow) })} style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none', background: '#1e40af', color: '#fff',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer'
                    }}>Workout hinzufügen</button>
                  </div>
                ) : null}
              </div>

              {workoutLoadError && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{workoutLoadError} <button onClick={() => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); }).catch(error => setWorkoutLoadError(error.message))}>Erneut laden</button></p>}
              {otherPlans.length > 0 && <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <h3 style={{ padding: '14px 20px', fontSize: 15, margin: 0 }}>Weitere geplante Workouts</h3>
                <PlannedWorkoutRows workouts={otherPlans} onOpen={setWorkoutEditor} showDate />
              </div>}

              {/* Letzte Aktivitäten */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #e5e7eb' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Letzte Aktivitäten</h3>
                </div>
                {activities.slice(0, 6).map(a => (
                  <div key={a.id} onClick={() => openActivity(a)} style={{ padding: '12px 20px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{sportEmoji[a.sport]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmt.date(a.date)} · {fmt.time(a.date)}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmt.dur(a.duration)}</div>
                    </div>
                    <MiniHR data={a.timeSeries} />
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN — Wochenübersicht */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Wochenübersicht */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>Wochenübersicht</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  {[
                    { l: 'Aktivitäten', v: weekStats.count, c: '#3b82f6' },
                    { l: 'Dauer', v: fmt.dur(weekStats.duration), c: '#22c55e' },
                    { l: 'Distanz', v: `${weekStats.distance.toFixed(1)} km`, c: '#f59e0b' },
                    { l: 'Kalorien', v: `${weekStats.calories}`, c: '#ef4444' },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: s.c + '08', border: `1px solid ${s.c}18` }}>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: "'IBM Plex Mono'", textTransform: 'uppercase', marginBottom: 3 }}>{s.l}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Sport breakdown */}
                {(() => {
                  const byS = {};
                  thisWeekActs.forEach(a => { byS[a.sport] = (byS[a.sport] || 0) + a.duration; });
                  const entries = Object.entries(byS);
                  if (!entries.length) return null;
                  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
                  return (
                    <div>
                      <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: "'IBM Plex Mono'", textTransform: 'uppercase', marginBottom: 8 }}>Sportaufteilung</div>
                      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                        {entries.map(([s, d]) => <div key={s} style={{ width: `${(d / total) * 100}%`, background: sportColors[s], transition: 'width 0.3s' }} />)}
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {entries.map(([s, d]) => (
                          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: sportColors[s] }} />
                            {sportLabels[s]} · {fmt.dur(d)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Herzfrequenz-Zonen */}
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Herzfrequenz-Zonen</h3>
                {[
                  { z: 'Z1 Erholung', range: '< 120 bpm', pct: 15, c: '#93c5fd' },
                  { z: 'Z2 Grundlage', range: '120–140', pct: 35, c: '#22c55e' },
                  { z: 'Z3 Tempo', range: '140–160', pct: 25, c: '#eab308' },
                  { z: 'Z4 Schwelle', range: '160–175', pct: 18, c: '#f97316' },
                  { z: 'Z5 VO2max', range: '> 175', pct: 7, c: '#ef4444' },
                ].map(z => (
                  <div key={z.z} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ fontWeight: 500, color: '#374151' }}>{z.z}</span>
                      <span style={{ color: '#9ca3af', fontFamily: "'IBM Plex Mono'" }}>{z.range}</span>
                    </div>
                    <div style={{ height: 5, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${z.pct}%`, background: z.c, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
              <BestEfforts apiBase={API} activities={activities} viewedYear={calMonth.getFullYear()} onOpenActivity={openActivity} />
            </div>
          </div>

        ) : page === 'calendar' ? (
          /* ─── KALENDER (TrainingPeaks fullwidth) ─── */
          <div style={{ padding: 0 }}>
            {/* Calendar Header Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
                {calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
              </h2>
              <select
                value={`${calMonth.getFullYear()}-${calMonth.getMonth()}`}
                onChange={e => { const [y, m] = e.target.value.split('-'); setCalMonth(new Date(+y, +m, 1)); }}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, color: '#6b7280', background: '#fff', cursor: 'pointer' }}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const d = new Date(calMonth.getFullYear(), i, 1);
                  return <option key={i} value={`${d.getFullYear()}-${i}`}>{d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>;
                })}
              </select>
              <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
                <button onClick={() => {
                  const now = new Date();
                  setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                }} style={{ padding: '5px 14px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#374151' }}>Heute</button>
                <button aria-label="Vorheriger Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))} style={{ padding: '5px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 16, cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>‹</button>
                <button aria-label="Nächster Monat" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))} style={{ padding: '5px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 16, cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>›</button>
              </div>
            </div>

            {workoutLoadError && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, padding: '0 20px' }}>{workoutLoadError} <button onClick={() => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); }).catch(error => setWorkoutLoadError(error.message))}>Erneut laden</button></p>}

            {/* Day-of-week header + SUMMARY */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 240px', borderBottom: '2px solid #d1d5db', background: '#fff' }}>
              {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
                <div key={d} style={{ padding: '10px 8px', fontSize: 12, fontWeight: 600, color: '#6b7280', fontFamily: "'IBM Plex Mono'", letterSpacing: '0.05em', textAlign: 'center', borderRight: '1px solid #e5e7eb' }}>{d}</div>
              ))}
              <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#6b7280', fontFamily: "'IBM Plex Mono'", letterSpacing: '0.05em', textAlign: 'center' }}>SUMMARY</div>
            </div>

            {/* Weekly rows */}
            {calWeeks.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 240px', borderBottom: '1px solid #e5e7eb' }}>
                {/* 7 Day cells */}
                {week.cells.map((cell, ci) => {
                  if (!cell) return <div key={`e${wi}-${ci}`} style={{ background: '#f9fafb', borderRight: '1px solid #e5e7eb', minHeight: 160 }} />;
                  const isToday = cell.date.toDateString() === todayStr;
                  return (
                    <div key={`${wi}-${ci}`} className="calendar-day" data-date={localDate(cell.date)} role="group" aria-label={`Kalendertag ${fmt.dateFull(cell.date)}`} style={{
                      borderRight: '1px solid #e5e7eb', padding: '4px 6px',
                      background: isToday ? '#dbeafe' : '#fff',
                      display: 'flex', flexDirection: 'column', minHeight: 160,
                    }}>
                      <div className="calendar-day-header">
                      {/* Day number badge */}
                      {isToday ? (
                        <div style={{ background: '#1e40af', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'IBM Plex Mono'", padding: '3px 8px', borderRadius: 4, alignSelf: 'flex-start', marginBottom: 6 }}>
                          Heute {cell.day}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#4b5563', fontFamily: "'IBM Plex Mono'", padding: '2px 4px', marginBottom: 6 }}>
                          {cell.day === 1 ? `1 ${calMonth.toLocaleDateString('de-DE', { month: 'short' })}` : cell.day}
                        </div>
                      )}
                      <button type="button" className="calendar-add-workout"
                        aria-label={`Workout am ${cell.date.toLocaleDateString('de-DE')} planen`}
                        title="Workout planen"
                        onClick={() => setWorkoutEditor({ date: localDate(cell.date) })}>+</button>
                      </div>

                      {cell.plans.map(workout => <button type="button" className="calendar-planned-workout" key={workout.id}
                        style={{ '--calendar-sport-color': sportColors[workout.sport] || '#3b82f6' }}
                        aria-label={`${workout.name} am ${cell.date.toLocaleDateString('de-DE')} bearbeiten`}
                        onClick={() => setWorkoutEditor(workout)}>
                        <span className="calendar-plan-heading"><span aria-hidden="true">{sportEmoji[workout.sport]}</span><span className="calendar-plan-status">Geplant</span></span>
                        <strong>{workout.name}</strong><small>{workoutSummary(workout)}</small>
                      </button>)}

                      {/* Activity cards — larger, matching TP screenshot */}
                      {cell.activities.map(a => {
                        return (
                          <div key={a.id} onClick={() => openActivity(a)} style={{
                            background: '#fff',
                            border: `1px solid ${a.sport === 'ride' ? '#c7d2fe' : a.sport === 'run' ? '#bbf7d0' : '#a5f3fc'}`,
                            borderLeft: `4px solid ${sportColors[a.sport]}`,
                            borderRadius: 6, padding: '8px 10px', marginBottom: 4, cursor: 'pointer',
                            transition: 'box-shadow 0.15s, transform 0.1s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          }}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'none'; }}
                          >
                            {/* Sport icon + title row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                              <span style={{ fontSize: 14 }}>{sportEmoji[a.sport]}</span>
                              <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{a.title}</span>
                            </div>
                            {/* Metrics */}
                            <div style={{ color: '#374151', fontFamily: "'IBM Plex Mono'", fontSize: 11, lineHeight: 1.7 }}>
                              <div style={{ fontWeight: 600 }}>{fmt.durHM(a.duration)}</div>
                              <div>{a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</div>
                            </div>
                            {/* Bottom icons */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, color: '#9ca3af', fontSize: 10 }}>
                              {a.hrAvg && <span>❤️ {a.hrAvg}</span>}
                              {a.power && <span>⚡ {a.power}W</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* ── Weekly Summary sidebar cell ── */}
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderLeft: '2px solid #e5e7eb', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                  {week.summary.count > 0 ? (<>
                    {/* Sport breakdown with duration bar label */}
                    {Object.entries(week.summary.bySport).map(([sport, data]) => (
                      <div key={sport} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 12 }}>{sportEmoji[sport]}</span>
                            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{sportLabels[sport]}</span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', fontFamily: "'IBM Plex Mono'" }}>{data.distance.toFixed(1)} km</span>
                        </div>
                        {/* Duration progress bar per sport */}
                        {(() => {
                          const maxSportDur = Math.max(...calWeeks.flatMap(w => Object.values(w.summary.bySport).map(s => s.duration))) || 1;
                          return (
                            <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${(data.duration / maxSportDur) * 100}%`, background: sportColors[sport], borderRadius: 2 }} />
                            </div>
                          );
                        })()}
                      </div>
                    ))}

                    {/* KPIs */}
                    <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 4, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[
                        { l: 'Dauer', v: fmt.durHM(week.summary.duration), u: 'hms' },
                        { l: 'Distanz', v: week.summary.distance.toFixed(1), u: 'km' },
                        ...(week.summary.elevation > 0 ? [{ l: 'Höhenmeter', v: fmt.num(week.summary.elevation), u: 'm' }] : []),
                        { l: 'Kalorien', v: fmt.num(week.summary.calories), u: 'kcal' },
                      ].map((row, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ color: '#9ca3af', fontSize: 11 }}>{row.l}</span>
                          <span style={{ fontWeight: row.bold ? 700 : 600, fontSize: row.bold ? 13 : 12, color: row.bold ? '#1e40af' : '#1e293b', fontFamily: "'IBM Plex Mono'" }}>
                            {row.v} <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 400 }}>{row.u}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>) : (
                    <div style={{ paddingTop: 6 }}>
                      <div style={{ color: '#d1d5db', fontSize: 11, fontStyle: 'italic', marginBottom: 8 }}>Keine Aktivitäten</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {[{ l: 'Dauer', v: '00:00:00', u: 'hms' }, { l: 'Distanz', v: '0.00', u: 'km' }].map((row, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#d1d5db', fontSize: 11 }}>{row.l}</span>
                            <span style={{ color: '#d1d5db', fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>{row.v} {row.u}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

        ) : page === 'coach' ? (
          <AICoach apiBase={API} workouts={plannedWorkouts} onOpenWorkout={setWorkoutEditor}
            onWorkoutsChanged={() => api('/api/workouts').then(saved => { setPlannedWorkouts(saved); setWorkoutLoadError(''); })} />
        ) : page === 'dashboard' ? (
          /* ─── DASHBOARD ─── */
          <div style={{ padding: '20px 0' }}>
            <Dashboard apiBase={API} activities={activities} loading={loading} onOpenActivity={openActivity} />

            {/* Activity list */}
            <div className="activity-list" style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Alle Aktivitäten</h3>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{activities.length} Einträge</span>
              </div>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px 80px 80px', padding: '8px 20px', borderBottom: '1px solid #f3f4f6', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', fontFamily: "'IBM Plex Mono'", letterSpacing: '0.05em' }}>
                <span>Aktivität</span><span>Datum</span><span>Dauer</span><span>Distanz</span><span>Ø HF</span><span>Leistung</span><span>Quelle</span>
              </div>
              {activities.map(a => (
                <div key={a.id} onClick={() => openActivity(a)} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px 80px 80px', padding: '10px 20px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', alignItems: 'center', fontSize: 13, transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{sportEmoji[a.sport]}</span>
                    <span style={{ fontWeight: 600 }}>{a.title}</span>
                  </div>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>{fmt.date(a.date)}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{fmt.dur(a.duration)}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{a.distance == null ? '—' : a.distance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</span>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{a.hrAvg ?? '—'}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{a.power != null ? `${a.power} W` : '—'}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: "'IBM Plex Mono'" }}>{a.source}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

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
          position: 'fixed', bottom: 24, right: 24, background: '#22c55e', color: '#fff', padding: '12px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.3s ease', zIndex: 2000
        }}>✓ {toast}</div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}
