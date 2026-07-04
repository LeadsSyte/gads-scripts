import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { logImplementation, updateImplementation } from '../lib/supabase.js';
import { verifyImplementation, verifyImplementationFromHtml, verifyImplementationVisually, isOffPageTask } from '../lib/verification.js';

// Reusable "Mark as Implemented" button. Place it next to any generated
// output (article, schema, meta fix, AEO optimization). When clicked:
//   1. Asks who implemented it (free text, defaults to current user name).
//   2. Logs it to syte_suite_implementations with status='pending'.
//   3. Immediately runs the AI verification scanner on the page URL.
//   4. Shows verified ✓ / failed ✗ with Claude's explanation inline.
//
// Props:
//   module:      'content' | 'aeo' | 'technical'
//   changeType:  'article' | 'schema' | 'meta' | 'fix' | 'aeo_optimization'
//   pageUrl:     the URL where the change should appear
//   title:       short description of what was implemented
//   description: longer detail (the actual change content)
//   client?:     OPTIONAL — explicit client object to verify against. Use
//                this when the button lives on a per-task / per-article
//                row whose client is NOT the topbar selection (e.g. a
//                pipeline view shows tasks from many clients). Without
//                this, the button verified against the topbar client and
//                produced the "checked bamdiy.com/robots.txt for a Syte
//                task" bug. It's also what kept the button disabled (the
//                not-allowed cursor) when no client was selected in the
//                topbar — falling back to a null current() left it dead.
//   disabled?:   boolean
export default function MarkImplementedButton({
  module, changeType, pageUrl, title, description, disabled, onVerified, client: clientProp
}) {
  const topbarClient = useClients(s => s.current());
  const client = clientProp || topbarClient;
  const [phase, setPhase] = useState('idle'); // idle | logging | verifying | done
  const [result, setResult] = useState(null); // { status, detail, impl }
  const [err, setErr] = useState('');
  const [showPasteHtml, setShowPasteHtml] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState('');
  const [pastedHtml, setPastedHtml] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);

  async function verifyFromPastedHtml() {
    if (!result?.impl?.id) return;
    setPasteBusy(true);
    try {
      const r = await verifyImplementationFromHtml(result.impl, pastedHtml);
      setResult({ ...result, status: r.status, detail: r.detail });
      if (r.status === 'verified') {
        setShowPasteHtml(false);
        setPastedHtml('');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setPasteBusy(false);
    }
  }

  // Compress + read an image File as a base64 data URL. Caps the long
  // edge at ~1600px so a phone screenshot doesn't bloat the DB row to
  // multi-MB. JPEG quality 0.85 keeps the file legible while
  // shrinking ~10× vs the raw photo.
  async function fileToCompressedDataUrl(file) {
    if (!file) return '';
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten transparency
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Verify-with-screenshot path. User picks an image → compress to JPEG
  // base64 → store in verification_detail prefixed with a marker so the
  // history view can split it back out and render the image. The whole
  // implementation row is updated to verified. Available on EVERY
  // verification state per user request — even after auto-verify said
  // OK, the user might still want to attach proof for the audit trail.
  const screenshotInputRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);

  async function uploadScreenshot(file) {
    if (!file || !result?.impl?.id) return;
    if (!file.type.startsWith('image/')) {
      setErr('Please upload an image (JPEG, PNG, etc.)');
      return;
    }
    setUploading(true); setErr('');
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      const note = (result?.detail ? result.detail + '\n\n' : '') +
        '✓ Verified via uploaded screenshot.\n[SCREENSHOT]' + dataUrl + '[/SCREENSHOT]';
      await updateImplementation(result.impl.id, {
        verification_status: 'verified',
        verification_detail: note,
        verified_at: new Date().toISOString()
      });
      setResult({ ...result, status: 'verified', detail: note });
      onVerified?.();
    } catch (e) {
      setErr('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    }
  }

  async function handleClick() {
    if (!client) { setErr('Select a client first.'); return; }

    // For AEO/technical, the optimization goes ON the existing page — use
    // the page URL as-is. Only derive a slug for content articles (new pages).
    let suggestedUrl = pageUrl || client.url || '';
    if (module === 'content') {
      const baseOnly = suggestedUrl && !suggestedUrl.replace(/^https?:\/\//, '').includes('/') ||
                       suggestedUrl.replace(/\/$/, '').split('/').length <= 3;
      if (baseOnly && title) {
        const slug = title.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        suggestedUrl = suggestedUrl.replace(/\/$/, '') + '/' + slug + '/';
      }
    }
    // NOTE: The slug above is a best-guess. WordPress may have generated a
    // different slug from the meta title. If you pushed this via CMS Push,
    // the real URL appears next to the "Review in admin" link — paste THAT
    // here instead of accepting the suggested one.

    const actualUrl = prompt(
      'Enter the live URL where this was published:',
      suggestedUrl
    );
    if (!actualUrl) return; // user cancelled

    const implementedBy = prompt('Who implemented this change?', 'Team member') || 'Unknown';

    setPhase('logging'); setErr(''); setResult(null);
    try {
      const impl = await logImplementation({
        client_id: client.id,
        module,
        change_type: changeType,
        page_url: actualUrl.trim(),
        title: title || 'Untitled change',
        description: (description || '').slice(0, 2000),
        implemented_by: implementedBy,
        verification_status: 'pending'
      });

      const offPage = isOffPageTask(impl);
      setPhase('verifying');
      setVerifyPhase(offPage
        ? 'Running off-page check (sitemap / robots / GSC / analytics)…'
        : 'Step 1/2 — Fetching and scanning page HTML…');
      let vResult = await verifyImplementation(impl, client);
      let st = typeof vResult === 'string' ? vResult : vResult.status;
      let dt = typeof vResult === 'object' ? vResult.detail : null;

      // For on-page tasks only: if HTML verification failed, fall back to
      // screenshot/visual verification. Skip this for off-page tasks (GSC,
      // sitemap, analytics) — the screenshot can't show admin-console work
      // and thum.io frequently 403s, which produced misleading "failed"
      // messages on tasks that were actually done correctly.
      if (!offPage && st !== 'verified') {
        setVerifyPhase('Step 2/2 — Taking screenshot and visual check with AI…');
        try {
          const visualResult = await verifyImplementationVisually(impl);
          if (visualResult.status === 'verified') {
            st = 'verified';
            dt = visualResult.detail;
          } else {
            dt = (dt || '') + '\n\nVisual check: ' + (visualResult.detail || 'also failed');
          }
        } catch {}
      }

      setResult({
        status: st,
        detail: dt || (st === 'verified' ? 'Change confirmed on the live page.' : 'Verification failed — no detail available.'),
        impl
      });
      setPhase('done');
      if (st === 'verified') onVerified?.();
    } catch (e) {
      setErr(e.message);
      setPhase('idle');
    }
  }

  const statusColor =
    result?.status === 'verified' ? 'var(--green)' :
    result?.status === 'manual_required' ? 'var(--orange)' :
    'var(--red)';
  const statusLabel =
    result?.status === 'verified' ? '✓ Verified' :
    result?.status === 'manual_required' ? '⚑ Manual verification required' :
    '✗ Auto-verify failed';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {phase === 'idle' && (
          <button
            onClick={handleClick}
            disabled={disabled || !client}
            style={{
              fontSize: 11, padding: '5px 14px',
              borderColor: 'var(--green)', color: 'var(--green)'
            }}
          >
            ✓ Mark as Implemented
          </button>
        )}
        {phase === 'logging' && (
          <span className="muted" style={{ fontSize: 11 }}>Logging…</span>
        )}
        {phase === 'verifying' && (
          <span style={{ fontSize: 11, color: 'var(--blue)' }}>
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginRight: 6 }} />
            {verifyPhase || 'Scanning live page…'}
          </span>
        )}
        {phase === 'done' && result && (
          <div style={{ fontSize: 11 }}>
            <span style={{ color: statusColor, fontWeight: 600 }}>
              {statusLabel}
            </span>
            {/* Universal "Upload screenshot proof" — available on every
                verification result (verified / failed / manual_required).
                User can always attach evidence; uploading marks the row
                verified regardless of the auto-check outcome. */}
            <input
              ref={screenshotInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => uploadScreenshot(e.target.files?.[0])}
            />
            <button
              onClick={() => screenshotInputRef.current?.click()}
              disabled={uploading}
              style={{
                fontSize: 10, padding: '2px 8px', marginLeft: 6,
                borderColor: 'var(--green)', color: 'var(--green)'
              }}
            >
              {uploading ? 'Uploading…' : (result.status === 'verified' ? '+ Add proof screenshot' : '📸 Upload screenshot to verify')}
            </button>
            {result.status === 'verified' && (
              <button onClick={handleClick} style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }}>Re-verify</button>
            )}
            {result.status !== 'verified' && result.impl?.id && (
              <>
                {result.status !== 'manual_required' && (
                  <button
                    onClick={() => setShowPreview(v => !v)}
                    style={{ fontSize: 10, padding: '3px 10px', marginLeft: 8, borderColor: 'var(--blue)', color: 'var(--blue)' }}
                  >
                    {showPreview ? 'Hide preview' : 'Show live page preview'}
                  </button>
                )}
                <button
                  onClick={async () => {
                    await updateImplementation(result.impl.id, {
                      verification_status: 'verified',
                      verification_detail: 'Visually verified by team member.',
                      verified_at: new Date().toISOString()
                    });
                    setResult({ ...result, status: 'verified', detail: 'Visually verified by team member.' });
                    setShowPreview(false);
                    onVerified?.();
                  }}
                  className="primary"
                  style={{ fontSize: 11, padding: '4px 14px', marginLeft: 6, background: 'var(--green)', borderColor: 'var(--green)', color: '#0a0a0c' }}
                >
                  ✓ Mark Verified
                </button>
              </>
            )}
          </div>
        )}

        {showPreview && result?.impl?.page_url && (
          <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, maxWidth: 600 }}>
            <div className="muted" style={{ fontSize: 10, marginBottom: 6 }}>
              Live rendered preview of <strong>{result.impl.page_url}</strong> — check if the content is visible, then click Mark Verified above.
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
              <img
                src={'https://image.thum.io/get/width/800/crop/1400/noanimate/' + result.impl.page_url}
                alt="Live page screenshot"
                style={{ width: '100%', display: 'block' }}
                loading="lazy"
              />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <a href={result.impl.page_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 10 }}>
                Open live page in new tab →
              </a>
              <button
                onClick={async () => {
                  await updateImplementation(result.impl.id, {
                    verification_status: 'verified',
                    verification_detail: 'Visually verified via page screenshot.',
                    verified_at: new Date().toISOString()
                  });
                  setResult({ ...result, status: 'verified', detail: 'Visually verified via page screenshot.' });
                  onVerified?.();
                  setShowPreview(false);
                }}
                className="primary"
                style={{ fontSize: 11, padding: '5px 16px', background: 'var(--green)', borderColor: 'var(--green)', color: '#0a0a0c' }}
              >
                ✓ I can see the content — Verify
              </button>
            </div>
          </div>
        )}
      </div>

      {result?.detail && (() => {
        // Split out an embedded screenshot data-URL (added by the upload
        // path) so we can render the image inline. Marker convention:
        //   …prose…[SCREENSHOT]data:image/jpeg;base64,XXX[/SCREENSHOT]
        const m = String(result.detail).match(/\[SCREENSHOT\]([\s\S]+?)\[\/SCREENSHOT\]/);
        const text = m ? result.detail.replace(m[0], '').trim() : result.detail;
        const screenshot = m ? m[1] : '';
        return (
          <div style={{
            fontSize: 11, lineHeight: 1.4, maxWidth: 500,
            color: result.status === 'verified' ? 'var(--text-muted)' : 'var(--orange)',
            padding: '4px 8px',
            background: 'var(--surface-2)',
            borderRadius: 6,
            borderLeft: '2px solid ' + statusColor
          }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
            {screenshot && (
              <div style={{ marginTop: 8 }}>
                <a href={screenshot} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                  <img
                    src={screenshot}
                    alt="Verification proof screenshot"
                    style={{
                      maxWidth: '100%', maxHeight: 240,
                      border: '1px solid var(--border)', borderRadius: 4
                    }}
                  />
                </a>
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                  Click the screenshot to open full size.
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showPasteHtml && (
        <div style={{ marginTop: 6, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, maxWidth: 500 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Paste the live page HTML</div>
          <div className="muted" style={{ fontSize: 10, marginBottom: 6, lineHeight: 1.4 }}>
            Use this when the auto-fetch is blocked (Shopify/Cloudflare returning 404/bot-check). On the live page: right-click → <em>View Page Source</em> → Ctrl+A → Ctrl+C → paste below. Claude will verify against the real HTML you see.
          </div>
          <textarea
            value={pastedHtml}
            onChange={e => setPastedHtml(e.target.value)}
            placeholder="Paste the full HTML of the live page here..."
            rows={5}
            disabled={pasteBusy}
            style={{ width: '100%', fontSize: 10, fontFamily: 'monospace' }}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span className="muted" style={{ fontSize: 10 }}>
              {pastedHtml.length > 0 ? `${Math.round(pastedHtml.length / 1000)}k chars` : ''}
            </span>
            <div className="row" style={{ gap: 6 }}>
              <button onClick={() => { setShowPasteHtml(false); setPastedHtml(''); }} style={{ fontSize: 10, padding: '3px 10px' }}>
                Cancel
              </button>
              <button
                onClick={verifyFromPastedHtml}
                disabled={pasteBusy || pastedHtml.length < 100}
                style={{ fontSize: 10, padding: '3px 10px', borderColor: 'var(--blue)', color: 'var(--blue)' }}
              >
                {pasteBusy ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {err && <div style={{ fontSize: 11, color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}
