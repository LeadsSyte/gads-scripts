import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { listCmsQueue, updateCmsQueueItem, upsertClient } from '../../lib/supabase.js';
import { detectCms, testWordPress, testShopify } from './cmsDetect.js';
import { pushToWordPress } from './wordpressPush.js';
import { pushToShopify } from './shopifyPush.js';
import { buildAndDownloadZip } from './customZip.js';

const ACCENT = '#4dabff';

function statusBadge(s) {
  const map = { pending: 'orange', pushed: 'green', failed: 'red', skipped: '' };
  return <span className={'badge ' + (map[s] || '')}>{s}</span>;
}

export default function CMSPush({ sub }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Connector form state (driven by selected client)
  const [form, setForm] = useState({});
  useEffect(() => {
    if (client) setForm(client);
  }, [client?.id]);

  async function refreshQueue() {
    if (!client) { setQueue([]); return; }
    try { setQueue(await listCmsQueue(client.id)); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { refreshQueue(); }, [client?.id]);

  async function saveConnector(patch = {}) {
    if (!client) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const merged = { ...client, ...form, ...patch };
      await upsertClient(merged);
      await load();
      setMsg('Saved.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handleDetect() {
    if (!client) return;
    setBusy(true); setErr(''); setMsg('Detecting…');
    try {
      const cms = await detectCms(client.url);
      setForm(f => ({ ...f, cms_type: cms, cms_detected: true }));
      await saveConnector({ cms_type: cms, cms_detected: true });
      setMsg('Detected: ' + cms);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handleTestWp() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const name = await testWordPress(form.wp_url, form.wp_username, form.wp_app_password);
      setMsg('WordPress connected as: ' + name);
      await saveConnector();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function handleTestShopify() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const name = await testShopify(form.shopify_store, form.shopify_token);
      setMsg('Shopify connected to: ' + name);
      await saveConnector();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handlePush(item) {
    if (!client) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      let result;
      if (client.cms_type === 'WordPress') result = await pushToWordPress(client, item);
      else if (client.cms_type === 'Shopify') result = await pushToShopify(client, item);
      else {
        await buildAndDownloadZip(client, [item]);
        result = { ok: true, admin_url: '' };
      }
      await updateCmsQueueItem(item.id, {
        status: 'pushed',
        pushed_at: new Date().toISOString(),
        payload: { ...(item.payload || {}), admin_url: result.admin_url }
      });
      setMsg('Pushed. ' + (result.admin_url ? 'Review: ' + result.admin_url : 'Downloaded package.'));
      await refreshQueue();
    } catch (e) {
      await updateCmsQueueItem(item.id, { status: 'failed', error_msg: e.message });
      setErr(e.message);
      await refreshQueue();
    } finally { setBusy(false); }
  }

  async function handleSkip(item) {
    await updateCmsQueueItem(item.id, { status: 'skipped' });
    await refreshQueue();
  }

  async function handleDownloadAll() {
    if (!client) return;
    const pending = queue.filter(i => i.status === 'pending');
    if (!pending.length) { setMsg('Nothing pending.'); return; }
    await buildAndDownloadZip(client, pending);
    for (const p of pending) {
      await updateCmsQueueItem(p.id, { status: 'pushed', pushed_at: new Date().toISOString() });
    }
    await refreshQueue();
  }

  // -------- Subviews --------
  if (sub === 'CMS Connector') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>CMS Connector</h2>
        {!client && <div className="muted">Select a client first.</div>}
        {client && (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>Auto-detect CMS</strong>
                  <div className="muted" style={{ fontSize: 12 }}>Site: {client.url || '—'}</div>
                </div>
                <div className="row">
                  {form.cms_type && <span className="badge blue">{form.cms_type}</span>}
                  <button onClick={handleDetect} disabled={busy || !client.url}>Detect CMS</button>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>Manual override</label>
                <select
                  value={form.cms_type || ''}
                  onChange={e => setForm(f => ({ ...f, cms_type: e.target.value }))}
                  onBlur={() => saveConnector()}
                >
                  <option value="">—</option>
                  <option>WordPress</option>
                  <option>Shopify</option>
                  <option>Custom Site</option>
                </select>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <strong>WordPress Connection</strong>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div><label>WP Site URL</label><input value={form.wp_url || ''} onChange={e => setForm(f => ({ ...f, wp_url: e.target.value }))} /></div>
                <div><label>Username</label><input value={form.wp_username || ''} onChange={e => setForm(f => ({ ...f, wp_username: e.target.value }))} /></div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label>Application Password</label>
                  <input type="password" value={form.wp_app_password || ''} onChange={e => setForm(f => ({ ...f, wp_app_password: e.target.value }))} />
                </div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={handleTestWp} disabled={busy}>Test Connection</button>
                <button onClick={() => saveConnector()} disabled={busy}>Save</button>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Shopify Connection</strong>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div><label>Store URL</label><input placeholder="mystore.myshopify.com" value={form.shopify_store || ''} onChange={e => setForm(f => ({ ...f, shopify_store: e.target.value }))} /></div>
                <div><label>Admin API Token</label><input type="password" value={form.shopify_token || ''} onChange={e => setForm(f => ({ ...f, shopify_token: e.target.value }))} /></div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={handleTestShopify} disabled={busy}>Test Connection</button>
                <button onClick={() => saveConnector()} disabled={busy}>Save</button>
              </div>
            </div>

            <div className="card">
              <strong>Custom Site</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Custom sites receive a downloadable change package for manual implementation.
              </div>
            </div>

            {msg && <div style={{ color: 'var(--green)', marginTop: 10 }}>{msg}</div>}
            {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
          </>
        )}
      </div>
    );
  }

  if (sub === 'Push Queue') {
    const pending = queue.filter(i => i.status === 'pending');
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Push Queue</h2>
          <div className="row">
            <span className="muted">{pending.length} pending</span>
            {client?.cms_type === 'Custom Site' && (
              <button onClick={handleDownloadAll} disabled={!pending.length}>Download Full Package</button>
            )}
          </div>
        </div>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Change Type</th>
                <th>Module</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(item => (
                <tr key={item.id}>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ fontWeight: 600 }}>{item.page_title}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{item.page_url}</div>
                  </td>
                  <td><span className="badge">{item.change_type}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{item.module}</td>
                  <td>{statusBadge(item.status)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {item.status === 'pending' && (
                        <>
                          <button onClick={() => handlePush(item)} disabled={busy} style={{ borderColor: ACCENT, color: ACCENT }}>Push Now</button>
                          <button onClick={() => alert(JSON.stringify(item.payload, null, 2))}>Preview</button>
                          <button onClick={() => handleSkip(item)}>Skip</button>
                        </>
                      )}
                      {item.payload?.admin_url && (
                        <a href={item.payload.admin_url} target="_blank" rel="noreferrer" style={{ color: ACCENT, fontSize: 12 }}>Review →</a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>Queue is empty for this client.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {msg && <div style={{ color: 'var(--green)', marginTop: 10 }}>{msg}</div>}
        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  if (sub === 'Push History') {
    const done = queue.filter(i => i.status !== 'pending');
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Push History</h2>
        <div className="card">
          <table>
            <thead>
              <tr><th>Date</th><th>Page</th><th>Type</th><th>Status</th><th>Review</th></tr>
            </thead>
            <tbody>
              {done.map(item => (
                <tr key={item.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{item.pushed_at ? new Date(item.pushed_at).toLocaleString() : '—'}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.page_title}</td>
                  <td><span className="badge">{item.change_type}</span></td>
                  <td>{statusBadge(item.status)}</td>
                  <td>
                    {item.payload?.admin_url && (
                      <a href={item.payload.admin_url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>Admin →</a>
                    )}
                  </td>
                </tr>
              ))}
              {done.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>No pushes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}
