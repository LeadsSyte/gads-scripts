// The Syte SEO Helper plugin (wordpress-plugin/syte-seo-helper/): download it
// as an installable zip, and ask a client's site whether it has it.
// With the plugin on a site the suite can make the fixes that live in the
// theme (heading levels, redirects, canonical/robots tags, structured data,
// sections on page-builder pages) — see netlify/functions/lib/helperFix.js.

import pluginSource from '../../../wordpress-plugin/syte-seo-helper/syte-seo-helper.php?raw';
import { wpRequest } from './wpApi.js';

export const HELPER_PLUGIN_VERSION = (pluginSource.match(/^\s*\*\s*Version:\s*([\d.]+)/m) || [])[1] || '';

// WordPress → Plugins → Add New → Upload Plugin takes exactly this: a zip
// holding one folder with the plugin file in it.
export async function downloadHelperPlugin() {
  const [{ default: JSZip }, { saveAs }] = await Promise.all([import('jszip'), import('file-saver')]);
  const zip = new JSZip();
  zip.folder('syte-seo-helper').file('syte-seo-helper.php', pluginSource);
  saveAs(await zip.generateAsync({ type: 'blob' }), 'syte-seo-helper-' + HELPER_PLUGIN_VERSION + '.zip');
}

// → { installed, version, upToDate, rules, enabled } | { installed: false, reason }
export async function checkHelperPlugin(client, request = wpRequest) {
  try {
    const s = await request(client, { path: 'syte/v1/status' });
    if (s?.plugin !== 'syte-seo-helper') return { installed: false, reason: 'The site answered, but not with the helper plugin.' };
    return { installed: true, version: s.version, upToDate: s.version === HELPER_PLUGIN_VERSION, rules: s.rules, enabled: s.enabled };
  } catch (e) {
    const msg = String(e.message || e);
    if (/40[13]/.test(msg)) return { installed: false, reason: 'The plugin may be there, but this login is not an Administrator (or the password is wrong).' };
    return { installed: false, reason: 'Not installed on this site.' };
  }
}
