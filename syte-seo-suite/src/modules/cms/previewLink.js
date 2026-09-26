// Links to the in-theme preview (netlify/functions/draft-preview.js).
// kind 'a' = an article saved in the suite, 'q' = a pushed draft (queue row).
// Signed with the same value the CMS proxies check (proxyAuthHash ==
// WP_PROXY_AUTH), so only an unlocked suite can mint working links.
import { proxyAuthHash } from './proxyAuth.js';
import { fnUrl } from '../../lib/fnUrl.js';

export async function themePreviewUrl(kind, id) {
  const key = await proxyAuthHash();
  if (!key || !id || !globalThis.crypto?.subtle) return '';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(kind + ':' + id));
  const sig = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return fnUrl('draft-preview') + '?' + kind + '=' + encodeURIComponent(id) + '&sig=' + sig;
}

// Opens the preview in a new tab. The tab is opened inside the click (before
// the await) so popup blockers allow it.
export async function openThemePreview(kind, id) {
  const tab = window.open('about:blank', '_blank');
  const url = await themePreviewUrl(kind, id);
  if (tab && url) tab.location.href = url;
  else if (tab) tab.close();
}
