import React, { useCallback, useEffect, useRef, useState } from 'react';
import './BatchImport.css';
import './WhoopSync.css';

const POLL_MS = 5000;
const OFFLINE_WARNING_HOURS = 24;
const INSTALL = 'bash whoop-bridge/install-mac.sh';
const BRIDGE = '~/.trainingplenum-whoop/venv/bin/python ~/.trainingplenum-whoop/app/bridge.py';

async function whoopRequest(apiBase, path = '', options = {}) {
  const body = options.method && options.method !== 'GET' && options.method !== 'DELETE' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {};
  const response = await fetch(`${apiBase}/api/whoop${path}`, { ...body, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'WHOOP-Anfrage fehlgeschlagen.');
  return data;
}

// The bridge talks to the same backend the browser uses.
export function bridgeUrl(apiBase) {
  try { return new URL(apiBase || window.location.origin, window.location.href).origin; } catch { return window.location.origin; }
}

const when = value => (value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function Command({ label, text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  return <div className="whoop-command">
    <span>{label}</span>
    <div><code>{text}</code><button type="button" onClick={copy}>{copied ? 'Kopiert' : 'Kopieren'}</button></div>
  </div>;
}

function Setup({ apiBase, token }) {
  return <div className="whoop-setup">
    <Command label="1. Im Terminal im Ordner von Training Plēnum (installiert die Bridge als Hintergrunddienst):" text={INSTALL} />
    <Command label="2. Bridge mit diesem Training Plēnum verbinden:" text={`${BRIDGE} setup ${bridgeUrl(apiBase)} ${token}`} />
    <p className="batch-help">Das Token wird nur jetzt angezeigt. Beim ersten Start fragt macOS nach dem Bluetooth-Zugriff: im Terminal erlauben. Danach läuft die Bridge ohne Fenster im Hintergrund.</p>
  </div>;
}

function Row({ label, children, tone }) {
  return <div className="whoop-row"><dt>{label}</dt><dd className={tone ? `whoop-${tone}` : undefined}>{children}</dd></div>;
}

const BAND_LABELS = { green: 'grün', yellow: 'gelb', red: 'rot' };
const minutesText = minutes => (minutes == null ? '–' : `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')} h`);

export function calibrationText(nights, provisionalAt = 4, solidAt = 14) {
  if (nights < provisionalAt) return `Kalibrierung: ${nights}/${provisionalAt} Nächte, danach gibt es eine Readiness`;
  if (nights < solidAt) return `Vorläufig: ${nights}/${solidAt} Nächte bis zur verlässlichen Baseline`;
  return `Verlässlich: Baseline aus ${nights} Nächten`;
}

// A preview of the latest computed day; the planning views come with phase 3.
function Recovery({ analytics }) {
  const day = analytics?.latest;
  if (!day) return <p className="batch-help">Noch keine ausgewertete Nacht. Die erste erscheint nach einer Nacht mit dem Strap.</p>;
  const base = day.hrvBaseline;
  const deviation = day.hrv != null && base?.mean ? Math.round((day.hrv / base.mean - 1) * 100) : null;
  const tone = { green: 'ok', yellow: 'warn', red: 'bad' }[day.band];
  return <section aria-label="Letzte Nacht" className="whoop-recovery">
    <h3>Letzte Nacht · {new Date(`${day.date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })}</h3>
    <p className="batch-help">{calibrationText(analytics.nights, analytics.provisionalAt, analytics.solidAt)}</p>
    <dl className="whoop-status">
      <Row label="Readiness" tone={tone}>{day.readiness != null ? `${day.readiness} (${BAND_LABELS[day.band]}${day.confidence === 'provisional' ? ', vorläufig' : ''})` : 'kalibriert…'}</Row>
      <Row label="HRV (RMSSD)">{day.hrv != null ? `${Math.round(day.hrv)} ms${deviation != null ? ` (${deviation > 0 ? '+' : ''}${deviation} %)` : ''}` : '–'}</Row>
      <Row label="Ruhepuls">{day.rhr != null ? `${Math.round(day.rhr)} bpm` : '–'}</Row>
      <Row label="Schlaf">{minutesText(day.sleep?.minutes)}{day.sleep?.efficiency != null ? ` · ${Math.round(day.sleep.efficiency * 100)} %` : ''}</Row>
      <Row label="Schlafschuld">{minutesText(day.sleepDebtMinutes)}</Row>
      <Row label="Strain">{day.strain?.strain != null ? day.strain.strain.toLocaleString('de-DE') : '–'}</Row>
    </dl>
  </section>;
}

function Status({ status }) {
  const bridge = status.bridge || {};
  const stats = status.stats || {};
  const battery = bridge.battery;
  const offlineLong = !bridge.online && bridge.offlineHours != null && bridge.offlineHours > OFFLINE_WARNING_HOURS;
  return <>
    {offlineLong && <p className="whoop-warning" role="alert">Die Bridge ist seit über 24 Stunden offline. Der Strap speichert nur etwa 14 Tage; danach gehen Daten verloren.</p>}
    <dl className="whoop-status">
      <Row label="Bridge" tone={bridge.online ? 'ok' : 'bad'}>{bridge.online ? 'online' : bridge.lastSeen ? `offline seit ${when(bridge.lastSeen)}` : 'noch nie gemeldet'}</Row>
      <Row label="Strap" tone={bridge.strapConnected ? 'ok' : undefined}>{bridge.strapConnected ? `verbunden${bridge.strapName ? ` (${bridge.strapName})` : ''}` : 'nicht verbunden'}</Row>
      <Row label="Akku">{battery?.percent != null ? `${Math.round(battery.percent)} %${battery.charging ? ', lädt' : ''}` : '–'}</Row>
      <Row label="Daten bis">{when(status.dataThrough)}</Row>
      <Row label="Herzfrequenz" tone={stats.lastHrAt ? 'ok' : undefined}>{stats.lastHrAt ? `✓ zuletzt ${when(stats.lastHrAt)}` : 'noch keine'}</Row>
      <Row label="R-R-Abstände" tone={stats.lastRrAt ? 'ok' : undefined}>{stats.lastRrAt ? `✓ zuletzt ${when(stats.lastRrAt)}` : 'noch keine'}</Row>
      <Row label="Echtzeit-HF">{bridge.realtimeHr?.bpm ? `${bridge.realtimeHr.bpm} bpm` : '–'}</Row>
      <Row label="Datensätze">{(stats.records || 0).toLocaleString('de-DE')}{stats.undecoded ? `, ${stats.undecoded.toLocaleString('de-DE')} nicht dekodiert` : ''}</Row>
      <Row label="Letzter Sync">{when(bridge.lastSyncAt)}</Row>
      <Row label="Puffer auf dem Mac">{bridge.outboxFrames != null ? `${bridge.outboxFrames.toLocaleString('de-DE')} Frames` : '–'}</Row>
      <Row label="Firmware">{bridge.firmware?.harvard || '–'}</Row>
      <Row label="Uhr des Straps" tone={bridge.clockOk === false ? 'bad' : undefined}>{bridge.clockOk == null ? '–' : bridge.clockOk ? '✓ gestellt' : 'nicht bestätigt'}</Row>
    </dl>
    {[status.lastError, bridge.strapError, bridge.uploadError, bridge.lastError].filter(Boolean).map(message =>
      <p key={message} className="batch-error">{message}</p>)}
  </>;
}

export default function WhoopSync({ apiBase = '', onClose }) {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const closeButton = useRef(null);

  const load = useCallback(async () => {
    try { setStatus(await whoopRequest(apiBase)); } catch (e) { setError(e.message); }
  }, [apiBase]);
  useEffect(() => { load(); closeButton.current?.focus(); }, [load]);
  useEffect(() => {
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const createToken = () => run(async () => { const data = await whoopRequest(apiBase, '/token', { method: 'POST' }); setToken(data.token); setStatus(data.status); });
  const sync = () => run(async () => setStatus(await whoopRequest(apiBase, '/sync', { method: 'POST' })));
  const recompute = () => run(async () => setStatus(await whoopRequest(apiBase, '/recompute', { method: 'POST' })));
  const disconnect = () => run(async () => {
    setStatus(await whoopRequest(apiBase, deleteData ? '?deleteData=1' : '', { method: 'DELETE' }));
    setToken(''); setConfirming(false); setDeleteData(false);
  });
  const keys = event => { if (event.key === 'Escape' && !busy) onClose(); };

  return <div className="batch-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="batch-dialog whoop-dialog" role="dialog" aria-modal="true" aria-labelledby="whoop-title" onKeyDown={keys}>
      <header className="batch-header">
        <div><h2 id="whoop-title">WHOOP 4.0</h2><p>Der Strap liefert Herzfrequenz, R-R-Abstände und Bewegung direkt an Training Plēnum, ohne WHOOP-App. Eine kleine Bridge auf deinem Mac hält die Bluetooth-Verbindung.</p></div>
        <button ref={closeButton} type="button" className="batch-close" aria-label="Dialog schließen" onClick={onClose}>×</button>
      </header>
      <div className="batch-content">
        {!status && !error && <p role="status" className="batch-help">Status wird geladen…</p>}
        {status && !status.connected && <ol className="whoop-steps">
          <li><h3>Strap von der WHOOP-App trennen</h3>
            <p>In der WHOOP-App den Strap entfernen und Bluetooth am Handy ausschalten. Danach erhalten WHOOP-App und WHOOP-Cloud keine Daten mehr. Den Strap tragen und geladen in der Nähe des Macs lassen.</p></li>
          <li><h3>Bridge einrichten</h3>
            {token ? <Setup apiBase={apiBase} token={token} /> : <>
              <p>Die Bridge braucht ein Token, damit nur sie Daten an Training Plēnum senden darf. Voraussetzung: Python 3.11 oder neuer auf dem Mac.</p>
              <button type="button" className="batch-primary" disabled={busy} onClick={createToken}>Token erzeugen</button>
            </>}</li>
        </ol>}
        {status?.connected && <>
          {token && <Setup apiBase={apiBase} token={token} />}
          <Recovery analytics={status.analytics} />
          <Status status={status} />
          {(status.reprocessing || status.analytics?.computing) && <p role="status" className="batch-help">{status.reprocessing ? 'Rohdaten werden neu eingelesen…' : 'Tage werden neu berechnet…'}</p>}
          {confirming && <div className="whoop-confirm" role="group" aria-label="WHOOP trennen">
            <p>Das Token wird ungültig, die Bridge kann keine Daten mehr senden.</p>
            <label><input type="checkbox" checked={deleteData} onChange={event => setDeleteData(event.target.checked)} /> Auch alle gespeicherten WHOOP-Daten löschen</label>
            <div><button type="button" className="batch-primary" disabled={busy} onClick={disconnect}>Trennen</button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Abbrechen</button></div>
          </div>}
        </>}
        {error && <p role="alert" className="batch-error">{error}</p>}
        <p className="batch-help">Alle Werte sind eigene Auswertungen der Rohdaten, keine offiziellen WHOOP-Scores und kein Medizinprodukt.</p>
      </div>
      {status?.connected && !confirming && <footer className="batch-footer">
        <button type="button" className="batch-link" disabled={busy} onClick={() => setConfirming(true)}>Trennen…</button>
        <button type="button" disabled={busy} onClick={createToken}>Neues Token</button>
        <button type="button" disabled={busy || status.reprocessing || status.analytics?.computing || !status.hours} onClick={recompute}>Neu berechnen</button>
        <button type="button" className="batch-primary" disabled={busy || status.syncRequested} onClick={sync}>{status.syncRequested ? 'Sync angefordert' : 'Jetzt synchronisieren'}</button>
      </footer>}
    </section>
  </div>;
}
