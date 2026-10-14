import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import DataHub, { garminSummary, timeAgo } from './DataHub';

const NOW = new Date('2026-10-14T18:00:00Z');
const connected = { available: true, connected: true, needsLogin: false, syncing: false, lastSyncAt: '2026-10-14T16:00:00Z',
  lastResult: { imported: 2, duplicate: 1 }, lastError: null, pushWorkouts: true, imported: 12, workouts: { scheduled: 3, sent: 3 } };
const activities = [
  { id: 'old', title: 'Alte Runde', date: '2026-01-02T08:00:00Z', origin: 'file', importedAt: '2026-01-03T10:00:00Z' },
  { id: 'synced', title: 'Radfahren · 14.10.2026', date: '2026-10-14T07:00:00Z', origin: 'garmin', importedAt: '2026-10-14T16:00:00Z' },
  { id: 'legacy', title: 'Ohne Zeitstempel', date: '2026-10-01T07:00:00Z' },
];
const workouts = [{ id: 'w1', date: '2026-10-15' }, { id: 'w2', date: '2026-10-16' }, { id: 'w0', date: '2026-10-01' }];

let host, root, originalFetch, garmin, onClose, onOpen, onImported;
const json = (payload, ok = true, status = 200) => ({ ok, status, json: async () => payload });
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  jest.setSystemTime(NOW);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  garmin = connected; onClose = jest.fn(); onOpen = jest.fn(); onImported = jest.fn();
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith('/api/garmin/sync')) { garmin = { ...connected, syncing: true }; return json(garmin); }
    if (url.endsWith('/api/garmin')) return json(garmin);
    if (url.endsWith('/api/activities/manual')) return json({ id: 'manual-1', ...JSON.parse(options.body) }, true, 201);
    return json({}, false, 404);
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; jest.useRealTimers();
});

const render = (props = {}) => act(async () => root.render(<DataHub apiBase="" activities={activities} workouts={workouts}
  onClose={onClose} onOpen={onOpen} onImported={onImported} {...props} />));
const button = text => Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes(text));
const click = text => act(async () => button(text).click());
const title = () => host.querySelector('#hub-title').textContent;

test('the overview shows every source, the Garmin state and both ways to the device', async () => {
  await render();
  expect(title()).toBe('Daten & Geräte');
  const sources = Array.from(host.querySelectorAll('.hub-source strong')).map(node => node.textContent);
  expect(sources).toEqual(['Garmin Connect', 'Garmin per USB', 'Dateien & Exporte', 'Manuell eintragen', 'Über Garmin Connect (automatisch)', 'Per USB als FIT-Datei']);
  expect(host.textContent).toContain('Zuletzt vor 2 h: 2 neu, 1 schon vorhanden');
  expect(host.textContent).toContain('An: 3 Einheiten im Garmin-Kalender');
  expect(host.textContent).toContain('2 kommende Workouts herunterladen');
});

test('syncs Garmin Connect straight from the overview', async () => {
  await render();
  await click('Jetzt abgleichen');
  expect(global.fetch).toHaveBeenCalledWith('/api/garmin/sync', expect.objectContaining({ method: 'POST' }));
  expect(button('Läuft…').disabled).toBe(true);
});

test('without a connection the overview offers to connect and opens the Garmin view', async () => {
  garmin = { available: true, connected: false };
  await render();
  expect(host.textContent).toContain('Erst Garmin Connect verbinden.');
  await click('Verbinden');
  expect(title()).toBe('Garmin Connect');
  expect(host.querySelector('input[type="email"]')).not.toBeNull();
  await click('Daten & Geräte');
  expect(title()).toBe('Daten & Geräte');
});

test('lists the latest imports of every source and opens them', async () => {
  await render();
  const recent = Array.from(host.querySelectorAll('.hub-recent li')).map(li => li.textContent);
  expect(recent).toHaveLength(2);
  expect(recent[0]).toContain('Radfahren · 14.10.2026');
  expect(recent[0]).toContain('Garmin Connect · importiert vor 2 h');
  expect(recent[1]).toContain('Datei / USB');
  await click('Alte Runde');
  expect(onOpen).toHaveBeenCalledWith('old');
});

test('a manual entry is saved with date and time and then opened', async () => {
  await render({ initialView: 'manual' });
  expect(title()).toBe('Manuell eintragen');
  await act(async () => button('Laufen').click());
  const field = label => Array.from(host.querySelectorAll('label')).find(l => l.textContent.startsWith(label)).querySelector('input, textarea');
  await act(async () => Simulate.change(field('Datum'), { target: { value: '2026-10-12' } }));
  await act(async () => Simulate.change(field('Startzeit'), { target: { value: '07:30' } }));
  await act(async () => Simulate.change(field('Dauer'), { target: { value: '45' } }));
  await act(async () => Simulate.change(field('Distanz'), { target: { value: '9.5' } }));
  await act(async () => Simulate.submit(host.querySelector('form')));
  const [, options] = global.fetch.mock.calls.find(([url]) => url.endsWith('/api/activities/manual'));
  expect(JSON.parse(options.body)).toEqual({ sport: 'run', date: '2026-10-12T07:30', title: 'Laufen', duration: 45, distance: 9.5, hrAvg: null, notes: '' });
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 'manual-1' }));
  expect(onOpen).toHaveBeenCalledWith('manual-1');
});

test('closing reports whether new activities arrived', async () => {
  await render();
  await act(async () => Simulate.keyDown(host.querySelector('[role="dialog"]'), { key: 'Escape' }));
  expect(onClose).toHaveBeenCalledWith(false);
});

test('summarizes times and the Garmin state in words', () => {
  expect(timeAgo('2026-10-14T17:59:40Z', NOW.getTime())).toBe('gerade eben');
  expect(timeAgo('2026-10-14T17:15:00Z', NOW.getTime())).toBe('vor 45 min');
  expect(timeAgo('2026-10-10T08:00:00Z', NOW.getTime())).toBe('am 10.10.');
  expect(garminSummary({ ...connected, needsLogin: true })).toEqual({ text: 'Anmeldung abgelaufen. Bitte neu anmelden.', tone: 'bad' });
  expect(garminSummary({ ...connected, syncing: true, progress: { done: 3, total: 9 } }).text).toBe('Abgleich läuft: 3 von 9');
  expect(garminSummary({ available: false }).text).toBe('Auf diesem Server nicht verfügbar');
  expect(garminSummary({ ...connected, history: { running: true, through: '2025-06-01' } }).text).toBe('Ältere Aktivitäten werden nachgeladen, geprüft bis Juni 2025');
});
