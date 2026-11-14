// Website logins for client sites with no API connection (custom sites,
// Wix, Propdata, anything the suite cannot reach): entered once on
// CMS → Connector, kept server-only (syte_suite_client_secrets.site_login,
// supabase-schema-site-logins.sql), and handed to the Grok bot only for a job
// it has claimed on that client. The browser never gets the password back.
//
// Pure; tested in test/siteLogin.test.mjs.

const URL_RE = /^https?:\/\/[^\s]+$/i;

// What the browser may see about a stored login.
export function publicLoginInfo(stored) {
  if (!stored || !stored.username) return { set: false };
  return {
    set: true, login_url: stored.login_url || '', username: stored.username, notes: stored.notes || '',
    has_password: !!stored.password, updated_at: stored.updated_at || null, updated_by: stored.updated_by || null
  };
}

// Merge a save from the form into what is stored. A blank password keeps the
// stored one (the form never shows it). → the new stored value, or throws.
export function mergeLogin(prev, input, { by, now = new Date() } = {}) {
  const login_url = String(input?.login_url || '').trim();
  const username = String(input?.username || '').trim();
  const password = String(input?.password ?? '');
  const notes = String(input?.notes || '').trim();
  if (!username) throw new Error('Enter the username or email used to log in.');
  if (login_url && !URL_RE.test(login_url)) throw new Error('The login page must be a full address starting with https://');
  if (username.length > 200 || login_url.length > 500 || notes.length > 1000 || password.length > 500) throw new Error('One of the fields is too long.');
  const keep = password === '' ? (prev?.password || '') : password;
  if (!keep) throw new Error('Enter the password.');
  return { login_url, username, password: keep, notes, updated_at: now.toISOString(), updated_by: by || '' };
}
