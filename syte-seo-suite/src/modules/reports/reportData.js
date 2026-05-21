// Fetch all data needed for a monthly SEO report in one call.
// Returns: { traffic, conversions, keywords, topPages }
//
// traffic:     { current, previous, yoy } — organic users + sessions
// conversions: { current, previous, yoy } — transactions+revenue (ecommerce) or key_events (lead_gen)
// keywords:    [{ query, position, prevPosition, change, clicks, impressions, ctr }]
// topPages:    [{ page, clicks, impressions, position }]

import { ensureToken, SCOPES } from '../technical/googleAuth.js';
import { querySearchAnalytics } from '../technical/gsc.js';
import { buildKeywordBuckets, classifyKeywords } from './keywordBuckets.js';

// ─── Date helpers ────────────────────────────────────────────
function monthRange(year, month) {
  // month is 0-based
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0); // last day
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function getReportPeriods(year, month) {
  // month is 0-based (0=Jan)
  const current = monthRange(year, month);
  const prev = monthRange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  const yoy = monthRange(year - 1, month);
  return { current, prev, yoy };
}

// ─── GA4 Organic Traffic + Conversions ───────────────────────
// `expectedEmail` pins which cached Google-account token gets used —
// supports the per-API binding where GA4 lives under a different Google
// account than GSC for the same client.
async function fetchGA4Period(propertyId, dateRange, clientType, expectedEmail = null) {
  const token = await ensureToken([SCOPES.ga4], { expectedEmail });

  // Base metrics always needed.
  const metrics = [
    { name: 'totalUsers' },
    { name: 'sessions' }
  ];

  // Add conversion metrics based on client type.
  if (clientType === 'ecommerce') {
    metrics.push({ name: 'transactions' });
    metrics.push({ name: 'purchaseRevenue' });
  } else {
    // lead_gen or unset — use key_events (GA4's conversion count)
    metrics.push({ name: 'keyEvents' });
  }

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics,
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { matchType: 'EXACT', value: 'Organic Search' }
          }
        }
      })
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('GA4 ' + res.status + ': ' + txt.slice(0, 200));
  }
  const data = await res.json();
  const row = data.rows?.[0];
  if (!row) {
    return { users: 0, sessions: 0, conversions: 0, revenue: 0 };
  }
  const vals = row.metricValues || [];
  const result = {
    users: Number(vals[0]?.value || 0),
    sessions: Number(vals[1]?.value || 0)
  };
  if (clientType === 'ecommerce') {
    result.conversions = Number(vals[2]?.value || 0); // transactions
    result.revenue = Number(vals[3]?.value || 0);      // purchaseRevenue
  } else {
    result.conversions = Number(vals[2]?.value || 0); // keyEvents
    result.revenue = 0;
  }
  return result;
}

// ─── GSC Keyword Rankings ────────────────────────────────────
// Paginate through GSC to pull up to MAX_KEYWORD_ROWS keywords. The
// flat top-N-by-impressions pull was missing low-volume head terms
// that rank in the top 3 — those keywords have small impressions but
// huge commercial weight. Pulling 10k rows makes sure every keyword
// the brand has any meaningful presence on is included in the buckets.
const MAX_KEYWORD_ROWS = 10000;
const PAGE_SIZE = 2500;

async function fetchKeywordRankings(gscProperty, dateRange, expectedEmail = null) {
  const all = [];
  for (let startRow = 0; startRow < MAX_KEYWORD_ROWS; startRow += PAGE_SIZE) {
    const page = await querySearchAnalytics(gscProperty, {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['query'],
      rowLimit: PAGE_SIZE,
      startRow,
      expectedEmail
    });
    const rows = page.rows || [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break; // No more rows.
  }
  return { rows: all };
}

async function fetchTopPages(gscProperty, dateRange, expectedEmail = null) {
  return querySearchAnalytics(gscProperty, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    dimensions: ['page'],
    rowLimit: 20,
    expectedEmail
  });
}

