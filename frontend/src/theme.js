// Display preference per browser: 'light', 'dark' or 'system'. public/index.html applies
// the stored value before the first paint; this module keeps it in sync afterwards.
const STORAGE_KEY = 'trainhub-theme';
const THEMES = ['light', 'dark', 'system'];
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function storedTheme() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(preference = storedTheme()) {
  const dark = preference === 'dark' || (preference === 'system' && !!media()?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function saveTheme(preference) {
  try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* Private mode: applies for this visit only. */ }
  applyTheme(preference);
}

export function followSystemTheme() {
  const query = media();
  const update = () => { if (storedTheme() === 'system') applyTheme('system'); };
  query?.addEventListener?.('change', update);
  applyTheme();
  return () => query?.removeEventListener?.('change', update);
}
