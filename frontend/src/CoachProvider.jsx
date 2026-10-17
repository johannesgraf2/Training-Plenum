import React, { useState } from 'react';

export const MODEL_PRESETS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'];
const REASONING_LEVELS = [['', 'Standard des Modells'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']];
// Rough costs per model from docs/coach-umsetzung.md: creating a plan, then a typical month.
const COSTS = {
  'gpt-6-astra': ['ca. 2 $', 'ca. 6–8 $'],
  'gpt-6.1-sol': ['ca. 0,40 $', 'ca. 1–1,50 $'],
  'gpt-6-luna': ['ca. 0,02 $', 'ca. 0,10 $'],
};

export function costEstimate(model) {
  const cost = COSTS[model];
  return cost ? `Grobe Kosten über deinen Zugang: Plan erstellen ${cost[0]}, danach ${cost[1]} im Monat (${model}).` : null;
}

function Field({ label, children, hint }) {
  return <label className="coach-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function KeyNotice({ provider }) {
  const { encryptionKeySource: source, encryptionKeyFile: file } = provider;
  if (!provider.encryptionConfigured) {
    const reason = source === 'invalid' ? `Die Schlüsseldatei ${file} enthält keinen gültigen Schlüssel. TrainHub überschreibt sie nicht, damit kein vorhandener Schlüssel verloren geht.`
      : source === 'unavailable' ? `TrainHub konnte die Schlüsseldatei ${file} nicht anlegen oder lesen.` : 'Dem Server fehlt der Schlüssel, mit dem API-Keys verschlüsselt werden.';
    return <div className="coach-message" role="note"><div><strong>API-Keys lassen sich gerade nicht speichern.</strong> {reason} Normalerweise legt TrainHub diesen Schlüssel beim ersten Start selbst an. Wie du das behebst, steht in AI-COACH.md unter „Einrichtung und erster Plan“.</div></div>;
  }
  return <p className="coach-muted coach-key-note">Dein API-Key wird verschlüsselt gespeichert. {source === 'environment' ? 'Den Schlüssel dafür liefert die Umgebungsvariable TRAINHUB_AI_ENCRYPTION_KEY.'
    : <>Der Schlüssel dafür liegt in <code>{file}</code>{source === 'created' ? ' und wurde beim letzten Start angelegt' : ''}. Sichere diese Datei getrennt von der Datenbank. Geht sie verloren, gibst du den API-Key einfach neu ein; deine Trainingsdaten brauchen sie nicht.</>}</p>;
}

// Provider, model, reasoning and key; used by the provider tab and onboarding step A4.
// request and run come from the host, which shows busy states and errors; children go below the buttons.
export function ProviderForm({ provider, disabled, request, run, onSaved, onRemoved, onEdit, onTested, dirty, showCost, children }) {
  const [model, setModel] = useState(provider.model || 'gpt-4.1-mini');
  const [customModel, setCustomModel] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState(provider.reasoningEffort || '');
  const [apiKey, setApiKey] = useState('');
  const custom = customModel || !MODEL_PRESETS.includes(model);
  const cost = showCost && costEstimate(model.trim());
  const edit = () => onEdit?.();
  const save = event => {
    event.preventDefault();
    const key = apiKey.trim();
    setApiKey('');
    run('Provider wird gespeichert …', async () => {
      const saved = await request('/api/ai-provider', 'PUT', { provider: 'openai', model: model.trim(), reasoningEffort: reasoningEffort || null, ...(key ? { apiKey: key } : {}) });
      setModel(saved.model || model); setReasoningEffort(saved.reasoningEffort || '');
      onSaved(saved);
    });
  };
  return <form onSubmit={save}>
    <fieldset disabled={disabled}><div className="coach-form-grid"><Field label="Provider"><select value="openai" disabled><option value="openai">OpenAI</option></select></Field><Field label="Modell"><select value={custom ? 'custom' : model} onChange={e => { edit(); const chosen = e.target.value === 'custom'; setCustomModel(chosen); if (!chosen) setModel(e.target.value); }}>{MODEL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}<option value="custom">Anderes Modell …</option></select></Field>{custom && <Field label="Modell-ID" hint="Beliebige OpenAI-Modell-ID mit Unterstützung für strukturierte Responses."><input required spellCheck="false" value={model} onChange={e => { edit(); setModel(e.target.value); }} /></Field>}<Field label="Reasoning" hint="Nur für Reasoning-Modelle. Höhere Stufen denken länger und kosten mehr."><select value={reasoningEffort} onChange={e => { edit(); setReasoningEffort(e.target.value); }}>{REASONING_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
      {cost && <p className="coach-muted coach-cost">{cost} Mit gpt-6-astra etwa fünfmal so viel wie mit gpt-6.1-sol, mit gpt-6-luna fast nichts.</p>}
      <Field label={provider.configured ? `API Key ersetzen (gespeichert: ••••${provider.keyLast4 || ''})` : 'API Key'} hint="Das Feld wird nach dem Absenden geleert. Der Key bleibt nur verschlüsselt im Backend."><input type="password" autoComplete="new-password" spellCheck="false" value={apiKey} placeholder={provider.configured ? 'Leer lassen, um den vorhandenen Key zu behalten' : 'API Key eingeben'} onChange={e => { edit(); setApiKey(e.target.value); }} /></Field>
      <div className="coach-actions"><button className="coach-primary" type="submit" disabled={!provider.encryptionConfigured}>Provider speichern</button><button type="button" disabled={!provider.configured || dirty} onClick={() => run('Verbindung wird geprüft …', async () => { await request('/api/ai-provider/test', 'POST', {}); onTested(); })}>Verbindung testen</button>{provider.configured && <button type="button" className="coach-danger" onClick={() => run('Key wird entfernt …', async () => { const saved = await request('/api/ai-provider', 'DELETE'); setApiKey(''); onRemoved(saved); })}>Gespeicherten Key entfernen</button>}</div>
      {children}
    </fieldset>
  </form>;
}
