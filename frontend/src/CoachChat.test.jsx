import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import CoachChat, { weekChanges } from './CoachChat';

const session = (minutes, id = 's1') => ({ id, day: 'tue', template: 'bike_z2', params: { durationMin: minutes }, rendered: { name: 'Grundlage', date: '2026-10-20', durationMin: minutes } });
const change = status => ({ proposalId: 'p1', status, summary: 'Dienstag kürzer', hinweise: ['Locker bleiben.'], settings: [],
  weeks: [{ week: '2026-W43', before: { calculatedHours: 1.5, sessions: [session(90)] }, after: { calculatedHours: 0.75, sessions: [session(45)] }, lines: ['Di Grundlage 90 min → 45 min'] }] });
const ref = { kind: 'session', week: '2026-W43', sessionId: 's1', label: 'Di., 20.10. · Grundlage' };
let container, root, requests, history, changed;
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
const click = async element => { await act(async () => element.click()); };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = []; changed = jest.fn(); history = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://coach.test').pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method, body });
    let data;
    if (path === '/api/coach/chat' && method === 'POST') {
      if (body.message === 'kaputt') return { ok: false, status: 502, json: async () => ({ error: 'Der AI-Provider ist derzeit nicht erreichbar.' }) };
      history = [...history, { id: history.length + 1, role: 'athlete', text: body.message, ref: body.ref, change: null },
        { id: history.length + 2, role: 'coach', text: 'Ich kürze auf 45 Minuten.', ref: null, change: change('pending') }];
      data = { messages: history };
    } else if (path === '/api/coach/chat' && method === 'DELETE') { history = []; data = { messages: [] }; }
    else if (path === '/api/coach/chat') data = { messages: history };
    else if (path === '/api/coach/proposals/p1/confirm') { history = history.map(m => m.change ? { ...m, change: change('confirmed') } : m); data = { revision: 2, weeks: {} }; }
    else if (path === '/api/coach/proposals/p1/discard') { history = history.map(m => m.change ? { ...m, change: change('discarded') } : m); data = { status: 'discarded' }; }
    else throw new Error(`Unexpected ${method} ${path}`);
    return { ok: true, json: async () => data };
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

const render = async props => { await act(async () => root.render(<CoachChat apiBase="" providerReady onClose={jest.fn()} onProviderSettings={jest.fn()} onChanged={changed} {...props} />)); };
const type = async text => {
  const input = container.querySelector('textarea');
  await act(async () => Simulate.change(input, { target: { value: text } }));
};

test('a message goes out with its reference and the change card applies only on Übernehmen', async () => {
  await render({ start: { ref, message: null, key: 1 } });
  expect(container.textContent).toContain('Über: Di., 20.10. · Grundlage');
  expect(button('Warum diese Einheit?')).toBeDefined();
  await click(button('Keine Zeit'));
  expect(container.querySelector('textarea').value).toBe('Ich habe weniger Zeit als geplant: ');
  await type('Dienstag nur 45 Minuten.');
  await act(async () => Simulate.submit(container.querySelector('form')));
  const sent = requests.find(r => r.method === 'POST' && r.path === '/api/coach/chat');
  expect(sent.body).toEqual({ message: 'Dienstag nur 45 Minuten.', ref });
  expect(container.textContent).toContain('Ich kürze auf 45 Minuten.');
  expect(container.textContent).toContain('KW 43 · 1,5 h → 0,8 h');
  expect(container.textContent).toContain('Di Grundlage 90 min → 45 min');
  expect(container.querySelector('.chat-ref')).toBeNull();  // The reference belonged to that message.
  expect(changed).not.toHaveBeenCalled();
  await click(button('Übernehmen'));
  expect(requests.find(r => r.path === '/api/coach/proposals/p1/confirm').body).toEqual({ confirm: true });
  expect(changed).toHaveBeenCalledWith({ revision: 2, weeks: {} });
  expect(container.textContent).toContain('✓ übernommen');
  expect(button('Übernehmen')).toBeUndefined();
});

test('a prepared message is sent right away, a removed chip sends no reference and a new chat empties the view', async () => {
  await render({ start: { ref, message: 'Meine Tagesampel ist heute gelb. Bitte mach die heutige Einheit kürzer.', key: 7 } });
  expect(requests.find(r => r.method === 'POST').body.message).toContain('kürzer');
  await click(button('Verwerfen'));
  expect(container.textContent).toContain('verworfen');
  await type('Und Samstag?');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(requests.filter(r => r.method === 'POST' && r.path === '/api/coach/chat')[1].body.ref).toBeNull();
  await click(button('Neuer Chat'));
  expect(requests.at(-1).method).toBe('DELETE');
  expect(container.querySelectorAll('.chat-message')).toHaveLength(0);
});

test('a failed message stays in the input and without a provider the input is locked', async () => {
  await render({});
  await type('kaputt');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(container.querySelector('[role="alert"]').textContent).toContain('nicht erreichbar');
  expect(container.querySelector('textarea').value).toBe('kaputt');
  expect(container.querySelectorAll('.chat-message')).toHaveLength(0);
  const settings = jest.fn();
  await render({ providerReady: false, onProviderSettings: settings });
  expect(container.querySelector('textarea').disabled).toBe(true);
  await click(button('Zu den Provider-Einstellungen'));
  expect(settings).toHaveBeenCalled();
});

test('week changes are listed for replanning proposals without server lines', () => {
  const before = { sessions: [session(90), { ...session(60, 's2'), day: 'thu', rendered: { name: 'Sweetspot', durationMin: 60 } }] };
  const after = { sessions: [{ ...session(90), day: 'sat' }, { ...session(30, 's3'), rendered: { name: 'Regeneration', durationMin: 30 } }] };
  expect(weekChanges(before, after)).toEqual(['Grundlage: Di → Sa', 'Di + Regeneration (30 min)', 'Do Sweetspot entfällt']);
});
