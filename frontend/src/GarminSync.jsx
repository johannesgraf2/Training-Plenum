import React, { useCallback, useEffect, useRef, useState } from 'react';
import './BatchImport.css';
import './WhoopSync.css';
import './GarminSync.css';

const POLL_MS = 5000;
const SYNC_POLL_MS = 1500;

async function garminRequest(apiBase, path = '', { method = 'GET', body } = {}) {
  const init = method === 'POST' || method === 'PUT' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) } : { method };
  const response = await fetch(`${apiBase}/api/garmin${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Garmin-Anfrage fehlgeschlagen.');
  return data;
}

const when = value => (value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const day = value => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('de-DE') : '–');
const RESULT_LABELS = [['imported', 'neu'], ['duplicate', 'schon vorhanden'], ['skipped', 'ohne FIT-Datei'], ['failed', 'fehlerhaft']];

const PUSH_LABELS = [['created', 'neu'], ['updated', 'geändert'], ['removed', 'gelöscht'], ['failed', 'abgelehnt']];

export function resultText(result, labels = RESULT_LABELS, nothing = 'keine neuen Aktivitäten') {
  const parts = labels.filter(([key]) => result?.[key]).map(([key, label]) => `${result[key]} ${label}`);
  return parts.length ? parts.join(', ') : nothing;
}

function Row({ label, children, tone }) {
  return <div className="whoop-row"><dt>{label}</dt><dd className={tone ? `whoop-${tone}` : undefined}>{children}</dd></div>;
}

function Workouts({ status, busy, onToggle }) {
  const [confirming, setConfirming] = useState(false);
  const [remove, setRemove] = useState(false);
  const workouts = status.workouts;
  const state = workouts.removing ? 'werden aus Garmin gelöscht…' : workouts.pushing ? 'werden gesendet…' : null;
  const toggle = event => {
    if (event.target.checked) onToggle(true, false);
    else if (workouts.sent) setConfirming(true);
    else onToggle(false, false);
  };
  return <section className="garmin-workouts" aria-label="Geplante Einheiten">
    <label className="garmin-switch">
      <input type="checkbox" checked={status.pushWorkouts} disabled={busy || status.needsLogin} onChange={toggle} />
      <span><strong>Geplante Einheiten an Garmin senden</strong>
        Ab heute landet jede geplante Einheit im Garmin-Connect-Kalender und von dort auf deinem Gerät. Verschieben, Ändern und Löschen werden übernommen.</span>
    </label>
    {confirming && <div className="whoop-confirm" role="group" aria-label="Senden abschalten">
      <p>Neue Einheiten gehen dann nicht mehr an Garmin.</p>
      <label><input type="checkbox" checked={remove} onChange={event => setRemove(event.target.checked)} /> Bereits gesendete Einheiten aus Garmin löschen</label>
      <div><button type="button" className="batch-primary" disabled={busy} onClick={() => { onToggle(false, remove); setConfirming(false); setRemove(false); }}>Abschalten</button>
        <button type="button" disabled={busy} onClick={() => { setConfirming(false); setRemove(false); }}>Abbrechen</button></div>
    </div>}
    <dl className="whoop-status">
      <Row label="Im Garmin-Kalender (ab heute)">{workouts.scheduled.toLocaleString('de-DE')} {workouts.scheduled === 1 ? 'Einheit' : 'Einheiten'}</Row>
      <Row label="Zuletzt gesendet">{state || when(workouts.lastPushAt)}</Row>
      <Row label="Ergebnis">{workouts.lastPushAt ? resultText(workouts.lastPushResult, PUSH_LABELS, 'alles aktuell') : '–'}</Row>
    </dl>
    {workouts.lastPushError && !state && <p className="batch-error">{workouts.lastPushError}</p>}
  </section>;
}

function Status({ status }) {
  const progress = status.progress;
  return <dl className="whoop-status">
    <Row label="Konto" tone={status.needsLogin ? 'bad' : 'ok'}>{status.email}{status.needsLogin ? ' (Anmeldung abgelaufen)' : ''}</Row>
    <Row label="Letzter Abgleich">{status.syncing ? (progress ? `läuft: ${progress.done} von ${progress.total} geprüft` : 'läuft…') : when(status.lastSyncAt)}</Row>
    <Row label="Ergebnis">{status.lastSyncAt ? resultText(status.lastResult) : '–'}</Row>
    <Row label="Abgerufen bis">{day(status.syncedThrough)}</Row>
    <Row label="Von Garmin importiert">{status.imported.toLocaleString('de-DE')}</Row>
    <Row label="Automatisch">{status.autoSyncHours ? `alle ${status.autoSyncHours.toLocaleString('de-DE')} h` : 'aus'}</Row>
  </dl>;
}

export default function GarminSync({ apiBase = '', onClose, onSynced }) {
  const [status, setStatus] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleteWorkouts, setDeleteWorkouts] = useState(false);
  const closeButton = useRef(null);
  const wasSyncing = useRef(false);

  const load = useCallback(async () => {
    try { setStatus(await garminRequest(apiBase)); } catch (e) { setError(e.message); }
  }, [apiBase]);
  useEffect(() => { load(); closeButton.current?.focus(); }, [load]);
  useEffect(() => {
    const timer = setInterval(load, status?.syncing ? SYNC_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, status?.syncing]);
  useEffect(() => {
    if (status?.email) setEmail(current => current || status.email);
    // New activities appear in the lists as soon as a sync has finished.
    if (wasSyncing.current && status && !status.syncing) onSynced?.();
    wasSyncing.current = Boolean(status?.syncing);
  }, [status, onSynced]);

  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const login = event => {
    event.preventDefault();
    const secret = password;
    setPassword('');
    run(async () => setStatus(await garminRequest(apiBase, '/login', { method: 'POST', body: { email: email.trim(), password: secret } })));
  };
  const confirmCode = event => {
    event.preventDefault();
    run(async () => { setStatus(await garminRequest(apiBase, '/mfa', { method: 'POST', body: { code: code.trim() } })); setCode(''); });
  };
  const sync = () => run(async () => setStatus(await garminRequest(apiBase, '/sync', { method: 'POST' })));
  const togglePush = (pushWorkouts, removeWorkouts) => run(async () => setStatus(await garminRequest(apiBase, '/settings', { method: 'PUT', body: { pushWorkouts, removeWorkouts } })));
  const disconnect = () => run(async () => {
    setStatus(await garminRequest(apiBase, deleteWorkouts ? '?deleteWorkouts=1' : '', { method: 'DELETE' }));
    setConfirming(false); setDeleteWorkouts(false);
  });
  const keys = event => { if (event.key === 'Escape' && !busy) onClose(); };

  const showLogin = status?.available && (!status.connected || status.needsLogin) && !status.mfaPending;
  return <div className="batch-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="batch-dialog whoop-dialog" role="dialog" aria-modal="true" aria-labelledby="garmin-title" onKeyDown={keys}>
      <header className="batch-header">
        <div><h2 id="garmin-title">Garmin Connect</h2><p>Neue Aktivitäten kommen automatisch als originale FIT-Datei aus Garmin Connect, geplante Einheiten gehen in deinen Garmin-Kalender. Ohne Export und USB-Kabel.</p></div>
        <button ref={closeButton} type="button" className="batch-close" aria-label="Dialog schließen" onClick={onClose}>×</button>
      </header>
      <div className="batch-content">
        {!status && !error && <p role="status" className="batch-help">Status wird geladen…</p>}
        {status && !status.available && <p className="whoop-warning" role="alert">Garmin Connect braucht auf dem Server Python 3.12 oder neuer und das Paket garminconnect. Mit Docker ist beides enthalten.</p>}
        {status?.disconnecting && <p role="status" className="batch-help">Gesendete Einheiten werden aus Garmin gelöscht, danach wird getrennt…</p>}
        {status?.connected && <Status status={status} />}
        {status?.connected && <Workouts status={status} busy={busy} onToggle={togglePush} />}
        {showLogin && <form className="garmin-form" onSubmit={login}>
          <label className="garmin-field">E-Mail deines Garmin-Kontos
            <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="garmin-field">Passwort
            <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button type="submit" className="batch-primary" disabled={busy}>{status.needsLogin ? 'Neu anmelden' : 'Verbinden'}</button>
          <p className="batch-help">Das Passwort geht nur zur Anmeldung an Garmin und wird nicht gespeichert. Training Plēnum behält nur den Anmelde-Token, verschlüsselt auf diesem Rechner. Der erste Abgleich holt die letzten 90 Tage; schon vorhandene Aktivitäten werden übersprungen.</p>
        </form>}
        {status?.mfaPending && <form className="garmin-form" onSubmit={confirmCode}>
          <label className="garmin-field">Bestätigungscode von Garmin
            <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{4,10}" value={code} onChange={e => setCode(e.target.value)} /></label>
          <button type="submit" className="batch-primary" disabled={busy}>Bestätigen</button>
          <p className="batch-help">Garmin hat dir einen Code per E-Mail oder App geschickt. Er gilt etwa 10 Minuten.</p>
        </form>}
        {confirming && <div className="whoop-confirm" role="group" aria-label="Garmin trennen">
          <p>Die gespeicherte Anmeldung wird gelöscht. Bereits importierte Aktivitäten bleiben erhalten.</p>
          {status.workouts?.sent > 0 && <label><input type="checkbox" checked={deleteWorkouts} onChange={event => setDeleteWorkouts(event.target.checked)} /> Auch die von Training Plēnum gesendeten Einheiten aus Garmin löschen</label>}
          <div><button type="button" className="batch-primary" disabled={busy} onClick={disconnect}>Trennen</button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); setDeleteWorkouts(false); }}>Abbrechen</button></div>
        </div>}
        {status?.connected && status.lastError && !status.syncing && <p className="batch-error">{status.lastError}</p>}
        {error && <p role="alert" className="batch-error">{error}</p>}
        <p className="batch-help">Nutzt die inoffizielle Schnittstelle von Garmin Connect (kostenlos). Ändert Garmin den Login, kann der Abgleich vorübergehend ausfallen; der Datei-Import funktioniert weiter.</p>
      </div>
      {status?.connected && !confirming && !status.disconnecting && <footer className="batch-footer">
        <button type="button" className="batch-link" disabled={busy} onClick={() => setConfirming(true)}>Trennen…</button>
        <button type="button" className="batch-primary" disabled={busy || status.syncing || status.workouts?.pushing || status.needsLogin} onClick={sync}>{status.syncing || status.workouts?.pushing ? 'Wird abgeglichen…' : 'Jetzt synchronisieren'}</button>
      </footer>}
    </section>
  </div>;
}
