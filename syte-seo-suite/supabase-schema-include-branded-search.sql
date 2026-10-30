-- Syte SEO Suite — per-client opt-in to branded search in reports.
-- Run AFTER supabase-schema.sql. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- Reports leave branded search out: AEO prompts that name the client and GSC
-- keywords containing its name are free wins. A few clients are named after
-- what buyers search for — Sabi Sands Lodges is an aggregator named after the
-- Sabi Sands reserve — so for them "Sabi Sands" queries ARE the competitive
-- search. When true, the AEO census/new prompts include branded prompts, they
-- are probed and reported, and keyword reports keep branded queries.
-- Competitor-named prompts are still excluded. See includeBrandedSearch in
-- src/modules/reports/probeRelevance.js.

alter table syte_suite_clients
  add column if not exists include_branded_search boolean not null default false;
