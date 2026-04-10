import React, { useState } from 'react';
import { loadSettings, saveSettings, engineStatus, estimateSweepCost } from '../lib/settings.js';
import { useClients } from '../store/useClients.js';

// Global Suite Settings modal. Holds external API keys for the AEO Snapshot
// module. Opened from the sidebar footer "Settings" button.
export default function SuiteSettingsModal({ onClose }) {
  const [form, setForm] = useState(loadSettings());
  const [saved, setSaved] = useState(false);
  const clients = useClients(s => s.clients);

  function update(k, v) {
    setForm(prev => ({ ...prev, [k]: v }));
    setSaved(false);
  }

  function save() {
    saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const status = {
    chatgpt:    !!form.openaiKey,
    perplexity: !!form.perplexityKey,
    gemini:     !!form.googleAiKey,
    claude:     true
  };

  const aeoClients = clients.filter(c => c.does_aeo !== false).length;
  const { responses, activeEngines, cost } = estimateSweepCost(aeoClients, 6);

  const row = (label, key, placeholder) => (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="password"
          value={form[key] || ''}
          placeholder={placeholder}
          onChange={e => update(key, e.target.value)}
        />
      </div>
    </div>
  );

  const statusDot = (ok) => (
    <span className="dot" style={{ background: ok ? 'var(--green)' : 'var(--red)', marginRight: 6 }} />
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Suite Settings</h2>
          <button onClick={onClose} className="ghost">Close</button>
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
            <span style={{ fontSize: 12 }}>{statusDot(status.chatgpt)}ChatGPT</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.perplexity)}Perplexity</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.gemini)}Gemini</span>
            <span style={{ fontSize: 12 }}>{statusDot(status.claude)}Claude (built-in)</span>
          </div>
        </div>

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

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 12 }}>Saved ✓</span>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}
