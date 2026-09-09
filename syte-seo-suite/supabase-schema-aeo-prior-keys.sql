-- Syte SEO Suite — AEO repeat suppression.
-- Run AFTER supabase-schema-persistence.sql. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- syte_suite_aeo_results holds ONE row per (client, page) and every run
-- overwrites its `optimizations` array. That made each monthly run amnesiac:
-- a revisited page was generated from scratch, so the model produced the same
-- answer block and the same FAQ section it produced last month, and those
-- repeats took slots on a 10-item shortlist that should have gone to new work.
--
-- prior_keys is the page's append-only ledger — "type::name" for every
-- optimization the page has ever been handed. The engine reads it before
-- generating (as the prompt's do-not-repeat list and as a hard filter on what
-- comes back) and writes the union back after each run. Capped in the app at
-- 60 keys per page, oldest dropped first.

alter table syte_suite_aeo_results
  add column if not exists prior_keys jsonb default '[]'::jsonb;

-- Backfill: seed each page's ledger from the optimizations it currently
-- holds, so the first run after this migration already knows about the
-- items that are live in the app today.
update syte_suite_aeo_results r
   set prior_keys = coalesce((
         select jsonb_agg(distinct coalesce(o->>'type', '') || '::' || coalesce(o->>'name', o->>'title', ''))
           from jsonb_array_elements(r.optimizations) o
          where coalesce(o->>'name', o->>'title', '') <> ''
       ), '[]'::jsonb)
 where (r.prior_keys is null or r.prior_keys = '[]'::jsonb)
   and r.optimizations is not null
   and jsonb_typeof(r.optimizations) = 'array';
