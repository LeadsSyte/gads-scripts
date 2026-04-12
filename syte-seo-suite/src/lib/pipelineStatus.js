// Compute the monthly pipeline status for a client in each module.
// Uses the implementations table + local history + client readiness
// to determine which of the four sections a client belongs in.

import { readinessFor } from './clientReadiness.js';

const HISTORY_KEY = 'syte-suite-content-history';

function thisMonth() { return new Date().toISOString().slice(0, 7); }

function loadContentHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

// ─── Content Engine ───────────────────────────────────────────────
// Sections: verified-on-site | articles-written | no-articles | credentials-missing
export function contentPipelineStatus(client, implementations, month) {
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

  const history = loadContentHistory();
  const monthArticles = history.filter(
    h => h.client_id === client.id && (h.created_at || '').slice(0, 7) === m
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
    const parts = [written + ' written'];
    if (verifiedCount > 0) parts.push(verifiedCount + '/' + required + ' verified');
    else parts.push('0 verified');
    return {
      section: 'articles-written',
      summary: parts.join(' · '),
      detail: verifiedCount > 0
        ? verifiedCount + ' of ' + required + ' verified — ' + (required - verifiedCount) + ' awaiting verification'
        : 'All ' + required + ' articles written, awaiting upload & verification'
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

  if (!client.wceo_project_id && !client.gsc_property) {
    return { section: 'credentials-missing', detail: 'No WebCEO project or GSC property' };
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

  // Only "verified-on-site" when ALL tasks are done (none open) and verifications exist.
  if (allTasksDone && verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
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
export function aeoPipelineStatus(client, implementations, aeoResults, month) {
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
  const totalOpts = monthResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);
  const allImplemented = totalOpts > 0 && verified.length >= totalOpts;

  // Only "verified-on-site" when all optimizations are implemented + verified.
  if (allImplemented && verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
    };
  }

  if (monthResults.length > 0) {
    const parts = [totalOpts + ' optimizations'];
    if (verified.length > 0) parts.push(verified.length + ' verified');
    const remaining = totalOpts - verified.length;
    if (remaining > 0) parts.push(remaining + ' awaiting implementation');
    return {
      // Only promote when all are verified; otherwise stay in working section.
      section: allImplemented ? 'optimizations-generated' : 'not-run',
      summary: parts.join(' · '),
      detail: verified.length > 0
        ? verified.length + ' of ' + totalOpts + ' optimizations verified'
        : 'Generated, awaiting implementation'
    };
  }

  return { section: 'not-run', detail: 'No AEO run for ' + m };
}

// ─── Approvals matrix ────────────────────────────────────────────
// For each client, return the status of each module this month.
export function approvalsStatus(client, implementations, tasks, aeoResults, month) {
  const m = month || thisMonth();
  return {
    content: contentPipelineStatus(client, implementations, m),
    technical: technicalPipelineStatus(client, implementations, tasks, m),
    aeo: aeoPipelineStatus(client, implementations, aeoResults, m)
  };
}
