import { resolveApiBase } from './apiBase';

const at = href => new URL(href);

test('keeps the configured backend on this machine', () => {
  expect(resolveApiBase('http://127.0.0.1:5000', at('http://127.0.0.1:5000/'))).toBe('http://127.0.0.1:5000');
  expect(resolveApiBase('http://localhost:5000', at('http://localhost:3000/#activity/1'))).toBe('http://localhost:5000');
});

test('uses the page address when opened from another device through Tailscale', () => {
  expect(resolveApiBase('http://127.0.0.1:5000', at('https://pc.tail1234.ts.net/'))).toBe('');
  expect(resolveApiBase('http://localhost:5000', at('https://nas.tail1234.ts.net:8443/'))).toBe('');
});

test('a backend on another host stays as configured', () => {
  expect(resolveApiBase('https://trainhub.example', at('https://pc.tail1234.ts.net/'))).toBe('https://trainhub.example');
  expect(resolveApiBase('', at('https://pc.tail1234.ts.net/'))).toBe('');
});
