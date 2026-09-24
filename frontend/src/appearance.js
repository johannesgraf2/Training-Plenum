import { useEffect, useState } from 'react';

// Start-page images live on the local backend; every change is broadcast so the
// user menu and the start page stay in sync without sharing state through App.
const EVENT = 'trainhub:appearance';
export const DEFAULT_APPEARANCE = { background: 'default', backgroundImage: null, raceGoalImage: null };
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Die Bildeinstellung konnte nicht gespeichert werden.');
  window.dispatchEvent(new CustomEvent(EVENT, { detail: data }));
  return data;
}

export const loadAppearance = apiBase => request(`${apiBase}/api/appearance`);

export const setBackground = (apiBase, mode) => request(`${apiBase}/api/appearance`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: mode }),
});

export function uploadImage(apiBase, slot, file) {
  if (!IMAGE_TYPES.includes(file.type)) return Promise.reject(new Error('Bitte ein JPEG-, PNG- oder WebP-Bild auswählen.'));
  if (file.size > MAX_IMAGE_BYTES) return Promise.reject(new Error('Das Bild darf höchstens 10 MB groß sein.'));
  const body = new FormData();
  body.append('file', file);
  return request(`${apiBase}/api/appearance/${slot}/image`, { method: 'POST', body });
}

export const removeImage = (apiBase, slot) => request(`${apiBase}/api/appearance/${slot}/image`, { method: 'DELETE' });

export const imageUrl = (apiBase, path) => (path ? `${apiBase}${path}` : null);

export function useAppearance(apiBase) {
  const [state, setState] = useState({ ...DEFAULT_APPEARANCE, loaded: false });
  useEffect(() => {
    let active = true;
    const update = event => { if (active) setState({ ...event.detail, loaded: true }); };
    window.addEventListener(EVENT, update);
    // Without the backend the bundled illustration stays in place.
    loadAppearance(apiBase).catch(() => { if (active) setState(current => ({ ...current, loaded: true })); });
    return () => { active = false; window.removeEventListener(EVENT, update); };
  }, [apiBase]);
  return state;
}
