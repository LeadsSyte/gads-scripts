# Automated CMS Publishing — where the project stands

**Updated:** 2026-08-28
**Branch:** `feature/cms-publishing-hardening` (10 commits) — **nothing is live yet**
**Blocked on:** client CMS credentials from Chris Beach, and Supabase dashboard access

---

## What this project does

Today the suite writes articles and a person copy-pastes each one into the client's
website by hand. This work removes that step: the suite sends the article straight
into the client's CMS as a hidden draft, tells the right person it's ready, and
publishes it automatically once approved.

The build is finished. It has not been switched on for a single real client, because
no client CMS credentials have been entered yet (only Syte's own site is connected).

## How the finished flow works

1. **Write** — unchanged; the Content Engine writes the article.
2. **Push** — one click (per article, or "Push month to CMS" for a client's whole
   month) creates it as a **hidden draft** in their WordPress or Shopify site.
3. **Check** — the system immediately re-reads the draft from the site and inspects
   what actually landed: leftover raw markdown, a duplicated title, escaped HTML,
   empty body, missing hero image, missing SEO fields. Findings are attached to the
   row so nobody opens a silently broken draft.
4. **Notify** — an email goes out, to whoever that client's settings name:
   - *Team approves* — the reviewer at Syte gets "draft ready", approves in the suite.
   - *Client approves* — the client gets the article itself with **Approve** and
     **Request changes** buttons. No login, no account.
5. **Approve** — one click sets the row to approved.
6. **Publish** — a scheduled job runs every 15 minutes, finds approved rows, and
   flips the draft live. The content never moves again; only its visibility changes.
7. **Rejection loop** — "Request changes" opens a box for the client to say what they
   want changed; that text reaches the team; after the fix, **Re-send for approval**
   issues a fresh link (the old one stops working).

A draft that **fails verification is never emailed to a client** — it goes to the team
with a fix-first note instead.

## Per-client settings (the answer to "every client's blog is different")

We never impose a house style: the client's own theme does all the styling, exactly as
it does today when Chris pastes by hand. What differs per client is *how their site
expects content to arrive*, and that lives in a **Publishing Profile** on each client
(CMS module → Connector):

| Setting | What it decides |
|---|---|
| Strip article H1 | Whether the title comes out of the body (stops themes showing it twice) |
| Hero image placement | Featured image / inline in the body / both / none |
| Post type | For clients whose blog isn't the standard one (e.g. a `news` type) |
| Default category, default author | What every draft lands as |
| Which Shopify blog | For stores with more than one blog |
| Who approves | Team in the suite, or the client by email (+ the address) |

Defaults match current behaviour, so an unconfigured client behaves exactly as before.
Pilot feedback becomes a dropdown change, not a code change.

## Health check

Each client has a **Run Health Check** button: it authenticates, confirms the post type,
creates and deletes a test draft, and checks whether SEO fields are writable. A client
joins a batch only once this passes. The result is stored on the client.

## What is deliberately NOT built

- **Publish with no review at all.** Designed, not enabled anywhere. We don't yet know
  whether any client actually works that way — it's a question for Chris, not an
  assumption to ship. (Roughly an hour to enable if the answer is yes.)
- **A single button that pushes every client at once.** Currently one button per client.
  Waiting on Chris's description of the monthly routine before guessing.
- **Reminder emails** when a client never answers an approval request. Drafts wait
  indefinitely and silently today.
- **Stale drafts in the Monday progress email.**

## Known caveats

- **Shopify has never touched a real store.** No client tokens exist. The code follows
  Shopify's documented API and has 18 tests covering the request shapes, but the first
  pilot store is what proves it. (Writing those tests already caught one real bug: the
  inline-hero mode uploaded no image at all.)
- **SEO fields on WordPress** need a small PHP snippet on sites running Yoast/RankMath,
  or the fields silently fail. The health check reports this per site; the push warns
  loudly instead of swallowing it, as it used to.
- The WordPress proxy function was an **open relay** anyone could push through. It now
  supports an auth gate, switched on by setting `WP_PROXY_AUTH` at go-live.

## Go-live checklist

Run in this order, once credentials exist. Steps 1–3 are one-time.

1. **Database** — in the Supabase dashboard, run `syte-seo-suite/supabase-schema-publishing.sql`
   (adds one column). *Needs dashboard access we don't have yet.*
2. **Netlify environment variables** on the `syte-seo-suite` site:
   - `WP_PROXY_AUTH` — the SHA-256 of the suite password, which closes the open relay
   - `NOTIFY_EMAIL` — fallback recipient for "draft ready" (per-client settings override it)
   - `SUPABASE_SERVICE_KEY` — so the scheduled publisher can work with nobody logged in
   - `ALLOWED_ORIGIN` — `https://syte-seo-suite.netlify.app`
3. **Merge** `feature/cms-publishing-hardening` into `main`; Netlify deploys and registers
   the scheduled publisher automatically.
4. **Per pilot client:** enter credentials → Run Health Check → fix anything it reports.
5. **First real push:** one article, one client, watched end to end — draft appears,
   verification passes, email arrives, approve, confirm it goes live.
6. Then the month-batch for that client, then the rest of the pilots.

## Waiting on

| Item | From | Why it blocks |
|---|---|---|
| CMS credentials for the 42 WordPress/Shopify clients | Chris Beach | Nothing can be pushed anywhere without them |
| Which clients are pilots | Chris Beach | Decides what we test first |
| Reviewer email per client; which clients approve their own posts | Chris Beach | Configures the approval settings |
| Supabase dashboard access | Chris Fourie / Mike | Step 1 and 3 of go-live |
| How the monthly routine actually works | Chris Beach | Shapes the batch button |

The email asking for the first three is drafted and ready to send, with the access
spreadsheet attached (36 WordPress + 6 Shopify + 21 other platforms).
