-- Syte SEO Suite — Supabase schema
-- Run this in the Supabase SQL editor.
-- RLS is intentionally left disabled for this build.

create table syte_suite_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text,
  industry text,
  location text,
  context text,
  voice text,
  audience text,
  internal_links text,
  ga4_property_id text,
  gsc_property text,
  wceo_project_id text,
  sitemap_url text,
  sitemap_raw text,
  org_name text,
  author text,
  author_creds text,
  pages_per_month int default 15,
  cms_type text,
  cms_detected boolean default false,
  wp_url text,
  wp_app_password text,
  wp_username text,
  shopify_store text,
  shopify_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table syte_suite_progress (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  module text not null,
  page_path text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table syte_suite_cms_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references syte_suite_clients(id) on delete cascade,
  module text,
  page_url text,
  page_title text,
  change_type text,
  payload jsonb,
  status text default 'pending',
  pushed_at timestamptz,
  error_msg text,
  created_at timestamptz default now()
);

-- Disable RLS for now (enable later for production)
alter table syte_suite_clients disable row level security;
alter table syte_suite_progress disable row level security;
alter table syte_suite_cms_queue disable row level security;
