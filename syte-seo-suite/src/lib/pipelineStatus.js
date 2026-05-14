// Compute the monthly pipeline status for a client in each module.
// Uses the implementations table + local history + client readiness
// to determine which of the four sections a client belongs in.

import { readinessFor } from './clientReadiness.js';

const BLOGS_KEY = 'syte-suite-content_blogs';

function thisMonth() { return new Date().toISOString().slice(0, 7); }

// Fallback: read cached content history from localStorage (written by
// loadContentHistory in supabase.js). The caller is expected to pass
// the Supabase-loaded list via the `contentHistory` param when available.
function loadContentHistoryLocal() {
  try { return JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]'); } catch { return []; }
}

// ─── Content Engine ───────────────────────────────────────────────
// Sections: verified-on-site | articles-written | no-articles | credentials-missing
// `contentHistory` is the shared Supabase-backed article list (optional;
// falls back to localStorage cache when undefined).
export function contentPipelineStatus(client, implementations, month, contentHistory) {
  const m = month || thisMonth();

  // Credentials check: needs GSC + basic readiness.
  const readiness = readinessFor(client, 'content');
  if (!client.gsc_property || readiness.status === 'empty') {
    return { section: 'credentials-missing', detail: readiness.missing.map(f => f.label).join(', ') };
  }

  // Gather this month's implementations + articles.
  const monthImpls = (implementations || []).filter(
    i => i.client_id === client.id && i.module === 'content' &&
      (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = monthImpls.filter(i => i.verification_status === 'verified');

  const history = contentHistory || loadContentHistoryLocal();
  const monthArticles = history.filter(
    h => h.client_id === client.id && ((h.generated_at || h.created_at || '').slice(0, 7) === m)
  );

  const required = client.pages_per_month || 4;
  const written = monthArticles.length;
  const verifiedCount = verified.length;
  const quotaMet = written >= required;
  const allVerified = verifiedCount >= required;

  // "Verified on Site" = ALL required articles are verified on the live site.
  if (allVerified) {
    const extra = verifiedCount - required;
    return {
      section: 'verified-on-site',
      summary: verifiedCount + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ') +
        (extra > 0 ? ' (+' + extra + ' bonus)' : '')
    };
  }

  // "Articles Written" = ALL required articles are written, but not all verified yet.
  if (quotaMet) {
    // Both summary and detail use the SAME denominator (written, the
    // actual count of articles in the list) so users don't see a
    // contradiction like "1/2 verified" + "1 of 7 verified" simultaneously.
    // The "need N to advance to Verified on Site" line is what tells them
    // the quota; before this fix users couldn't tell whether the bucket
    // moved on quota (required) or completion (written).
    const parts = [written + ' written'];
    parts.push(verifiedCount + ' verified');
    // We only reach here if allVerified was false above, so verifiedCount
    // < required. remainingForQuota is always >= 1 in this branch.
    const remainingForQuota = required - verifiedCount;
    const detail = verifiedCount === 0
      ? 'All ' + written + ' articles written, awaiting verification. ' +
        'Verify any ' + required + ' to move to Verified on Site.'
      : verifiedCount + ' of ' + written + ' verified — verify ' +
        remainingForQuota + ' more to move to Verified on Site (quota: ' + required + ').';
    return {
      section: 'articles-written',
      summary: parts.join(' · '),
      detail
    };
  }

  // In progress — some articles written but quota not met.
  if (written > 0) {
    const parts = [written + '/' + required + ' articles'];
    if (verifiedCount > 0) parts.push(verifiedCount + ' verified');
    return {
      section: 'no-articles',
      summary: parts.join(' · '),
      detail: written + ' of ' + required + ' articles written — ' + (required - written) + ' remaining'
    };
  }

  return { section: 'no-articles', detail: 'No articles generated for ' + m };
}

// ─── Technical SEO ───────────────────────────────────────────────
// Sections: verified-on-site | fixes-generated | not-scanned | credentials-missing
export function technicalPipelineStatus(client, implementations, tasks, month) {
  const m = month || thisMonth();

  // Crawler-first scan path needs only a website URL or sitemap URL —
  // GSC is optional enrichment, WebCEO is fully deprecated. Bucket as
  // "credentials-missing" only when the crawler has nothing to work with.
  const hasCrawlTarget = !!(client.url || client.sitemap_url);
  if (!hasCrawlTarget && !client.gsc_property) {
    return { section: 'credentials-missing', detail: 'No website URL, sitemap URL, or GSC property' };
  }

  const monthImpls = (implementations || []).filter(
    i => i.client_id === client.id && i.module === 'technical' &&
      (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = monthImpls.filter(i => i.verification_status === 'verified');

  const clientTasks = (tasks || []).filter(
    t => t.client_id === client.id && (t.created_at || '').slice(0, 7) === m
  );
  const open = clientTasks.filter(t => t.status === 'open').length;
  const done = clientTasks.filter(t => t.status === 'done' || t.status === 'verified').length;
  const allTasksDone = clientTasks.length > 0 && open === 0;

  // "Verified on Site" when at least 1 implementation is verified on the live site.
  if (verified.length > 0) {
    const parts = [clientTasks.length + ' tasks'];
    if (verified.length > 0) parts.push(verified.length + ' verified');
    if (open > 0) parts.push(open + ' open');
    return {
      section: 'verified-on-site',
      summary: parts.join(' · '),
      detail: allTasksDone
        ? 'All ' + verified.length + ' fixes verified on site'
        : verified.length + ' of ' + clientTasks.length + ' verified · ' + open + ' still open'
    };
  }

  if (clientTasks.length > 0) {
    const parts = [clientTasks.length + ' tasks'];
    if (done > 0) parts.push(done + ' done');
    if (verified.length > 0) parts.push(verified.length + ' verified');
    if (open > 0) parts.push(open + ' open');
    return {
      // "fixes-generated" = a scan was run and tasks exist (regardless of
      // whether they're all done). "not-scanned" is ONLY for zero tasks.
      section: 'fixes-generated',
      summary: parts.join(' · '),
      detail: allTasksDone
        ? 'All tasks completed, awaiting verification'
        : open + ' of ' + clientTasks.length + ' tasks still open'
    };
  }

  return { section: 'not-scanned', detail: 'No scan run for ' + m };
}

// ─── AEO Engine ──────────────────────────────────────────────────
// Sections: verified-on-site | optimizations-generated | not-run | credentials-missing
export function aeoPipelineStatus(client, implementations, aeoResults, month, deepResults) {
  const m = month || thisMonth();

  // AEO optimizations need a page source — either sitemap URL or GA4 property.
  // Without one, there are no pages to optimize.
  const hasSitemap = !!(client.sitemap_url || client.sitemap_raw);
  const hasGa4 = !!client.ga4_property_id;
  if (!hasSitemap && !hasGa4) {
    const missing = [];
    if (!hasSitemap) missing.push('Sitemap URL');
    if (!hasGa4)     missing.push('GA4 Property');
    return { section: 'credentials-missing', detail: 'Needs: ' + missing.join(' or ') };
  }

  const monthImpls = (implementations || []).filter(
    i => i.client_id === client.id && i.module === 'aeo' &&
      (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = monthImpls.filter(i => i.verification_status === 'verified');

  // Check if AEO optimizations were generated this month.
  const monthResults = Object.values(aeoResults || {}).filter(
    r => r.client_id === client.id && (r.generated_at || '').slice(0, 7) === m
  );
  // ALSO count optimizations from any earlier month — these existed but
  // the strict month filter was hiding them as "not run". Show the
  // client in optimizations-generated with a "stale" note instead of
  // burying them in NOT RUN YET.
  const allClientResults = Object.values(aeoResults || {}).filter(
    r => r.client_id === client.id
  );
  const priorResults = allClientResults.filter(
    r => (r.generated_at || '').slice(0, 7) !== m
  );
  const monthOpts = monthResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);
  const priorOpts = priorResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);
  const totalOpts = monthOpts + priorOpts;

  // Deep optimizations count as real work too. Each deep opt is a full-page
  // rewrite so we count it as 1 "optimization" toward the month's work.
  const monthDeep = (deepResults || []).filter(
    d => d.client_id === client.id && (d.generated_at || '').slice(0, 7) === m
  );
  const allDeep = (deepResults || []).filter(d => d.client_id === client.id);
  const priorDeep = allDeep.filter(d => (d.generated_at || '').slice(0, 7) !== m);
  const deepCount = monthDeep.length + priorDeep.length;
  const totalWork = totalOpts + deepCount;
  const allImplemented = totalWork > 0 && verified.length >= totalWork;
  const isStale = monthResults.length === 0 && monthDeep.length === 0 && (priorResults.length > 0 || priorDeep.length > 0);

  // Only "verified-on-site" when all optimizations are implemented + verified.
  if (allImplemented && verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
    };
  }

  if (totalOpts > 0 || deepCount > 0) {
    const parts = [];
    if (totalOpts > 0) parts.push(totalOpts + ' quick-win optimizations');
    if (deepCount > 0) parts.push(deepCount + ' deep rewrite' + (deepCount > 1 ? 's' : ''));
    if (verified.length > 0) parts.push(verified.length + ' verified');
    const remaining = totalWork - verified.length;
    if (remaining > 0) parts.push(remaining + ' awaiting implementation');
    if (isStale) parts.push('from prior month — re-run for ' + m);
    return {
      section: 'optimizations-generated',
      summary: parts.join(' · '),
      detail: isStale
        ? 'Existing optimizations are from a prior month. Click Run Optimizations to refresh for ' + m + '.'
        : (verified.length > 0
          ? verified.length + ' of ' + totalWork + ' items verified'
          : 'Generated, awaiting implementation')
    };
  }

  return { section: 'not-run', detail: 'No AEO run for ' + m };
}

// ─── Approvals matrix ────────────────────────────────────────────
// For each client, return the status of each module this month.
export function approvalsStatus(client, implementations, tasks, aeoResults, month, contentHistory) {
  const m = month || thisMonth();
  return {
    content: contentPipelineStatus(client, implementations, m, contentHistory),
    technical: technicalPipelineStatus(client, implementations, tasks, m),
    aeo: aeoPipelineStatus(client, implementations, aeoResults, m)
  };
}
