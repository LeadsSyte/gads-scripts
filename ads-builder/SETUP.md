# Syte Campaign Creator — Netlify Deployment

## Project Structure

```
ads-builder/
├── public/
│   ├── index.html              ← App shell (loads app.jsx dynamically)
│   └── app.jsx                 ← Full React app source
├── netlify/
│   └── functions/
│       ├── claude-proxy.mjs    ← Anthropic API proxy
│       ├── scan-website.mjs    ← Website scanner + AI analysis
│       └── keyword-planner.mjs ← DataForSEO keyword volume lookup
├── netlify.toml                ← Netlify build configuration
├── package.json                ← Dependencies (cheerio)
└── SETUP.md                    ← This file
```

## Environment Variables (set in Netlify Dashboard)

### Claude API (required)
- `ANTHROPIC_API_KEY` — Your Anthropic API key for Claude

### DataForSEO — Keyword Volume (required for keyword validation)
- `DATAFORSEO_LOGIN` — Account email (e.g. you@example.com)
- `DATAFORSEO_PASSWORD` — API password (found in DataForSEO dashboard → API Access)

> The API password is **not** your login password — generate/copy it from the DataForSEO dashboard.

Cost: roughly $0.01–$0.05 per full campaign scan (200 keywords). Pay-as-you-go, no subscription required.

## Deployment

1. Connect this repo to Netlify
2. Set **Base directory** to `ads-builder`
3. Set **Publish directory** to `public`
4. Set **Functions directory** to `netlify/functions`
5. Add the environment variables above
6. Deploy!

## Local Development

```bash
cd ads-builder
npm install
npx netlify dev
```
