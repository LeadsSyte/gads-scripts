#!/usr/bin/env node
// Create a service API key for the bot API from the command line.
//
//   WP_PROXY_AUTH=<the suite header hash> node scripts/create-api-key.mjs "Riley" read,scan,fix:plan,content [webhook_url]
//
// WP_PROXY_AUTH is the same value as in the Netlify environment (keys are
// managed by staff, so an API key cannot create keys). SUITE_URL overrides
// the live site. The key is printed ONCE — hand it over through a secure
// form, never chat or email.

const [name, scopesArg, webhookUrl] = process.argv.slice(2);
if (!name || !scopesArg) {
  console.error('usage: WP_PROXY_AUTH=… node scripts/create-api-key.mjs "<name>" <scope,scope,…> [webhook_url]');
  process.exit(2);
}
const auth = process.env.WP_PROXY_AUTH;
if (!auth) { console.error('Set WP_PROXY_AUTH (the suite header hash from the Netlify environment).'); process.exit(2); }
const base = (process.env.SUITE_URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');

const body = { name, scopes: scopesArg.split(',').map(s => s.trim()).filter(Boolean) };
if (webhookUrl) { body.webhook_url = webhookUrl; body.webhook_secret = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const res = await fetch(base + '/api/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth }, body: JSON.stringify(body) });
const out = await res.json().catch(() => ({}));
if (!res.ok) { console.error('HTTP ' + res.status + ': ' + (out.error || JSON.stringify(out))); process.exit(1); }
console.log('Key created for', out.name, '(id ' + out.id + ', scopes ' + out.scopes.join(', ') + ')');
console.log('\n  ' + out.key + '\n');
if (body.webhook_secret) console.log('Webhook signing secret (give it with the key):\n\n  ' + body.webhook_secret + '\n');
console.log('This is the only time the key is shown.');
