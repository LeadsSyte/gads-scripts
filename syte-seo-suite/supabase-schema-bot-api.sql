-- Syte SEO Suite — bot API tables (security brief, 2 Nov 2026, Phase 2).
-- Run in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- The assistant bot (Riley, on Grok) drives the suite through /api/v1
-- (netlify/functions/api-v1.js) with a service API key instead of the UI.
-- These tables hold the keys (hashed), the jobs that background work
-- reports into, the idempotency replay cache, the audit trail and the
-- rate-limit counters.
--
-- SECURITY NOTE — these tables are SERVER ONLY.
-- RLS is on with NO policy, so the public anon key in the browser bundle
-- cannot read or write them; only the service-role key the Netlify functions
-- hold can. supabase-schema-rls-policies.sql skips them by name — keep it
-- that way, or every key hash and audit row becomes public.

-- 2.1 Service API keys. The key itself (sk_syte_…) is shown once at creation
-- and only its HMAC-SHA256 is stored (requireAuth.hashApiKey).
create table if not exists syte_suite_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  prefix text not null,                       -- first 12 chars, to recognise a key in logs
  scopes text[] not null default '{}',        -- read | scan | fix:plan | fix:apply | content | queue:review | queue:approve | publish | settings
  created_by text,                            -- staff email or 'server'
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  webhook_url text,                           -- 2.6 optional completion webhook
  webhook_secret text                         -- HMAC signing secret for that webhook
);

-- 2.3 Jobs. Every POST that starts background work creates one and returns
-- its id; the background function updates status/progress/result.
create table if not exists syte_suite_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,                         -- aeo_scan | tech_scan | aeo_fix | tech_fix | autopilot | aeo_report | report | …
  client_id text,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','planning','applying','undoing','done','error','failed')),
  progress jsonb,                             -- free-form: { step, pct, message }
  log jsonb not null default '[]'::jsonb,     -- [{ at, message }]
  result jsonb,
  error text,
  actor jsonb,                                -- { kind: 'api_key'|'staff'|'internal', id, name|email }
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists syte_suite_jobs_client_status on syte_suite_jobs (client_id, status, created_at desc);
create index if not exists syte_suite_jobs_type_client on syte_suite_jobs (type, client_id, created_at desc);

-- 2.4 Idempotency: Idempotency-Key + actor → the original response for 24 h.
create table if not exists syte_suite_idempotency (
  idem_key text not null,
  actor_id text not null,
  request_hash text not null,
  status int not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (idem_key, actor_id)
);

-- 2.7 Audit log: one row per mutating call, written by the API middleware.
create table if not exists syte_suite_audit_log (
  id bigserial primary key,
  actor jsonb not null,
  action text not null,                       -- e.g. 'POST /clients/{id}/scans/aeo'
  client_id text,
  target text,
  request_hash text,
  result text,                                -- '202 job:…' | '403 …'
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists syte_suite_audit_log_client on syte_suite_audit_log (client_id, created_at desc);

-- 2.8 Rate limits: fixed one-hour windows per key and endpoint class.
create table if not exists syte_suite_rate_limits (
  key_id text not null,
  bucket text not null,                       -- 'scans:<clientId>' | 'fixes' | 'reads'
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key_id, bucket, window_start)
);

-- Server only: RLS on, no policies. The service role bypasses RLS.
alter table syte_suite_api_keys     enable row level security;
alter table syte_suite_jobs         enable row level security;
alter table syte_suite_idempotency  enable row level security;
alter table syte_suite_audit_log    enable row level security;
alter table syte_suite_rate_limits  enable row level security;
revoke all on syte_suite_api_keys, syte_suite_jobs, syte_suite_idempotency, syte_suite_audit_log, syte_suite_rate_limits from anon, authenticated;

-- Atomic rate-limit increment: returns the new count for this window.
create or replace function syte_suite_rate_hit(p_key_id text, p_bucket text, p_window timestamptz)
returns int language sql security definer set search_path = public as $$
  insert into syte_suite_rate_limits (key_id, bucket, window_start, count)
  values (p_key_id, p_bucket, p_window, 1)
  on conflict (key_id, bucket, window_start) do update set count = syte_suite_rate_limits.count + 1
  returning count;
$$;
revoke all on function syte_suite_rate_hit(text, text, timestamptz) from public, anon, authenticated;
-- The functions call it with the service-role key; without this grant the
-- revoke above would block them too and rate limits would never apply.
grant execute on function syte_suite_rate_hit(text, text, timestamptz) to service_role;
