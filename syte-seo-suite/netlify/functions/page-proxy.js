// Page proxy — fetches a public web page server-side with browser-like
// headers so verification, crawling and sitemap discovery see the HTML a
// visitor sees (clears CORS and most basic bot filters).
//
// Security brief §1.6: this used to be an open proxy — no auth, any URL
// (cloud metadata, localhost, private ranges), redirects followed blindly,
// and a third-party relay (allorigins.win) as the last tier. Now every call
// is authorised (lib/requireAuth.js), every address goes through
// lib/safeFetch.js (http/https only, DNS-checked against private ranges on
// every hop, timeout, size cap), and the relay tier is gone. Jina Reader
// stays for JS-rendered sites, after the same address check.
//
// POST { url, raw? }  → { status, html, finalUrl, source } | { error }
// raw=true skips Jina (it rewrites <head>, which breaks robots/canonical
// checks and sitemap XML).

import { authorize, fromEvent, corsFor, deny, liveDeps, parseJsonPost } from './lib/requireAuth.js';
import { safeFetch, urlProblem } from './lib/safeFetch.js';
import { getServerSupabase } from './lib/serverSupabase.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// A response is useful only when it has body content: JS-heavy themes can
// come back as head + inline CSS only, which is garbage for the verifier.
export function hasUsefulBody(html) {
  if (!html || html.length < 200) return false;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyMatch ? bodyMatch[1] : html;
  const text = bodyInner
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= 60;
}

// Sitemaps and robots.txt are not HTML and have no <body>; raw callers get
// them verbatim as long as there is something there.
const usefulFor = (html, raw) => raw ? !!(html && html.trim().length > 0) : hasUsefulBody(html);

export async function handler(event) {
  const cors = corsFor(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  let deps = {};
  try { deps = liveDeps(getServerSupabase()); } catch { /* legacy/internal still verify */ }
  const req = fromEvent(event);
  const auth = await authorize(req, { deps });
  if (!auth.ok) return deny(auth.status, cors, auth.reason);

  const parsed = parseJsonPost(req);
  if (parsed.error) return deny(parsed.error.status, cors, parsed.error.reason);
  const { url, raw } = parsed.body;
  if (!url || typeof url !== 'string') return deny(400, cors, 'Missing url parameter');

  const problem = await urlProblem(url);
  if (problem) return deny(400, cors, problem);

  const failures = [];
  // Tier 1: direct, through the guarded fetch.
  try {
    const res = await safeFetch(url, { headers: BROWSER_HEADERS });
    const blocked = res.status === 403 ||
      (res.status === 404 && res.html.length < 5000) ||
      /Attention Required|Cloudflare|Just a moment|captcha|403 Forbidden|Access Denied/i.test(res.html.slice(0, 2000));
    if (!blocked && usefulFor(res.html, !!raw)) {
      return ok(cors, { status: res.status, html: res.html, finalUrl: res.finalUrl, source: 'direct' });
    }
    failures.push('direct (' + (blocked ? 'blocked' : 'no useful body') + ')');
  } catch (e) {
    failures.push('direct (' + String(e.message || 'error').slice(0, 80) + ')');
  }

  // Tier 2: Jina Reader renders JS-heavy pages. It fetches the page itself,
  // so it only ever sees the public address we already checked above.
  if (raw) failures.push('jina-reader (skipped: raw)');
  else {
    try {
      for (const headers of [{ 'Accept': 'text/html', 'X-Return-Format': 'html' }, {}]) {
        const r = await fetch('https://r.jina.ai/' + url, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const html = await r.text();
        if (hasUsefulBody(html)) return ok(cors, { status: 200, html, finalUrl: url, source: 'jina-reader' });
      }
      failures.push('jina-reader (no useful body)');
    } catch (e) {
      failures.push('jina-reader (' + String(e.message || 'error').slice(0, 60) + ')');
    }
  }

  return {
    statusCode: 502,
    headers: { 'content-type': 'application/json', ...cors },
    body: JSON.stringify({ error: 'All fetch tiers returned empty/blocked HTML. Tried: ' + failures.join('; ') + '.', stage: 'all-tiers-failed' })
  };
}

const ok = (cors, out) => ({ statusCode: 200, headers: { 'content-type': 'application/json', ...cors }, body: JSON.stringify(out) });
