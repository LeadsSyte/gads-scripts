// /api/v1 — the bot API (security brief Phase 2). The routes, checks and
// handlers live in lib/apiRouter.js; this file only wires the live database,
// environment and fetch. netlify.toml redirects /api/v1/* here as well.

import { getServerSupabase } from './lib/serverSupabase.js';
import { liveDeps } from './lib/requireAuth.js';
import { supaDb } from './lib/apiCore.js';
import { createApi } from './lib/apiRouter.js';

export const config = { path: ['/api/v1', '/api/v1/*'] };

let api = null;
export default async function handler(req) {
  if (!api) {
    const supabase = getServerSupabase();
    api = createApi({ db: supaDb(supabase), deps: liveDeps(supabase) });
  }
  return api(req);
}
