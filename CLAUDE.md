# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout — two distinct projects

1. **`syte-seo-suite/`** — the main project: a React (Vite) web app, the internal Syte Digital Agency SEO/AEO dashboard. This is what Netlify deploys (site `syte-seo-suite`, base dir `syte-seo-suite`, branch `main`).
2. **Repo root + `clients/` + `tools/`** — legacy Google Ads Scripts (`syte_optimization_core.js`, `LOADER_TEMPLATE.js`, report scripts). These run inside Google Ads, fetched at runtime by per-client loader scripts. The root `README.md` describes these, not the web app. Key policies: no auto keyword addition, no auto-removal of negatives, never auto-pause keywords with historical conversions.

## Commands (run from `syte-seo-suite/`)

```bash
npm run dev            # Vite dev server (port 5173)
npm run build          # production build to dist/
npm test               # node test runner (test/run-all.mjs) + vitest
npm run test:node      # plain-node tests only
npm run test:components  # vitest component tests only
npx vitest run path/to/file.test.jsx   # single component test file
npm run test:e2e       # Playwright e2e tests
npm run test:ai-qa     # AI walkthrough (test/ai-qa/walkthrough.mjs)
```

Environment: copy `.env.example` to `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as the Netlify site env).

## Architecture

- **SPA, no router**: `src/App.jsx` switches between modules via `useState`; each module gets an accent color (`ACCENTS`) and an optional per-module client filter (`SERVICE_FILTER`, keyed on `does_<service>` client flags).
- **Access gate**: `components/LockScreen.jsx` + `lib/auth.js` — a suite password unlocks the app (stored key checked via `getStoredApiKey()`).
- **State**: Zustand store in `src/store/useClients.js` (client list + selection is global; modules read from it).
- **Data**: Supabase (`lib/supabase.js`; `hasSupabase()` guards for no-config mode). Schema lives in the `supabase-schema*.sql` files at the app root — one file per feature area (reports, aeo, settings, RLS policies…). `lib/migration.js` migrates legacy localStorage data into Supabase on first run.
- **Modules** (`src/modules/`): `clients/` (master list, approvals, implementation pipeline, account managers), `content/` (topic research → Claude auto-write → image gen → CMS push), `aeo/` (query discovery, AI-engine probing/citation analysis), `technical/` (crawler, Google Search Console, WebCEO), `reports/` (baseline audits, monthly reports, AEO snapshots, DOCX export via html-docx-js), `cms/` (WordPress/Shopify push, custom ZIP export).
- **External calls go through Netlify functions** (`netlify/functions/`): proxies for Google APIs, OpenAI, WebCEO, WordPress, and generic page fetching (CORS), plus Google OAuth start/callback and a scheduled `weekly-progress` job. Client-side helpers live in `lib/` (`corsProxy.js`, `googleServerAuth.js`, `http.js`).
- **Google auth is two-mode**: client-side OAuth (`modules/technical/googleAuth.js`, silent refresh on app load) and server-managed accounts (`lib/googleServerAuth.js`, see `GOOGLE_SERVER_AUTH_SETUP.md`).
- **AI**: Claude API via `lib/anthropic.js`; content prompts in `modules/content/prompts.js`, report prompts in `modules/reports/reportPrompts.js`.

## CMS publishing pipeline (`src/modules/cms/`)

Built on branch `feature/cms-publishing-hardening`; see `docs/cms-publishing-status.md` for
status, caveats and the go-live checklist. Flow: `pushAction.pushItemInline()` logs a
`syte_suite_cms_queue` row → dispatches to `wordpressPush` / `shopifyPush` (both create
**drafts only**; publishing is never done at push time) → `verifyDraft.verifyPushedDraft()`
re-reads the draft and records findings → `netlify/functions/notify-draft` emails the
reviewer or the client → approval sets status `approved` → the scheduled
`netlify/functions/publish-approved` (every 15 min) flips it live.

- Queue statuses: `pending → pushed` (awaiting review) `→ approved → published`, plus
  `changes_requested`, `failed`, `publish_failed`.
- **Per-client behaviour lives in `publishingProfile.js`** (JSONB column, defaults match
  pre-profile behaviour) — H1 handling, hero placement, post type, category/author,
  Shopify blog, `approval_mode` (`internal` | `client`; an `auto` mode is documented but
  deliberately not surfaced). Never hardcode per-client formatting; add a profile key.
- All CMS traffic goes through `netlify/functions/wp-proxy` and `shopify-proxy`, gated by
  `WP_PROXY_AUTH` (SHA-256 of the suite key, sent as `X-Suite-Auth` via `proxyAuth.js`).
  Shopify's Admin API rejects browser-origin calls, so it *must* use the proxy.
- Pure, node-testable logic is split out deliberately: `parseArticle.js`,
  `publishingProfile.js`, `verifyDraft.js` (`checkDraftContent`). Tests:
  `test/{cmsParse,publishingProfile,approvalFlow,verifyDraft,shopifyPush}.test.mjs`.
  `shopifyPush.test.mjs` patches the network/image imports and writes a temp module
  beside the original so relative imports resolve.
