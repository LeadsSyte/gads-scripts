# What we need from Chris Beach — Automated CMS Publishing kickoff

Chris is the main point of contact: he currently runs the suite and does the manual copy-paste publishing, so he holds both the credentials and the tribal knowledge about each client's blog quirks.

## 1. Scope: collect ALL credentials upfront (per Mike's 2-week target)

We ran CMS detection on all 57 client sites (2026-08-05). Breakdown:
- **34 WordPress** + **6 Shopify** (bamdiy, Cuddledown, Ixaxa, Milwaukee Motorcycle Clothing, Valco Baby USA, Vitamin G) → these 40 need credentials
- 14 Custom/Other (incl. the 3 Ferrari dealer sites) → phase 3: each needs its own connection built (per-site integration); they stay on the ZIP/manual path until then, no credentials needed yet
- 2 Webflow (Yonda Tax, RAIDS AI) → phase 3 quick win, via Chris Fourie's existing Webflow work
- 1 Wix (18 On The Hill) → phase 3, hardest of the bunch (Wix requires an installed app + OAuth); manual until then

Rollout order is by client count: WordPress (34) → Shopify (6) → custom/other (17). Sequencing is ours; scope is Mike's call.

**Ask Chris to start credential collection for all 40 WP/Shopify sites immediately** — this is the long-pole ops task. From those 40, he flags:
- **FIRST, before anything else:** identify any of the 40 where he has **no admin access** (client-held sites) and start chasing that access with those clients on day 1 — it's the longest-turnaround item in the project. Client contact is entirely Syte's side; our job starts when credentials land in the connector.
- **2–3 WordPress + 1–2 Shopify** as the pilot batch (diverse themes; forgiving client relationships)
- For the pilot sites only, his one-line answer: *"anything weird about this blog?"* (custom blog location, formatting rules, mandatory categories). The automated health check covers the rest of the fleet.

## 2. Credentials per client (all 40)

**These should be entered directly into the suite's CMS Connector page (CMS module → select client), not emailed or messaged to anyone.**

**WordPress (per site) — ~3 minutes each:**
- WP admin URL
- An **Application Password** (WP admin → Users → Profile → Application Passwords). NOT the normal login password. His own user is fine for speed; a dedicated `syte-suite` Editor user is preferred where easy (so posts aren't attributed to him personally), but must not slow collection down.
- (We auto-detect the SEO plugin — he doesn't need to note it.)

**Shopify (per store) — ~5 minutes each:**
- Store URL (`*.myshopify.com`)
- A **custom app Admin API token** with scopes: `write_content` and `read_content`. (Store admin → Settings → Apps → Develop apps → create app → configure Admin API scopes → install → reveal token.)
- (Blog selection happens later in the connector UI — it lists the store's blogs; nothing to note now.)

## 3. His current manual process (screen recording)

A screen recording (Loom or similar) where Chris publishes ONE article the manual way, per platform — WordPress and Shopify. No scheduling needed; he records when convenient. Ask him to **talk out loud while doing it** (or send short notes with it) and make sure every step is visible on screen. We're watching for the things he does without thinking:
- Where in the CMS he pastes, and what he fixes up after pasting (headings, images, spacing)
- How he sets category/author/tags/featured image
- What he fills in for SEO title/description
- What per-client differences he silently compensates for — this feeds the per-client Publishing Profiles directly

## 4. Prior automation work — this one is for **Chris Fourie**, not Chris Beach

Per the meeting, it was Chris Fourie who connected Claude to Webflow and Shopify for publishing (and he's confirming technical feasibility).
- Where does that code/config live? Can we see it?
- How does his Shopify auth work (custom app per store? which scopes)? If it's solid we reuse his approach for our connector.
- What were the manual steps he couldn't automate (connecting each new store, draft themes) — so we don't re-hit the same walls.

## 5. Approval flow — per-client answers needed (added after build started)

The approval pipeline is built with two modes, set per client:
- **Team approves**: draft-ready email goes to one address per client (whoever manages that account); they click Approve in the suite; auto-publishes within 15 min.
- **Client approves**: the client gets the article by email with one-click Approve / Request changes buttons; no login. Approve auto-publishes.

Per client, we need from Chris (three extra columns on the access sheet works):
1. **Reviewer email** — who should get the "draft ready" email (him? the account manager?)
2. **Client approves first?** — yes/no, and if yes the client contact's email
3. **Any clients that need NO review at all?** — i.e. content can go straight live. We have an "auto-publish without review" mode designed but deliberately NOT enabled anywhere — before offering it we need to understand their current process (do some clients simply trust the drafts? does another service feed content in?). Question, not assumption.

## 5b. Approval flow reality-check (original questions)

- Which clients insist on approving posts before they go live, and how does that approval happen today (email? WhatsApp?)
- Who should get the "draft ready for review" notification per client — him, the AM, or the client?
- Confirm he's happy being the "green light" clicker in the app for batch 1 (internal approval model).

## 6. General project needs (not from Chris)

- **From Mike:** confirmation of the pilot client list and that drafts-for-review → in-app approve → auto-publish is the agreed flow
- **Access we already have:** repo (GitHub), Netlify (token working), Supabase (via app env)
- **Access still possibly needed:** Supabase dashboard access (service-role key) for the server-side publisher function; Resend dashboard (email sending is already configured in Netlify env)

## Suggested message to Chris

> Hey Chris — we're building the auto-publishing into the SEO suite so the copy-paste step disappears, targeted for ~2 weeks. We've scanned all 57 client sites: 34 are WordPress and 6 are Shopify, so those 40 are the automation fleet. Everything below is what your side needs to provide for this to work — our job is making the system itself work, so client contact and access-chasing stays with you. What we need: (1) TODAY if possible — flag any of those 40 sites where you don't have admin access and start getting it from those clients immediately (that's the slowest-moving part of the whole project); (2) create API access for the rest as you go (WP Application Passwords / Shopify custom-app tokens — 3–5 min per site, guide attached) and enter them straight into the suite's CMS Connector page; (3) pick 2–3 WordPress + 1–2 Shopify as the pilot batch we test first; (4) record a quick screen recording (Loom is fine) of you publishing one post the manual way on each platform — talking through what you're doing as you go — so we capture everything the automation has to replicate. (Separately we'll ask Chris F about the Claude→Shopify/Webflow work he's already done, so we build on it rather than redo it.)
