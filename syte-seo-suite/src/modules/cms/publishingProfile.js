// Per-client publishing profile — how THIS client's blog expects content
// to arrive. The pusher never invents a look (the client's theme styles
// everything); the profile only adjusts the structure we send.
//
// Stored as JSONB in syte_suite_clients.publishing_profile (see
// supabase-schema-publishing.sql). An empty/missing profile behaves
// exactly like the defaults below, which match pre-profile behavior —
// profiles only override.

export const PROFILE_DEFAULTS = {
  // Pull the article's H1 out of the body and use it as the post title.
  // Nearly every theme renders the title itself; keeping the H1 in the
  // body shows a double title. Set false for the rare theme that doesn't.
  strip_leading_h1: true,

  // Where the hero image goes:
  //   'featured-only' — set as the post's featured image (default)
  //   'inline-only'   — placed at the top of the body instead (for themes
  //                     that don't render the featured image on the post)
  //   'both'          — featured image AND inline at the top
  //   'none'          — skip image generation entirely for this client
  hero_mode: 'featured-only',

  // REST base of the post type the client blogs under. 'posts' for a
  // normal blog; a custom post type's rest_base (e.g. 'news') otherwise.
  post_type_rest_base: 'posts',

  // WP term/user IDs applied to every draft. null = let WP use its defaults.
  default_category_id: null,
  default_author_id: null,

  // How the site's editor stores content. 'classic-html' posts plain HTML
  // (works on classic + most themes). 'builder-manual' flags that drafts
  // land as plain content and the AM finishes layout in the page builder.
  editor_type: 'classic-html',

  // Shopify: which blog articles go to. null = first blog on the store.
  shopify_blog_id: null,
};

export function getPublishingProfile(client) {
  let raw = client?.publishing_profile;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  return { ...PROFILE_DEFAULTS, ...raw };
}
