import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RemoteAccess, { claudeCodeCommand, desktopConfig } from './RemoteAccess';

const TOOLS = [{ name: 'get_training_overview', title: 'Trainingsüberblick', write: false },
  { name: 'create_planned_workout', title: 'Einheit planen', write: true }];
const mcp = { token: null, allowWrite: false, pairingExpiresAt: null, connections: [], tools: TOOLS };
const remote = {
  tailscale: { installed: true, running: true, state: 'Running', dnsName: 'pc.tail1234.ts.net', https: true },
  appPort: 5000, claudePort: 5001, claudePortRunning: true, funnelPort: 8443, appUrl: null, appServed: false,
  claudeUrl: null, claudeFunnel: false, appPublic: false,
  commands: { serve: 'tailscale serve --bg 5000', funnel: 'tailscale funnel --bg --https=8443 5001', serveOff: 'tailscale serve --https=443 off', funnelOff: 'tailscale funnel --https=8443 off' },
};
let host, root, originalFetch, current, network, onClose;
const response = (payload, ok = true) => ({ ok, json: async () => payload });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  current = { ...mcp }; network = { ...remote }; onClose = jest.fn();
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.includes('/api/remote-access')) return response(network);
    if (url.endsWith('/api/mcp/token') && options.method === 'POST') {
      current = { ...current, token: { createdAt: '2026-10-18T10:00:00Z', lastUsedAt: null, lastClient: null } };
      return response({ token: 'tp_secret', status: current });
    }
    if (url.endsWith('/api/mcp/token')) { current = { ...current, token: null }; return response(current); }
    if (url.endsWith('/api/mcp/settings')) { current = { ...current, allowWrite: JSON.parse(options.body).allowWrite }; return response(current); }
    if (url.endsWith('/api/mcp/pairing')) {
      current = { ...current, pairingExpiresAt: new Date(Date.now() + 600000).toISOString() };
      return response({ code: 'ABCD-EFGH', status: current });
    }
    if (url.includes('/api/mcp/connections/')) { current = { ...current, connections: [] }; return response(current); }
    return response(current);
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; });

const render = (apiBase = 'http://127.0.0.1:5000') => act(async () => root.render(<RemoteAccess apiBase={apiBase} onClose={onClose} />));
const button = text => Array.from(host.querySelectorAll('button')).find(b => b.textContent.trim() === text);
const click = text => act(async () => button(text).click());
const codes = () => Array.from(host.querySelectorAll('code')).map(code => code.textContent);

test('builds the Claude Code command and the Claude Desktop configuration', () => {
  expect(claudeCodeCommand('https://pc.tail1234.ts.net', 'tp_x'))
    .toBe('claude mcp add --transport http training-plenum https://pc.tail1234.ts.net/mcp --header "Authorization: Bearer tp_x"');
  const config = JSON.parse(desktopConfig('http://127.0.0.1:5000', 'tp_x'));
  expect(config.mcpServers['training-plenum']).toEqual({ command: 'npx', args: ['-y', 'mcp-remote', 'http://127.0.0.1:5000/mcp', '--header', 'Authorization:$' + '{AUTH}'],
    env: { AUTH: 'Bearer tp_x' } });
});

test('shows the Tailscale state and the command to publish the app in the tailnet', async () => {
  await render();
  expect(host.textContent).toContain('verbunden als pc.tail1234.ts.net');
  expect(codes()).toContain('tailscale serve --bg 5000');
  expect(codes()).toContain('tailscale funnel --bg --https=8443 5001');
  expect(codes()).toContain('https://pc.tail1234.ts.net:8443/mcp');
  expect(host.textContent).toContain('sobald Funnel läuft');
});

test('once published it shows the addresses instead of the commands', async () => {
  network = { ...remote, appServed: true, appUrl: 'https://pc.tail1234.ts.net', claudeFunnel: true, claudeUrl: 'https://pc.tail1234.ts.net:8443/mcp' };
  await render();
  expect(codes()).toContain('https://pc.tail1234.ts.net');
  expect(codes()).not.toContain('tailscale serve --bg 5000');
  expect(codes()).not.toContain('tailscale funnel --bg --https=8443 5001');
  expect(host.textContent).toContain('aktiv (Funnel)');
});

test('warns when the whole app is on the internet and when Tailscale is missing', async () => {
  network = { ...remote, appPublic: true, tailscale: { installed: false, running: false } };
  await render();
  expect(host.querySelector('[role="alert"]').textContent).toContain('tailscale funnel reset');
  expect(host.textContent).toContain('auf diesem Rechner nicht gefunden');
});

test('creates a token once and offers it for this machine or another tailnet device', async () => {
  network = { ...remote, appServed: true, appUrl: 'https://pc.tail1234.ts.net' };
  await render();
  await click('Token erzeugen');
  const [post] = global.fetch.mock.calls.filter(([url, options]) => url.endsWith('/api/mcp/token') && options?.method === 'POST');
  expect(post[1].headers).toEqual({ 'Content-Type': 'application/json' });
  expect(codes()).toContain(claudeCodeCommand('http://127.0.0.1:5000', 'tp_secret'));
  await click('Auf einem anderen Gerät im Tailnet');
  expect(codes()).toContain(claudeCodeCommand('https://pc.tail1234.ts.net', 'tp_secret'));
  expect(button('Neues Token')).toBeTruthy();
  await click('Token löschen');
  expect(host.textContent).not.toContain('tp_secret');
  expect(button('Token erzeugen')).toBeTruthy();
});

test('switches between reading and planning', async () => {
  await render();
  expect(host.textContent).toContain('Claude kann: Trainingsüberblick.');
  await click('Lesen und Einheiten planen');
  expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5000/api/mcp/settings', expect.objectContaining({ method: 'PUT', body: '{"allowWrite":true}' }));
  expect(host.textContent).toContain('Trainingsüberblick, Einheit planen');
});

test('creates an approval code and disconnects apps', async () => {
  current = { ...mcp, connections: [{ id: 'fam-1', client: 'Claude', approvedAt: '2026-10-18T10:00:00Z', lastUsedAt: null }] };
  await render();
  expect(host.textContent).toContain('Claude');
  await click('Freigabecode erzeugen');
  expect(host.querySelector('.remote-code strong').textContent).toBe('ABCD-EFGH');
  await click('Trennen');
  expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5000/api/mcp/connections/fam-1', expect.objectContaining({ method: 'DELETE' }));
  expect(host.querySelector('.remote-connections')).toBeNull();
});

test('uses the page address when opened through the tailnet and closes with Escape', async () => {
  await render('');
  expect(global.fetch).toHaveBeenCalledWith('/api/mcp', {});
  await act(async () => host.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(onClose).toHaveBeenCalled();
});
