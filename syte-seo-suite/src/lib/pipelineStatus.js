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

  // Check if this client has verified implementations this month.
  const monthImpls = (implementations || []).filter(
    i => i.client_id === client.id && i.module === 'content' &&
      (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = monthImpls.filter(i => i.verification_status === 'verified');
  if (verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
    };
  }

  // Check if articles were generated this month (from localStorage history).
  const history = loadContentHistory();
  const monthArticles = history.filter(
    h => h.client_id === client.id && (h.created_at || '').slice(0, 7) === m
  );
  if (monthArticles.length > 0) {
    return {
      section: 'articles-written',
      summary: monthArticles.length + ' articles',
      detail: 'Generated, awaiting upload to site'
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
  if (verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
    };
  }

  const clientTasks = (tasks || []).filter(
    t => t.client_id === client.id && (t.created_at || '').slice(0, 7) === m
  );
  if (clientTasks.length > 0) {
    const open = clientTasks.filter(t => t.status === 'open').length;
    const done = clientTasks.filter(t => t.status === 'done').length;
    return {
      section: 'fixes-generated',
      summary: clientTasks.length + ' tasks',
      detail: `${open} open · ${done} done`
    };
  }

  return { section: 'not-scanned', detail: 'No scan run for ' + m };
}

// ─── AEO Engine ──────────────────────────────────────────────────
// Sections: verified-on-site | optimizations-generated | not-run | credentials-missing
export function aeoPipelineStatus(client, implementations, aeoResults, month) {
  const m = month || thisMonth();

  const readiness = readinessFor(client, 'aeo');
  if (readiness.status === 'empty') {
    return { section: 'credentials-missing', detail: readiness.missing.map(f => f.label).join(', ') };
  }

  const monthImpls = (implementations || []).filter(
    i => i.client_id === client.id && i.module === 'aeo' &&
      (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = monthImpls.filter(i => i.verification_status === 'verified');
  if (verified.length > 0) {
    return {
      section: 'verified-on-site',
      summary: verified.length + ' verified',
      detail: verified.map(v => v.title).slice(0, 3).join(', ')
    };
  }

  // Check if AEO optimizations were generated this month.
  const monthResults = Object.values(aeoResults || {}).filter(
    r => r.client_id === client.id && (r.generated_at || '').slice(0, 7) === m
  );
  if (monthResults.length > 0) {
    const totalOpts = monthResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);
    return {
      section: 'optimizations-generated',
      summary: totalOpts + ' optimizations',
      detail: 'Generated, awaiting implementation'
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
