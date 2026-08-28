# Automated CMS Publishing — Edge-Case Plan

> **This is the original planning document (2026-08-04), kept for the edge-case
> catalogue and the reasoning behind the design. It is NOT a status report — most
> of it is built.** For what actually exists today, what is deliberately parked,
> and the go-live checklist, see [cms-publishing-status.md](../../cms-publishing-status.md).
>
> Deviations from this plan worth knowing: the phasing changed (WordPress and
> Shopify were both built rather than split across weeks); client-approval-by-email
> was pulled forward from "phase 2" into scope because Chris otherwise still has to
> chase those clients by hand; and publish-without-review was designed but
> deliberately left disabled pending a conversation with Chris.

**Goal:** Push generated articles into each client's CMS as **drafts for review**, with no human paste step, for a first batch of clients in ~3 weeks — without any client's blog layout/formatting breaking.

**Locked decisions (from Mike / meeting):**
- Drafts for review first. No auto-publish in phase 1.
- WordPress is the most promising path today (push pipeline already works end-to-end); Shopify clients are the likely first batch but Shopify needs real build work (browser-blocked API calls, no proxy, no formatting).
- The #1 bottleneck is **per-client layout variability** — each client's blog renders content differently, so "one HTML output for everyone" will look wrong somewhere.

**Core design answer to the bottleneck:** a **per-client Publishing Profile** — a stored config per client that captures how *their* blog expects content to arrive — plus a **verification step** that renders/fetches the created draft and checks it before a human ever reviews it. Generic output + per-client profile + automated check, instead of per-client custom code.

---

## 1. Edge-case catalog — WordPress (layout & formatting)

These are the ways a structurally identical draft renders differently per client:

| # | Edge case | Why it happens | Mitigation |
|---|-----------|----------------|------------|
| W1 | **Theme double-renders the H1** — post title appears twice because our HTML body also starts with an `<h1>` | `parseArticleBody` (wordpressPush.js) keeps the article's first heading in the body while WP also renders `post_title` | Profile flag `strip_leading_h1` (default **true**); parser removes the first H1 and uses it as the title |
| W2 | **Page builders (Elementor, Divi, WPBakery, Gutenberg-heavy themes)** ignore or mangle `post_content` raw HTML | Builders store layout in meta/shortcodes; plain HTML posts render unstyled or in a "classic" fallback template | Profile field `editor_type`: `classic-html` (default), `gutenberg` (wrap content in block comments — `<!-- wp:paragraph -->` etc.), `builder-manual` (flag client as "draft lands as plain content; AM finishes layout in builder"). Detect via `wp/v2/posts?per_page=1` on an existing post and inspect its content for block/shortcode markers |
| W3 | **Custom post type / custom blog location** — client blog isn't `wp/v2/posts` (e.g. `news`, `insights` CPT) | Meeting notes: "custom blog locations create per-client variability" | Profile field `post_type_rest_base` (default `posts`); connector test enumerates `wp/v2/types` and lets the AM pick |
| W4 | **Category/author/template defaults** — drafts land uncategorized under the API user, possibly wrong page template | We send no `categories`, `author`, or `template` today | Profile fields `default_category_id`, `default_author_id`, optional `template`; connector UI fetches the lists so the AM picks once at onboarding |
| W5 | **Image handling differs** — some themes need `featured_media` only, some render it above content (duplicate hero), some need the image inline | Theme-dependent featured-image placement | Profile flag `hero_mode`: `featured-only` (default), `inline-only`, `both`. Onboarding check: fetch an existing post's rendered page and see whether featured image appears in the article body |
| W6 | **SEO plugin variance (Yoast vs RankMath vs none)** — meta fields differ and currently **fail silently** (`metaStatus = 'failed'` swallowed) | Meta keys need REST registration via a helper snippet; each plugin has different keys | Profile field `seo_plugin` (auto-detect via `wp/v2` route inspection); make meta failure **loud**: draft still created, but queue row marked `pushed_with_warnings` and surfaced in UI. Onboarding checklist includes installing the snippet |
| W7 | **Markdown → HTML conversion gaps** — tables, code blocks, blockquotes, nested lists produced by Claude may not survive `markdownToHtml` or the theme's CSS | Our converter is minimal; themes style only common tags | Golden-file tests for the parser covering every structure the prompts can emit; restrict content prompts to a "safe subset" (h2/h3, p, ul/ol, strong/em, img, a) declared per profile |
| W8 | **Media upload failures** (image too large, WP upload limits, missing MIME support, disk quota) | `wp-proxy` uploads base64 PNG; hosts vary wildly | Push proceeds without image but flags `pushed_with_warnings`; retry with resized image (cap ~1600px / <1MB) before giving up |
| W9 | **Slug collisions / re-push duplicates** — pushing the same article twice creates two drafts | Create is a plain POST | Before create, look up by slug (endpoint already exists in wpApi.js); on hit, **update** the existing draft instead of creating |
| W10 | **Security/hosting quirks** — WAFs (Wordfence, Cloudflare) blocking REST writes, Basic Auth disabled, cookie-only auth, non-standard `wp-json` path, HTTP-only sites | Agency clients on cheap/varied hosting | Connector test (already exists as `users/me`) expanded into an **onboarding health check** that must pass before a client enters the batch: REST reachable, auth OK, can create+delete a test draft, media upload OK, SEO meta OK. Result stored on the client record as `publish_readiness` |

