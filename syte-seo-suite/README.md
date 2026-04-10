# Syte SEO Suite

Unified multi-module SEO tool merging Content Engine, Technical SEO, AEO Engine,
and CMS Push into one React + Vite app backed by Supabase.

## Modules

1. **Content Engine** (accent `#c8ff00`) — AI-drafted SEO articles with brand
   presets loaded from Supabase, streaming output, QA scorecard, .txt/.docx
   export.
2. **Technical SEO** (accent `#ff6b35`) — WebCEO / GSC scans, Claude-triaged
   task board with round-robin assignment and AI verification.
3. **AEO Engine** (accent `#00d4aa`) — 20 AEO optimization types, GA4 top-page
   detection, sitemap parsing with CORS-proxy fallback, batch processing.
4. **CMS Push** (accent `#4dabff`) — Detect and push drafts to WordPress,
   Shopify, or a downloadable ZIP for custom sites. **Never auto-publishes.**

## Deploy

1. `npm install`
2. Rename `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. In the Supabase SQL Editor run the contents of `supabase-schema.sql`.
4. `npm run build`
5. Drag the generated `dist/` folder to https://netlify.com/drop to deploy.
6. (Optional) In the Netlify site's environment variables, set `WEBCEO_KEY` so
   the `/.netlify/functions/webceo-proxy` function can talk to WebCEO.

## First load

- Enter the shared password to unlock the embedded Anthropic API key.
- The app will migrate any legacy localStorage keys
  (`syte-tseo-clients`, `syte-aeo-clients`, `syte-ce-brands`) into
  Supabase on first load. The original keys are **not** deleted.

## CMS Push safety

- WordPress posts are always created with `status: draft`.
- Shopify articles are always created with `published: false`.
- Every successful push returns the admin review URL.
