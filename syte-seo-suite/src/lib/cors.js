// CORS proxy fallback chain used across modules for fetching external sites
// (sitemaps, WP detection, page HTML verification, etc.).

const PROXIES = [
  (u) => u, // direct
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

export async function fetchWithCorsProxy(url, init = {}) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(url), init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All CORS proxies failed');
}

export async function fetchTextWithCors(url) {
  const res = await fetchWithCorsProxy(url);
  return res.text();
}
