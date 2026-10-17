import React, { useEffect, useRef, useState } from 'react';
import './CoachPlan.css';

// The coach chat: the one way to change the plan or ask about it. A change from the coach arrives as a card;
// only "Übernehmen" changes plan and calendar (POST /api/coach/proposals/<id>/confirm).

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `timezone=${encodeURIComponent(timezone())}`;
const DAY_NAMES = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };
const fmt = value => value == null ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const hm = minutes => minutes == null ? '—' : minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')} h` : `${Math.round(minutes)} min`;
const weekLabel = week => `KW ${Number(week.split('-W')[1])}`;
// Quick replies fill the input; the athlete adds the details.
export const QUICK_REPLIES = [['Keine Zeit', 'Ich habe weniger Zeit als geplant: '], ['Krank', 'Ich bin krank: '], ['Müde', 'Ich bin müde und brauche etwas Erholung.'],
  ['Reise', 'Ich bin auf Reise: '], ['Mehr Zeit', 'Ich habe mehr Zeit: ']];
const STATUS = { confirmed: '✓ übernommen', discarded: 'verworfen', expired: 'verfallen' };

export async function request(apiBase, path, method = 'GET', body) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Anfrage fehlgeschlagen (${response.status}).`), { status: response.status, data });
  return data;
}

const sessionName = session => session.rendered?.name || session.name || session.template;
const sessionMinutes = session => session.rendered?.durationMin ?? session.durationMin;
const hoursOf = week => week?.calculatedHours ?? week?.targetHours;

// What a week change does, as short lines; the chat gets them from the server, a replanning proposal not.
export function weekChanges(before = { sessions: [] }, after = { sessions: [] }) {
  const old = Object.fromEntries((before.sessions || []).map(s => [s.id, s]));
  const lines = [];
  for (const session of after.sessions || []) {
    const previous = old[session.id];
    if (!previous) lines.push(`${DAY_NAMES[session.day]} + ${sessionName(session)} (${Math.round(sessionMinutes(session) || 0)} min)`);
    else if (previous.day !== session.day) lines.push(`${sessionName(previous)}: ${DAY_NAMES[previous.day]} → ${DAY_NAMES[session.day]}`);
    else if (JSON.stringify([previous.template, previous.params]) !== JSON.stringify([session.template, session.params]))
      lines.push(`${DAY_NAMES[session.day]} ${sessionName(previous)} ${Math.round(sessionMinutes(previous) || 0)} min → ${sessionName(session) === sessionName(previous) ? '' : `${sessionName(session)} `}${Math.round(sessionMinutes(session) || 0)} min`);
  }
  const kept = new Set((after.sessions || []).map(s => s.id));
  return [...lines, ...(before.sessions || []).filter(s => !kept.has(s.id)).map(s => `${DAY_NAMES[s.day]} ${sessionName(s)} entfällt`)];
}

function DayList({ week }) {
  const sessions = [...(week?.sessions || [])].sort((a, b) => (a.rendered?.date || '').localeCompare(b.rendered?.date || ''));
  if (!sessions.length) return <p className="coach-muted">Keine Einheiten.</p>;
  return <ul className="chat-days">{sessions.map(s => <li key={s.id}><strong>{DAY_NAMES[s.day]}</strong> {sessionName(s)} · {hm(sessionMinutes(s))}</li>)}</ul>;
}

/** The change card: affected days, before and after, the new weekly hours and lasting settings. */
export function ChangeCard({ change, busy, onConfirm, onDiscard }) {
  const weeks = change.weeks || [];
  const pending = change.status === 'pending';
  return <div className={`chat-change ${change.status}`} aria-label="Änderungskarte">
    <strong className="chat-change-title">{change.summary || 'Änderung prüfen'}</strong>
    {weeks.map(item => {
      const lines = item.lines || weekChanges(item.before, item.after);
      return <div key={item.week} className="chat-change-week">
        <span className="coach-eyebrow">{weekLabel(item.week)} · {fmt(hoursOf(item.before))} h → {fmt(hoursOf(item.after))} h</span>
        {lines.length > 0 ? <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul> : <p className="coach-muted">Nur Zielstunden und Fokus ändern sich.</p>}
        <details className="chat-compare"><summary>Vorher / Nachher</summary><div className="chat-compare-grid">
          <div><small>Vorher</small><DayList week={item.before} /></div><div><small>Nachher</small><DayList week={item.after} /></div></div></details>
      </div>;
    })}
    {change.settings?.length > 0 && <div className="chat-change-week"><span className="coach-eyebrow">In Einstellungen übernehmen</span>
      <ul>{change.settings.map(line => <li key={line}>{line}</li>)}</ul></div>}
    {change.hinweise?.length > 0 && <ul className="chat-hints">{change.hinweise.map(hint => <li key={hint}>{hint}</li>)}</ul>}
    {pending ? <div className="coach-actions">
      <button type="button" className="coach-primary" disabled={busy} onClick={onConfirm}>{weeks.length ? 'Übernehmen' : 'In Einstellungen übernehmen'}</button>
      <button type="button" disabled={busy} onClick={onDiscard}>Verwerfen</button>
    </div> : <span className="chat-change-status">{STATUS[change.status] || change.status}</span>}
  </div>;
}

/** Chat window (full-screen sheet on the phone). start = {ref, message, key}: a new key sets the reference and sends the message. */
export default function CoachChat({ apiBase = '', providerReady, start, onClose, onProviderSettings, onChanged }) {
  const [messages, setMessages] = useState(null);
  const [ref, setRef] = useState(start?.ref || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  const list = useRef(null);
  const started = useRef(null);
  useEffect(() => {
    let active = true;
    request(apiBase, '/api/coach/chat').then(data => { if (active) setMessages(data.messages); }, e => { if (active) { setMessages([]); setError(e.message); } });
    return () => { active = false; };
  }, [apiBase]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { list.current?.scrollTo?.({ top: list.current.scrollHeight }); }, [messages, sending]);

  async function send(text, about = ref) {
    const message = text.trim();
    if (!message || sending || !providerReady) return;
    setSending(true); setError(''); setDraft('');
    setMessages(current => [...(current || []), { id: 'pending', role: 'athlete', text: message, ref: about, change: null }]);
    try {
      const data = await request(apiBase, `/api/coach/chat?${tzQuery()}`, 'POST', { message, ref: about });
      setMessages(data.messages); setRef(null);
    } catch (e) {
      // Nothing was saved: the text goes back into the input.
      setMessages(current => (current || []).filter(m => m.id !== 'pending')); setDraft(message); setError(e.message);
    } finally { setSending(false); }
  }
  // A prepared message (quick button in Heute, an action of a session) is sent right away.
  useEffect(() => {
    if (!start || started.current === start.key || messages === null) return;
    started.current = start.key;
    setRef(start.ref || null);
    if (start.message) send(start.message, start.ref || null);
    else input.current?.focus();
  }, [start, messages === null]);

  async function decide(change, action) {
    setBusy(true); setError('');
    try {
      const result = await request(apiBase, `/api/coach/proposals/${encodeURIComponent(change.proposalId)}/${action}`, 'POST', action === 'confirm' ? { confirm: true } : {});
      if (action === 'confirm') await onChanged?.(result);
    } catch (e) { setError(e.message); }
    try { setMessages((await request(apiBase, '/api/coach/chat')).messages); } catch (_) { /* The card keeps its last state. */ }
    setBusy(false);
  }
  async function newChat() {
    setBusy(true); setError('');
    try { setMessages((await request(apiBase, '/api/coach/chat', 'DELETE')).messages); setRef(null); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const quick = ref?.kind === 'session' ? [...QUICK_REPLIES, ['Warum diese Einheit?', 'Warum diese Einheit?']] : QUICK_REPLIES;

  return <div className="chat-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="chat-window" role="dialog" aria-modal="true" aria-label="Coach-Chat">
      <header className="chat-head"><div><span className="coach-eyebrow">Coach-Chat · über deinen AI-Zugang</span><h2>Coach fragen</h2></div>
        <div className="chat-head-actions"><button type="button" disabled={busy || sending || !messages?.length} onClick={newChat}>Neuer Chat</button>
          <button type="button" aria-label="Chat schließen" onClick={onClose}>✕</button></div></header>
      <div className="chat-messages" ref={list} aria-live="polite">
        {messages === null && <p className="coach-muted">Chat wird geladen …</p>}
        {messages?.length === 0 && <p className="coach-muted chat-empty">Frag den Coach oder sag ihm in eigenen Worten, was sich ändern soll, zum Beispiel „Morgen schaffe ich nur 45 Minuten“ oder „Bin ich auf Kurs?“. Änderungen zeigt er dir vorher als Karte.</p>}
        {(messages || []).map(message => <div key={message.id} className={`chat-message ${message.role}`}>
          {message.ref && <span className="chat-ref-tag">Über: {message.ref.label}</span>}
          <p>{message.text}</p>
          {message.change && <ChangeCard change={message.change} busy={busy || sending} onConfirm={() => decide(message.change, 'confirm')} onDiscard={() => decide(message.change, 'discard')} />}
        </div>)}
        {sending && <div className="chat-message coach"><p><span className="coach-spinner" />Der Coach denkt nach …</p></div>}
      </div>
      {error && <div role="alert" className="coach-message error">{error}</div>}
      <footer className="chat-foot">
        {!providerReady ? <div className="coach-message">Für den Chat brauchst du einen verbundenen AI-Provider. <button type="button" onClick={onProviderSettings}>Zu den Provider-Einstellungen</button></div> : <>
          {ref && <span className="chat-ref"><span>Über: {ref.label}</span><button type="button" aria-label="Bezug entfernen" onClick={() => setRef(null)}>✕</button></span>}
          <div className="chat-quick" role="group" aria-label="Schnellantworten">{quick.map(([label, text]) => <button type="button" key={label} disabled={sending}
            onClick={() => { setDraft(text); input.current?.focus(); }}>{label}</button>)}</div>
        </>}
        <form className="chat-input" onSubmit={event => { event.preventDefault(); send(draft); }}>
          <textarea ref={input} aria-label="Nachricht an den Coach" maxLength={1500} rows={2} value={draft} disabled={!providerReady || sending}
            placeholder={providerReady ? 'Schreib dem Coach …' : 'Erst den AI-Provider verbinden'} onChange={e => setDraft(e.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(draft); } }} />
          <button type="submit" className="coach-primary" disabled={!providerReady || sending || !draft.trim()}>Senden</button>
        </form>
      </footer>
    </section>
  </div>;
}
