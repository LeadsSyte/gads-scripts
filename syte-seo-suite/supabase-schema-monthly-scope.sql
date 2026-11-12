-- Syte SEO Suite — per-client "What we do for you every month" scope.
-- Run AFTER supabase-schema.sql. Safe to re-run (IF NOT EXISTS).
--
-- The SEO and AEO client reports each carry a section listing the standing
-- monthly scope of work (src/modules/reports/monthlyScope.js). One item per
-- line, "Title: description". Null / empty = the standard scope built from
-- the client's services and settings.

alter table syte_suite_clients add column if not exists monthly_scope_seo text;
alter table syte_suite_clients add column if not exists monthly_scope_aeo text;
