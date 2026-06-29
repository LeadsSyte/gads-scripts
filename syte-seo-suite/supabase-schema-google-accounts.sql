-- Syte SEO Suite — server-side Google auth patch.
-- Run AFTER supabase-schema.sql. Safe to re-run: everything is additive.
--
-- Stores a long-lived Google refresh token per connected Google account so
-- the suite never has to re-prompt for that account. The browser never sees
-- these tokens — only the Netlify functions (google-oauth-callback,
-- google-proxy) read/write this table, using the SERVICE ROLE key.
--
-- SECURITY NOTE — read this before touching the RLS block below.
-- Every other syte_suite_* table has an allow-all policy for the public anon
-- key (see supabase-schema-rls-policies.sql) because the suite ships a single
-- shared anon key in the browser bundle. This table is the ONE exception: a
-- refresh token grants long-lived access to a client's Google data, so it
-- must NOT be readable by the anon key. We enable RLS and attach NO anon
-- policy — that blocks the public key entirely while the service-role key
-- used by the functions bypasses RLS. Do NOT add an `anon`/`using (true)`
-- policy here, and do NOT include this table in the allow-all loop in
-- supabase-schema-rls-policies.sql.

create table if not exists syte_suite_google_accounts (
  email         text primary key,        -- lower-cased Google account email
  refresh_token text not null,           -- long-lived; service-role only
  scopes        text,                     -- space-separated granted scopes
  revoked       boolean default false,    -- set when Google rejects the token
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- RLS on, NO policy → public anon key cannot read/write; service role bypasses
-- RLS so the functions still work. This is deliberate (see note above).
alter table syte_suite_google_accounts enable row level security;

-- Belt-and-braces: make sure no anon/authenticated policy lingers from a
-- previous allow-all run.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'syte_suite_google_accounts'
  loop
    execute format('drop policy if exists %I on syte_suite_google_accounts', p.policyname);
  end loop;
end $$;
