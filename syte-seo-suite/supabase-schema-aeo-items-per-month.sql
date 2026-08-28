-- Syte SEO Suite — per-client AEO shortlist size.
-- Run AFTER supabase-schema.sql. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- The AEO Engine used to ship a fixed 5 optimizations for every page it
-- touched, so a client on 12 pages/month received 60 items in one hand-off.
-- Account managers cannot brief a developer on 60 changes, so the tail went
-- unimplemented and the genuinely high-impact items were buried in it.
--
-- The engine now generates across a handful of pages and ranks the result
-- down to ONE site-wide shortlist. This column is that shortlist's size —
-- it defaults to 10 and is deliberately separate from `pages_per_month`,
-- which the Content Engine reads as its monthly article quota.

alter table syte_suite_clients
  add column if not exists aeo_items_per_month int default 10;

-- Backfill existing rows so the app doesn't have to treat null as "unset".
update syte_suite_clients
  set aeo_items_per_month = 10
  where aeo_items_per_month is null;
