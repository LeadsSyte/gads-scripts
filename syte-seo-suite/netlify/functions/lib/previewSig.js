// Signature for in-theme preview links (draft-preview.js). The browser makes
// the same HMAC in src/modules/cms/previewLink.js.
import crypto from 'node:crypto';

export function previewSig(kind, id, key) {
  return crypto.createHmac('sha256', String(key)).update(kind + ':' + id).digest('hex');
}

// Absolute signed link for emails; '' when the server can't sign.
export function signedUrl(fnName, kind, id, { base = process.env.URL, key = process.env.WP_PROXY_AUTH } = {}) {
  if (!id || !key) return '';
  const origin = String(base || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  return origin + '/.netlify/functions/' + fnName + '?' + kind + '=' + encodeURIComponent(id) + '&sig=' + previewSig(kind, id, key);
}

export function previewUrl(kind, id, opts) {
  return signedUrl('draft-preview', kind, id, opts);
}
