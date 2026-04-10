import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';

const BASE_FIELDS = [
  ['name',              'Client Name',        'input'],
  ['url',               'Website URL',        'input'],
  ['industry',          'Industry',           'input'],
  ['location',          'Location / Service Area', 'input'],
  ['org_name',          'Organization Name',  'input'],
  ['author',            'Default Author',     'input'],
  ['author_creds',      'Author Credentials', 'input'],
  ['voice',             'Brand Voice',        'textarea'],
  ['audience',          'Target Audience',    'textarea'],
  ['context',           'Brand Context',      'textarea'],
  ['internal_links',    'Internal Links (one per line)', 'textarea'],
  ['sitemap_url',       'Sitemap URL',        'input'],
  ['ga4_property_id',   'GA4 Property ID',    'input'],
  ['gsc_property',      'GSC Property',       'input'],
  ['wceo_project_id',   'WebCEO Project ID',  'input'],
  ['pages_per_month',   'Pages / month',      'number']
];

const REPORTING_FIELDS = [
  ['reporting_email',    'Reporting Email',    'input'],
  ['start_date',         'Start Date with Syte', 'date'],
  ['rankscale_url',      'Rankscale Share URL (optional)', 'input'],
  ['aeo_probe_queries',  'AEO Probe Queries (one per line)', 'textarea'],
  ['competitors',        'Key Competitors (comma separated)', 'textarea'],
  ['internal_notes',     'Internal Notes (never shown to client)', 'textarea']
];

const SERVICES = [
  ['does_technical', 'Technical SEO', 'var(--mod-technical)'],
  ['does_content',   'Content Engine', 'var(--mod-content)'],
  ['does_aeo',       'AEO Engine',     'var(--mod-aeo)'],
  ['does_reporting', 'Monthly Reporting', 'var(--mod-reports)']
];

function Field({ k, label, type, value, onChange }) {
  const wrapStyle = type === 'textarea' ? { gridColumn: 'span 2' } : {};
  return (
    <div style={wrapStyle}>
      <label>{label}</label>
      {type === 'textarea' ? (
        <textarea value={value || ''} onChange={e => onChange(k, e.target.value)} rows={3} />
      ) : type === 'date' ? (
        <input type="date" value={value || ''} onChange={e => onChange(k, e.target.value)} />
      ) : type === 'number' ? (
        <input type="number" value={value || ''} onChange={e => onChange(k, parseInt(e.target.value) || 0)} />
      ) : (
        <input type="text" value={value || ''} onChange={e => onChange(k, e.target.value)} />
      )}
    </div>
  );
}

export default function ClientModal({ initial, onClose }) {
  // Services default true for new clients.
  const [f, setF] = useState({
    pages_per_month: 15,
    does_technical: true,
    does_content: true,
    does_aeo: true,
    does_reporting: true,
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = useClients(s => s.save);
  const remove = useClients(s => s.remove);

  function update(k, v) { setF(prev => ({ ...prev, [k]: v })); }

  async function handleSave() {
    if (!f.name) { setErr('Name is required'); return; }
    setBusy(true); setErr('');
    try {
      await save(f);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!f.id) return;
    if (!confirm('Delete this client? This cannot be undone.')) return;
    setBusy(true);
    try {
      await remove(f.id);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{f.id ? 'Edit Client' : 'New Client'}</h2>
          <button onClick={onClose} className="ghost">Close</button>
        </div>

        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>
          Services
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {SERVICES.map(([k, label, color]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', margin: 0, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={f[k] !== false}
                onChange={e => update(k, e.target.checked)}
                style={{ width: 'auto', accentColor: color }}
              />
              <span style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </div>

        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '16px 0 8px' }}>
          Brand & Content
        </div>
        <div className="grid-2">
          {BASE_FIELDS.map(([k, label, type]) => (
            <Field key={k} k={k} label={label} type={type} value={f[k]} onChange={update} />
          ))}
        </div>

        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '20px 0 8px' }}>
          Reporting & AEO
        </div>
        <div className="grid-2">
          {REPORTING_FIELDS.map(([k, label, type]) => (
            <Field key={k} k={k} label={label} type={type} value={f[k]} onChange={update} />
          ))}
        </div>

        {err && <div style={{ color: 'var(--red)', marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'space-between' }}>
          <div>
            {f.id && <button onClick={handleDelete} disabled={busy} style={{ color: 'var(--red)' }}>Delete</button>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button onClick={handleSave} className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Client'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
