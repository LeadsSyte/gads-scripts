-- Syte SEO Suite — per-client search country for the AI (AEO) report.
-- Run AFTER supabase-schema.sql. Safe to re-run (IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- The AEO census asks ChatGPT, Gemini and Claude the prompts a buyer would
-- type. Those engines answer from a location: a UK client probed without one
-- is measured against the wrong market (other stores, other cited sites).
-- This column is the ISO 3166-1 alpha-2 country the engines search from
-- ('GB', 'US', 'ZA', ...). Null / empty = Auto: the app reads the country off
-- the website domain (.co.uk, .co.za, .com.au ...) or the Location field
-- (src/modules/reports/searchCountry.js).

alter table syte_suite_clients
  add column if not exists search_country text;

-- Each AEO snapshot records where the engines searched from
-- ({ code, name, source }), so a month-on-month change of market is visible.
-- Optional: an AEO History insert drops a column the database lacks.
alter table syte_suite_aeo_history add column if not exists search_country jsonb;
