import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { logImplementation, updateImplementation } from '../lib/supabase.js';
import { verifyImplementation, verifyImplementationFromHtml, verifyImplementationVisually } from '../lib/verification.js';

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
//   disabled?:   boolean
export default function MarkImplementedButton({
  module, changeType, pageUrl, title, description, disabled, onVerified
}) {
  const client = useClients(s => s.current());
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

      setPhase('verifying'); setVerifyPhase('Step 1/2 — Fetching and scanning page HTML…');
      let vResult = await verifyImplementation(impl, client);
      let st = typeof vResult === 'string' ? vResult : vResult.status;
      let dt = typeof vResult === 'object' ? vResult.detail : null;

      // If HTML verification failed, automatically try visual verification
      // (screenshot-based) — catches JS-rendered content on Shopify/React sites.
      if (st !== 'verified') {
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

  const statusColor = result?.status === 'verified' ? 'var(--green)' : 'var(--red)';

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
              {result.status === 'verified' ? '✓ Verified' : '✗ Auto-verify failed'}
            </span>
            {result.status === 'verified' && (
              <button onClick={handleClick} style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }}>Re-verify</button>
            )}
            {result.status !== 'verified' && result.impl?.id && (
              <>
                <button
                  onClick={() => setShowPreview(v => !v)}
                  style={{ fontSize: 10, padding: '3px 10px', marginLeft: 8, borderColor: 'var(--blue)', color: 'var(--blue)' }}
                >
                  {showPreview ? 'Hide preview' : 'Show live page preview'}
                </button>
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

      {result?.detail && (
        <div style={{
          fontSize: 11, lineHeight: 1.4, maxWidth: 500,
          color: result.status === 'verified' ? 'var(--text-muted)' : 'var(--orange)',
          padding: '4px 8px',
          background: 'var(--surface-2)',
          borderRadius: 6,
          borderLeft: '2px solid ' + statusColor
        }}>
          {result.detail}
        </div>
      )}

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
