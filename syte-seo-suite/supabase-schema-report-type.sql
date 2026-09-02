-- Syte SEO Suite — generated-report log: one row per report TYPE per month.
--
-- Why: the SEO and AEO reports are separate deliverables (see the report
-- split), and the app writes one row per (client, month, report_type). The
-- table was created with `unique (client_id, month)`, so the SECOND report
-- generated for a client in a month failed to insert with a duplicate-key
-- error. The app caught it, fell back to localStorage, and the report showed
-- on the machine that made it and nowhere else.
--
-- Run AFTER supabase-schema-reports.sql. Safe to re-run.

-- 1. Backfill: pre-split rows carry no type. They were SEO-led, and the app
--    reads a missing type as 'full', so stamp that in — a null column can't
--    take part in a unique key.
update syte_suite_report_generated_log
   set report_type = 'full'
 where report_type is null;

alter table syte_suite_report_generated_log
  alter column report_type set default 'full';

alter table syte_suite_report_generated_log
  alter column report_type set not null;

-- 2. Drop the old (client_id, month) unique constraint. Matched on its
--    columns rather than its name, which differs between projects depending
--    on whether the table came from reports.sql or persistence.sql.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'syte_suite_report_generated_log'
       and con.contype = 'u'
       and (
         select array_agg(att.attname order by att.attname)
           from unnest(con.conkey) k
           join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
       ) = array['client_id', 'month']
  loop
    execute format('alter table syte_suite_report_generated_log drop constraint %I', c.conname);
  end loop;
end $$;

-- 3. The real key. Pre-existing rows are already unique on (client_id, month),
--    so adding report_type cannot collide.
create unique index if not exists syte_suite_report_generated_log_client_month_type_key
  on syte_suite_report_generated_log(client_id, month, report_type);
