import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { listCmsQueue, updateCmsQueueItem, upsertClient } from '../../lib/supabase.js';
import { detectCms, testWordPress, testShopify } from './cmsDetect.js';
import { getPublishingProfile } from './publishingProfile.js';

const ACCENT = '#4dabff';

function statusBadge(s) {
  const map = {
    pending: 'orange',
    pushed: 'blue',            // draft created, awaiting review
    approved: 'orange',        // green-lit, publisher picks it up within 15 min
    published: 'green',
    publish_failed: 'red',
    changes_requested: 'orange',
    failed: 'red',
    skipped: ''
  };
  const label = s === 'pushed' ? 'awaiting review' : s;
  return <span className={'badge ' + (map[s] || '')}>{label}</span>;
}

// CMS module, post-refactor: this is now just the connector config + a
// read-only push history. The actual "Push Now" action lives inline on
// each generated output in Content Engine, Technical SEO, and AEO Engine
// via <PushToCmsButton />.
export default function CMSPush({ sub }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [form, setForm] = useState({});
  useEffect(() => { if (client) setForm(client); }, [client?.id]);

  async function refreshHistory() {
    if (!client) { setHistory([]); return; }
    try { setHistory(await listCmsQueue(client.id)); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { refreshHistory(); }, [client?.id]);

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

  // Review actions: 'pushed' (awaiting review) → approved | changes_requested.
  // The publish-approved scheduled function flips approved rows live.
  async function setReviewStatus(item, status) {
    setBusy(true); setErr('');
    try {
      await updateCmsQueueItem(item.id, { status });
      await refreshHistory();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // -------- Subviews --------
  if (sub === 'Connector') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>CMS Connector</h2>
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Connect this client's CMS here, then push content directly from Content Engine,
          Technical SEO, or AEO Engine using the inline <em>Push to CMS</em> button.
        </div>
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

            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Publishing Profile</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                How this client's blog expects content to arrive. Defaults work for most sites —
                only change what the pilot review shows is off.
              </div>
              {(() => {
                const profile = getPublishingProfile(form);
                const setP = (k, v) => setForm(f => ({ ...f, publishing_profile: { ...getPublishingProfile(f), [k]: v } }));
                return (
                  <>
                    <div className="grid-2" style={{ marginTop: 10 }}>
                      <div>
                        <label>Hero image placement</label>
                        <select value={profile.hero_mode} onChange={e => setP('hero_mode', e.target.value)}>
                          <option value="featured-only">Featured image only (default)</option>
                          <option value="inline-only">Inline at top of body</option>
                          <option value="both">Featured + inline</option>
                          <option value="none">No image for this client</option>
                        </select>
                      </div>
                      <div>
                        <label>Post type (REST base)</label>
                        <input placeholder="posts" value={profile.post_type_rest_base}
                          onChange={e => setP('post_type_rest_base', e.target.value.trim() || 'posts')} />
                      </div>
                      <div>
                        <label>Default category ID (WP)</label>
                        <input placeholder="— WP default —" value={profile.default_category_id ?? ''}
                          onChange={e => setP('default_category_id', e.target.value ? Number(e.target.value) : null)} />
                      </div>
                      <div>
                        <label>Default author ID (WP)</label>
                        <input placeholder="— API user —" value={profile.default_author_id ?? ''}
                          onChange={e => setP('default_author_id', e.target.value ? Number(e.target.value) : null)} />
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                        <input type="checkbox" checked={profile.strip_leading_h1}
                          onChange={e => setP('strip_leading_h1', e.target.checked)} />
                        Strip article H1 into the post title (prevents double titles — leave on unless this theme needs it)
                      </label>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button onClick={() => saveConnector()} disabled={busy}>Save Profile</button>
                    </div>
                  </>
                );
              })()}
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

  if (sub === 'Push History') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Push History</h2>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Every inline push from Content Engine, Technical SEO, and AEO Engine is logged here.
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>Date</th><th>Module</th><th>Page</th><th>Type</th><th>Status</th><th>Review</th></tr>
            </thead>
            <tbody>
              {history.map(item => (
                <tr key={item.id}>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {item.pushed_at ? new Date(item.pushed_at).toLocaleString() : new Date(item.created_at).toLocaleString()}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{item.module}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ fontWeight: 600 }}>{item.page_title}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{item.page_url}</div>
                  </td>
                  <td><span className="badge">{item.change_type}</span></td>
                  <td>{statusBadge(item.status)}</td>
                  <td>
                    {item.payload?.admin_url && (
                      <a href={item.payload.admin_url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>Admin →</a>
                    )}
                    {Array.isArray(item.payload?.warnings) && item.payload.warnings.length > 0 && (
                      <div style={{ color: 'var(--orange, #e8a33d)', fontSize: 11 }} title={item.payload.warnings.join('\n')}>
                        ⚠ {item.payload.warnings.length} warning{item.payload.warnings.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {item.status === 'pushed' && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <button disabled={busy} onClick={() => setReviewStatus(item, 'approved')}
                          title="Green-light: the auto-publisher takes it live within 15 minutes">
                          Approve
                        </button>
                        <button className="ghost" disabled={busy} onClick={() => setReviewStatus(item, 'changes_requested')}>
                          Request changes
                        </button>
                      </div>
                    )}
                    {item.status === 'approved' && (
                      <div className="muted" style={{ fontSize: 11 }}>publishing within 15 min…</div>
                    )}
                    {item.status === 'published' && item.payload?.live_url && (
                      <a href={item.payload.live_url} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>Live →</a>
                    )}
                    {(item.status === 'failed' || item.status === 'publish_failed') && item.error_msg && (
                      <span className="muted" style={{ fontSize: 11 }}>{item.error_msg}</span>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No pushes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}
