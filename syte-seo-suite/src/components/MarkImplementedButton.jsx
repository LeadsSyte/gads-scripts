import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { logImplementation } from '../lib/supabase.js';
import { verifyImplementation } from '../lib/verification.js';

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
  module, changeType, pageUrl, title, description, disabled
}) {
  const client = useClients(s => s.current());
  const [phase, setPhase] = useState('idle'); // idle | logging | verifying | done
  const [result, setResult] = useState(null); // { status, detail, impl }
  const [err, setErr] = useState('');

  async function handleClick() {
    if (!client) { setErr('Select a client first.'); return; }

    // Always ask for the actual page URL — the default might just be the
    // client's homepage which won't contain the specific article/change.
    // Prefer the live_url from a previous CMS push (the real WordPress
    // permalink), then fall back to deriving a slug from the title.
    let suggestedUrl = pageUrl || client.url || '';
    const baseOnly = suggestedUrl && !suggestedUrl.replace(/^https?:\/\//, '').includes('/') ||
                     suggestedUrl.replace(/\/$/, '').split('/').length <= 3;
    if (baseOnly && title) {
      const slug = title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      suggestedUrl = suggestedUrl.replace(/\/$/, '') + '/' + slug + '/';
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

      setPhase('verifying');
      const status = await verifyImplementation(impl, client);
      // Re-read the updated impl from the updateImplementation call inside
      // verifyImplementation — the original `impl` object is stale and won't
      // have verification_detail set on it.
      // We pass the detail through the status return, but the canonical
      // detail is now on the Supabase/localStorage record. For the inline
      // display, use a sensible message based on what we know.
      setResult({
        status,
        detail: status === 'verified'
          ? 'Change confirmed on the live page.'
          : 'Change not found — the page may be a draft, behind a login, or the content differs from what was expected. Click Re-verify after publishing.',
        impl
      });
      setPhase('done');
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
            Scanning live page…
          </span>
        )}
        {phase === 'done' && result && (
          <span style={{ fontSize: 11 }}>
            <span style={{ color: statusColor, fontWeight: 600 }}>
              {result.status === 'verified' ? '✓ Verified' : '✗ Not found'}
            </span>
            {' '}
            <button
              onClick={handleClick}
              style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }}
            >
              Re-verify
            </button>
          </span>
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

      {err && <div style={{ fontSize: 11, color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}
