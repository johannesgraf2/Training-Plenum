import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { BlockEditor, GenerationControl, WeeklyHoursChart } from './CoachPeriodization';

const overview = { revision: 7, settings: { startDate: '2026-10-19', endDate: '2027-01-10', replanMode: 'manual', taperWeeks: 1 }, events: [],
  phases: [{ id: 'base', blockType: 'grundlage', purpose: 'Basis', startDate: '2026-10-19', weeks: 8 },
    { id: 'vo2', blockType: 'vo2max', purpose: 'Motor', startDate: '2026-12-14', weeks: 4 }],
  weeks: [{ week: '2026-W43', startDate: '2026-10-19', number: 1, targetHours: 4, phase: 'base', phaseName: 'Grundlage' },
    { week: '2026-W44', startDate: '2026-10-26', number: 2, targetHours: 3, deload: true, phase: 'recovery', phaseName: 'Grundlage' }] };
let root, container, requests;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
const input = label => [...container.querySelectorAll('label')].find(l => l.firstElementChild.textContent === label).querySelector('input, select');
const render = async node => { await act(async () => root.render(node)); };
const click = async element => { await act(async () => element.click()); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = [];
  global.fetch = jest.fn(async (url, options) => {
    requests.push({ path: url.split('?')[0], method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ job: { id: 'create-5', kind: 'create', status: 'running' } }) };
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('moving and resizing blocks sends explicit deterministic dates without an AI call', async () => {
  const saved = jest.fn(), close = jest.fn();
  await render(<BlockEditor overview={overview} apiBase="" onSaved={saved} onClose={close} />);
  expect(input('Dauer Block 1 (Wochen)').hasAttribute('max')).toBe(false);
  await click(button('Block 2 nach vorne'));
  expect(input('Start Block 1').value).toBe('2026-10-19');
  expect(input('Start Block 2').value).toBe('2026-11-16');
  await change(input('Dauer Block 1 (Wochen)'), '5');
  await change(input('Dauer Block 2 (Wochen)'), '7');
  await click(button('Blockplanung speichern'));
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ path: '/api/coach/plan/phases', method: 'PUT', body: { revision: 7, taperWeeks: 1 } });
  expect(requests[0].body.phases.map(p => [p.id, p.weeks, p.startDate])).toEqual([['vo2', 5, '2026-10-19'], ['base', 7, '2026-11-23']]);
  expect(saved).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});

test('a block conflict stays open with the server explanation', async () => {
  const close = jest.fn();
  global.fetch.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Blockkonflikt: Eventdatum bleibt fest.' }) }));
  await render(<BlockEditor overview={overview} apiBase="" onSaved={jest.fn()} onClose={close} />);
  await click(button('+ Eigenen Block hinzufügen'));
  expect(container.textContent).toContain('13 von 12 Wochen');
  await click(button('Blockplanung speichern'));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Eventdatum bleibt fest');
  expect(close).not.toHaveBeenCalled();
});

test('generation persists five weeks and starts the creation job', async () => {
  const onJob = jest.fn();
  await render(<GenerationControl overview={overview} apiBase="" onSaved={jest.fn()} onJob={onJob} />);
  expect(input('Anzahl auszuarbeitender Wochen').value).toBe('3');
  await change(input('Anzahl auszuarbeitender Wochen'), '5');
  await click(button('Wochen ausarbeiten'));
  expect(requests.map(r => r.path)).toEqual(['/api/coach/plan/settings', '/api/coach/plan/create']);
  expect(requests[0].body.generationWeeks).toBe(5);
  expect(onJob).toHaveBeenCalledWith({ id: 'create-5', kind: 'create', status: 'running' });
});

test('the hours chart exposes the same targets for every outlined and worked-out week', async () => {
  await render(<WeeklyHoursChart weeks={overview.weeks} />);
  const bars = container.querySelectorAll('rect');
  expect([...bars].map(b => b.getAttribute('aria-label'))).toEqual(['Woche 1: 4 Stunden, Belastung', 'Woche 2: 3 Stunden, Entlastung']);
  await act(async () => Simulate.click(bars[1]));
  expect(container.querySelector('[aria-live="polite"]').textContent).toContain('3 h');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
});
