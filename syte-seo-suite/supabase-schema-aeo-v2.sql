-- Syte SEO Suite — AEO v2 (recursive fan-out probe engine).
-- Run AFTER supabase-schema.sql and supabase-schema-reports.sql.
-- Safe to re-run: everything is additive (add column if not exists / create
-- table if not exists). No existing data is dropped or rewritten.

-- 1. Append-only probe set on the client. Array of probe objects:
--    { id, tier, type, intent, query, source, parentProbeId, discoveredAt,
--      active, runMode }. The flat aeo_probe_queries list and the aeo_census
--    stay in sync for back-compat, but aeo_probes is the source of truth.
alter table syte_suite_clients add column if not exists aeo_probes jsonb;

-- Fan-out branches (parentProbeId values) flagged exhausted — the engine stops
-- proposing children from these. Array of probe ids.
alter table syte_suite_clients add column if not exists aeo_exhausted_branches jsonb;

-- 2. Per-run result capture. One row per (probe x engine x runIndex x runMode).
--    The full raw response is stored keyed by hash and retained for 90 days
--    (see the retention statement at the bottom — run it on a schedule).
create table if not exists syte_suite_aeo_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  month text not null,                    -- "YYYY-MM", the snapshot this run belongs to
  probe_id text,
  engine text,
  run_index int,
  run_mode text,                          -- 'search_on' | 'search_off'
  appeared boolean,
  position int,                           -- 1-based among brand mentions; null if absent
  list_length int,                        -- brands the response named in total; null if absent
  segment_label text,
  reason_phrase text,                     -- verbatim, max 200 chars
  sentiment text,                         -- 'positive' | 'neutral' | 'negative'
  competitors_named jsonb,                -- string[]
  cited_urls jsonb,                       -- string[]
  raw_response_hash text,                 -- key into raw storage below
  timestamp timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists syte_suite_aeo_runs_client_month_idx
  on syte_suite_aeo_runs(client_id, month desc);
create index if not exists syte_suite_aeo_runs_hash_idx
  on syte_suite_aeo_runs(raw_response_hash);

-- 3. Raw response bodies, deduped by content hash, retained 90 days. Kept
--    separate from the run rows so many identical/near responses share storage
--    and the retention sweep is a single cheap delete.
create table if not exists syte_suite_aeo_raw (
  hash text primary key,
  client_id uuid references syte_suite_clients(id) on delete cascade,
  engine text,
  run_mode text,
  raw_response text,
  created_at timestamptz default now()
);

create index if not exists syte_suite_aeo_raw_created_idx
  on syte_suite_aeo_raw(created_at);

-- 4. New snapshot-level columns on the history table. These ride alongside the
--    existing jsonb blobs so old rows keep rendering (normalizeSnapshot fills
--    the gaps for pre-v2 snapshots).
alter table syte_suite_aeo_history add column if not exists coverage_rate  numeric;   -- 0..1
alter table syte_suite_aeo_history add column if not exists prompt_coverage int;      -- active probes with appearanceRate > 0
alter table syte_suite_aeo_history add column if not exists composite_index int;      -- 0..100
alter table syte_suite_aeo_history add column if not exists new_themes     int;        -- fan-out probes approved since last snapshot
alter table syte_suite_aeo_history add column if not exists probe_results  jsonb;      -- per-probe-per-engine scored rows
alter table syte_suite_aeo_history add column if not exists citation_gaps  jsonb;      -- ranked domain gap table
alter table syte_suite_aeo_history add column if not exists engine_params  jsonb;      -- per-engine params used (model, temperature, modes)

alter table syte_suite_aeo_runs disable row level security;
alter table syte_suite_aeo_raw  disable row level security;

-- 5. Retention: keep raw responses for 90 days. Run this on a schedule
--    (Supabase cron / pg_cron / an external job). No new infra required.
--    delete from syte_suite_aeo_raw where created_at < now() - interval '90 days';
