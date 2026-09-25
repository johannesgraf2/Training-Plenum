import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import Dashboard, { BarChart } from './Dashboard';

const activities = [{ id: 'a', date: '2026-08-01T12:00:00Z' }, { id: 'b', date: '2022-01-01T12:00:00Z' }];
const bucket = (key, extra = {}) => ({ key, count: 1, seconds: 3600, distance: 40, elevation: 500, calories: 600, tss: 100, hrZones: [0, 1800, 1800, 0, 0], powerZones: [0, 0, 0, 3600, 0, 0, 0], known: { seconds: 1, distance: 1, elevation: 1, calories: 1, tss: 1, hr: 1, power: 1 }, ...extra });
const sample = () => ({ settings: { ftp: 320, maxHr: 191 }, years: [2026, 2022], totals: bucket('total'), sportShare: [bucket('ride')], cyclingYears: [bucket('2022'), bucket('2026')], weeks: [
  { ...bucket('2026-08-03'), label: 'KW 32', end: '2026-08-09', days: Array.from({ length: 7 }, (_, i) => bucket(`2026-08-${String(i + 3).padStart(2, '0')}`)) },
  { ...bucket('2026-08-10'), label: 'KW 33', end: '2026-08-16', days: Array.from({ length: 7 }, (_, i) => bucket(`2026-08-${i + 10}`)) },
], fitness: { value: 44, window: 42, thresholdHr: 172, activities: { power: 10, hr: 5, missing: 2 }, days: Array.from({ length: 730 }, (_, i) => ({ key: new Date(Date.UTC(2024, 7, 17) + i * 86400000).toISOString().slice(0, 10), value: i < 365 ? 10 : i === 365 ? 20 : i === 729 ? 44 : 30, load: i % 3 ? 0 : 60 })) } });
let host, root, originalFetch, data;
const response = payload => ({ ok: true, json: async () => payload });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  data = sample();
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options) => {
    if (url.includes('/api/user')) { data.settings = JSON.parse(options.body); return response(data.settings); }
    return response(url.includes('/best-efforts') ? { efforts: [] } : data);
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; });
const render = () => act(async () => root.render(<Dashboard apiBase="http://localhost:5000" activities={activities} loading={false} onOpenActivity={jest.fn()} />));
const click = text => act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === text).click());
const select = (label, value) => act(async () => Simulate.change(host.querySelector(`select[aria-label="${label}"]`), { target: { value } }));

test('shows every analysis and switches yearly distance and the daily TSS week', async () => {
  await render();
  expect(host.textContent).toContain('Dein Sportarten-Mix');
  expect(host.textContent).toContain('Bestwerte');
  expect(host.textContent).toContain('HFmax (191 bpm)');
  await click('Höhenmeter');
  expect(host.querySelector('svg[aria-label="Radfahren: Höhenmeter je Jahr"]')).not.toBeNull();
  await click('Tag');
  const daily = host.querySelector('svg[aria-label="TSS pro Tag"]');
  expect(daily.querySelectorAll('g[tabindex]')).toHaveLength(7);
  expect(daily.textContent).toContain('10.08.');
  await select('Woche für TSS-Tagesansicht', '2026-08-03');
  expect(host.querySelector('svg[aria-label="TSS pro Tag"]').textContent).toContain('03.08.');
});

test('all weekly charts show the full year with readable month labels and no eight-week limit', async () => {
  const firstMonday = Date.UTC(2025, 11, 29);
  data.weeks = Array.from({ length: 53 }, (_, i) => {
    const key = new Date(firstMonday + i * 7 * 86400000).toISOString().slice(0, 10);
    const end = new Date(firstMonday + (i * 7 + 6) * 86400000).toISOString().slice(0, 10);
    return { ...bucket(key), label: `KW ${i + 1}`, end, days: [], future: i > 38 };
  });
  await render();
  for (const label of ['Trainingszeit pro Woche', 'Verbrauchte Kalorien pro Woche', 'TSS pro Woche', 'Zeit in Herzfrequenz-Zonen pro Woche', 'Zeit in Leistungszonen pro Woche']) {
    const chart = host.querySelector(`svg[aria-label="${label}"]`);
    expect(chart.querySelectorAll('g[tabindex]')).toHaveLength(53);
    expect(Array.from(chart.querySelectorAll('.analysis-calendar-tick')).map(tick => tick.textContent)).toEqual(['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']);
    expect(chart.querySelectorAll('g[tabindex]')[52].getAttribute('aria-label')).toContain('noch ausstehend');
  }
  expect(host.textContent).not.toContain('Wochenfenster');
  expect(host.textContent).toContain('Januar–Dezember');
  expect(host.querySelector('select[aria-label="Letzte Woche im Diagramm"]')).toBeNull();
});

