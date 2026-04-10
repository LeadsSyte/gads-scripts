import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';

const FIELDS = [
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

export default function ClientModal({ initial, onClose }) {
  const [f, setF] = useState({ pages_per_month: 15, ...initial });
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

        <div className="grid-2">
          {FIELDS.map(([k, label, type]) => (
            <div key={k} style={type === 'textarea' ? { gridColumn: 'span 2' } : {}}>
              <label>{label}</label>
              {type === 'textarea' ? (
                <textarea value={f[k] || ''} onChange={e => update(k, e.target.value)} rows={3} />
              ) : (
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  value={f[k] || ''}
                  onChange={e => update(k, type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
                />
              )}
            </div>
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
