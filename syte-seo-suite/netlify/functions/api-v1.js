// /api/v1 — the bot API (security brief Phase 2). The routes, checks and
// handlers live in lib/apiRouter.js; this file only wires the live database,
// environment and fetch. netlify.toml redirects /api/v1/* here as well.

import { getServerSupabase } from './lib/serverSupabase.js';
import { liveDeps } from './lib/requireAuth.js';
import { supaDb } from './lib/apiCore.js';
import { createApi } from './lib/apiRouter.js';

// Routed by the netlify.toml redirect /api/v1/* → /.netlify/functions/api-v1/:splat.
// No custom `path` here: a function with one loses its default
// /.netlify/functions/<name> URL, which is where that redirect points.

let api = null;
export default async function handler(req) {
  if (!api) {
    const supabase = getServerSupabase();
    api = createApi({ db: supaDb(supabase), deps: liveDeps(supabase) });
  }
  return api(req);
}
