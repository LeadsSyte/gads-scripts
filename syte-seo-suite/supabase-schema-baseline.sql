-- Syte SEO Suite — Client Baseline patch.
-- Run AFTER supabase-schema.sql, supabase-schema-reports.sql and
-- supabase-schema-persistence.sql. Safe to re-run: everything is additive.

-- Client onboarding baseline — captured ONCE when a new client comes on board.
-- Snapshots their current keyword rankings + organic traffic for the past
-- month so future performance can be measured against where they started.
-- Distinct from syte_suite_report_cache (recurring, one row per month that
-- gets refreshed) — a baseline is immutable reference data: one row per client.
create table if not exists syte_suite_baselines (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  month text not null,                   -- YYYY-MM the baseline covers (the past complete month)
  data jsonb not null,                   -- full reportData object (traffic + keywords + topPages)
  captured_by text,                      -- who captured it
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);

-- One baseline per client — re-capturing overwrites the existing row.
create unique index if not exists syte_suite_baselines_client_uniq
  on syte_suite_baselines(client_id);

alter table syte_suite_baselines disable row level security;
