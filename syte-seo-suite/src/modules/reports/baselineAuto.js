// Automatic Onboarding Baseline — the browser side.
//
// When a client is saved, decide whether to start the server-side baseline
// (netlify/functions/baseline-run-background.js) and start it. The decision
// is pure and node-tested (test/baselineAuto.test.mjs).

// A baseline that came out incomplete (GA4 / Search Console wasn't connected
// yet when the client was added) is filled in when those are connected — but
// only shortly after onboarding, so a months-old starting point is never
// silently replaced.
export const BASELINE_REFILL_DAYS = 45;

// Returns { run: boolean, force: boolean, reason: string }.
//   client   — the client as saved
//   baseline — the client's existing baseline row, or null
export function shouldAutoBaseline(client, baseline, now = new Date()) {
  if (!client?.id) return { run: false, force: false, reason: 'no-client' };
  const hasSource = !!(client.ga4_property_id || client.gsc_property || client.url);
  if (!hasSource) return { run: false, force: false, reason: 'no-sources' };
  if (!baseline) return { run: true, force: false, reason: 'no-baseline' };

  // Only refill baselines the automatic run made — never one someone captured by hand.
  const data = baseline.data || {};
  if (data.baseline?.mode !== 'auto') return { run: false, force: false, reason: 'manual-baseline' };
  const age = now.getTime() - new Date(baseline.captured_at || 0).getTime();
  if (!(age >= 0 && age < BASELINE_REFILL_DAYS * 86400000)) return { run: false, force: false, reason: 'too-old' };

  const src = data.baseline.sources || {};
  const missingGa4 = !!client.ga4_property_id && src.ga4 !== 'ok';
  const missingGsc = !!client.gsc_property && src.gsc !== 'ok';
  if (missingGa4 || missingGsc) return { run: true, force: true, reason: 'fill-missing-search' };
  return { run: false, force: false, reason: 'complete' };
}

// Ask the server to run it. Resolves true when the server accepted the job.
export async function startBaselineRun(clientId, { force = false, trigger = 'auto' } = {}) {
  const { suiteFetch } = await import('../../lib/suiteAuth.js');
  const res = await suiteFetch('/.netlify/functions/baseline-run-background', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, force, trigger })
  });
  return res.status === 202;
}

// Called after a client is saved. Never throws — a baseline that doesn't
// start must not get in the way of saving the client.
export async function maybeAutoBaseline(client) {
  try {
    const { getBaseline } = await import('../../lib/supabase.js');
    const baseline = client?.id ? await getBaseline(client.id) : null;
    const d = shouldAutoBaseline(client, baseline);
    if (!d.run) return d;
    const ok = await startBaselineRun(client.id, { force: d.force, trigger: 'auto' });
    return { ...d, started: ok };
  } catch (e) {
    console.warn('[baseline] auto-capture not started:', e?.message || e);
    return { run: false, force: false, reason: 'error' };
  }
}

// The live run state (syte_suite_settings 'baseline:<id>'), or null.
export async function loadBaselineRunState(clientId) {
  try {
    const { supabase } = await import('../../lib/supabase.js');
    if (!supabase || !clientId) return null;
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'baseline:' + clientId).maybeSingle();
    return data?.data?.client_id ? data.data : null;
  } catch { return null; }
}

export const BASELINE_RUNNING = ['queued', 'traffic', 'technical', 'aeo', 'saving'];
