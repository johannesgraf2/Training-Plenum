import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bridgeUrl } from './WhoopSync';
import './BatchImport.css';
import './WhoopSync.css';
import './RemoteAccess.css';

const POLL_MS = 5000;
const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download';
const NAME = 'training-plenum';

async function request(apiBase, path, method = 'GET', body) {
  // Writing requests always carry JSON: the origin guard refuses anything else.
  const options = method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) };
  const response = await fetch(`${apiBase}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  return data;
}

const when = value => (value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

export const claudeCodeCommand = (url, token) => `claude mcp add --transport http ${NAME} ${url}/mcp --header "Authorization: Bearer ${token}"`;

// Claude Desktop starts local servers only; mcp-remote (Node.js) forwards to the HTTP endpoint. The header is
// passed through an environment variable because Windows splits arguments with spaces.
export function desktopConfig(url, token) {
  const header = 'Authorization:$' + '{AUTH}';
  return JSON.stringify({ mcpServers: { [NAME]: { command: 'npx', args: ['-y', 'mcp-remote', `${url}/mcp`, '--header', header],
    env: { AUTH: `Bearer ${token}` } } } }, null, 2);
}

function Copyable({ label, text, block }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  return <div className={`whoop-command${block ? ' remote-block' : ''}`}>
    {label && <span>{label}</span>}
    <div>{block ? <pre><code>{text}</code></pre> : <code>{text}</code>}<button type="button" onClick={copy}>{copied ? 'Kopiert' : 'Kopieren'}</button></div>
  </div>;
}

function Row({ label, children, tone }) {
  return <div className="whoop-row"><dt>{label}</dt><dd className={tone ? `whoop-${tone}` : undefined}>{children}</dd></div>;
}

function tailscaleText(tailscale) {
  if (!tailscale.installed) return ['auf diesem Rechner nicht gefunden', 'bad'];
  if (!tailscale.running) return [{ NeedsLogin: 'nicht angemeldet', Stopped: 'gestoppt' }[tailscale.state] || tailscale.error || 'nicht verbunden', 'bad'];
  return [`verbunden als ${tailscale.dnsName}`, 'ok'];
}

function Tailscale({ remote, onRefresh, busy }) {
  const { tailscale, commands } = remote;
  const [text, tone] = tailscaleText(tailscale);
  return <section className="remote-section" aria-labelledby="remote-tailscale">
    <h3 id="remote-tailscale">Von unterwegs öffnen</h3>
    <p className="batch-help">Mit <a href={TAILSCALE_DOWNLOAD} target="_blank" rel="noreferrer">Tailscale</a> auf diesem Rechner und auf dem Handy (mit demselben Konto) öffnest du Training Plēnum von überall. Die App bleibt dabei in deinem privaten Tailnet und ist nicht im Internet.</p>
    <dl className="whoop-status">
      <Row label="Tailscale" tone={tone}>{text}</Row>
      <Row label="Freigabe im Tailnet" tone={remote.appServed ? 'ok' : undefined}>{remote.appServed ? 'aktiv' : 'aus'}</Row>
    </dl>
    {remote.appPublic && <div className="whoop-warning" role="alert">
      <p>Tailscale Funnel stellt die App selbst ins Internet. Training Plēnum blockt dort alles außer dem Claude-Zugang, schalte es trotzdem ab und gib die App danach wieder nur im Tailnet frei:</p>
      <Copyable text="tailscale funnel reset" />
    </div>}
    {remote.appUrl && <Copyable label="Auf dem Handy in der Tailscale-App verbinden, dann im Browser öffnen:" text={remote.appUrl} />}
    {!remote.appServed && (commands.serve
      ? <Copyable label={`Einmalig im Terminal dieses Rechners${tailscale.installed ? '' : ' (bzw. des Rechners, auf dem Docker läuft)'}:`} text={commands.serve} />
      : <p className="batch-help">Für den Zugriff von unterwegs Training Plēnum als Windows-App oder mit Docker starten: Dort liefert ein Port Seite und API zusammen.</p>)}
    {!remote.appServed && commands.serve && <p className="batch-help">Beim ersten Mal fragt Tailscale, ob HTTPS-Zertifikate für dein Tailnet eingeschaltet werden sollen: zustimmen. Die Freigabe bleibt bei Neustarts bestehen; abschalten mit <code>{commands.serveOff}</code>.</p>}
    <button type="button" className="remote-refresh" disabled={busy} onClick={onRefresh}>Erneut prüfen</button>
  </section>;
}

function Access({ status, busy, onChange }) {
  const visible = status.tools.filter(tool => status.allowWrite || !tool.write).map(tool => tool.title);
  return <>
    <div className="garmin-ranges" role="radiogroup" aria-label="Was Claude darf">
      {[[false, 'Nur lesen'], [true, 'Lesen und Einheiten planen']].map(([value, label]) =>
        <button key={label} type="button" role="radio" aria-checked={status.allowWrite === value} disabled={busy} onClick={() => onChange(value)}>{label}</button>)}
    </div>
    <p className="batch-help">Claude kann: {visible.join(', ')}. GPS-Positionen gehen nie an Claude.{status.allowWrite ? ' Neue und geänderte Einheiten landen im Kalender und, wenn eingerichtet, im Garmin-Kalender; gesperrte Einheiten bleiben unangetastet.' : ''}</p>
  </>;
}

function TokenSetup({ token, localUrl, tailnetUrl }) {
  const [where, setWhere] = useState('local');
  const url = where === 'tailnet' && tailnetUrl ? tailnetUrl : localUrl;
  return <div className="whoop-setup">
    {tailnetUrl && tailnetUrl !== localUrl && <div className="garmin-ranges" role="radiogroup" aria-label="Wo läuft Claude?">
      {[['local', 'Claude auf diesem Rechner'], ['tailnet', 'Auf einem anderen Gerät im Tailnet']].map(([value, label]) =>
        <button key={value} type="button" role="radio" aria-checked={where === value} onClick={() => setWhere(value)}>{label}</button>)}
    </div>}
    <Copyable label="Claude Code: im Terminal ausführen" text={claudeCodeCommand(url, token)} />
    <Copyable block label="Claude Desktop: in claude_desktop_config.json eintragen (Einstellungen → Entwickler → Konfiguration bearbeiten, braucht Node.js), danach Claude neu starten" text={desktopConfig(url, token)} />
    <p className="batch-help">Das Token wird nur jetzt angezeigt. Wer es hat, kann über diese Adresse auf deine Trainingsdaten zugreifen.</p>
  </div>;
}

function Token({ apiBase, status, remote, run, busy }) {
  const [token, setToken] = useState('');
  const create = () => run(async () => { const data = await request(apiBase, '/api/mcp/token', 'POST'); setToken(data.token); return data.status; });
  const remove = () => run(async () => { setToken(''); return request(apiBase, '/api/mcp/token', 'DELETE'); });
  return <section className="remote-section" aria-labelledby="remote-token">
    <h3 id="remote-token">Mit Token: Claude Code und Claude Desktop</h3>
    <p className="batch-help">Claude Code und lokale Server in Claude Desktop verbinden sich direkt von deinem Gerät, hier oder unterwegs über das Tailnet. Sie melden sich mit einem persönlichen Token an.</p>
    {token ? <TokenSetup token={token} localUrl={bridgeUrl(apiBase)} tailnetUrl={remote?.appServed ? remote.appUrl : null} />
      : status.token ? <p className="batch-help">Token vom {when(status.token.createdAt)} · zuletzt genutzt {when(status.token.lastUsedAt)}{status.token.lastClient ? ` von ${status.token.lastClient}` : ''}</p>
        : null}
    <div className="remote-actions">
      <button type="button" className={status.token ? undefined : 'batch-primary'} disabled={busy} onClick={create}>{status.token ? 'Neues Token' : 'Token erzeugen'}</button>
      {status.token && <button type="button" disabled={busy} onClick={remove}>Token löschen</button>}
    </div>
  </section>;
}

function ClaudeApps({ apiBase, status, remote, run, busy }) {
  const [code, setCode] = useState('');
  const pending = status.pairingExpiresAt && new Date(status.pairingExpiresAt) > new Date();
  const pair = () => run(async () => { const data = await request(apiBase, '/api/mcp/pairing', 'POST'); setCode(data.code); return data.status; });
  const disconnect = id => run(() => request(apiBase, `/api/mcp/connections/${encodeURIComponent(id)}`, 'DELETE'));
  const host = remote?.tailscale?.dnsName || (remote?.appUrl ? new URL(remote.appUrl).hostname : null);
  const url = remote?.claudeUrl || (host ? `https://${host}:${remote.funnelPort}/mcp` : null);
  return <section className="remote-section" aria-labelledby="remote-apps">
    <h3 id="remote-apps">Mit Freigabe: claude.ai, Claude-App und Connectors</h3>
    <p className="batch-help">Claude im Browser, auf dem Handy und Connectors in der Desktop-App verbinden sich aus der Cloud von Anthropic, nicht von deinem Gerät, und erreichen dein Tailnet deshalb nicht. Tailscale Funnel stellt dafür nur den Claude-Zugang ins Internet (Port {remote?.claudePort || 5001}); die übrige App bleibt im Tailnet. Claude meldet sich über eine Freigabe an, die du hier bestätigst.</p>
    {remote && <dl className="whoop-status">
      <Row label="Claude-Zugang im Internet" tone={remote.claudeFunnel ? 'ok' : undefined}>{remote.claudeFunnel ? 'aktiv (Funnel)' : 'aus'}</Row>
      <Row label="Verbundene Apps">{status.connections.length || 'keine'}</Row>
    </dl>}
    {remote && !remote.claudePortRunning && <p className="whoop-warning">Der Claude-Port {remote.claudePort || 5001} läuft nicht (belegt oder mit TRAINHUB_CLAUDE_PORT=0 abgeschaltet). Ohne ihn können sich diese Apps nicht verbinden.</p>}
    <ol className="whoop-steps remote-steps">
      {remote && !remote.claudeFunnel && <li><Copyable label="Einmalig im Terminal, nur der Claude-Zugang kommt ins Internet:" text={remote.commands.funnel} /></li>}
      <li>{url ? <Copyable label={`In Claude unter Einstellungen → Connectors → Eigenen Connector hinzufügen diese Adresse eintragen${remote?.claudeFunnel ? '' : ' (sobald Funnel läuft)'}:`} text={url} />
        : <p className="batch-help">In Claude unter Einstellungen → Connectors einen eigenen Connector mit der Funnel-Adresse dieses Rechners und /mcp anlegen.</p>}</li>
      <li><p className="batch-help">Beim Verbinden fragt Training Plēnum nach einem Freigabecode. Ihn hier erzeugen, er gilt 10 Minuten und nur einmal:</p>
        {code && pending ? <p className="remote-code" aria-label="Freigabecode"><strong>{code}</strong><small>gültig bis {new Date(status.pairingExpiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small></p> : null}
        <button type="button" className="batch-primary" disabled={busy} onClick={pair}>{code && pending ? 'Neuen Code erzeugen' : 'Freigabecode erzeugen'}</button></li>
    </ol>
    {status.connections.length > 0 && <ul className="remote-connections" aria-label="Verbundene Apps">
      {status.connections.map(connection => <li key={connection.id}>
        <span><strong>{connection.client}</strong><small>verbunden {when(connection.approvedAt)} · zuletzt {when(connection.lastUsedAt)}</small></span>
        <button type="button" disabled={busy} onClick={() => disconnect(connection.id)}>Trennen</button>
      </li>)}
    </ul>}
  </section>;
}

export default function RemoteAccess({ apiBase = '', onClose }) {
  const [status, setStatus] = useState(null);
  const [remote, setRemote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeButton = useRef(null);

  const load = useCallback(async () => {
    try { setStatus(await request(apiBase, '/api/mcp')); } catch (e) { setError(e.message); }
  }, [apiBase]);
  const check = useCallback(async (refresh = false) => {
    try { setRemote(await request(apiBase, `/api/remote-access${refresh ? '?refresh=1' : ''}`)); } catch (e) { setError(e.message); }
  }, [apiBase]);
  useEffect(() => { load(); check(); closeButton.current?.focus(); }, [load, check]);
  useEffect(() => {
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function run(action) {
    setBusy(true); setError('');
    try { const next = await action(); if (next) setStatus(next); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const refresh = () => run(async () => { await check(true); });
  const allowWrite = value => run(() => request(apiBase, '/api/mcp/settings', 'PUT', { allowWrite: value }));
  const keys = event => { if (event.key === 'Escape' && !busy) onClose(); };

  return <div className="batch-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="batch-dialog remote-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-title" onKeyDown={keys}>
      <header className="batch-header">
        <div><h2 id="remote-title">Claude &amp; Fernzugriff</h2><p>Training Plēnum von unterwegs über Tailscale öffnen und Claude mit deinen Trainingsdaten arbeiten lassen.</p></div>
        <button ref={closeButton} type="button" className="batch-close" aria-label="Dialog schließen" onClick={onClose}>×</button>
      </header>
      <div className="batch-content">
        {(!status || !remote) && !error && <p role="status" className="batch-help">Status wird geladen…</p>}
        {remote && <Tailscale remote={remote} busy={busy} onRefresh={refresh} />}
        {status && <section className="remote-section" aria-labelledby="remote-claude">
          <h3 id="remote-claude">Was Claude darf</h3>
          <Access status={status} busy={busy} onChange={allowWrite} />
        </section>}
        {status && <Token apiBase={apiBase} status={status} remote={remote} run={run} busy={busy} />}
        {status && <ClaudeApps apiBase={apiBase} status={status} remote={remote} run={run} busy={busy} />}
        {error && <p role="alert" className="batch-error">{error}</p>}
      </div>
    </section>
  </div>;
}
