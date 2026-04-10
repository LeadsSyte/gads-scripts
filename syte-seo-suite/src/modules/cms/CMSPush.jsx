import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { fetchCmsQueue, updateCmsQueueItem } from '../../lib/supabase.js';
import { detectCms } from './detector.js';
import { testWpConnection, pushToWordPress } from './wordpress.js';
import { testShopifyConnection, pushToShopify } from './shopify.js';
import { buildCustomPackage } from './customSite.js';

const ACCENT = '#4dabff';

const STATUS_BADGE = {
  pending: '',
  pushed: 'green',
  failed: 'red',
  skipped: 'orange',
};

function Connector({ client }) {
  const { save } = useClients();
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);
  const [form, setForm] = useState({
    cms_type: client?.cms_type || '',
    wp_url: client?.wp_url || '',
    wp_username: client?.wp_username || '',
    wp_app_password: client?.wp_app_password || '',
    shopify_store: client?.shopify_store || '',
    shopify_token: client?.shopify_token || '',
  });
  const [wpStatus, setWpStatus] = useState('');
  const [shopifyStatus, setShopifyStatus] = useState('');

  useEffect(() => {
    setForm({
      cms_type: client?.cms_type || '',
      wp_url: client?.wp_url || '',
      wp_username: client?.wp_username || '',
      wp_app_password: client?.wp_app_password || '',
      shopify_store: client?.shopify_store || '',
      shopify_token: client?.shopify_token || '',
    });
    setDetected(null);
    setWpStatus('');
    setShopifyStatus('');
  }, [client?.id]);

  if (!client) return <div className="muted">Select a client.</div>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function doDetect() {
    setDetecting(true);
    try {
      const result = await detectCms(client.url);
      setDetected(result);
      const patch = { cms_type: result.type, cms_detected: true };
      setForm((f) => ({ ...f, cms_type: result.type }));
      await save({ ...client, ...patch });
    } catch (e) {
      setDetected({ type: 'unknown', error: e.message });
    } finally {
      setDetecting(false);
    }
  }

  async function saveWp() {
    await save({ ...client, ...form });
    setWpStatus('Saved.');
  }

  async function testWp() {
    try {
      await save({ ...client, ...form });
      const name = await testWpConnection({ ...client, ...form });
      setWpStatus(`Connected as ${name}`);
    } catch (e) {
      setWpStatus(`Error: ${e.message}`);
    }
  }

  async function testShopify() {
    try {
      await save({ ...client, ...form });
      const name = await testShopifyConnection({ ...client, ...form });
      setShopifyStatus(`Connected to ${name}`);
    } catch (e) {
      setShopifyStatus(`Error: ${e.message}`);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Auto-detect CMS</div>
            <div className="muted" style={{ fontSize: 12 }}>{client.url || '(no URL)'}</div>
          </div>
          <button onClick={doDetect} disabled={detecting}>
            {detecting ? 'Detecting…' : 'Detect CMS'}
          </button>
        </div>
        {detected && (
          <div>
            <span className="badge blue">Detected: {detected.type}</span>
            {detected.via && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>via {detected.via}</span>}
          </div>
        )}
        <div>
          <label>Manual override</label>
          <select value={form.cms_type} onChange={set('cms_type')}>
            <option value="">— none —</option>
            <option value="wordpress">WordPress</option>
            <option value="shopify">Shopify</option>
            <option value="custom">Custom Site</option>
          </select>
        </div>
      </div>

      {(form.cms_type === 'wordpress' || form.cms_type === '') && (
        <div className="card stack">
          <div style={{ fontWeight: 600 }}>WordPress Connection</div>
          <div className="grid-2">
            <div>
              <label>WP Site URL</label>
              <input value={form.wp_url} onChange={set('wp_url')} placeholder="https://example.com" />
            </div>
            <div>
              <label>Username</label>
              <input value={form.wp_username} onChange={set('wp_username')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Application Password</label>
              <input type="password" value={form.wp_app_password} onChange={set('wp_app_password')} />
            </div>
          </div>
          <div className="row">
            <button onClick={saveWp}>Save</button>
            <button onClick={testWp}>Test Connection</button>
            {wpStatus && <span className="muted">{wpStatus}</span>}
          </div>
        </div>
      )}

      {(form.cms_type === 'shopify' || form.cms_type === '') && (
        <div className="card stack">
          <div style={{ fontWeight: 600 }}>Shopify Connection</div>
          <div className="grid-2">
            <div>
              <label>Store URL</label>
              <input value={form.shopify_store} onChange={set('shopify_store')} placeholder="mystore.myshopify.com" />
            </div>
            <div>
              <label>Admin API Token</label>
              <input type="password" value={form.shopify_token} onChange={set('shopify_token')} />
            </div>
          </div>
          <div className="row">
            <button onClick={saveWp}>Save</button>
            <button onClick={testShopify}>Test Connection</button>
            {shopifyStatus && <span className="muted">{shopifyStatus}</span>}
          </div>
        </div>
      )}

      {form.cms_type === 'custom' && (
        <div className="card">
          <div className="muted">
            Custom sites receive a downloadable change package for manual implementation.
          </div>
        </div>
      )}
    </div>
  );
}

function Queue({ client }) {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [preview, setPreview] = useState(null);

  async function load() {
    if (!client) return setItems([]);
    setItems(await fetchCmsQueue(client.id));
  }
  useEffect(() => {
    load();
  }, [client?.id]);

  async function pushOne(item) {
    setBusyId(item.id);
    try {
      let result;
      if (client.cms_type === 'wordpress') {
        result = await pushToWordPress(client, item);
      } else if (client.cms_type === 'shopify') {
        result = await pushToShopify(client, item);
      } else {
        await buildCustomPackage(client, [item]);
        result = { admin_url: null };
      }
      await updateCmsQueueItem(item.id, {
        status: 'pushed',
        pushed_at: new Date().toISOString(),
        payload: { ...(item.payload || {}), admin_url: result.admin_url },
      });
      if (result.admin_url) {
        if (confirm(`Pushed as draft. Open in admin?\n\n${result.admin_url}`)) {
          window.open(result.admin_url, '_blank');
        }
      } else {
        alert('Pushed. Check your downloads for the package.');
      }
    } catch (e) {
      await updateCmsQueueItem(item.id, { status: 'failed', error_msg: e.message });
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function pushAllCustom() {
    if (client.cms_type !== 'custom') return;
    const pending = items.filter((i) => i.status === 'pending');
    if (!pending.length) return;
    await buildCustomPackage(client, pending);
    for (const p of pending) {
      await updateCmsQueueItem(p.id, {
        status: 'pushed',
        pushed_at: new Date().toISOString(),
      });
    }
    load();
  }

  async function skip(item) {
    await updateCmsQueueItem(item.id, { status: 'skipped' });
    load();
  }

  if (!client) return <div className="muted">Select a client.</div>;

  return (
    <div className="stack">
      <div className="row">
        <div className="muted">
          {items.length} items queued · CMS: {client.cms_type || 'unknown'}
        </div>
        {client.cms_type === 'custom' && (
          <button onClick={pushAllCustom} style={{ marginLeft: 'auto' }}>
            Download Full Package
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Change Type</th>
              <th>Source</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan="5" className="muted" style={{ padding: 20 }}>
                  No items in queue.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div>{item.page_title}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{item.page_url}</div>
                </td>
                <td>
                  <span className="badge">{item.change_type}</span>
                </td>
                <td>
                  <span className="badge">{item.module}</span>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[item.status] || ''}`}>{item.status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {item.status === 'pending' && (
                    <>
                      <button onClick={() => pushOne(item)} disabled={busyId === item.id}>
                        {busyId === item.id ? 'Pushing…' : 'Push Now'}
                      </button>
                      <button onClick={() => setPreview(item)} style={{ marginLeft: 4 }}>
                        Preview
                      </button>
                      <button onClick={() => skip(item)} style={{ marginLeft: 4 }}>
                        Skip
                      </button>
                    </>
                  )}
                  {item.status === 'pushed' && item.payload?.admin_url && (
                    <a href={item.payload.admin_url} target="_blank" rel="noreferrer">
                      Open in admin →
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="h1-title" style={{ fontSize: 22 }}>Preview</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              {preview.page_url}
            </div>
            <pre className="output">{JSON.stringify(preview.payload, null, 2)}</pre>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function History({ client }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    (async () => {
      if (!client) return setItems([]);
      const all = await fetchCmsQueue(client.id);
      setItems(all.filter((i) => i.status === 'pushed'));
    })();
  }, [client?.id]);

  if (!client) return <div className="muted">Select a client.</div>;
  if (!items.length) return <div className="muted">No pushes yet.</div>;

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Page</th>
            <th>Type</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.pushed_at ? new Date(i.pushed_at).toLocaleString() : '—'}</td>
              <td>{i.page_title}<div className="muted" style={{ fontSize: 11 }}>{i.page_url}</div></td>
              <td><span className="badge">{i.change_type}</span></td>
              <td><span className="badge green">{i.status}</span></td>
              <td>
                {i.payload?.admin_url && (
                  <a href={i.payload.admin_url} target="_blank" rel="noreferrer">
                    Admin →
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CMSPush({ tab }) {
  const { getSelected } = useClients();
  const client = getSelected();
  return (
    <div>
      <h1 className="h1-title">CMS Push</h1>
      <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        {client ? client.name : 'Select a client.'} · Draft-only. Never auto-publishes.
      </div>
      {tab === 'Connector' && <Connector client={client} />}
      {tab === 'Push Queue' && <Queue client={client} />}
      {tab === 'Push History' && <History client={client} />}
    </div>
  );
}
