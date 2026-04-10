import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';

const BLANK = {
  name: '',
  url: '',
  industry: '',
  location: '',
  context: '',
  voice: '',
  audience: '',
  internal_links: '',
  ga4_property_id: '',
  gsc_property: '',
  wceo_project_id: '',
  sitemap_url: '',
  sitemap_raw: '',
  org_name: '',
  author: '',
  author_creds: '',
  pages_per_month: 15,
  cms_type: '',
  cms_detected: false,
  wp_url: '',
  wp_username: '',
  wp_app_password: '',
  shopify_store: '',
  shopify_token: '',
};

export default function ClientModal({ initial, onClose }) {
  const { save, remove } = useClients();
  const [form, setForm] = useState({ ...BLANK, ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => {
    const val = e?.target?.type === 'checkbox' ? e.target.checked : e?.target?.value;
    setForm((f) => ({ ...f, [k]: val }));
  };

  async function handleSave() {
    setBusy(true);
    setErr('');
    try {
      await save(form);
      onClose();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!form.id) return;
    if (!confirm(`Delete "${form.name}"?`)) return;
    setBusy(true);
    try {
      await remove(form.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="h1-title" style={{ fontSize: 24, marginBottom: 12 }}>
          {form.id ? 'Edit Client' : 'New Client'}
        </h2>

        <div className="grid-2">
          <div>
            <label>Name</label>
            <input value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label>URL</label>
            <input value={form.url || ''} onChange={set('url')} placeholder="https://example.com" />
          </div>
          <div>
            <label>Industry</label>
            <input value={form.industry || ''} onChange={set('industry')} />
          </div>
          <div>
            <label>Location</label>
            <input value={form.location || ''} onChange={set('location')} />
          </div>
          <div>
            <label>Organization Name</label>
            <input value={form.org_name || ''} onChange={set('org_name')} />
          </div>
          <div>
            <label>Author</label>
            <input value={form.author || ''} onChange={set('author')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Author Credentials (E-E-A-T)</label>
            <input value={form.author_creds || ''} onChange={set('author_creds')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Brand Context / Brief</label>
            <textarea value={form.context || ''} onChange={set('context')} />
          </div>
          <div>
            <label>Voice / Tone</label>
            <input value={form.voice || ''} onChange={set('voice')} />
          </div>
          <div>
            <label>Audience</label>
            <input value={form.audience || ''} onChange={set('audience')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Internal Link List (one per line)</label>
            <textarea value={form.internal_links || ''} onChange={set('internal_links')} />
          </div>

          <div>
            <label>GA4 Property ID</label>
            <input value={form.ga4_property_id || ''} onChange={set('ga4_property_id')} />
          </div>
          <div>
            <label>GSC Property</label>
            <input value={form.gsc_property || ''} onChange={set('gsc_property')} />
          </div>
          <div>
            <label>WebCEO Project ID</label>
            <input value={form.wceo_project_id || ''} onChange={set('wceo_project_id')} />
          </div>
          <div>
            <label>Sitemap URL</label>
            <input value={form.sitemap_url || ''} onChange={set('sitemap_url')} />
          </div>

          <div>
            <label>Pages / Month</label>
            <input
              type="number"
              value={form.pages_per_month || 15}
              onChange={set('pages_per_month')}
            />
          </div>
          <div>
            <label>CMS Type</label>
            <select value={form.cms_type || ''} onChange={set('cms_type')}>
              <option value="">— auto —</option>
              <option value="wordpress">WordPress</option>
              <option value="shopify">Shopify</option>
              <option value="custom">Custom Site</option>
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              WordPress
            </div>
          </div>
          <div>
            <label>WP URL</label>
            <input value={form.wp_url || ''} onChange={set('wp_url')} />
          </div>
          <div>
            <label>WP Username</label>
            <input value={form.wp_username || ''} onChange={set('wp_username')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>WP Application Password</label>
            <input type="password" value={form.wp_app_password || ''} onChange={set('wp_app_password')} />
          </div>

          <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Shopify
            </div>
          </div>
          <div>
            <label>Shopify Store</label>
            <input value={form.shopify_store || ''} onChange={set('shopify_store')} placeholder="mystore.myshopify.com" />
          </div>
          <div>
            <label>Shopify Admin Token</label>
            <input type="password" value={form.shopify_token || ''} onChange={set('shopify_token')} />
          </div>
        </div>

        {err && (
          <div className="badge red" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          {form.id && (
            <button onClick={handleDelete} disabled={busy} style={{ marginRight: 'auto', color: 'var(--red)' }}>
              Delete
            </button>
          )}
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={handleSave} disabled={busy || !form.name}>
            {busy ? 'Saving...' : 'Save Client'}
          </button>
        </div>
      </div>
    </div>
  );
}
