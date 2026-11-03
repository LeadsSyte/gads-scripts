# Syte SEO Suite — bot API (`/api/v1`)

Every action of the suite for the assistant bot (Riley), through an
authenticated API instead of the UI. Built from the security brief of
2 Nov 2026, Phase 2.

- **Base URL:** `https://syte-seo-suite.netlify.app/api/v1`
- **Spec:** `GET /api/v1/openapi.json` (public, generated from the route table)
- **Code:** `netlify/functions/api-v1.js` → `netlify/functions/lib/apiRouter.js`
  (routes + handlers), `lib/apiCore.js` (keys, jobs, idempotency, audit,
  rate limits, webhooks), `lib/jobStatus.js` (job status derived from the
  suite's state rows), `lib/openapi.js`.
- **Tables:** `supabase-schema-bot-api.sql` — run once in the Supabase SQL
  Editor. The tables are server-only (RLS on, no policy) and
  `supabase-schema-rls-policies.sql` skips them by name.
- **Tests:** `test/{apiCore,jobStatus,apiRouter}.test.mjs`.

## Authentication

`Authorization: Bearer sk_syte_…` — a service API key — or a staff
credential (today the suite's `X-Suite-Auth` header; after Deploy B a staff
sign-in token). Keys are stored hashed and shown once at creation; scopes:
`read`, `scan`, `fix:plan`, `fix:apply`, `content`, `queue:approve`,
`publish`, `settings`. Riley's key gets `read scan fix:plan content` — it can
plan fixes and run content, but cannot apply fixes to a site, approve or
publish. A revoked key gets 401, a missing scope 403.

Create a key (staff only — an API key cannot create keys):

```bash
WP_PROXY_AUTH=<suite header hash> node scripts/create-api-key.mjs "Riley" read,scan,fix:plan,content
```

Add a webhook URL as a third argument to have job completions POSTed to the
bot, signed with `X-Syte-Signature: t=<unix>,v1=<hmac-sha256(secret, t.body)>`.

## Jobs

Anything that runs in the background answers `202 { jobId, job }`. Netlify
starts background functions asynchronously, so the API reads progress from
the same state rows the suite's panels use and reports it on
`GET /jobs/{id}`: `queued → running | planning | applying | undoing → done |
failed | error`. A job whose run never starts fails after 20 minutes. An
identical request while one is in flight returns the existing job
(`existing: true`). `jobs-sweep` (every 2 min) refreshes open jobs and fires
webhooks for bots that do not poll.

## Idempotency, limits, audit

- `Idempotency-Key` header on any mutating call: a replay within 24 h returns
  the original response (`Idempotency-Replayed: true`); the same key with a
  different body is 409.
- Hourly limits per key, 429 with `Retry-After`: scans 10 per client, fixes
  60, writes 120, reads 600 (`API_LIMIT_*` env vars).
- Every mutating call writes a row to `syte_suite_audit_log`; `GET /audit`.

## Endpoints

| Method | Path | Scope | Does |
|---|---|---|---|
| GET | `/clients`, `/clients/{id}` | read | Clients without credentials (`wp_configured`, `shopify_configured` flags instead) |
| POST / PATCH | `/clients`, `/clients/{id}` | settings | Create / update non-credential fields; `publishing_profile` is merged |
| POST | `/clients/{id}/scans/aeo` | scan | aeoscan-run-background → job |
| POST | `/clients/{id}/scans/tech` `{restart}` | scan | techscan-run-background → job |
| GET | `/clients/{id}/aeo/results|history|raw?hash=|deep|rejections` | read | AEO tables |
| GET | `/clients/{id}/tech/tasks?status=|rejections` | read | Technical tasks |
| POST | `/clients/{id}/aeo-fixes` `{url, optKey, action}` | fix:plan / fix:apply | aeofix-background → job |
| POST | `/clients/{id}/tech-fixes` `{taskId, action}` | fix:plan / fix:apply | techfix-background → job |
| POST | `/clients/{id}/autopilot` `{mode: run|push, restart}` | content | autopilot-run-background → job |
| GET | `/clients/{id}/autopilot` | read | This month's run state |
| GET | `/clients/{id}/articles|implementations|external-work|baseline|reports` | read | Content, work, baseline, reports (`?month&type` for one report) |
| POST | `/clients/{id}/external-work` | content | Log work done outside the suite |
| POST | `/clients/{id}/reports` `{type: seo|aeo, month, force}` | content | report / aeoreport background → job |
| GET / PUT | `/settings/autopilot-config` | read / settings | `{report_email}`; the `global` row (provider keys) is unreachable |
| GET | `/jobs`, `/jobs/{id}` | read | Jobs with derived status |
| GET | `/queue?status=` | read | CMS approval queue (approval tokens stripped) |
| POST | `/queue/{id}/approve`, `/reject {reason}` | queue:approve | pushed → approved / changes_requested |
| POST | `/queue/{id}/resubmit` | content | → pushed, notify-draft re-sent |
| POST | `/queue/{id}/unpublish` | publish | 501 for now (suite only) |
| GET | `/audit` | read | Audit log |
| GET / POST | `/keys`, `/keys/{id}/revoke` | staff only | Manage keys |

Example:

```bash
curl -s -X POST https://syte-seo-suite.netlify.app/api/v1/clients/<id>/scans/tech \
  -H "Authorization: Bearer sk_syte_…" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"restart": true}'
# → 202 {"jobId":"…"} ; then
curl -s https://syte-seo-suite.netlify.app/api/v1/jobs/<jobId> -H "Authorization: Bearer sk_syte_…"
```

## Hand-over to Riley (after the SQL has run and a key exists)

Base URL, the OpenAPI URL, the key and (if used) the webhook secret — through
Riley's secure form, never chat or email — and one test client id.

## Not in this version

`/queue/{id}/unpublish` (501), Phase 3 (server-side article writing / rewrite
/ topic research / feedback / report generation endpoints, MCP server).
