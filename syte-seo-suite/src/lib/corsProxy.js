// CORS proxy fallback chain for fetching external URLs from the browser.
const PROXIES = [
  (u) => u, // direct
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?' + encodeURIComponent(u)
];

export async function corsFetch(url, init = {}) {
  let lastErr;
  for (const build of PROXIES) {
    try {
      const res = await fetch(build(url), init);
      if (res.ok) return res;
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All CORS proxies failed');
}

export async function corsFetchText(url) {
  const res = await corsFetch(url);
  return res.text();
}
