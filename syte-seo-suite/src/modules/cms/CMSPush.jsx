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
  const [msgFor, setMsgFor] = useState('general');

  const [form, setForm] = useState({});
  useEffect(() => { if (client) setForm(client); }, [client?.id]);

  async function refreshHistory() {
    if (!client) { setHistory([]); return; }
    try { setHistory(await listCmsQueue(client.id)); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { refreshHistory(); }, [client?.id]);

  // successMsg/scope let callers keep their own result visible — this used
  // to hardcode 'Saved.', which silently clobbered "connected as ..." so a
  // successful connection test looked like nothing had happened.
  async function saveConnector(patch = {}, successMsg = 'Saved.', scope = 'general') {
    if (!client) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const merged = { ...client, ...form, ...patch };
      try {
        await upsertClient(merged);
      } catch (e) {
        // publishing_profile arrives with a migration that may not have been
        // run on this database yet. Credentials and CMS type must stay
        // saveable regardless, so drop that one field and retry once.
        if (/publishing_profile/i.test(e?.message || '')) {
          const { publishing_profile, ...withoutProfile } = merged;
          await upsertClient(withoutProfile);
          await load();
          setMsgFor(scope);
          setMsg(successMsg + ' — note: per-client publishing settings were not saved (database migration still pending).');
          return;
        }
        throw e;
      }
      await load();
      setMsgFor(scope); setMsg(successMsg);
    } catch (e) { setMsgFor(scope); setErr(e.message); }
    finally { setBusy(false); }
  }

  // Results render next to the button that produced them; a message at the
  // bottom of a long page is a message nobody sees.
  function Status({ scope }) {
    if (msgFor !== scope) return null;
    if (err) return <div style={{ color: 'var(--red)', marginTop: 8, fontSize: 13 }}>✗ {err}</div>;
    if (msg) return <div style={{ color: 'var(--green)', marginTop: 8, fontSize: 13 }}>✓ {msg}</div>;
    return null;
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
      await saveConnector({}, 'Connected as "' + name + '" — credentials saved.', 'wp');
    } catch (e) {
      // Keep what was typed. A failed test is often transient (network,
      // a slow site), and losing the credentials means re-fetching an
      // Application Password that WordPress only ever shows once.
      try { await upsertClient({ ...client, ...form }); await load(); } catch { /* keep the original error */ }
      setMsgFor('wp');
      setErr(e.message + ' — your details were kept, try Test Connection again.');
    }
    finally { setBusy(false); }
  }
  async function handleTestShopify() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const name = await testShopify(form.shopify_store, form.shopify_token);
      await saveConnector({}, 'Connected to "' + name + '" — credentials saved.', 'shopify');
    } catch (e) {
      try { await upsertClient({ ...client, ...form }); await load(); } catch { /* keep the original error */ }
      setMsgFor('shopify');
      setErr(e.message + ' — your details were kept, try Test Connection again.');
    }
    finally { setBusy(false); }
  }

  const [blogs, setBlogs] = useState([]);
  const [health, setHealth] = useState(null);

  // Full readiness test: auth, post-type, create+delete a test draft, SEO
  // meta writability. Result is stored on the profile so batch selection
  // can filter to ready clients.
  async function handleHealthCheck() {
    setBusy(true); setErr(''); setMsg(''); setHealth(null);
    try {
      const { runHealthCheck } = await import('./healthCheck.js');
      const result = await runHealthCheck({ ...client, ...form });
      setHealth(result);
      const profile = getPublishingProfile(form);
      const stamped = { ...profile, publish_readiness: { ready: result.ready, checked_at: new Date().toISOString(), summary: result.checks.map(c => (c.ok ? 'ok' : 'FAIL') + ' ' + c.name) } };
      setForm(f => ({ ...f, publishing_profile: stamped }));
      await saveConnector({ publishing_profile: stamped }, 'Saved.', 'health');
      setMsgFor('health'); setErr('');
      setMsg(result.ready ? 'Client is READY for automated publishing.' : 'Not ready yet — see the failed checks above.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function handleLoadBlogs() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { listBlogs } = await import('./shopifyApi.js');
      const list = await listBlogs({ shopify_store: form.shopify_store, shopify_token: form.shopify_token });
      setBlogs(list);
      setMsg(list.length + ' blog(s) found — pick where articles should go.');
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

  // After a changes_requested draft has been fixed: put it back in review
  // and re-send the notification/approval email (fresh token; the old
  // client link stops working).
  async function resendForApproval(item) {
    setBusy(true); setErr('');
    try {
      await updateCmsQueueItem(item.id, { status: 'pushed' });
      await fetch('/.netlify/functions/notify-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: item.id })
      });
      await refreshHistory();
      setMsg('Sent back for approval.');
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
                <button onClick={() => saveConnector({}, 'Saved.', 'wp')} disabled={busy}>Save</button>
              </div>
              <Status scope="wp" />
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Site URL is the site root (https://example.co.za) — not the /wp-admin/ address.
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
                <button onClick={handleLoadBlogs} disabled={busy || !form.shopify_store || !form.shopify_token}>Load Blogs</button>
                <button onClick={() => saveConnector({}, 'Saved.', 'shopify')} disabled={busy}>Save</button>
              </div>
              <Status scope="shopify" />
              {blogs.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <label>Publish articles to blog</label>
                  <select
                    value={getPublishingProfile(form).shopify_blog_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, publishing_profile: { ...getPublishingProfile(f), shopify_blog_id: e.target.value ? Number(e.target.value) : null } }))}
                  >
                    <option value="">First blog on the store (default)</option>
                    {blogs.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </div>
              )}
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
                    <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                        <input type="checkbox" checked={profile.notifications_enabled}
                          onChange={e => setP('notifications_enabled', e.target.checked)} />
                        <strong>Send email notifications for this client</strong>
                      </label>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Off by default. While off, drafts are still created and can still be approved —
                      nobody is emailed about them.
                    </div>
                    <div className="grid-2" style={{ marginTop: 10, opacity: profile.notifications_enabled ? 1 : 0.45 }}>
                      <div>
                        <label>Who approves drafts?</label>
                        <select value={profile.approval_mode} onChange={e => setP('approval_mode', e.target.value)}>
                          <option value="internal">Team approves in the suite (default)</option>
                          <option value="client">Client approves by email</option>
                        </select>
                      </div>
                      {profile.approval_mode === 'client' ? (
                        <div>
                          <label>Client approval email</label>
                          <input type="email" placeholder="client@company.com"
                            value={profile.client_approval_email ?? ''}
                            onChange={e => setP('client_approval_email', e.target.value.trim() || null)} />
                          {!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.client_approval_email || '') && (
                            <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>
                              No valid email — approval emails can't be sent, drafts will wait forever.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <label>Notify on new draft (optional)</label>
                          <input type="email" placeholder="— suite default —"
                            value={profile.notify_email ?? ''}
                            onChange={e => setP('notify_email', e.target.value.trim() || null)} />
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                        <input type="checkbox" checked={profile.strip_leading_h1}
                          onChange={e => setP('strip_leading_h1', e.target.checked)} />
                        Strip article H1 into the post title (prevents double titles — leave on unless this theme needs it)
                      </label>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button onClick={() => saveConnector({}, 'Profile saved.', 'profile')} disabled={busy}>Save Profile</button>
                    </div>
                    <Status scope="profile" />
                  </>
                );
              })()}
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Publishing Health Check</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Full readiness test: auth, post access, create/delete a test draft, SEO fields.
                    Run after entering credentials — a client only joins a batch once this passes.
                  </div>
                </div>
                <button onClick={handleHealthCheck} disabled={busy || !form.cms_type || form.cms_type === 'Custom Site'}>
                  Run Health Check
                </button>
              </div>
              {health && (
                <div style={{ marginTop: 10 }}>
                  {health.checks.map((c, i) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: c.ok ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{c.ok ? '✓' : '✗'} {c.name}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {!health && getPublishingProfile(form).publish_readiness && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Last check: {getPublishingProfile(form).publish_readiness.ready ? '✓ ready' : '✗ not ready'}
                  {' · '}{new Date(getPublishingProfile(form).publish_readiness.checked_at).toLocaleString()}
                </div>
              )}
              <Status scope="health" />
            </div>

            <div className="card">
              <strong>Custom Site</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Custom sites receive a downloadable change package for manual implementation.
              </div>
            </div>

            <Status scope="general" />
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
                    {item.payload?.verification === 'verified' && (
                      <div style={{ color: 'var(--green)', fontSize: 11 }} title="We re-read the draft in the CMS and it looks right">
                        ✓ checked on the site
                      </div>
                    )}
                    {item.payload?.verification === 'failed' && (
                      <div style={{ color: 'var(--red)', fontSize: 11, fontWeight: 600 }}>
                        ✗ looks wrong on the site — read it before approving
                      </div>
                    )}
                    {Array.isArray(item.payload?.warnings) && item.payload.warnings.length > 0 && (
                      <details style={{ fontSize: 11, color: 'var(--orange, #e8a33d)' }}>
                        <summary style={{ cursor: 'pointer' }}>
                          ⚠ {item.payload.warnings.length} thing{item.payload.warnings.length > 1 ? 's' : ''} to check
                        </summary>
                        <ul style={{ margin: '4px 0 0 14px', padding: 0 }}>
                          {item.payload.warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
                        </ul>
                      </details>
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
                    {item.status === 'changes_requested' && (
                      <div style={{ marginTop: 4 }}>
                        {item.payload?.change_comment && (
                          <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', maxWidth: 220 }}>
                            "{item.payload.change_comment}"
                          </div>
                        )}
                        <button disabled={busy} onClick={() => resendForApproval(item)} style={{ marginTop: 4 }}
                          title="Puts the draft back in review and sends a fresh approval email">
                          Re-send for approval
                        </button>
                      </div>
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