// ─── Main Report Data Fetcher ────────────────────────────────
// year/month are the report month (month is 1-based for UX, converted to 0-based internally).
export async function fetchReportData(client, year, month1Based) {
  const month = month1Based - 1; // convert to 0-based
  const periods = getReportPeriods(year, month);
  const clientType = client.client_type || 'lead_gen';
  const errors = [];

  // Per-API account binding. The agency has clients where GA4 lives in
  // one Google account and Search Console lives in another (e.g. brand
  // owns GSC, agency hosts GA4). Each fetcher uses its own binding,
  // falling back to the legacy single google_account_email for clients
  // set up before the per-API fields existed.
  const ga4Email = client.ga4_account_email || client.google_account_email || null;
  const gscEmail = client.gsc_account_email || client.google_account_email || null;

  // 1. GA4 traffic + conversions (3 periods in parallel)
  let traffic = { current: null, previous: null, yoy: null };
  if (client.ga4_property_id) {
    try {
      const [cur, prev, yoy] = await Promise.all([
        fetchGA4Period(client.ga4_property_id, periods.current, clientType, ga4Email),
        fetchGA4Period(client.ga4_property_id, periods.prev, clientType, ga4Email),
        fetchGA4Period(client.ga4_property_id, periods.yoy, clientType, ga4Email)
      ]);
      traffic = { current: cur, previous: prev, yoy };
    } catch (e) {
      errors.push('GA4: ' + e.message);
    }
  } else {
    errors.push('GA4: No property ID configured');
  }

  // 2. GSC keyword rankings (current + previous for comparison)
  let keywords = [];
  let topPages = [];
  if (client.gsc_property) {
    try {
      await ensureToken([SCOPES.gsc], { expectedEmail: gscEmail });
      const [curKw, prevKw, pages] = await Promise.all([
        fetchKeywordRankings(client.gsc_property, periods.current, gscEmail),
        fetchKeywordRankings(client.gsc_property, periods.prev, gscEmail),
        fetchTopPages(client.gsc_property, periods.current, gscEmail)
      ]);

      // Build keyword comparison table.
      const prevMap = {};
      for (const row of (prevKw.rows || [])) {
        const q = row.keys?.[0];
        if (q) prevMap[q] = row;
      }

      keywords = (curKw.rows || []).map(row => {
        const query = row.keys?.[0] || '';
        const position = Number(row.position?.toFixed(1) || row.position || 0);
        const prev = prevMap[query];
        const prevPosition = prev ? Number(prev.position?.toFixed(1) || prev.position || 0) : null;
        return {
          query,
          position,
          prevPosition,
          change: prevPosition != null ? +(prevPosition - position).toFixed(1) : null, // positive = improved
          clicks: row.clicks || 0,
          impressions: row.impressions || 0,
          ctr: row.ctr ? (row.ctr * 100).toFixed(1) + '%' : '0%'
        };
      }).sort((a, b) => b.impressions - a.impressions);

      topPages = (pages.rows || []).map(row => ({
        page: row.keys?.[0] || '',
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        position: Number(row.position?.toFixed(1) || 0)
      }));
    } catch (e) {
      errors.push('GSC: ' + e.message);
    }
  } else {
    errors.push('GSC: No property configured');
  }

  // Compute changes.
  function pctChange(current, previous) {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return +(((current - previous) / previous) * 100).toFixed(1);
  }

  // Classify each keyword (head-term / long-tail / branded) and build
  // bucketed views — top 3, top 10, improved, striking distance, head
  // term wins. Branded queries are excluded from the showcase buckets
  // since they would rank #1 regardless of SEO work.
  const classifiedKeywords = classifyKeywords(keywords, client.name);
  const keywordBuckets = buildKeywordBuckets(classifiedKeywords, client.name);

  const summary = {
    clientType,
    period: periods,
    traffic: {
      ...traffic,
      momChange: traffic.current && traffic.previous ? {
        users: pctChange(traffic.current.users, traffic.previous.users),
        sessions: pctChange(traffic.current.sessions, traffic.previous.sessions),
        conversions: pctChange(traffic.current.conversions, traffic.previous.conversions),
        revenue: pctChange(traffic.current.revenue, traffic.previous.revenue)
      } : null,
      yoyChange: traffic.current && traffic.yoy ? {
        users: pctChange(traffic.current.users, traffic.yoy.users),
        sessions: pctChange(traffic.current.sessions, traffic.yoy.sessions),
        conversions: pctChange(traffic.current.conversions, traffic.yoy.conversions),
        revenue: pctChange(traffic.current.revenue, traffic.yoy.revenue)
      } : null
    },
    keywords: classifiedKeywords,
    keywordBuckets,
    topPages,
    errors
  };

  return summary;
}
