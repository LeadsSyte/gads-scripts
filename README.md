# Syte Optimization Core — Google Ads Scripts

Automated Google Ads optimization engine used across all Syte Digital Agency client accounts.

## Architecture

- **`syte_optimization_core.js`** — The shared core engine. Hosted in this private repo and fetched by each client's loader script at runtime.
- **`LOADER_TEMPLATE.js`** — Template for client-side loader scripts. Each client gets a copy with their specific CONFIG values pasted into Google Ads Scripts.

## Setup

### 1. Master Google Sheet

Each client loader points to a shared master Google Sheet via `CONFIG.SHEET_URL`.
This sheet needs two tabs:

**ChangeLog tab** (auto-created by the script):
Tracks every action the script takes for outcome analysis.

**Config tab** (create manually):
Holds shared secrets so they don't need to be in every loader.

| Key               | Value                    |
|-------------------|--------------------------|
| ANTHROPIC_API_KEY | Your Anthropic API key   |
| GITHUB_PAT        | Your GitHub PAT          |

### 2. Private Repo Access

This repo is private. Client loaders authenticate using a GitHub Personal Access Token (PAT) stored in the master sheet's Config tab. If the PAT expires or is rotated, update it in ONE place (the sheet) and all loaders pick it up automatically.

To create a PAT:
1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Create a token with **read-only access** to this repo's contents
3. Paste the token into the master sheet Config tab as `GITHUB_PAT`

### 3. Adding a New Client

1. Copy `LOADER_TEMPLATE.js` into Google Ads Scripts for the client account
2. Update the CONFIG values (client name, website, thresholds, protected terms, etc.)
3. Set `CONFIG.SHEET_URL` to the master Google Sheet URL
4. Authorize the script (run once manually to grant Sheets + Ads permissions)
5. Schedule the script to run every 3 days

### 4. Secrets

No secrets (API keys, PATs) should appear in committed code. All secrets live in the master Google Sheet Config tab and are read at runtime:

- **ANTHROPIC_API_KEY** — Read by the core script's `_loadSharedConfig()` function
- **GITHUB_PAT** — Read by the loader's `main()` function before fetching the core

## Policies

- **No auto keyword addition.** The script does not add new keywords. Exact match promotion of converting search terms is allowed.
- **No auto-removal of negatives.** The audit module scans for issues but only reports — never auto-removes negatives or unpauses keywords.
- **Active keyword protection.** Search terms matching active keywords are never auto-negatived. Keywords with historical conversions are never auto-paused.

## Version

Current: **v4.2.1**
