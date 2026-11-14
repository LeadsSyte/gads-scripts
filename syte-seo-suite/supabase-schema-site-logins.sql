-- Syte SEO Suite — website logins for sites with no API (Chris, 12 Nov 2026:
-- "if it's not WordPress and we're not using an API, I can just enter the
-- details to log in"). Run in the Supabase SQL Editor. Safe to re-run.
--
-- The login is kept in the server-only secrets table (RLS on, no policy; the
-- public browser key cannot read it), as one JSON value per client:
--   { "login_url", "username", "password", "notes", "updated_at", "updated_by" }
-- It is written by netlify/functions/site-login.js (the CMS → Connector form)
-- and read only by the Grok bot, for a job it has claimed on that client
-- (GET /api/v1/grok-jobs/{id}/login, which is written to the audit log).

alter table syte_suite_client_secrets add column if not exists site_login jsonb;

-- Check: the column exists and the table is still closed to the public key.
select
  (select count(*) from information_schema.columns
     where table_name = 'syte_suite_client_secrets' and column_name = 'site_login') as site_login_column,
  (select relrowsecurity from pg_class where relname = 'syte_suite_client_secrets') as rls_on;
