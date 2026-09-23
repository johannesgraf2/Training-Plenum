import React, { useEffect, useRef, useState } from 'react';
import { saveTheme, storedTheme } from './theme';
import './UserMenu.css';

const FIELDS = [
  ['age', 'Alter', 'Jahre', { min: 1, max: 120, step: 1 }],
  ['weight', 'Gewicht', 'kg', { min: 20, max: 300, step: 0.1 }],
  ['ftp', 'FTP', 'W', { min: 1, max: 1000, step: 1 }],
  ['maxHr', 'HFmax', 'bpm', { min: 60, max: 250, step: 1 }],
];

export const initials = name => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
const THEMES = [['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'System']];
const draftFrom = user => ({ name: user?.name || '', ...Object.fromEntries(FIELDS.map(([key]) => [key, user?.[key] ?? ''])) });

export default function UserMenu({ apiBase = '', user, onSaved, onOpenCoachProfile }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setDraft(draftFrom(user)); setError(''); setOpen(true);
    // FTP/HFmax can also change in the dashboard settings; show the stored values.
    try {
      const response = await fetch(`${apiBase}/api/user`);
      if (response.ok) { const fresh = await response.json(); setDraft(draftFrom(fresh)); onSaved?.(fresh, false); }
    } catch { /* The last known profile stays editable. */ }
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { name: draft.name.trim(), ...Object.fromEntries(FIELDS.map(([key]) => [key, draft[key] === '' ? null : Number(draft[key])])) };
      const response = await fetch(`${apiBase}/api/user`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Profil konnte nicht gespeichert werden.');
      onSaved?.(data, true); setOpen(false);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return <div className="user-menu" ref={root}>
    <button type="button" className="user-menu-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      <span className="user-menu-avatar">{initials(user?.name)}</span>
      <span className="user-menu-name">{user?.name || 'Profil'}</span>
      <span className="user-menu-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div className="user-menu-panel" role="dialog" aria-label="Profil bearbeiten">
      <div className="user-menu-head">
        <span className="user-menu-avatar large">{initials(draft.name || user?.name)}</span>
        <div><strong>{draft.name || user?.name || 'Dein Profil'}</strong>{user?.email && <small>{user.email}</small>}</div>
      </div>
      <div className="user-menu-theme" role="radiogroup" aria-label="Darstellung">
        <span>Darstellung</span>
        <div>{THEMES.map(([value, label]) => <button type="button" key={value} role="radio" aria-checked={theme === value}
          onClick={() => { saveTheme(value); setTheme(value); }}>{label}</button>)}</div>
      </div>
      <form onSubmit={save}>
        <fieldset disabled={saving}>
          <label className="user-menu-field wide"><span>Name</span><input required maxLength={100} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
          <div className="user-menu-grid">{FIELDS.map(([key, label, unit, limits]) =>
            <label className="user-menu-field" key={key}><span>{label} <em>{unit}</em></span><input type="number" {...limits} value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /></label>)}
          </div>
          <p className="user-menu-note">FTP und HFmax bestimmen deine Leistungs- und Herzfrequenzzonen, TSS und die Zielbereiche geplanter Workouts.</p>
          {error && <p role="alert" className="user-menu-error">{error}</p>}
          <div className="user-menu-actions">
            <button type="submit" className="primary">{saving ? 'Speichert …' : 'Speichern'}</button>
            <button type="button" onClick={() => setOpen(false)}>Abbrechen</button>
          </div>
        </fieldset>
      </form>
      {onOpenCoachProfile && <button type="button" className="user-menu-link" onClick={() => { setOpen(false); onOpenCoachProfile(); }}>Ziele &amp; Verfügbarkeit im AI Coach <span aria-hidden="true">→</span></button>}
    </div>}
  </div>;
}
