-- Syte SEO Suite — RLS hardening (run in the Supabase SQL Editor).
--
-- WHY THIS EXISTS
-- The suite has gone dark twice because row-level security was switched ON
-- for a table with NO policy attached. RLS-on + no-policy blocks every read
-- from the public anon key, so the app silently sees zero rows: clients
-- vanish, the Approvals matrix shows everything "Not done", reports go empty.
-- The dashboard's "Enable RLS" nag in the Table Editor is the usual trigger.
--
-- WHAT THIS DOES
-- Enables RLS on every syte_suite_* table BUT attaches an explicit allow-all
-- policy for the anon + authenticated roles. Result: RLS can be on (so the
-- dashboard stops nagging and a stray click can't lock you out) while the
-- single shared anon key keeps working exactly as before.
--
-- SECURITY NOTE
-- This grants full read/write to anyone holding the public anon key, which
-- ships in the client JS bundle. That matches the suite's existing
-- single-key design — it does NOT make the data more private. If you later
-- add real per-user auth, replace the `using (true)` predicates with proper
-- ownership checks. This file only removes the foot-gun, not the openness.
--
-- Safe to re-run: drops and recreates each policy.

do $$
declare
  t record;
  policy_name text;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'syte_suite_%'
  loop
    policy_name := t.tablename || '_anon_all';

    -- Turn RLS on so the dashboard stops warning and the state is explicit.
    execute format('alter table public.%I enable row level security', t.tablename);

    -- (Re)create the allow-all policy for the roles the app uses.
    execute format('drop policy if exists %I on public.%I', policy_name, t.tablename);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      policy_name, t.tablename
    );
  end loop;
end $$;

-- Verify: every suite table should be rls_enabled = true AND have one policy.
-- select c.relname, c.relrowsecurity as rls_enabled, count(p.polname) as policies
-- from pg_class c
-- left join pg_policy p on p.polrelid = c.oid
-- where c.relname like 'syte_suite_%' and c.relkind = 'r'
-- group by 1, 2
-- order by 1;
