# Syte Campaign Creator — Netlify Deployment

## Project Structure

```
ads-builder/
├── public/
│   └── index.html          ← Place the full app HTML here
├── netlify/
│   └── functions/
│       ├── claude-proxy.mjs     ← Anthropic API proxy
│       ├── scan-website.mjs     ← Website scanner + AI analysis
│       └── keyword-planner.mjs  ← DataForSEO keyword volumes
├── netlify.toml             ← Netlify build configuration
├── package.json             ← Dependencies (cheerio for scan-website)
└── SETUP.md                 ← This file
```

## Environment Variables (set in Netlify Dashboard)

Required:
- `ANTHROPIC_API_KEY` — Your Anthropic API key for Claude
- `DATAFORSEO_LOGIN` — DataForSEO account login
- `DATAFORSEO_PASSWORD` — DataForSEO account password

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
