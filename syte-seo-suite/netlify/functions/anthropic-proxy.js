// Claude calls for the browser, so the provider key never has to be in the
// browser (security brief §1.3). Until this existed, src/lib/anthropic.js
// called api.anthropic.com directly with the key the lock screen decrypted
// into localStorage. Now the browser sends the same request body here with
// its suite credentials (lib/requireAuth.js); this function adds the key
// from the Netlify environment and streams the answer back unchanged.
//
// POST { model, max_tokens, temperature, system, messages, stream? }
// Streams Anthropic's SSE through when stream is true; otherwise returns the
// JSON body. A v2 function, because streaming needs a Response body.

import { getServerSupabase } from './lib/serverSupabase.js';
import { authorize, fromRequest, liveDeps, corsHeaders } from './lib/requireAuth.js';

const UPSTREAM = 'https://api.anthropic.com/v1/messages';
const ALLOWED_MODEL = /^claude-[a-z0-9.-]+$/i;

export default async function handler(req) {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only.' }), { status: 405, headers: { 'Content-Type': 'application/json', ...cors } });

  let deps = {};
  try { deps = liveDeps(getServerSupabase()); } catch { /* no DB: JWT and API keys can't verify, legacy/internal still can */ }
  const auth = await authorize(fromRequest(req), { deps });
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.reason }), { status: auth.status, headers: { 'Content-Type': 'application/json', ...cors } });

  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set in the Netlify environment.' }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }); }
  if (!body || !Array.isArray(body.messages) || !body.model || !ALLOWED_MODEL.test(String(body.model))) {
    return new Response(JSON.stringify({ error: 'A model and messages are required.' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }
  // Only what the Messages API needs; nothing else from the browser is forwarded.
  const upstreamBody = {
    model: body.model, max_tokens: Math.min(Number(body.max_tokens) || 4096, 16000), temperature: body.temperature,
    system: body.system, messages: body.messages, stream: !!body.stream, ...(body.thinking ? { thinking: body.thinking } : {})
  };
  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
    body: JSON.stringify(upstreamBody)
  });
  const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', ...cors };
  return new Response(upstream.body, { status: upstream.status, headers });
}
