import { localDate } from './workoutModel';

// Onboarding steps in order; part A is the athlete profile, part B creates the plan.
export const STEPS = [
  { id: 'sports', part: 'A', title: 'Deine Sportarten' },
  { id: 'sources', part: 'A', title: 'Verbinde deine Daten' },
  { id: 'thresholds', part: 'A', title: 'Deine Leistungsdaten' },
  { id: 'provider', part: 'A', title: 'Dein AI-Provider' },
  { id: 'background', part: 'B', title: 'Dein Hintergrund' },
  { id: 'goal', part: 'B', title: 'Dein Ziel' },
  { id: 'planSports', part: 'B', title: 'Sportarten im Plan' },
  { id: 'period', part: 'B', title: 'Zeitraum' },
  { id: 'availability', part: 'B', title: 'Verfügbarkeiten' },
  { id: 'ready', part: 'B', title: 'Bereit' },
];
export const DAYS = [['mon', 'Mo', 'Montag'], ['tue', 'Di', 'Dienstag'], ['wed', 'Mi', 'Mittwoch'], ['thu', 'Do', 'Donnerstag'],
  ['fri', 'Fr', 'Freitag'], ['sat', 'Sa', 'Samstag'], ['sun', 'So', 'Sonntag']];
// Stage 1 offers ride, run and strength; the other sports follow once their templates exist.
export const STAGE_SPORTS = [['ride', 'Radfahren'], ['run', 'Laufen'], ['strength', 'Kraft & Core']];
export const SPORT_NAMES = { ride: 'Rad', run: 'Laufen', strength: 'Kraft', swim: 'Schwimmen', xcski: 'XC Ski', hyrox: 'Hyrox', triathlon: 'Triathlon', duathlon: 'Duathlon', other: 'Sonstiges' };
export const METRICS = { ride: [['power', 'Leistung'], ['heart_rate', 'Herzfrequenz']], run: [['pace', 'Pace'], ['heart_rate', 'Herzfrequenz'], ['power', 'Leistung']] };
export const METRIC_NAMES = { power: 'Leistung', heart_rate: 'Herzfrequenz', pace: 'Pace', rpe: 'RPE' };
export const BACKGROUND_TYPES = [['triShort', 'Triathlon (Kurz)'], ['triLong', 'Triathlon (Mittel/Lang)'], ['duathlon', 'Duathlon'], ['run', 'Läufer'],
  ['ride', 'Radfahrer'], ['swim', 'Schwimmer'], ['hyrox', 'Hyrox'], ['xcski', 'XC Ski'], ['other', 'Etwas anderes']];
// Event sports of stage 1 with their subtypes (the backend knows more).
export const EVENT_SPORTS = [['ride', 'Rad'], ['run', 'Laufen'], ['other', 'Anderes']];
export const SUBTYPES = {
  ride: [['criterium', 'Kriterium'], ['cyclocross', 'Cyclocross'], ['timeTrial', 'Zeitfahren'], ['crossCountry', 'Cross Country'], ['roadRace', 'Straßenrennen'],
    ['granFondo', 'Gran Fondo'], ['xcMarathon', 'XC Marathon'], ['gravel', 'Gravel'], ['ultra', 'Ultra'], ['custom', 'Eigenes']],
  run: [['5k', '5 km'], ['10k', '10 km'], ['halfMarathon', 'Halbmarathon'], ['marathon', 'Marathon'], ['trail', 'Trail'], ['ultra', 'Ultra'], ['custom', 'Eigenes']],
  other: [['custom', 'Eigenes']],
};
export const PRIORITIES = {
  A: ['Hauptziel', 'Voller Taper (1–3 Wochen je nach Event), danach eine Erholungswoche.'],
  B: ['Wichtig', 'Kurzer Taper, danach ein paar lockere Tage.'],
  C: ['Training', 'Läuft im Training mit, ohne Taper.'],
};
export const HANDLING = {
  B: [['miniTaper', 'Mini-Taper', 'Vorher 3–4 Tage Mini-Taper, danach 2–4 Tage locker.'], ['trainThrough', 'Durchtrainieren', 'Ohne Taper, danach 2 Tage locker.']],
  C: [['replaceHard', 'Ersetzt die harte Einheit', 'Das Rennen ersetzt die harte Einheit der Woche, danach 1 Tag locker.'], ['easy', 'Lockere Teilnahme', 'Als lockere Teilnahme, danach normal weiter.']],
};
export const GOALS = [['vo2max', 'VO2max verbessern'], ['threshold', 'Schwelle erhöhen'], ['fitness', 'Allgemein fit']];
export const OPTIONS = { ride: [['indoor', 'Rolle'], ['outdoor', 'Draußen']], run: [['treadmill', 'Laufband'], ['outdoor', 'Draußen']] };
export const EQUIPMENT = [['studio', 'Studio'], ['dumbbells', 'Kurzhanteln'], ['kettlebell', 'Kettlebell'], ['bodyweight', 'Eigengewicht']];
export const INTENSITIES = [['easy', 'Locker'], ['moderate', 'Mittel'], ['hard', 'Hart']];
export const REPLAN_DEFAULT = 'afterReview';

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const weekday = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
// The Monday on or after the date.
export const mondayFrom = date => addDays(date, (7 - weekday(date)) % 7);
export const dateLabel = (date, year = false) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' } : {}) }) : '';

