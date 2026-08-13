-- Syte SEO Suite — suite-wide settings sync.
-- Run in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- The external AI-engine API keys (OpenAI / Perplexity / Google AI) used by
-- the AEO probe were stored ONLY in per-device localStorage. A fresh browser,
-- a cleared cache, or a new deploy origin silently lost them, so the AEO
-- report quietly dropped to "Claude only" (Claude ships with a built-in key).
-- This table gives the suite one shared settings row so the keys follow the
-- operator to any device instead of vanishing.
--
-- SECURITY NOTE
-- Like every other syte_suite_* table, this is readable/writable by anyone
-- holding the public anon key that ships in the client bundle. Storing the
-- engine keys here is the same trust level as the rest of the suite's data —
-- it does not make them more private. See supabase-schema-rls-policies.sql.

-- Single-row key/value store for suite-wide settings. id is fixed to 'global'
-- so there is exactly one row; `data` holds the settings object (currently the
-- three engine API keys). Kept generic so future suite-wide settings can share
-- the row without a schema change.
create table if not exists syte_suite_settings (
  id text primary key default 'global',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table syte_suite_settings disable row level security;
