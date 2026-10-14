import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import WhoopSync, { bridgeUrl } from './WhoopSync';

const disconnected = { connected: false, reprocessing: false, rawRetentionDays: 30 };
const connected = {
  connected: true, syncRequested: false, reprocessing: false, hours: 12, dataThrough: '2026-10-14T05:10:00Z', lastError: null,
  stats: { records: 43200, undecoded: 3, lastHrAt: 1760418600, lastRrAt: 1760418600 },
  bridge: { online: true, lastSeen: '2026-10-14T05:12:00Z', strapConnected: true, strapName: 'WHOOP 4C0123', battery: { percent: 87.3, charging: false },
    realtimeHr: { bpm: 58 }, outboxFrames: 0, lastSyncAt: '2026-10-14T05:11:00Z', firmware: { harvard: '41.17.6.0' } },
};
let host, root, originalFetch, current, onClose;
const response = (payload, ok = true) => ({ ok, json: async () => payload });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  current = disconnected; onClose = jest.fn();
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith('/api/whoop/token')) { current = connected; return response({ token: 'tok-123', status: { ...disconnected } }); }
    if (url.endsWith('/api/whoop/sync')) return response({ ...current, syncRequested: true });
    if (options.method === 'DELETE') { current = disconnected; return response(disconnected); }
    return response(current);
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; });

const render = () => act(async () => root.render(<WhoopSync apiBase="http://localhost:5000" onClose={onClose} />));
const button = text => Array.from(host.querySelectorAll('button')).find(b => b.textContent.trim() === text);
const click = text => act(async () => button(text).click());

test('walks through unpairing and shows the setup commands with the token once', async () => {
  await render();
  expect(host.textContent).toContain('Strap von der WHOOP-App trennen');
  await click('Token erzeugen');
  const [post] = global.fetch.mock.calls.filter(([url]) => url.endsWith('/token'));
  expect(post[1]).toEqual(expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }));
  const commands = Array.from(host.querySelectorAll('code')).map(code => code.textContent);
  expect(commands[0]).toBe('bash whoop-bridge/install-mac.sh');
  expect(commands[1]).toBe('~/.trainingplenum-whoop/venv/bin/python ~/.trainingplenum-whoop/app/bridge.py setup http://localhost:5000 tok-123');
});

test('shows bridge, strap and data status and requests a sync', async () => {
  current = connected;
  await render();
  expect(host.textContent).toContain('online');
  expect(host.textContent).toContain('verbunden (WHOOP 4C0123)');
  expect(host.textContent).toContain('87 %');
  expect(host.textContent).toContain('3 nicht dekodiert');
  expect(host.textContent).toContain('58 bpm');
  expect(host.textContent).toMatch(/Herzfrequenz✓ zuletzt/);
  expect(host.textContent).toContain('Uhr des Straps–');
  expect(host.querySelector('code')).toBeNull();
  await click('Jetzt synchronisieren');
  expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/whoop/sync', expect.objectContaining({ method: 'POST' }));
  expect(button('Sync angefordert').disabled).toBe(true);
});

test('warns when the bridge has been offline for over a day', async () => {
  current = { ...connected, bridge: { ...connected.bridge, online: false, offlineHours: 30 } };
  await render();
  expect(host.querySelector('[role="alert"]').textContent).toContain('seit über 24 Stunden offline');
});

test('disconnects and optionally deletes the stored data', async () => {
  current = connected;
  await render();
  await click('Trennen…');
  await act(async () => Simulate.change(host.querySelector('.whoop-confirm input'), { target: { checked: true } }));
  await click('Trennen');
  expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/whoop?deleteData=1', { method: 'DELETE' });
  expect(host.textContent).toContain('Token erzeugen');
});

test('closes on Escape and builds the bridge URL from the API base', async () => {
  await render();
  await act(async () => Simulate.keyDown(host.querySelector('[role="dialog"]'), { key: 'Escape' }));
  expect(onClose).toHaveBeenCalled();
  expect(bridgeUrl('http://localhost:5000')).toBe('http://localhost:5000');
  expect(bridgeUrl('')).toBe(window.location.origin);
});
