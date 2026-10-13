import React, { useState } from 'react';
import { scopeClientCss, MAX_BYTES } from './clientCss.js';

// "Client CSS" in the Publishing Profile: upload (or paste) the client's
// stylesheet; only what styles article content is kept (clientCss.js) and
// sent with every article and AEO section. Saved with "Save Profile".
export default function ClientCssField({ profile, setP, disabled }) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const info = profile.client_css_info;

  const take = (raw, file) => {
    setError('');
    const r = scopeClientCss(raw);
    if (!r.css) { setError('Nothing in that CSS styles article content (headings, paragraphs, lists, tables, links, fonts) — nothing was kept.'); return; }
    setP('client_css', r.css);
    setP('client_css_info', { file: file || 'pasted CSS', kept: r.kept, dropped: r.dropped, truncated: r.truncated, bytes: r.bytes, saved_at: new Date().toISOString() });
    setPasting(false); setPasted('');
  };

  const onFile = e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { setError('That file is over 3 MB — export just the theme stylesheet.'); return; }
    const reader = new FileReader();
    reader.onload = () => take(String(reader.result || ''), f.name);
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(f);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ margin: 0 }}>Client CSS</label>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Upload the client's stylesheet (fonts, headings, tables… or the whole theme CSS). The suite keeps only what styles
        article content, applies it to our content alone — never the rest of the site — and sends it with every article and
        AEO section it publishes. Only takes effect where the site keeps styles in posts (Shopify, or a WordPress Administrator login).
      </div>
      {profile.client_css ? (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          ✓ <strong>{info?.file || 'Client CSS'}</strong> — {info?.kept ?? '?'} rule{info?.kept === 1 ? '' : 's'} kept for articles
          {info?.dropped ? ', ' + info.dropped + ' left out (layout, menus, footer…)' : ''}
          {info?.truncated ? <span style={{ color: 'var(--orange, #e8a33d)' }}> — trimmed to {Math.round(MAX_BYTES / 1000)} KB</span> : ''}.
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11 }}>Show what will be sent</summary>
            <pre style={{ fontSize: 10, maxHeight: 180, overflow: 'auto', background: 'var(--surface-2)', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{profile.client_css}</pre>
          </details>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>None — articles use the site's own styles and the copied classes only.</div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <label className="ghost" style={{ fontSize: 11, padding: '3px 10px', cursor: disabled ? 'default' : 'pointer', border: '1px solid var(--border)', borderRadius: 6, margin: 0 }}>
          {profile.client_css ? 'Replace with a file…' : 'Upload a .css file…'}
          <input type="file" accept=".css,text/css" onChange={onFile} disabled={disabled} style={{ display: 'none' }} />
        </label>
        <button className="ghost" style={{ fontSize: 11, padding: '3px 10px' }} disabled={disabled} onClick={() => setPasting(p => !p)}>
          {pasting ? 'Cancel' : 'Paste CSS'}
        </button>
        {profile.client_css && (
          <button className="ghost" style={{ fontSize: 11, padding: '3px 10px' }} disabled={disabled}
            onClick={() => { setP('client_css', null); setP('client_css_info', null); }}>Remove</button>
        )}
      </div>
      {pasting && (
        <div style={{ marginTop: 6 }}>
          <textarea rows={6} value={pasted} onChange={e => setPasted(e.target.value)} placeholder="h2 { font-family: …; color: … }"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }} />
          <button style={{ fontSize: 11, padding: '3px 10px', marginTop: 4 }} disabled={disabled || !pasted.trim()} onClick={() => take(pasted)}>Use this CSS</button>
        </div>
      )}
      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{error}</div>}
      {(profile.client_css || error) && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Click <em>Save Profile</em> to keep the change.</div>}
    </div>
  );
}
