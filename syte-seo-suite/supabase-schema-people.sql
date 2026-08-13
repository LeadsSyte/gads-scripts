-- Syte SEO Suite — People / ownership columns for syte_suite_clients.
--
-- Run this in the Supabase SQL Editor. It is safe to run more than once
-- (every statement is idempotent).
--
-- Fixes the runtime error:
--   Could not find the 'manager_content' column of 'syte_suite_clients'
--   in the schema cache
--
-- …raised from the master Clients view when you set the Owner or a
-- per-service person. The master view stores one owner plus an optional
-- person override per service. The service flags are does_technical /
-- does_content / does_aeo / does_reporting, and each has a matching
-- manager_* column here.

alter table syte_suite_clients add column if not exists owner              text;
alter table syte_suite_clients add column if not exists manager_technical  text;
alter table syte_suite_clients add column if not exists manager_content    text;
alter table syte_suite_clients add column if not exists manager_aeo        text;
alter table syte_suite_clients add column if not exists manager_reporting  text;
-- "Reports" is exposed as does_reporting everywhere else, but add the
-- shorter alias too so an older/newer client build that writes
-- manager_reports instead can't re-trigger the same schema-cache error.
alter table syte_suite_clients add column if not exists manager_reports    text;

-- PostgREST (the API layer Supabase puts in front of the table) keeps its
-- own cached copy of the schema. Adding columns from the SQL editor does
-- not always refresh it, which is what produces the "…in the schema cache"
-- wording. Nudge it to reload now so the new columns are usable immediately.
notify pgrst, 'reload schema';
