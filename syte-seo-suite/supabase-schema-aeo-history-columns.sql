-- Syte SEO Suite — AEO History: the columns the snapshot actually writes.
-- Run AFTER supabase-schema-reports.sql and supabase-schema-aeo-v2.sql.
-- Safe to re-run: every statement is add column if not exists.
--
-- WHY THIS EXISTS
-- runSnapshot() (src/modules/reports/aeoRunner.js) returns more fields than
-- the reports + v2 schemas ever created, so inserting a snapshot into
-- syte_suite_aeo_history failed with "Could not find the 'avg_position'
-- column of 'syte_suite_aeo_history' in the schema cache" and the month never
-- reached AEO History. These are the remaining fields, typed to match.

-- Brand metrics (back-compat with pre-v2 cards and the month-on-month table)
alter table syte_suite_aeo_history add column if not exists visibility_score numeric;
alter table syte_suite_aeo_history add column if not exists detection_rate   numeric;  -- coverage %
alter table syte_suite_aeo_history add column if not exists top3_rate        numeric;
alter table syte_suite_aeo_history add column if not exists avg_position     numeric;
alter table syte_suite_aeo_history add column if not exists mentions         int;
alter table syte_suite_aeo_history add column if not exists citations        int;
alter table syte_suite_aeo_history add column if not exists sentiment_score  numeric;

-- Share of voice and coverage detail
alter table syte_suite_aeo_history add column if not exists share_of_voice    numeric;
alter table syte_suite_aeo_history add column if not exists sov_detail        jsonb;
alter table syte_suite_aeo_history add column if not exists scorable_probes   int;
alter table syte_suite_aeo_history add column if not exists branch_exhaustion jsonb;
alter table syte_suite_aeo_history add column if not exists fanout_signals    jsonb;

-- Run bookkeeping
alter table syte_suite_aeo_history add column if not exists run_config     jsonb;
alter table syte_suite_aeo_history add column if not exists run_modes_used jsonb;
alter table syte_suite_aeo_history add column if not exists engine_health  jsonb;
alter table syte_suite_aeo_history add column if not exists iterations     int;
alter table syte_suite_aeo_history add column if not exists total_runs     int;
alter table syte_suite_aeo_history add column if not exists queries_count  int;

-- Long-tail carry-forward (next month starts from these prompts)
alter table syte_suite_aeo_history add column if not exists expansion_probes jsonb;
alter table syte_suite_aeo_history add column if not exists expansion_count  int;
alter table syte_suite_aeo_history add column if not exists carry_forward    jsonb;

-- Report sections
alter table syte_suite_aeo_history add column if not exists keyword_wins     jsonb;
alter table syte_suite_aeo_history add column if not exists intent_breakdown jsonb;
alter table syte_suite_aeo_history add column if not exists excerpts         jsonb;

-- PostgREST caches the schema; without this the new columns can stay
-- invisible to the app until the cache next refreshes.
notify pgrst, 'reload schema';
