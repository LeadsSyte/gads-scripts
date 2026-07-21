import React, { useState } from 'react';
import { loadSettings, saveSettings, engineStatus, estimateSweepCost } from '../lib/settings.js';
import { useClients } from '../store/useClients.js';
import GoogleServerAccounts from './GoogleServerAccounts.jsx';

// Global Suite Settings modal. Holds external API keys for the AEO Snapshot
// module. Opened from the sidebar footer "Settings" button.
export default function SuiteSettingsModal({ onClose }) {
  const initial = loadSettings();
  const [form, setForm] = useState(initial);
  // What's ACTUALLY in localStorage — the only thing AEO runs read. The status
  // dots track THIS, not the input boxes, so a pasted-but-unsaved key can't show
  // green while runs silently skip the engine (the "only Claude showed up" bug).
  const [persisted, setPersisted] = useState(initial);
  const [saved, setSaved] = useState(false);
  // Per-field show/hide toggle. Keys stay password-masked by default
  // for shoulder-surfing protection but the operator can flip the eye
  // icon to verify what's actually saved (useful when debugging the
  // "millions of stars and I can't tell what's in there" case).
  const [shown, setShown] = useState({ openaiKey: false, perplexityKey: false, googleAiKey: false });
  const clients = useClients(s => s.clients);

  // Track unsaved-edit state so a stray backdrop click doesn't blow
  // away half-pasted keys. Click-away on a clean modal still closes.
  const isDirty =
    (form.openaiKey || '') !== (persisted.openaiKey || '') ||
    (form.perplexityKey || '') !== (persisted.perplexityKey || '') ||
    (form.googleAiKey || '') !== (persisted.googleAiKey || '');

  function tryClose() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    onClose();
  }

  function update(k, v) {
    setForm(prev => ({ ...prev, [k]: v }));
    setSaved(false);
  }

  function save() {
    // Trim whitespace before persisting — pasted keys often arrive with
    // a trailing newline or leading space that silently breaks the
    // request. We don't strip non-ASCII (the issues panel already flags
    // those visibly) so the operator sees the warning until they
    // re-copy from a clean source.
    const cleaned = {
      ...form,
      openaiKey:    (form.openaiKey || '').trim(),
      perplexityKey:(form.perplexityKey || '').trim(),
      googleAiKey:  (form.googleAiKey || '').trim(),
    };
    saveSettings(cleaned);
    setForm(cleaned);
    setPersisted(cleaned);   // dots now reflect what runs will actually use
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // Dots reflect the SAVED keys (what AEO runs read), not the input boxes.
  const status = {
    chatgpt:    !!persisted.openaiKey,
    perplexity: !!persisted.perplexityKey,
    gemini:     !!persisted.googleAiKey,
    claude:     true
  };
  // A field is "pending" when the box holds a key that hasn't been saved yet —
  // green dot would be a lie, so we warn and show it as not-yet-active.
  const pending = {
    openaiKey:    (form.openaiKey || '').trim() !== (persisted.openaiKey || ''),
    perplexityKey:(form.perplexityKey || '').trim() !== (persisted.perplexityKey || ''),
    googleAiKey:  (form.googleAiKey || '').trim() !== (persisted.googleAiKey || ''),
  };
  const hasUnsaved = pending.openaiKey || pending.perplexityKey || pending.googleAiKey;

  // Sniff for the most common copy-paste mistake — pasting an Anthropic
  // key into the OpenAI field. The two services use distinct prefixes
  // (sk-ant-…  vs  sk-proj-… or sk-…), so we can catch this before the
  // key burns 45 iterations of 401s in the next AEO probe. Same for
  // Perplexity (pplx-…) and Google AI (AIza…). All checks tolerate
  // empty / whitespace input (no nag on a half-pasted key).
  //
  // We also flag non-ASCII characters — autocorrected hyphens (em dash
  // U+2014), smart quotes, and NBSP all sneak in when copying from
  // Word / Notion / Slack and crash the proxy with a ByteString error
  // ("Cannot convert argument to a ByteString because the character at
  // index N has a value of …").
  const issues = [];
  const k = (s) => (s || '').trim();
  const nonAsciiIdx = (s) => [...s].findIndex(ch => ch.charCodeAt(0) > 255);
  function checkAscii(field, label) {
    const v = k(form[field]);
    if (!v) return;
    const idx = nonAsciiIdx(v);
    if (idx !== -1) {
      issues.push({
        field,
        message: `${label} contains a non-ASCII character at position ${idx} (char code ${v.charCodeAt(idx)}). This is usually an autocorrected hyphen (— instead of -) or a smart quote. Re-copy the key from the original source.`
      });
    }
  }
  if (k(form.openaiKey).startsWith('sk-ant-')) {
    issues.push({ field: 'openaiKey', message: 'This looks like an Anthropic key (sk-ant-…). The OpenAI field needs a key starting with sk-proj-… or sk-…' });
  }
  if (k(form.openaiKey) && !k(form.openaiKey).startsWith('sk-')) {
    issues.push({ field: 'openaiKey', message: 'OpenAI keys start with sk-…' });
  }
  if (k(form.perplexityKey) && !k(form.perplexityKey).startsWith('pplx-')) {
    issues.push({ field: 'perplexityKey', message: 'Perplexity keys start with pplx-…' });
  }
  if (k(form.googleAiKey) && !k(form.googleAiKey).startsWith('AIza')) {
    issues.push({ field: 'googleAiKey', message: 'Google AI Studio keys start with AIza…' });
  }
  checkAscii('openaiKey', 'OpenAI key');
  checkAscii('perplexityKey', 'Perplexity key');
  checkAscii('googleAiKey', 'Google AI key');

  const aeoClients = clients.filter(c => c.does_aeo !== false).length;
  const { responses, activeEngines, cost } = estimateSweepCost(aeoClients, 6);

  const row = (label, key, placeholder) => {
    const issue = issues.find(i => i.field === key);
    const value = form[key] || '';
    const isShown = shown[key];
    return (
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>{label}</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type={isShown ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            onChange={e => update(key, e.target.value)}
            className={isShown ? 'mono' : undefined}
            style={{ flex: 1, ...(issue ? { borderColor: 'var(--orange)' } : {}) }}
          />
          <button
            type="button"
            onClick={() => setShown(prev => ({ ...prev, [key]: !prev[key] }))}
            title={isShown ? 'Hide key' : 'Show key'}
            style={{ padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
          >
            {isShown ? 'Hide' : 'Show'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => update(key, '')}
              title="Clear key"
              style={{ padding: '6px 10px', fontSize: 11, color: 'var(--red)' }}
            >
              Clear
            </button>
          )}
        </div>
        {issue && (
          <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 4 }}>
            {issue.message}
          </div>
        )}
      </div>
    );
  };

  const statusDot = (ok) => (
    <span className="dot" style={{ background: ok ? 'var(--green)' : 'var(--red)', marginRight: 6 }} />
  );

  return (
    <div className="modal-backdrop" onClick={tryClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Suite Settings</h2>
          <button onClick={tryClose} className="ghost">Close</button>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <strong>AEO Snapshot — Engine Keys</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
            Keys stay on this device. Missing engines are skipped gracefully.
          </div>
          {row('OpenAI API Key (GPT-4o)', 'openaiKey', 'sk-proj-…')}
          {row('Perplexity API Key (Sonar)', 'perplexityKey', 'pplx-…')}
          {row('Google AI API Key (Gemini)', 'googleAiKey', 'AIza…')}

          <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12 }}>{statusDot(status.chatgpt)}ChatGPT{pending.openaiKey ? ' (unsaved)' : ''}</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.perplexity)}Perplexity{pending.perplexityKey ? ' (unsaved)' : ''}</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.gemini)}Gemini{pending.googleAiKey ? ' (unsaved)' : ''}</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.claude)}Claude (built-in)</span>
          </div>
          {hasUnsaved && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--orange)' }}>
              ⚠ You have unsaved key changes. A dot only turns green once you click <strong>Save Settings</strong> — until then AEO runs won't use that engine.
            </div>
          )}
        </div>

        <GoogleServerAccounts />

        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Cost Estimator</strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Full AEO sweep for <strong>{aeoClients}</strong> client{aeoClients === 1 ? '' : 's'}
            {' '}× ~6 probe queries × {activeEngines} active engines ≈
            {' '}<strong style={{ color: 'var(--green)' }}>${cost.toFixed(2)}</strong>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {responses} total model responses. Rankscale charges ~R10,000/month for comparable coverage.
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          {issues.length > 0 && (
            <span style={{ color: 'var(--orange)', fontSize: 11, flex: 1 }}>
              {issues.length} key{issues.length === 1 ? '' : 's'} look wrong — saving anyway will let you fix later, but probes will 401 until you correct.
            </span>
          )}
          {saved && <span style={{ color: 'var(--green)', fontSize: 12 }}>Saved ✓</span>}
          <button onClick={tryClose}>Cancel</button>
          <button className="primary" onClick={save}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}
