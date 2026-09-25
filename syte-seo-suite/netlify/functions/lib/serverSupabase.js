// Supabase client for server functions — same env convention as
// publish-approved / notify-draft / google-proxy.
import { createClient } from '@supabase/supabase-js';

export function getServerSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured for server functions (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  return createClient(url, key);
}
