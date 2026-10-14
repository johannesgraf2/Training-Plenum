import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import UserMenu, { initials } from './UserMenu';
import { applyTheme } from './theme';

const stored = { id: 'u', name: 'Johannes Graf', email: 'athlete@trainhub.de', age: 30, weight: 75, ftp: 320, maxHr: 191 };
let host, root, originalFetch, saved, onSaved, onOpenCoachProfile, onOpenWhoop;
const response = (payload, ok = true) => ({ ok, json: async () => payload });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  saved = null; onSaved = jest.fn(); onOpenCoachProfile = jest.fn(); onOpenWhoop = jest.fn();
  originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PUT') {
      saved = JSON.parse(options.body);
      return saved.name === 'fail' ? response({ error: 'name: ungültig' }, false) : response({ ...stored, ...saved });
    }
    return response({ ...stored, ftp: 333 });
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; delete global.IS_REACT_ACT_ENVIRONMENT; delete window.matchMedia; });
const render = () => act(async () => root.render(<UserMenu apiBase="http://api" user={stored} onSaved={onSaved} onOpenCoachProfile={onOpenCoachProfile} onOpenWhoop={onOpenWhoop} />));
const button = text => Array.from(host.querySelectorAll('button')).find(b => b.textContent.trim() === text);
const open = () => act(async () => host.querySelector('.user-menu-trigger').click());
const field = label => Array.from(host.querySelectorAll('label')).find(l => l.querySelector('span').textContent.startsWith(label)).querySelector('input');
const type = (label, value) => act(async () => Simulate.change(field(label), { target: { value } }));

test('shows only the compact trigger until opened and loads the stored profile', async () => {
  await render();
  expect(host.querySelector('.user-menu-trigger').textContent).toContain('JG');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await open();
  expect(global.fetch).toHaveBeenCalledWith('http://api/api/user');
  expect(field('FTP').value).toBe('333');
  expect(host.textContent).toContain('athlete@trainhub.de');
});

test('saves the profile with numbers, empty fields as null, and reports the change', async () => {
  await render();
  await open();
  await type('Name', '  Alex Muster ');
  await type('Gewicht', '');
  await type('HFmax', '188');
  await act(async () => Simulate.submit(host.querySelector('form')));
  expect(saved).toEqual({ name: 'Alex Muster', age: 30, weight: null, ftp: 333, maxHr: 188 });
  expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Alex Muster', maxHr: 188 }), true);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

test('keeps the menu open with the backend error when saving fails', async () => {
  await render();
  await open();
  await type('Name', 'fail');
  await act(async () => Simulate.submit(host.querySelector('form')));
  expect(host.querySelector('[role="alert"]').textContent).toBe('name: ungültig');
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});

test('switches and remembers the theme without saving the profile', async () => {
  await render();
  await open();
  await act(async () => button('Dunkel').click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(window.localStorage.getItem('trainhub-theme')).toBe('dark');
  expect(button('Dunkel').getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Hell').click());
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(saved).toBeNull();
});

test('system theme follows the operating system preference', () => {
  window.matchMedia = jest.fn(() => ({ matches: true }));
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.matchMedia = jest.fn(() => ({ matches: false }));
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('closes with Escape and links to goals in the AI Coach', async () => {
  await render();
  await open();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await open();
  await act(async () => button('Ziele & Verfügbarkeit im AI Coach →').click());
  expect(onOpenCoachProfile).toHaveBeenCalled();
  await open();
  await act(async () => button('WHOOP-Strap verbinden →').click());
  expect(onOpenWhoop).toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(initials('  anna  maria  berg ')).toBe('AM');
  expect(initials('')).toBe('?');
});
