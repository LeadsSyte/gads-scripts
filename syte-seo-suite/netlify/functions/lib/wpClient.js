// WordPress REST for a client, with its application password:
// wp(path) GETs, wp(path, body) POSTs, wp(path, null, 'DELETE') deletes —
// all against /wp-json/.
export function wpClient(client) {
  const base = client.wp_url.replace(/\/+$/, '') + '/wp-json/';
  const auth = 'Basic ' + Buffer.from(client.wp_username + ':' + client.wp_app_password).toString('base64');
  return async (path, body, method) => {
    const r = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text; try { msg = JSON.parse(text).message || text; } catch { /* raw */ }
      throw new Error('WordPress ' + r.status + ': ' + String(msg).slice(0, 160));
    }
    try { return JSON.parse(text); } catch { return text; }
  };
}

export const hasWordPress = client => client?.cms_type === 'WordPress' && !!client.wp_url && !!client.wp_app_password;
