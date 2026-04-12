-- Syte SEO Suite — Reporting module patch.
-- Run AFTER supabase-schema.sql. Safe to re-run: everything is additive.

-- 1. Extend syte_suite_clients with reporting + service-flag columns.
alter table syte_suite_clients add column if not exists reporting_email    text;
alter table syte_suite_clients add column if not exists start_date         date;
alter table syte_suite_clients add column if not exists aeo_probe_queries  text;
alter table syte_suite_clients add column if not exists competitors        text;
alter table syte_suite_clients add column if not exists rankscale_url      text;
alter table syte_suite_clients add column if not exists internal_notes     text;
alter table syte_suite_clients add column if not exists does_technical     boolean default true;
alter table syte_suite_clients add column if not exists does_content       boolean default true;
alter table syte_suite_clients add column if not exists does_aeo           boolean default true;
alter table syte_suite_clients add column if not exists does_reporting     boolean default true;

-- 2. AEO Snapshot history — append-only, one row per client per month per run.
create table if not exists syte_suite_aeo_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  month text not null,                  -- "YYYY-MM"
  overall_score int,
  engine_scores jsonb,                  -- {"chatgpt": 80, "perplexity": 65, ...}
  per_query jsonb,                      -- array of {query, engine, mentioned, position, excerpt, sentiment}
  competitors jsonb,                    -- [{name, appearances}]
  sentiment text,                       -- "84% positive"
  engines_used jsonb,                   -- ["chatgpt","gemini",...] — which engines actually ran
  created_at timestamptz default now()
);

create index if not exists syte_suite_aeo_history_client_month_idx
  on syte_suite_aeo_history(client_id, month desc);

-- 3. Report log — one row per sent monthly report.
create table if not exists syte_suite_report_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  month text not null,
  sent_date timestamptz default now(),
  qa_score int,
  aeo_snapshot_score int,
  email_subject text,
  created_at timestamptz default now()
);

alter table syte_suite_aeo_history disable row level security;
alter table syte_suite_report_log  disable row level security;

-- Content rules: always-enforced restrictions per client (e.g. gambling
-- compliance for play.co.za, factual constraints for Kruger Gate).
-- Separate from internal_notes (Manual Content Direction) which is monthly
-- topic steering. This field is non-negotiable in every generation.
alter table syte_suite_clients add column if not exists content_rules text;
