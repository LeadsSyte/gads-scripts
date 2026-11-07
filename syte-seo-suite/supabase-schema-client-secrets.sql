-- Syte SEO Suite — client CMS credentials, server-only (security brief §1.2).
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS
-- syte_suite_clients is readable by the public key that ships in the browser
-- bundle, and it held every client's WordPress app password and Shopify
-- token (19 + 2 on 6 Nov 2026). This moves them into a table the public key
-- cannot read.
--
-- HOW IT WORKS (no app change needed for saving)
-- A trigger on syte_suite_clients catches any wp_app_password / shopify_token
-- written to a client row — from the Connections form, the Shopify connect
-- flow, anything — stores it in syte_suite_client_secrets, and leaves the
-- marker 'stored-server-side' in the public column. The browser still sees
-- that a password is set, never the value. Server functions read the real
-- value with the service-role key (netlify/functions/lib/clientSecrets.js).
-- Clearing the field clears the stored value. Nothing is deleted from the
-- clients table.

create table if not exists syte_suite_client_secrets (
  client_id       uuid primary key
                  references syte_suite_clients(id) on delete cascade
                  deferrable initially deferred,   -- the trigger runs before a new client row exists
  wp_app_password text,
  shopify_token   text,
  updated_at      timestamptz not null default now()
);

-- Server only: RLS on, no policy; the service role bypasses RLS.
alter table syte_suite_client_secrets enable row level security;
revoke all on syte_suite_client_secrets from anon, authenticated;

create or replace function syte_suite_stash_client_secrets()
returns trigger language plpgsql security definer set search_path = public as $$
declare marker constant text := 'stored-server-side';
begin
  -- WordPress app password
  if new.wp_app_password is distinct from marker then
    if coalesce(new.wp_app_password, '') = '' then
      if tg_op = 'UPDATE' and old.wp_app_password is not null and old.wp_app_password <> '' then
        update syte_suite_client_secrets set wp_app_password = null, updated_at = now() where client_id = new.id;
      end if;
    else
      insert into syte_suite_client_secrets (client_id, wp_app_password, updated_at)
        values (new.id, new.wp_app_password, now())
        on conflict (client_id) do update set wp_app_password = excluded.wp_app_password, updated_at = now();
      new.wp_app_password := marker;
    end if;
  end if;

  -- Shopify token
  if new.shopify_token is distinct from marker then
    if coalesce(new.shopify_token, '') = '' then
      if tg_op = 'UPDATE' and old.shopify_token is not null and old.shopify_token <> '' then
        update syte_suite_client_secrets set shopify_token = null, updated_at = now() where client_id = new.id;
      end if;
    else
      insert into syte_suite_client_secrets (client_id, shopify_token, updated_at)
        values (new.id, new.shopify_token, now())
        on conflict (client_id) do update set shopify_token = excluded.shopify_token, updated_at = now();
      new.shopify_token := marker;
    end if;
  end if;

  return new;
end $$;

revoke all on function syte_suite_stash_client_secrets() from public, anon, authenticated;

drop trigger if exists syte_suite_clients_stash_secrets on syte_suite_clients;
create trigger syte_suite_clients_stash_secrets
  before insert or update of wp_app_password, shopify_token on syte_suite_clients
  for each row execute function syte_suite_stash_client_secrets();

-- Move what is there today: rewriting each value fires the trigger, which
-- stores it and leaves the marker.
update syte_suite_clients set wp_app_password = wp_app_password
  where wp_app_password is not null and wp_app_password <> '' and wp_app_password <> 'stored-server-side';
update syte_suite_clients set shopify_token = shopify_token
  where shopify_token is not null and shopify_token <> '' and shopify_token <> 'stored-server-side';

-- Check: both counts should match what was there (19 WordPress, 2 Shopify on 6 Nov),
-- and the clients table should now hold only the marker.
select
  (select count(*) from syte_suite_client_secrets where wp_app_password is not null) as wordpress_moved,
  (select count(*) from syte_suite_client_secrets where shopify_token is not null)  as shopify_moved,
  (select count(*) from syte_suite_clients where wp_app_password is not null and wp_app_password not in ('', 'stored-server-side')) as wordpress_left_public,
  (select count(*) from syte_suite_clients where shopify_token is not null and shopify_token not in ('', 'stored-server-side'))     as shopify_left_public;
