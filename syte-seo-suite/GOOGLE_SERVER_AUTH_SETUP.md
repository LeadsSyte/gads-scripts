# Server-side Google auth ("connect once") — setup

Connect each Google account a single time; the server stores a long-lived
refresh token and mints access tokens on demand, so reports never re-prompt
for sign-in. The feature is **off until the env vars below are set**, so
deploying this code changes nothing on its own.

## 1. Google Cloud Console (one-time)

1. APIs & Services → **Credentials** → **Create OAuth client ID** →
   application type **Web application**. (The existing client is "Web/JS
   origins" only; this one needs a redirect URI + secret.)
2. **Authorized redirect URI**:
   `https://<your-netlify-domain>/.netlify/functions/google-oauth-callback`
   (add the deploy-preview/branch domains too if you test there).
3. Note the **Client ID** and **Client secret**.
4. Make sure the **Google Analytics Data API** and **Search Console API** are
   enabled on the project.
5. OAuth consent screen: the scopes (`analytics.readonly`,
   `webmasters.readonly`) are **sensitive** → Google may require app
   **verification**. Add your operators as **test users** to use it
   immediately while verification is pending.

## 2. Supabase (one-time)

Run `supabase-schema-google-accounts.sql` in the SQL editor. It creates
`syte_suite_google_accounts` with **RLS on and no anon policy** — the refresh
tokens are reachable only by the service-role key the functions use. Do **not**
add an allow-all policy to this table.

## 3. Netlify environment variables

| Var | Value |
|-----|-------|
| `GOOGLE_CLIENT_ID` | Web client ID from step 1 |
| `GOOGLE_CLIENT_SECRET` | Web client secret from step 1 |
| `GOOGLE_REDIRECT_URI` | *(optional)* override; defaults to this site's callback |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **service role** key (so token rows stay private) |
| `PROXY_SHARED_SECRET` | *(optional)* if set, the client must send a matching `VITE_PROXY_SHARED_SECRET` |
| `VITE_GOOGLE_SERVER_AUTH` | `true` — **flips the feature on** (build-time) |
| `VITE_PROXY_SHARED_SECRET` | *(optional)* must match `PROXY_SHARED_SECRET` if used |

`VITE_*` vars are build-time, so trigger a redeploy after setting them.

## 4. Connect accounts

Open **Suite Settings → Connected Google Accounts → "+ Connect a Google
account"** once per agency Google account. After that, reports pull GA4 + GSC
with no sign-in prompts.

## Notes

- This does **not** grant data permissions. Each account still needs **Viewer**
  on the GA4 property and **user/owner** on the Search Console property inside
  Google — a 403 there is a Google permission grant, not a login issue.
- If a refresh token is revoked Google-side (password change, access removed),
  the account shows as **expired** in Suite Settings — just reconnect it.
- Rollback: unset `VITE_GOOGLE_SERVER_AUTH` and redeploy to fall straight back
  to the in-browser sign-in flow.
