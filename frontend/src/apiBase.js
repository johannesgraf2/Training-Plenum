const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

// The build points at the backend on this machine (REACT_APP_API_URL, e.g. http://127.0.0.1:5000 in the Windows
// app). Opened from another device through Tailscale, that address would be the device itself; there the page's
// own address serves the API as well (the Windows app on one port, Docker through nginx).
export function resolveApiBase(configured = process.env.REACT_APP_API_URL || 'http://localhost:5000', location = window.location) {
  try {
    if (LOOPBACK.includes(new URL(configured, location.href).hostname) && !LOOPBACK.includes(location.hostname)) return '';
  } catch { /* an unusual value stays as configured */ }
  return configured;
}
