-- Publishing profile: per-client CMS publishing settings (JSONB).
-- Defaults live in src/modules/cms/publishingProfile.js — an empty object
-- (or missing column value) behaves exactly like pre-profile behavior.
-- Run this in the Supabase SQL editor.

alter table syte_suite_clients
  add column if not exists publishing_profile jsonb not null default '{}'::jsonb;

comment on column syte_suite_clients.publishing_profile is
  'Per-client CMS publishing settings: strip_leading_h1, hero_mode, post_type_rest_base, default_category_id, default_author_id, editor_type, shopify_blog_id. See src/modules/cms/publishingProfile.js for defaults.';
