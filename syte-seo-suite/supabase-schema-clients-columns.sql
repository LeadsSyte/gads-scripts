-- Syte SEO Suite — bring syte_suite_clients up to date with the app.
-- Run this in the Supabase SQL editor. Safe to re-run: every statement is
-- additive and guarded with IF NOT EXISTS, and nothing here drops or
-- rewrites data.
--
-- WHY THIS EXISTS
-- upsertClient() (src/lib/supabase.js) posts the whole client object to
-- PostgREST as-is, so a client save fails outright the moment ONE column the
-- form carries is missing from the table:
--
--   Could not find the 'aeo_census' column of 'syte_suite_clients'
--   in the schema cache
--
-- The columns were added over time by feature-specific patch files
-- (supabase-schema-reports.sql, -persistence.sql, -aeo-v2.sql,
-- -aeo-items-per-month.sql, -publishing.sql). Miss one of those and you get
-- the error above, fix that column, then hit the next one. This file is every
-- syte_suite_clients column those patches add, in one place, so the table can
-- be reconciled in a single run.

-- ── Reporting + service flags (supabase-schema-reports.sql) ──
alter table syte_suite_clients add column if not exists reporting_email        text;
alter table syte_suite_clients add column if not exists start_date             date;
alter table syte_suite_clients add column if not exists competitors            text;
alter table syte_suite_clients add column if not exists rankscale_url          text;
alter table syte_suite_clients add column if not exists internal_notes         text;
alter table syte_suite_clients add column if not exists content_rules          text;
alter table syte_suite_clients add column if not exists does_technical         boolean default true;
alter table syte_suite_clients add column if not exists does_content           boolean default true;
alter table syte_suite_clients add column if not exists does_aeo               boolean default true;
alter table syte_suite_clients add column if not exists does_reporting         boolean default true;

-- ── AEO probe set (reports.sql + aeo-v2.sql + aeo-items-per-month.sql) ──
-- aeo_probe_queries is the flat newline list that actually runs;
-- aeo_census is the intent-bucketed structure the report reads;
-- aeo_probes is the v2 probe objects { id, query, type, tier, active, runMode }.
alter table syte_suite_clients add column if not exists aeo_probe_queries      text;
alter table syte_suite_clients add column if not exists aeo_census             jsonb;
alter table syte_suite_clients add column if not exists aeo_probes             jsonb;
alter table syte_suite_clients add column if not exists aeo_exhausted_branches jsonb;
alter table syte_suite_clients add column if not exists aeo_items_per_month    int default 10;

-- ── Account managers, brand docs, client type (supabase-schema-persistence.sql) ──
alter table syte_suite_clients add column if not exists looker_url             text;
alter table syte_suite_clients add column if not exists client_type            text;  -- 'ecommerce' | 'lead_gen'
alter table syte_suite_clients add column if not exists brand_docs             text;
alter table syte_suite_clients add column if not exists account_manager        text;
alter table syte_suite_clients add column if not exists manager_technical      text;
alter table syte_suite_clients add column if not exists manager_content        text;
alter table syte_suite_clients add column if not exists manager_aeo            text;
alter table syte_suite_clients add column if not exists manager_reporting      text;

-- ── Google account bindings (supabase-schema-persistence.sql) ──
-- google_account_email is the legacy single binding; the per-API fields win
-- over it when set, so a client can have GA4 in one account and GSC in another.
alter table syte_suite_clients add column if not exists google_account_email   text;
alter table syte_suite_clients add column if not exists ga4_account_email      text;
alter table syte_suite_clients add column if not exists gsc_account_email      text;

-- ── CMS publishing profile (supabase-schema-publishing.sql) ──
alter table syte_suite_clients add column if not exists publishing_profile     jsonb not null default '{}'::jsonb;

-- Backfill the one column the app treats as always-set.
update syte_suite_clients set aeo_items_per_month = 10 where aeo_items_per_month is null;

-- PostgREST caches the schema. A column added while the API is running stays
-- invisible ("... in the schema cache") until it reloads, so tell it to.
notify pgrst, 'reload schema';

-- ── Verify ──
-- Should list every column above. Anything missing means a statement failed;
-- read the SQL editor's error output rather than assuming it applied.
--
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'syte_suite_clients'
--   order by column_name;