// The first step that is not done yet; a connected provider counts as done.
export function startStep(profile, provider) {
  const done = new Set(profile?.onboarding?.completed || []);
  if (provider?.configured) done.add('provider');
  return STEPS.find(step => !done.has(step.id))?.id || 'ready';
}

// --- Thresholds ---------------------------------------------------------------------------------

export function paceLabel(seconds) {
  if (seconds == null) return '';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
// "4:35" or "4.35" as seconds per km; null when it is no plausible pace.
export function parsePace(text) {
  const match = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(text || '');
  if (!match || Number(match[2]) > 59) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 900 ? seconds : null;
}
// FTP from the best 20-minute power of the last 90 days, else of the last year (95 %).
export function ftpFromData(snapshot) {
  const best = snapshot?.observed?.performanceHistory?.bestEfforts;
  const effort = best?.last90Days?.cycling?.['20min'] || best?.last365Days?.cycling?.['20min'];
  return effort?.watts ? { ftp: Math.round(effort.watts * 0.95), basis: `20-min-Bestwert vom ${dateLabel(effort.date)}` } : null;
}

// --- Events -------------------------------------------------------------------------------------

export function splitDuration(seconds) {
  if (seconds == null) return { days: '', hours: '', minutes: '' };
  return { days: Math.floor(seconds / 86400) || '', hours: Math.floor(seconds % 86400 / 3600) || '', minutes: Math.floor(seconds % 3600 / 60) || '' };
}
export function joinDuration({ days, hours, minutes }) {
  const total = (Number(days) || 0) * 86400 + (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
  return total > 0 ? total : null;
}
export function durationLabel(seconds) {
  if (seconds == null) return '';
  const { days, hours, minutes } = splitDuration(seconds);
  return [days && `${days} d`, hours && `${hours} h`, minutes && `${minutes} min`].filter(Boolean).join(' ');
}
export const subtypeLabel = (sport, subtype) => (SUBTYPES[sport] || []).find(([key]) => key === subtype)?.[1] || '';
export const eventDates = event => event.endDate && event.endDate !== event.startDate
  ? `${dateLabel(event.startDate)}–${dateLabel(event.endDate, true)}` : dateLabel(event.startDate, true);
export function eventSummary(event) {
  return [SPORT_NAMES[event.sport], subtypeLabel(event.sport, event.subtype), event.distanceKm != null && `${event.distanceKm.toLocaleString('de-DE')} km`,
    event.targetSeconds != null && durationLabel(event.targetSeconds), event.elevationM != null && `${event.elevationM.toLocaleString('de-DE')} hm`].filter(Boolean).join(' · ');
}

const DISTANCES = { '5k': 5, '10k': 10, halfMarathon: 21.1, marathon: 42.2 };
const TOP_SPEED = { ride: 55, run: 25 };
// Hints, never blocks: distance and time should roughly fit the subtype; ultra may be anything.
export function eventHints(event) {
  const hints = [];
  if (event.subtype === 'ultra' || event.subtype === 'custom') return hints;
  const expected = DISTANCES[event.subtype];
  if (expected && event.distanceKm != null && Math.abs(event.distanceKm - expected) > expected * 0.1) hints.push(`Ein ${subtypeLabel(event.sport, event.subtype)} ist etwa ${expected.toLocaleString('de-DE')} km lang.`);
  if (event.distanceKm && event.targetSeconds && TOP_SPEED[event.sport] && event.distanceKm / (event.targetSeconds / 3600) > TOP_SPEED[event.sport]) hints.push('Distanz und Zeit ergeben ein sehr hohes Tempo. Stimmt die Zeit?');
  return hints;
}
// Events the plan covers or that ended in the last 14 days.
export function splitEvents(events, today = localDate()) {
  const upcoming = events.filter(e => (e.endDate || e.startDate) >= today);
  const recent = events.filter(e => (e.endDate || e.startDate) < today && (e.endDate || e.startDate) >= addDays(today, -14));
  return { upcoming, recent };
}

// --- Plan period --------------------------------------------------------------------------------

const RECOVERY_DAYS = { A: 7, B: 3, C: 1 };
// Next Monday, or the Monday after the recovery from a recent event.
export function defaultStart(events = [], today = localDate()) {
  const after = events.filter(e => (e.endDate || e.startDate) < today)
    .map(e => addDays(e.endDate || e.startDate, RECOVERY_DAYS[e.priority] + 1));
  return mondayFrom([addDays(today, 1), ...after].sort().at(-1));
}
// The end of the last A event, else 12 weeks after the start.
export function defaultEnd(start, events = []) {
  const last = events.filter(e => e.priority === 'A' && (e.endDate || e.startDate) > start).map(e => e.endDate || e.startDate).sort().at(-1);
  return last || addDays(start, 12 * 7 - 1);
}
export const lastAEvent = (events = []) => events.filter(e => e.priority === 'A').sort((a, b) => (a.endDate || a.startDate).localeCompare(b.endDate || b.startDate)).at(-1);
export const weeksLabel = (start, end) => { const weeks = Math.round((daysBetween(start, end) + 1) / 7); return `${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}`; };

// --- Availability windows -----------------------------------------------------------------------

const minutesOf = clock => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
// Minutes per weekday: the union of available windows without the unavailable ones, as the backend counts them.
export function windowMinutes(windows = []) {
  return Object.fromEntries(DAYS.map(([day]) => {
    const free = new Set(), blocked = new Set();
    windows.filter(w => w.day === day).forEach(w => {
      const [from, to] = w.allDay ? [0, 1440] : [minutesOf(w.from), minutesOf(w.to)];
      for (let minute = from; minute < to; minute += 1) (w.kind === 'available' ? free : blocked).add(minute);
    });
    return [day, [...free].filter(minute => !blocked.has(minute)).length];
  }));
}
export const windowHours = windows => Object.values(windowMinutes(windows)).reduce((sum, minutes) => sum + minutes, 0) / 60;
export const hoursLabel = hours => `${(Math.round(hours * 10) / 10).toLocaleString('de-DE')} h`;
export function clockLabel(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
export function windowLabel(window) {
  if (window.kind === 'unavailable') return `${window.allDay ? 'Ganzer Tag' : `${window.from}–${window.to}`} · nicht verfügbar`;
  const sports = Object.entries(window.sports || {}).map(([sport, options]) => {
    const chosen = (OPTIONS[sport] || []).filter(([key]) => options?.[key]).map(([, label]) => label);
    return `${SPORT_NAMES[sport]}${chosen.length ? ` (${chosen.join(', ')})` : ''}`;
  });
  const group = window.group ? ` · Gruppentraining ${SPORT_NAMES[window.group.sport]}` : '';
  return `${window.allDay ? 'Ganzer Tag' : `${window.from}–${window.to}`}${sports.length ? ` · ${sports.join(', ')}` : ''}${group}`;
}
let windowCount = 0;
export const newId = prefix => `${prefix}-${Date.now().toString(36)}-${(windowCount += 1)}`;

// Recommended weekly hours for the A event, to warn when the windows are too few.
const EVENT_HOURS = { ride: { ultra: 10, granFondo: 6, xcMarathon: 6, gravel: 6, roadRace: 6 }, run: { marathon: 5, ultra: 7, trail: 5 } };
const EVENT_NAMES = { ultra: 'ein Ultra-Event', granFondo: 'einen Gran Fondo', xcMarathon: 'einen XC Marathon', gravel: 'ein Gravel-Rennen', roadRace: 'ein Straßenrennen', marathon: 'einen Marathon', trail: 'einen Traillauf' };
// The minimum weekly hours the coach recommends for the A event, or null when its kind has none.
export function recommendedHours(events) {
  const event = lastAEvent(events);
  const minimum = event && EVENT_HOURS[event.sport]?.[event.subtype];
  return minimum ? { hours: minimum, label: EVENT_NAMES[event.subtype], event: event.title } : null;
}
export function hoursHint(events, hours) {
  const recommended = recommendedHours(events);
  return recommended && hours < recommended.hours ? `Für ${recommended.label} empfehle ich mindestens ${recommended.hours} h/Woche, du hast ${hoursLabel(hours)} eingetragen.` : null;
}
export const dayNames = (days, index = 2) => DAYS.filter(([key]) => days.includes(key)).map(day => day[index]);

// --- Plan creation job --------------------------------------------------------------------------

export const CREATE_STEPS = [['frame', 'Phasen festlegen'], ['week1', 'Woche 1 planen'], ['week2', 'Woche 2 planen'], ['week3', 'Woche 3 planen']];
const DONE = ['done', 'completed', 'succeeded', 'success'];
const FAILED = ['failed', 'error'];
const stepStatus = value => DONE.includes(value) ? 'done' : FAILED.includes(value) ? 'failed' : value === 'running' ? 'running' : 'pending';
// The job of POST /api/coach/plan/create and its polling endpoint, read tolerantly.
export function jobState(data = {}) {
  const job = data.job || data;
  const status = DONE.includes(job.status) ? 'done' : FAILED.includes(job.status) ? 'failed' : 'running';
  const given = Array.isArray(job.steps) && job.steps.length ? job.steps : null;
  const steps = given ? given.map((step, index) => {
    const key = step.key || step.id || step.name || `step-${index}`;
    return { key, label: step.label || CREATE_STEPS.find(([id]) => id === key)?.[1] || key, status: stepStatus(step.status) };
  }) : CREATE_STEPS.map(([key, label], index) => ({ key, label, status: status === 'done' ? 'done' : index === 0 && status === 'running' ? 'running' : 'pending' }));
  const error = typeof job.error === 'string' ? job.error : job.error?.message || (status === 'failed' ? job.message : null);
  return { id: job.id || job.jobId || data.jobId || null, status, steps, error: error || null };
}
