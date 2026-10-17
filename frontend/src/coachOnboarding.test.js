import { defaultEnd, defaultStart, durationLabel, eventHints, ftpFromData, hoursHint, jobState, joinDuration, paceLabel, parsePace, splitDuration,
  splitEvents, startStep, windowHours, windowLabel, windowMinutes } from './coachOnboarding';

const window = (day, from, to, extra = {}) => ({ id: `${day}-${from}`, day, kind: 'available', allDay: false, from, to, sports: { ride: { indoor: true, outdoor: false } }, group: null, ...extra });

test('the wizard resumes at the first open step; a connected provider counts as done', () => {
  expect(startStep({ onboarding: { completed: [] } }, { configured: false })).toBe('sports');
  expect(startStep({ onboarding: { completed: ['sports', 'sources', 'thresholds'] } }, { configured: true })).toBe('background');
  expect(startStep({ onboarding: { completed: ['sports', 'sources', 'thresholds'] } }, { configured: false })).toBe('provider');
  expect(startStep({}, null)).toBe('sports');
});

test('windows count like the backend: overlaps once, unavailable time is cut out', () => {
  const windows = [window('tue', '18:00', '19:30'), window('tue', '19:00', '20:00'), window('sat', null, null, { allDay: true, from: null, to: null }),
    { ...window('sat', '12:00', '14:00'), kind: 'unavailable', sports: {} }, window('sun', '08:00', '12:00')];
  expect(windowMinutes(windows)).toEqual({ mon: 0, tue: 120, wed: 0, thu: 0, fri: 0, sat: 1320, sun: 240 });
  expect(windowHours(windows)).toBe(28);
  expect(windowLabel(windows[0])).toBe('18:00–19:30 · Rad (Rolle)');
  expect(windowLabel(windows[3])).toBe('12:00–14:00 · nicht verfügbar');
  expect(windowLabel(window('wed', '18:00', '20:00', { group: { sport: 'ride', intensity: 'moderate', note: '' } }))).toBe('18:00–20:00 · Rad (Rolle) · Gruppentraining Rad');
});

test('paces and multi-day times read and print the way athletes write them', () => {
  expect(parsePace('4:35')).toBe(275);
  expect(parsePace('4.05')).toBe(245);
  expect([parsePace('4:75'), parsePace('1:30'), parsePace('fast'), parsePace('')]).toEqual([null, null, null, null]);
  expect(paceLabel(275)).toBe('4:35');
  const tenDays = joinDuration({ days: 10, hours: 12, minutes: '' });
  expect(tenDays).toBe(10 * 86400 + 12 * 3600);
  expect(splitDuration(tenDays)).toEqual({ days: 10, hours: 12, minutes: '' });
  expect(durationLabel(tenDays)).toBe('10 d 12 h');
  expect(joinDuration({ days: '', hours: '', minutes: '' })).toBeNull();
});

test('the plan starts next Monday or after the recovery and ends with the last A event', () => {
  expect(defaultStart([], '2026-10-16')).toBe('2026-10-19');
  expect(defaultStart([], '2026-10-19')).toBe('2026-10-26');
  const raced = [{ startDate: '2026-10-11', endDate: '2026-10-11', priority: 'A' }];
  expect(defaultStart(raced, '2026-10-16')).toBe('2026-10-19');  // seven days recovery end on 18.10.
  expect(defaultStart([{ ...raced[0], startDate: '2026-10-14', endDate: '2026-10-14' }], '2026-10-16')).toBe('2026-10-26');
  const events = [{ startDate: '2027-05-16', endDate: '2027-05-16', priority: 'B' }, { startDate: '2027-07-29', endDate: '2027-08-12', priority: 'A' }];
  expect(defaultEnd('2026-10-19', events)).toBe('2027-08-12');
  expect(defaultEnd('2026-10-19', [])).toBe('2027-01-10');  // 12 weeks
  const { upcoming, recent } = splitEvents([...events, { startDate: '2026-10-04', endDate: '2026-10-04' }, { startDate: '2026-09-01' }], '2026-10-16');
  expect([upcoming.length, recent.length]).toEqual([2, 1]);
});

test('event hints warn but never block, and ultra may be anything', () => {
  expect(eventHints({ sport: 'run', subtype: 'marathon', distanceKm: 30 })).toEqual(['Ein Marathon ist etwa 42,2 km lang.']);
  expect(eventHints({ sport: 'ride', subtype: 'granFondo', distanceKm: 200, targetSeconds: 3600 })).toHaveLength(1);
  expect(eventHints({ sport: 'ride', subtype: 'ultra', distanceKm: 4000, targetSeconds: 3600 })).toEqual([]);
  expect(hoursHint([{ priority: 'A', sport: 'ride', subtype: 'ultra', startDate: '2027-07-29' }], 6)).toBe('Für ein Ultra-Event empfehle ich mindestens 10 h/Woche. Du hast 6 h Zeit pro Woche eingetragen.');
  expect(hoursHint([{ priority: 'A', sport: 'ride', subtype: 'ultra', startDate: '2027-07-29' }], 12)).toBe('Für ein Ultra-Event empfehle ich mindestens 10 h/Woche.');
});

test('the FTP suggestion comes from the best 20 minutes', () => {
  const snapshot = { observed: { performanceHistory: { bestEfforts: { last90Days: { cycling: { '20min': { watts: 300, date: '2026-09-12' } } }, last365Days: { cycling: {} } } } } };
  expect(ftpFromData(snapshot)).toEqual({ ftp: 285, basis: '20-min-Bestwert vom 12.09.' });
  expect(ftpFromData({})).toBeNull();
});

test('the creation job is read tolerantly', () => {
  expect(jobState({ job: { id: 'j', status: 'running', steps: [{ key: 'frame', status: 'completed' }, { key: 'week1', status: 'running' }] } }))
    .toEqual({ id: 'j', status: 'running', error: null, steps: [{ key: 'frame', label: 'Phasen festlegen', status: 'done' }, { key: 'week1', label: 'Woche 1 planen', status: 'running' }] });
  const failed = jobState({ jobId: 'k', status: 'error', error: { message: 'Provider antwortet nicht.' } });
  expect([failed.id, failed.status, failed.error, failed.steps.length]).toEqual(['k', 'failed', 'Provider antwortet nicht.', 4]);
  expect(jobState({ status: 'done' }).steps.every(step => step.status === 'done')).toBe(true);
});
