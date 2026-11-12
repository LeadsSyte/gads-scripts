// "What we changed this month": the changes Syte actually made, read from
// syte_suite_implementations (every fix the AEO / technical autopilots apply,
// and every change a team member marks as implemented). Only delivered work
// counts: verified on the live page, or handed to the client's developer
// (deliveryStatus.js). Pending, failed and undone rows are never shown.
//
// SEO and AEO are separate reports, so each shows its own modules.
// Pure and dependency-light so it runs in plain-node tests and on the server.

import { isDelivered, isHandoverStatus } from '../../lib/deliveryStatus.js';
import { shiftMonthKey, monthKeyLabel } from './reportMonths.js';

export const REPORT_MODULES = Object.freeze({ aeo: ['aeo'], seo: ['technical', 'content'] });

const MODULE_LABEL = { aeo: 'AEO', technical: 'Technical SEO', content: 'Content' };
const TYPE_LABEL = {
  schema: 'Structured data', meta: 'Meta tags', fix: 'Technical fix', article: 'Article',
  faq: 'FAQ section', aeo_optimization: 'AEO optimisation'
};

export function implMonth(impl) {
  return String(impl?.implemented_at || impl?.created_at || '').slice(0, 7);
}

function pagePath(url) {
  if (!url) return '';
  try { const u = new URL(url); return u.pathname === '/' ? u.hostname : u.pathname; } catch { return String(url); }
}

// First line only: autopilot rows put the inserted HTML in the description,
// and titles occasionally carry it too.
function cleanTitle(s) {
  return String(s || '').split('\n')[0].replace(/<[^>]*>/g, '').trim().slice(0, 140);
}

// impls: implementation rows (any client; filtered here).
// Returns { items, total, byCategory, history } for one report month.
// history: the last `months` months (oldest first, ending at `month`) with
// the number of delivered changes in each, for the month-to-month strip.
export function changeLog(impls, { clientId, kind = 'seo', month, months = 6 } = {}) {
  const modules = REPORT_MODULES[kind] || REPORT_MODULES.seo;
  const delivered = (impls || []).filter(i =>
    (!clientId || i.client_id === clientId) &&
    modules.includes(i.module) &&
    isDelivered(i.verification_status));

  const itemsFor = (key) => {
    const seen = new Set();
    return delivered
      .filter(i => implMonth(i) === key)
      .sort((a, b) => String(a.implemented_at || a.created_at).localeCompare(String(b.implemented_at || b.created_at)))
      .map(i => ({
        category: MODULE_LABEL[i.module] || i.module,
        type: TYPE_LABEL[i.change_type] || '',
        title: cleanTitle(i.title) || TYPE_LABEL[i.change_type] || 'Change',
        page: pagePath(i.page_url),
        url: i.page_url || '',
        status: isHandoverStatus(i.verification_status) ? 'Sent to your developer' : 'Live on your site'
      }))
      // The same change re-logged on the same page is one change to the client.
      .filter(it => { const k = it.title + '|' + it.page; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const items = month ? itemsFor(month) : [];

  const byCategory = {};
  items.forEach(it => { byCategory[it.category] = (byCategory[it.category] || 0) + 1; });

  const history = [];
  if (month) {
    for (let d = months - 1; d >= 0; d--) {
      const key = shiftMonthKey(month, -d);
      history.push({ month: key, label: monthKeyLabel(key), count: itemsFor(key).length });
    }
  }
  return { items, total: items.length, byCategory, history };
}