test('year and sport filters request new analyses and All-Time works for best efforts', async () => {
  await render();
  await select('Analysezeitraum', '2022');
  expect(global.fetch.mock.calls.some(([url]) => url.includes('/analytics?year=2022'))).toBe(true);
  await select('Analysezeitraum', 'all');
  await select('Sportart für Wochenanalysen', 'run');
  expect(global.fetch.mock.calls.some(([url]) => url.includes('/analytics?year=all&sport=run'))).toBe(true);
  expect(host.querySelector('select[aria-label="Zeitraum für Bestwerte"]').value).toBe('all');
  expect(host.querySelectorAll('select[aria-label="Zeitraum für Bestwerte"] option[value="all"]')).toHaveLength(1);
});

test('settings can be supplied later and saving refreshes the charts', async () => {
  data.settings = { ftp: null, maxHr: null };
  await render();
  expect(host.querySelector('svg[aria-label="TSS pro Woche"]')).toBeNull();
  await click('FTP & Zonen');
  const inputs = host.querySelectorAll('input');
  await act(async () => Simulate.change(inputs[0], { target: { value: '320' } }));
  await act(async () => Simulate.change(inputs[1], { target: { value: '191' } }));
  await act(async () => Simulate.submit(host.querySelector('form')));
  expect(global.fetch.mock.calls.find(([url]) => url.includes('/api/user'))[1].body).toBe('{"ftp":320,"maxHr":191}');
  expect(host.textContent).toContain('Analysewerte gespeichert.');
  expect(host.querySelector('svg[aria-label="TSS pro Woche"]')).not.toBeNull();
});

test('failures support retry and a stale request cannot replace the chosen year', async () => {
  global.fetch.mockRejectedValueOnce(new Error('Server nicht erreichbar.'));
  await render();
  expect(host.querySelector('[role="alert"]').textContent).toContain('Server nicht erreichbar.');
  await click('Erneut versuchen');
  let finish;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await select('Analysezeitraum', '2022');
  await select('Analysezeitraum', 'all');
  await act(async () => finish(response({ ...sample(), sportShare: [bucket('stale')] })));
  expect(host.querySelector('select[aria-label="Analysezeitraum"]').value).toBe('all');
  expect(host.textContent).not.toContain('stale');
});

test('a missing chart value stays a dash while a recorded zero remains zero', async () => {
  await act(async () => root.render(<BarChart rows={[{ key: '1', label: 'KW 1', value: null }, { key: '2', label: 'KW 2', value: 0 }]} series={[{ key: 'value', label: 'TSS', color: '#000' }]} unit="TSS" label="Test" />));
  expect(host.querySelectorAll('tbody td')[0].textContent).toBe('—');
  expect(host.querySelectorAll('tbody td')[1].textContent).toBe('0');
});

test('fitness shows today, the change for the chosen range and daily values', async () => {
  await render();
  const card = host.querySelector('section[aria-label="Fitness"]');
  expect(card.querySelector('.fitness-kpi').textContent).toContain('44');
  expect(card.textContent).toContain('▲ 120 %');
  expect(card.textContent).toContain('+24 Punkte im letzten Jahr');
  expect(card.textContent).toContain('15 Einheiten ausgewertet, 2 ohne ausreichende');
  await click('2 Jahre');
  expect(card.textContent).toContain('▲ 340 %');
  expect(card.textContent).toContain('+34 Punkte in den letzten 2 Jahren');
  const chart = card.querySelector('svg[aria-label="Fitness pro Tag"]');
  await act(async () => Simulate.keyDown(chart, { key: 'End' }));
  expect(card.querySelector('.analysis-chart-caption').textContent).toContain('Fitness 44');
  await act(async () => Simulate.keyDown(chart, { key: 'ArrowLeft' }));
  expect(card.querySelector('.analysis-chart-caption').textContent).toContain('Fitness 30');
});

test('fitness asks for heart rate or FTP before it can be calculated', async () => {
  data.settings = { ftp: null, maxHr: null };
  data.fitness = { value: null, days: [], activities: { power: 0, hr: 0, missing: 3 } };
  await render();
  expect(host.querySelector('section[aria-label="Fitness"]').textContent).toContain('HFmax oder FTP hinterlegen');
});
