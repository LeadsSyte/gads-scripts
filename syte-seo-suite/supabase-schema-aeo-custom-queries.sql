-- Syte SEO Suite — per-client custom AEO queries.
-- Run AFTER supabase-schema.sql. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- The AEO census is generated (gold grid, census, carried and new prompts) and
-- filtered (no branded or competitor prompts). Teams also have queries of
-- their own, often from the client, that must run exactly as written every
-- month. This column holds them, one per line; the client editor fills it by
-- paste or by uploading a .docx / .txt / .csv. See customQueriesFor in
-- src/modules/reports/probeRelevance.js.

alter table syte_suite_clients
  add column if not exists aeo_custom_queries text;
