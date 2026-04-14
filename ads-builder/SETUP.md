# Syte Campaign Creator — Netlify Deployment

## Project Structure

```
ads-builder/
├── public/
│   ├── index.html              ← App shell (loads app.jsx dynamically)
│   └── app.jsx                 ← Full React app source (replace placeholder with your code)
├── netlify/
│   └── functions/
│       ├── claude-proxy.mjs    ← Anthropic API proxy
│       ├── scan-website.mjs    ← Website scanner + AI analysis
│       └── keyword-planner.mjs ← Google Ads API keyword volumes
├── netlify.toml                ← Netlify build configuration
├── package.json                ← Dependencies (cheerio, google-ads-api)
└── SETUP.md                    ← This file
```

## Environment Variables (set in Netlify Dashboard)

### Claude API (required)
- `ANTHROPIC_API_KEY` — Your Anthropic API key for Claude

### Google Ads API — Keyword Volume (required for keyword validation)
- `GOOGLE_ADS_DEVELOPER_TOKEN` — Developer token from Google Ads API Centre
- `GOOGLE_ADS_CLIENT_ID` — OAuth2 client ID from Google Cloud Console
- `GOOGLE_ADS_CLIENT_SECRET` — OAuth2 client secret from Google Cloud Console
- `GOOGLE_ADS_REFRESH_TOKEN` — OAuth2 refresh token (generated once via consent flow)
- `GOOGLE_ADS_CUSTOMER_ID` — Google Ads account ID (e.g. 123-456-7890)
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — (optional) Manager account ID. Required ONLY when `GOOGLE_ADS_CUSTOMER_ID` is a child account under an MCC.

> ⚠️ **All keywords returning 0 volume?** Your developer token is likely on **Test Access**. Test tokens return 0 for every keyword regardless of real search volume. Fix: Google Ads → Tools → API Centre → apply for **Basic Access** (free, 1–2 business days).

### Google Ads API Setup Guide

1. **Google Cloud Project**: Create a project at https://console.cloud.google.com
2. **Enable API**: Enable "Google Ads API" in APIs & Services
3. **OAuth2 Credentials**: Create OAuth2 credentials (Web Application type)
4. **Developer Token**: Apply at Google Ads → Tools → API Centre
5. **Refresh Token**: Generate using the OAuth2 playground or a one-time script:
   ```
   https://developers.google.com/oauthplayground/
   → Scope: https://www.googleapis.com/auth/adwords
   → Exchange code for refresh token
   ```
6. **Customer ID**: Your Google Ads account number (visible top-right in Google Ads UI)

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