## 2. Edge-case catalog — Shopify

Shopify themes are more uniform (per the meeting), but our integration is the weak side:

| # | Edge case | Mitigation |
|---|-----------|------------|
| S1 | **Browser-blocked API calls** — Admin API rejects browser-origin requests; current `shopifyPush.js` can't work in production | New `shopify-proxy` Netlify function mirroring `wp-proxy` (with the auth fix in §4) |
| S2 | **Multiple blogs per store** — code currently always picks `blogs[0]` | Profile field `shopify_blog_id`; connector lists blogs, AM picks |
| S3 | **No markdown conversion** — raw Claude output pushed as `body_html` | Reuse the same `markdownToHtml` + `parseArticleBody` path WordPress uses |
| S4 | **SEO metafields orphaned** — created with no `owner_id`, so they attach to nothing | Use the article's own `metafields` on create, or set `owner_id`/`owner_resource: article` after create; verify via GET |
| S5 | **Theme snippet variance** — Online Store 2.0 vs vintage themes render article HTML differently (image sizing, heading scale) | Same `hero_mode` / safe-subset approach as WP; verification render check (§3) catches the rest |
| S6 | **Featured image** — Shopify articles take `image.src`/attachment; we send none | Add image upload (base64 attachment on the article create call) |

## 3. Cross-cutting: verify before a human reviews

The layout bottleneck can't be fully solved by config — so every push gets an automated **post-push verification**:

1. After draft creation, fetch the draft's rendered/preview state (WP: `?preview=true` via authenticated fetch or the REST `content.rendered`; Shopify: article GET).
2. Structural checks (cheap, deterministic): exactly one H1 on page, hero image present per `hero_mode`, no raw markdown artifacts (`##`, `**`, code fences), no empty body, meta title/description present.
3. Optional Claude vision check (screenshot of preview → "does this look like a normal post on this blog?") for the batch pilot phase — expensive but catches theme weirdness config can't.
4. Result recorded on the queue row: `verified` / `pushed_with_warnings` / `failed`. Reviewers see warnings inline; nothing silently looks broken.

## 4. Cross-cutting: operational edge cases (must fix before batch automation)

| Issue | Mitigation |
|-------|------------|
| `wp-proxy` is an **unauthenticated open relay** (CORS `*`) | Require a shared secret header checked in the function (env `PROXY_AUTH_SECRET`), same for the new `shopify-proxy`; restrict CORS to the app origin |
| Credentials in plaintext, browser-passed | Phase 1 (human-triggered batch): acceptable to keep browser-triggered flow. Phase 2 (scheduled): move pushes server-side; functions read creds via Supabase service role; encrypt columns (pgcrypto) or move to a vault table |
| No batch runner / retries | "Push batch" action: iterates selected clients' approved articles, sequential per site with per-platform rate limiting, 2 retries with backoff, per-item status — never abort the whole batch on one failure |
| Silent failures | Every non-fatal degradation becomes a visible `pushed_with_warnings`; batch run ends with a summary (n pushed / n warnings / n failed) persisted to the queue table |
| Draft review workflow | Reuse existing `syte_suite_cms_queue` statuses + `admin_url` links: reviewer gets a checklist view of "drafts awaiting review" with direct edit links per CMS |

## 5. Data model addition

One new concept: `publishing_profile` (JSONB column on the client record, or a small table):

```sql
alter table syte_suite_clients add column publishing_profile jsonb default '{}';
-- keys: editor_type, post_type_rest_base, strip_leading_h1, hero_mode,
--       default_category_id, default_author_id, seo_plugin,
--       shopify_blog_id, safe_subset, publish_readiness (health-check result + timestamp)
```

Defaults are chosen so an empty profile behaves exactly like today's code — profiles only *override*.

## 6. Phasing (fits the ~3-week target)

**Week 1 — WordPress hardening + profiles:** publishing profile schema + connector onboarding health check (W10), parser fixes (W1, W7, W9), loud meta failures (W6), proxy lockdown (§4). Pilot with 2–3 friendly WP clients across different themes (ideally one classic, one Gutenberg, one builder).

**Week 2 — Shopify build-out:** `shopify-proxy` function (S1), blog selection (S2), shared formatting path (S3), metafield fix (S4), image (S6). Pilot 1–2 Shopify stores.

**Week 3 — Batch + verification:** batch runner with retries and summary, post-push verification checks (§3), review-queue UI polish, run the first real client batch as drafts, collect AM feedback.

## 7. Open questions (for Mike / Chris)

1. Which 2–3 WP clients and 1–2 Shopify stores make good pilots (diverse themes, forgiving relationships)?
2. Chris connected Claude to Webflow/Shopify already — is his Shopify auth flow (custom app tokens per store?) something we should reuse for the connector onboarding?
3. For builder-based WP sites (Elementor/Divi): is "draft lands as plain content, AM applies layout" acceptable for batch 1, or are those clients out of scope?
4. Who reviews drafts — the assigned AM per client? (Determines whether the review queue needs assignment/notification.)
5. Are there clients on neither WP nor Shopify in the intended batch (Webflow, custom)? If so they stay on the manual/ZIP path for now.
