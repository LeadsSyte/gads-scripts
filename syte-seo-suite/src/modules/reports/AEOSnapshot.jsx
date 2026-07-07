import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { snapshotPreflight, runSnapshot, estimateRunCost } from './aeoRunner.js';
import { normalizeSnapshot } from './aeoCompare.js';
import { saveAeoSnapshot, listAeoSnapshots, getCachedReportData, persistAeoRuns } from '../../lib/supabase.js';
import { ALL_ENGINES } from './aeoEngines.js';
import { readinessFor } from '../../lib/clientReadiness.js';
import { probeCandidatesFromGSC, groundedProbeSet } from './keywordBuckets.js';
import { buildDiscoveryQueries, runDiscoverySweep, extractSitePhrases } from './aeoDiscovery.js';
import { buildGoldProbesForClient } from './gridProfile.js';
import { groundClientForAeo, probeSetHealth } from './grounding.js';
import { parseCensus, intentCoverage, INTENT_BUCKETS } from './aeoCensus.js';
import { generateFanout } from './aeoFanout.js';
import { parseProbes, migrateClientProbes, addProbes, probesToProbeList } from './aeoProbes.js';

const ACCENT = '#a78bfa';

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)';
  if (s < 40)  return 'var(--red)';
  if (s < 70)  return 'var(--orange)';
  return 'var(--green)';
}

// Horizontal SVG bar for an engine score (0-100).
function ScoreBar({ value, label }) {
  const w = Math.max(0, Math.min(100, value || 0));
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 12, color: scoreColor(value), fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: w + '%', height: '100%', background: scoreColor(value), transition: 'width .4s' }} />
      </div>
    </div>
  );
}

export default function AEOSnapshot() {
  const client = useClients(s => s.current());
  const allClients = useClients(s => s.clients);
  const selectClient = useClients(s => s.select);
  const saveClient = useClients(s => s.save);
  const [preflight, setPreflight] = useState(null);
  const [progress, setProgress] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null); // for delta calc
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [gscCandidates, setGscCandidates] = useState([]);
  const [expandBusy, setExpandBusy] = useState(false);
  // Discovery state
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState(null);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [discoverySelected, setDiscoverySelected] = useState(new Set());

  // Bulk-run state
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [pendingMonthly, setPendingMonthly] = useState([]);
  const [iterations, setIterations] = useState(3);
  // Fan-out "Discovered prompts" approval queue.
  const [fanoutProposals, setFanoutProposals] = useState([]);
  const [fanoutBusy, setFanoutBusy] = useState(false);
  // Cost preview: block a run above this many model calls until confirmed.
  const [callBudget, setCallBudget] = useState(400);

  // Compute the list of AEO-enabled clients that haven't had a snapshot
  // yet this month. Runs once when clients load.
  useEffect(() => {
    (async () => {
      const thisMonth = new Date().toISOString().slice(0, 7);
      const aeoClients = allClients.filter(c => {
        if (c.does_aeo === false) return false;
        const readiness = readinessFor(c, 'aeo');
        return readiness.status === 'ready';
      });
      const pending = [];
      for (const c of aeoClients) {
        try {
          const rows = await listAeoSnapshots(c.id);
          const hasThisMonth = rows.some(r => r.month === thisMonth);
          if (!hasThisMonth) pending.push(c);
        } catch {}
      }
      setPendingMonthly(pending);
    })();
  }, [allClients]);

  useEffect(() => {
    if (!client) { setPreflight(null); setSnapshot(null); setLastSnapshot(null); setGscCandidates([]); return; }
    setPreflight(snapshotPreflight(client));
    setSnapshot(null);
    // Load the most recent saved snapshot for delta comparison.
    listAeoSnapshots(client.id).then(rows => {
      setLastSnapshot(rows[0] || null);
    }).catch(() => {});

    // Sniff cached GSC report data for this client to surface a
    // "expand probe queries from GSC head terms" affordance — these are
    // queries the brand actually gets impressions for, so they map to
    // real visibility, not guessed-up phrases.
    (async () => {
      const months = [];
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toISOString().slice(0, 7));
      }
      let candidates = [];
      for (const m of months) {
        try {
          const cached = await getCachedReportData(client.id, m);
          const kws = cached?.data?.keywords;
          if (kws?.length) {
            candidates = probeCandidatesFromGSC(kws, client.name, { limit: 50 });
            if (candidates.length > 0) break;
          }
        } catch {}
      }
      setGscCandidates(candidates);
    })();
  }, [client?.id]);

  // Build probe objects from a list of queries (for the append-only model).
  function candProbes(queries, { tier = 1, type = 'category', source = 'gsc' } = {}) {
    return (queries || []).map(q => ({ query: q, tier, type, intent: 'commercial', source, active: true }));
  }

  async function expandProbeFromGSC() {
    if (!client || !gscCandidates.length) return;
    setExpandBusy(true); setErr(''); setMsg('');
    try {
      // Update the append-only probe model (what the snapshot actually runs),
      // and keep the flat list in sync for back-compat.
      const existing = parseProbes(client) || migrateClientProbes(client);
      const competitors = (client.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      const set = groundedProbeSet(gscCandidates, { geo: client.location || client.market, competitors, limit: 25 });
      const { probes, added } = addProbes(existing, set);
      if (added === 0) {
        setMsg('No new queries — all GSC head terms are already in the probe set.');
      } else {
        await saveClient({ ...client, aeo_probes: probes, aeo_probe_queries: probesToProbeList(probes) });
        setMsg(`Added ${added} GSC head-term probes · probe set now ${probes.length}`);
      }
    } catch (e) {
      setErr('Could not save: ' + e.message);
    } finally {
      setExpandBusy(false);
    }
  }

  // Fetch a client's website server-side (page-proxy) so we can ground
  // discovery in what they actually say they do. Returns '' on any failure.
  async function fetchSiteHtml(url) {
    if (!url) return '';
    try {
      const r = await fetch('/.netlify/functions/page-proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!r.ok) return '';
      const d = await r.json();
      return d.html || '';
    } catch { return ''; }
  }

  // Discovery: dig for everything the AI engines cite this brand for, grounded
  // in Search Console head-terms + the client's own website, then surface the
  // list so the user can add the winners to the tracked probe set.
  async function runDiscovery() {
    if (!client) return;
    setDiscoveryBusy(true); setErr(''); setMsg(''); setDiscoveryResult(null);
    setDiscoverySelected(new Set());
    try {
      setDiscoveryProgress({ index: 0, total: 1, query: 'reading website + Search Console…', engine: '' });
      const html = await fetchSiteHtml(client.url);
      const sitePhrases = extractSitePhrases(html);
      const queries = buildDiscoveryQueries(client, { gscSeeds: gscCandidates, sitePhrases });
      if (!queries.length) {
        setErr('Discovery needs a signal to work from: connect Search Console, add an industry, or make sure the website URL is set.');
        setDiscoveryBusy(false); setDiscoveryProgress(null);
        return;
      }
      const result = await runDiscoverySweep(client, {
        queries,
        onProgress: (p) => setDiscoveryProgress(p)
      });
      setDiscoveryResult(result);
      // Pre-select all citing queries by default — usually the user wants them all.
      setDiscoverySelected(new Set(result.citingQueries.map(c => c.query)));
    } catch (e) {
      setErr('Discovery failed: ' + e.message);
    } finally {
      setDiscoveryBusy(false);
      setDiscoveryProgress(null);
    }
  }

  async function addDiscoveredToProbe() {
    if (!client || !discoveryResult || discoverySelected.size === 0) return;
    const toAdd = [...discoverySelected];
    try {
      const existing = parseProbes(client) || migrateClientProbes(client);
      const { probes, added } = addProbes(existing, candProbes(toAdd, { tier: 2, type: 'niche', source: 'discovery' }));
      if (added === 0) {
        setMsg('No new queries — all selected discovery queries are already in the probe set.');
      } else {
        await saveClient({ ...client, aeo_probes: probes, aeo_probe_queries: probesToProbeList(probes) });
        setMsg(`Added ${added} discovered probes · probe set now ${probes.length}`);
        setDiscoveryResult(null);
      }
    } catch (e) {
      setErr('Could not save: ' + e.message);
    }
  }

  function toggleDiscoverySelection(query) {
    setDiscoverySelected(prev => {
      const next = new Set(prev);
      if (next.has(query)) next.delete(query); else next.add(query);
      return next;
    });
  }

  const delta = useMemo(() => {
    if (!snapshot || !lastSnapshot) return null;
    return snapshot.overall_score - (lastSnapshot.overall_score || 0);
  }, [snapshot, lastSnapshot]);

  async function run() {
    if (!client) return;

    // Auto-ground the probe set in a strategic GOLD GRID before running. The
    // decision logic (upgrade to gold, retire old junk, never shrink the active
    // set) lives in the pure, unit-tested grounding module; here we wire in the
    // browser-coupled builder and a GSC-derived fallback.
    let runClient = client;
    const competitors = (client.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const fallbackSet = gscCandidates.length
      ? groundedProbeSet(gscCandidates, { geo: client.location || client.market, competitors, limit: 25 })
      : [];
    const grounded = await groundClientForAeo(client, { gscQueries: gscCandidates, buildGold: buildGoldProbesForClient, fallbackSet });
    if (grounded.changed) {
      runClient = grounded.client;
      saveClient(runClient).catch(() => {});
      setMsg(grounded.reason === 'upgraded-to-gold'
        ? `Built a strategic ${grounded.activeAfter}-probe grid from the website, Search Console and competitors before running.`
        : `Grounded the probe set (${grounded.activeAfter} active probes) before running.`);
    }

    // Cost preview + confirm (Requirement 7): block runs above the budget.
    const est = estimateRunCost(runClient, { iterations });
    if (est.totalCalls > (Number(callBudget) || 0)) {
      const go = window.confirm(
        `Cost preview: about ${est.totalCalls} model calls this run ` +
        `(${est.probes} probes x ${est.engines} engines x ${iterations} iterations across search modes, ` +
        `${est.engineCalls} engine + ${est.extractionCalls} extraction). ` +
        `This exceeds your budget of ${callBudget}. Proceed?`
      );
      if (!go) return;
    }
    setBusy(true); setErr(''); setSnapshot(null);
    setProgress({ phase: 'starting', index: 0, total: 0 });
    try {
      const result = await runSnapshot(runClient, {
        iterations,
        expandWinners: true, winnerTarget: 30, maxExpansionQueries: 60, // spider-web long-tail off every winner
        onProgress: (p) => setProgress(p),
        onRuns: (records, raws) => persistAeoRuns(records, raws).catch(() => {})
      });
      setSnapshot(result);
      setProgress({ phase: 'complete', index: result.per_query.length, total: result.per_query.length });
      generateProposals(result);
    } catch (e) {
      setErr(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  // After a snapshot, fan out from what the engines said about the brand and
  // propose the most novel new probes for approval (Requirement 4).
  async function generateProposals(snap) {
    if (!client || !snap) return;
    setFanoutBusy(true); setFanoutProposals([]);
    try {
      const existing = parseProbes(client) || migrateClientProbes(client);
      // Merge branches exhausted this snapshot with any previously flagged, so
      // we stop proposing children from dead branches (Requirement 4).
      const freshExhausted = Object.entries(snap.branch_exhaustion || {})
        .filter(([, v]) => v.exhausted).map(([k]) => k);
      const exhaustedParents = [...new Set([...(client.aeo_exhausted_branches || []), ...freshExhausted])]
        .filter(k => k && k !== '__root__');
      const { candidates } = await generateFanout({ snapshot: snap, client, existingProbes: existing, exhaustedParents });
      setFanoutProposals(candidates);
      if (freshExhausted.some(k => k !== '__root__' && !(client.aeo_exhausted_branches || []).includes(k))) {
        saveClient({ ...client, aeo_exhausted_branches: exhaustedParents }).catch(() => {});
      }
    } catch { /* non-fatal — proposals are optional */ }
    finally { setFanoutBusy(false); }
  }

  // Approve candidates → add as ACTIVE tier-2 probes. Append-only: tier-1 is
  // never touched, so month-over-month trend comparability is preserved.
  async function approveProbes(cands) {
    if (!client || !cands.length) return;
    try {
      const existing = parseProbes(client) || migrateClientProbes(client);
      const { probes, added } = addProbes(existing, cands.map(c => ({ ...c, active: true })));
      await saveClient({ ...client, aeo_probes: probes, aeo_probe_queries: probesToProbeList(probes) });
      const approved = new Set(cands.map(c => c.query));
      setFanoutProposals(prev => prev.filter(p => !approved.has(p.query)));
      setMsg(`Approved ${added} discovered prompt${added === 1 ? '' : 's'} as active tier-2 probe${added === 1 ? '' : 's'}`);
    } catch (e) {
      setErr('Could not approve: ' + e.message);
    }
  }

  function dismissProbe(cand) {
    setFanoutProposals(prev => prev.filter(p => p.query !== cand.query));
  }

  // Export the per (probe × engine) results as CSV — mirrors the prototype's
  // export so the panel doubles as a scorecard.
  function exportCsv() {
    if (!snapshot?.per_query?.length) return;
    const head = ['query', 'engine', 'appearance_rate', 'avg_pos_when_appearing', 'avg_list_length', 'visibility_score', 'parametric_rate', 'segment_labels', 'reason'];
    const rows = snapshot.per_query.slice()
      .sort((a, b) => (b.visibility || 0) - (a.visibility || 0))
      .map(r => [
        r.query, r.engine_label || r.engine,
        (r.appearance_rate ?? r.visibility ?? 0) + '%',
        r.avg_position != null ? '#' + r.avg_position : '',
        r.avg_list_length ?? '',
        r.visibility_score ?? '',
        r.parametric_appearance_rate != null ? Math.round(r.parametric_appearance_rate * 100) + '%' : '',
        (r.segment_labels || []).join('; '),
        r.reason || ''
      ]);
    const csv = [head, ...rows].map(row => row.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = (client.name || 'brand').replace(/[^a-z0-9]+/gi, '-') + '-aeo-results.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Citation gap "brand present?" is user-editable and saved with the snapshot.
  function setGapBrandPresent(idx, val) {
    setSnapshot(prev => {
      if (!prev) return prev;
      const gaps = (prev.citation_gaps || []).slice();
      gaps[idx] = { ...gaps[idx], brandPresent: val };
      return { ...prev, citation_gaps: gaps };
    });
  }

  async function handleSave() {
    if (!snapshot) return;
    const month = snapshot.month;
    // Check if a snapshot already exists for this month and prompt to overwrite.
    const existing = lastSnapshot && lastSnapshot.month === month ? lastSnapshot : null;
    if (existing && !confirm(`A snapshot for ${month} already exists. Save another run?`)) return;
    try {
      await saveAeoSnapshot(snapshot);
      setMsg('Saved to AEO history ✓');
      const rows = await listAeoSnapshots(client.id);
      setLastSnapshot(rows[0] || null);
    } catch (e) { setErr(e.message); }
  }

  // Run a snapshot for every AEO-ready client in sequence. Each one saves
  // to syte_suite_aeo_history on success. Progress is tracked per-client
  // so the user can see which ones finish and which ones fail.
  async function runBulk(clientList) {
    if (!clientList || clientList.length === 0) return;
    setBulkBusy(true); setErr(''); setMsg('');
    const total = clientList.length;
    const results = { ok: 0, fail: 0, errors: [] };
    for (let i = 0; i < clientList.length; i++) {
      const c = clientList[i];
      setBulkProgress({ index: i, total, clientName: c.name, status: 'running' });
      try {
        const result = await runSnapshot(c, {
          onRuns: (records, raws) => persistAeoRuns(records, raws).catch(() => {}),
          onProgress: (p) => {
            setBulkProgress({
              index: i, total, clientName: c.name,
              status: 'running',
              detail: p.phase === 'sentiment' ? 'sentiment' : (p.engine || '')
            });
          }
        });
        await saveAeoSnapshot(result);
        results.ok++;
      } catch (e) {
        results.fail++;
        results.errors.push(c.name + ': ' + e.message);
      }
    }
    setBulkProgress({ index: total, total, status: 'done', ok: results.ok, fail: results.fail, errors: results.errors });
    setBulkBusy(false);

    // Refresh the pending-monthly list since we just ran some.
    const thisMonth = new Date().toISOString().slice(0, 7);
    setPendingMonthly(prev => prev.filter(c => !clientList.some(r => r.id === c.id)));
  }

  if (!client && pendingMonthly.length === 0 && allClients.filter(c => c.does_aeo !== false).length === 0) {
    return <div className="muted">Select a client first.</div>;
  }

  const engineRow = ALL_ENGINES.map(e => ({
    id: e.id, label: e.label,
    configured: e.isConfigured(),
    score: snapshot?.engine_scores?.[e.id] ?? null
  }));

  const queries = (client.aeo_probe_queries || '').split('\n').map(s => s.trim()).filter(Boolean);
  const costEst = preflight?.canRun ? (() => { try { return estimateRunCost(client, { iterations }); } catch { return null; } })() : null;
  // Health of the probe set that will actually run — flags a degenerate set
  // (the "6 prompts, all 0%" failure) before a run instead of after the PDF.
  const probeHealth = probeSetHealth(parseProbes(client) || migrateClientProbes(client) || []);
  const census = parseCensus(client);
  const coverage = census ? intentCoverage(census) : null;
  const intentLabel = id => (INTENT_BUCKETS.find(b => b.id === id)?.label) || id;

  const today = new Date();
  const isAfterFirst = today.getDate() >= 1; // always true, kept for clarity
  const thisMonth = new Date().toISOString().slice(0, 7);
  const readyAeoClients = allClients.filter(c => {
    if (c.does_aeo === false) return false;
    return readinessFor(c, 'aeo').status === 'ready';
  });

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>AEO Snapshot</h2>
        <span className="badge" style={{ borderColor: ACCENT, color: ACCENT }}>
          {thisMonth}
        </span>
      </div>

      {/* Monthly scheduler banner — prompts bulk run if any AEO-ready clients
          haven't been snapshotted yet this month. Purely client-side. */}
      {pendingMonthly.length > 0 && !bulkBusy && !bulkProgress?.status && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + ACCENT }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <strong>{pendingMonthly.length} client{pendingMonthly.length === 1 ? '' : 's'} need a {thisMonth} snapshot</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Monthly schedule: AEO snapshots run on the 1st of every month. Click Run All to process
                every ready client now, or run each one individually below.
              </div>
            </div>
            <button
              className="primary"
              onClick={() => runBulk(pendingMonthly)}
              style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
            >
              Run All ({pendingMonthly.length})
            </button>
          </div>
        </div>
      )}

      {/* Bulk-run progress */}
      {bulkBusy && bulkProgress && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + ACCENT }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Running bulk AEO snapshots</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {bulkProgress.index + 1} / {bulkProgress.total}
            </span>
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {bulkProgress.clientName} {bulkProgress.detail && <span className="muted">· {bulkProgress.detail}</span>}
          </div>
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div style={{
              width: Math.round(((bulkProgress.index + 1) / bulkProgress.total) * 100) + '%',
              height: '100%', background: ACCENT, transition: 'width .3s'
            }} />
          </div>
        </div>
      )}

      {/* Bulk-run summary after completion */}
      {bulkProgress?.status === 'done' && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--green)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Bulk run complete</strong>
            <button onClick={() => setBulkProgress(null)}>Dismiss</button>
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {bulkProgress.ok} succeeded · {bulkProgress.fail} failed
          </div>
          {bulkProgress.errors?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>Errors</summary>
              <ul style={{ fontSize: 12, margin: '6px 0 0 18px' }}>
                {bulkProgress.errors.map((e, i) => <li key={i} className="muted">{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Bulk action when no clients need a monthly run */}
      {pendingMonthly.length === 0 && !bulkBusy && !bulkProgress?.status && readyAeoClients.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          All {readyAeoClients.length} AEO-ready clients have a snapshot for {thisMonth} ✓
          {' '}
          <button
            onClick={() => runBulk(readyAeoClients)}
            style={{ padding: '3px 10px', fontSize: 11, marginLeft: 8 }}
          >
            Re-run all anyway
          </button>
        </div>
      )}

      {!client && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="muted">
            Select a client in the top bar to see or run a per-client snapshot,
            or use the Run All button above to process every ready client at once.
          </div>
        </div>
      )}

      {client && <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong>{client.name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {coverage
                ? `${coverage.total}-prompt census · tracking ${(client.competitors || '').split(',').filter(Boolean).length} competitor(s)`
                : `${queries.length} probe ${queries.length === 1 ? 'query' : 'queries'} · tracking ${(client.competitors || '').split(',').filter(Boolean).length} competitor(s)`}
            </div>
            {coverage && (
              <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {coverage.buckets.filter(b => b.count > 0).map(b => (
                  <span key={b.id} title={b.hint} style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10,
                    border: '1px solid var(--border)', color: 'var(--text-muted)'
                  }}>
                    {b.label} {b.count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {engineRow.map(e => (
              <span key={e.id} style={{ fontSize: 12 }}>
                <span className="dot" style={{ background: e.configured ? 'var(--green)' : 'var(--red)', marginRight: 6 }} />
                {e.label}
              </span>
            ))}
          </div>
        </div>

        {queries.length === 0 && (
          <div style={{ color: 'var(--orange)', marginTop: 10, fontSize: 13 }}>
            This client has no probe queries. Open Edit Client → Reporting & AEO to add some.
          </div>
        )}
        {preflight?.missingEngines.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Missing engines: {preflight.missingEngines.map(e => e.label).join(', ')} (Suite Settings → AEO Engine Keys)
          </div>
        )}

        {gscCandidates.length > 0 && (
          <div className="row" style={{
            marginTop: 12, padding: '10px 14px',
            background: 'rgba(167,139,250,.05)',
            border: '1px solid rgba(167,139,250,.2)',
            borderRadius: 'var(--radius)',
            justifyContent: 'space-between', flexWrap: 'wrap', gap: 10
          }}>
            <div style={{ fontSize: 12, flex: 1, minWidth: 240 }}>
              <strong>{gscCandidates.length} head-term queries</strong> from GSC available to expand the probe list.
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Real queries this brand already gets impressions for — better probe targets than guessed phrases.
                Currently probing {queries.length} {queries.length === 1 ? 'query' : 'queries'}.
              </div>
            </div>
            <button
              onClick={expandProbeFromGSC}
              disabled={expandBusy}
              style={{ fontSize: 12, padding: '6px 14px', borderColor: ACCENT, color: ACCENT, whiteSpace: 'nowrap' }}
            >
              {expandBusy ? 'Adding…' : `Add ${gscCandidates.length} GSC queries`}
            </button>
          </div>
        )}

        {/* Discovery — find queries the brand is actually cited for */}
        <div className="row" style={{
          marginTop: 12, padding: '10px 14px',
          background: 'rgba(74,222,128,.04)',
          border: '1px solid rgba(74,222,128,.2)',
          borderRadius: 'var(--radius)',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: 10
        }}>
          <div style={{ fontSize: 12, flex: 1, minWidth: 280 }}>
            <strong>Discover everything you appear for</strong> — grounded in Search Console + your website.
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Reads {client.name}'s Search Console head-terms{gscCandidates.length ? ` (${gscCandidates.length} loaded)` : ''} and their website, builds a broad prompt net from what they actually rank for and offer, then reports which prompts the AI engines cite {client.name} for. This is the real list, not guessed terms.
            </div>
          </div>
          <button
            onClick={runDiscovery}
            disabled={discoveryBusy || !preflight?.canRun}
            style={{ fontSize: 12, padding: '6px 14px', borderColor: 'var(--green)', color: 'var(--green)', whiteSpace: 'nowrap' }}
          >
            {discoveryBusy ? 'Running…' : 'Run Discovery'}
          </button>
        </div>

        {discoveryBusy && discoveryProgress && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {discoveryProgress.index} / {discoveryProgress.total} — {discoveryProgress.engine || ''} · "{(discoveryProgress.query || '').slice(0, 60)}…"
            <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
              <div style={{
                width: Math.round((discoveryProgress.index / discoveryProgress.total) * 100) + '%',
                height: '100%', background: 'var(--green)', transition: 'width .3s'
              }} />
            </div>
          </div>
        )}

        {discoveryResult && (
          <div style={{
            marginTop: 12, padding: '14px 16px',
            background: 'var(--surface)',
            border: '1px solid rgba(74,222,128,.3)',
            borderRadius: 'var(--radius)'
          }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>
                Discovery: {discoveryResult.citingQueries.length} citing queries found
                <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                  out of {discoveryResult.totalQueries} probed across {discoveryResult.totalRuns} responses
                </span>
              </strong>
              <div className="row" style={{ gap: 6 }}>
                <button
                  onClick={() => setDiscoveryResult(null)}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >
                  Dismiss
                </button>
                {discoveryResult.citingQueries.length > 0 && (
                  <button
                    onClick={addDiscoveredToProbe}
                    disabled={discoverySelected.size === 0}
                    style={{ fontSize: 11, padding: '4px 12px', borderColor: ACCENT, color: ACCENT }}
                  >
                    Add {discoverySelected.size} selected to probe
                  </button>
                )}
              </div>
            </div>
            {discoveryResult.citingQueries.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                No citations found. Try expanding the probe queries manually or running a fresh probe with iterations=5.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                {discoveryResult.citingQueries.map(c => (
                  <label
                    key={c.query}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '8px 10px', background: 'var(--surface-2)',
                      borderRadius: 6, cursor: 'pointer', fontSize: 12
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={discoverySelected.has(c.query)}
                      onChange={() => toggleDiscoverySelection(c.query)}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{c.query}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        Cited on: {c.engines.join(', ')}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {progress ? (
              progress.phase === 'complete'
                ? 'Complete'
                : progress.phase === 'sentiment'
                  ? `Sentiment: ${progress.query?.slice(0, 40)}…`
                  : `${progress.index} / ${progress.total} — ${progress.engine || ''}${progress.iteration ? ' #' + progress.iteration : ''}`
            ) : ''}
          </span>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Iterations
              <input
                type="number" min={1} max={10}
                value={iterations}
                onChange={e => setIterations(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                style={{ width: 56, padding: '4px 8px', fontSize: 12 }}
                disabled={busy}
                title="How many times to ask each (query × engine). 3+ gives meaningful visibility percentages."
              />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Call budget
              <input
                type="number" min={0} step={50}
                value={callBudget}
                onChange={e => setCallBudget(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 68, padding: '4px 8px', fontSize: 12 }}
                disabled={busy}
                title="Runs above this many model calls ask for confirmation first."
              />
            </label>
            {costEst && (
              <span className="muted" style={{ fontSize: 11, color: costEst.totalCalls > callBudget ? 'var(--orange)' : 'var(--text-muted)' }}
                title={`${costEst.engineCalls} engine + ${costEst.extractionCalls} extraction calls`}>
                ~{costEst.totalCalls} calls
              </span>
            )}
            <button
              className="primary"
              onClick={run}
              disabled={busy || !preflight?.canRun}
              style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
            >
              {busy ? 'Running…' : 'Run AEO Snapshot'}
            </button>
          </div>
        </div>

        {probeHealth.activeCount > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: probeHealth.degenerate ? 'var(--orange)' : 'var(--text-muted)' }}
            title={probeHealth.types.join(', ')}>
            {probeHealth.degenerate ? '⚠ ' : '✓ '}{probeHealth.summary}
          </div>
        )}

        {progress && progress.total > 0 && (
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div style={{
              width: Math.round((progress.index / progress.total) * 100) + '%',
              height: '100%', background: ACCENT, transition: 'width .3s'
            }} />
          </div>
        )}

        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        {msg && <div style={{ color: 'var(--green)', marginTop: 10 }}>{msg}</div>}
      </div>

      {snapshot && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Visibility</div>
                <div style={{
                  fontFamily: 'Instrument Serif, serif',
                  fontSize: 72, lineHeight: 1,
                  color: scoreColor(snapshot.overall_score)
                }}>
                  {snapshot.visibility_score ?? 0}<span style={{ fontSize: 24, color: 'var(--text-muted)' }}>%</span>
                </div>
                {delta != null && (
                  <div style={{ fontSize: 13, color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {delta >= 0 ? '+' : ''}{delta} pts vs {lastSnapshot?.month}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  composite score {snapshot.overall_score}/100
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: 12, flex: 1, minWidth: 280 }}>
                {[
                  { label: 'Share of Voice', value: (snapshot.share_of_voice ?? 0) + '%', hint: 'your share of all brand mentions across the census, vs tracked competitors' },
                  { label: 'Mentions',       value: snapshot.mentions ?? 0 },
                  { label: 'Citations',      value: snapshot.citations ?? 0 },
                  { label: 'Detection rate', value: (snapshot.detection_rate ?? 0) + '%' },
                  { label: 'Top-3 rate',     value: (snapshot.top3_rate ?? 0) + '%' },
                  { label: 'Sentiment',      value: (snapshot.sentiment_score ?? 0) + '%' }
                ].map(m => (
                  <div key={m.label} title={m.hint} style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{m.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ minWidth: 240, flex: 1, maxWidth: 360 }}>
                {engineRow.filter(e => e.configured).map(e => (
                  <ScoreBar key={e.id} label={e.label} value={e.score} />
                ))}
              </div>
              <button onClick={handleSave}>Save Snapshot</button>
            </div>
            <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
              {snapshot.sentiment} · engines: {snapshot.engines_used.join(', ')} · {snapshot.total_runs || snapshot.per_query.length} total responses
            </div>
            {snapshot.engine_health && Object.values(snapshot.engine_health).some(h => h.errors > 0) && (
              <div style={{
                marginTop: 12, padding: 10,
                background: 'color-mix(in srgb, var(--orange) 8%, var(--surface-2))',
                border: '1px solid color-mix(in srgb, var(--orange) 40%, var(--border))',
                borderLeft: '3px solid var(--orange)',
                borderRadius: 'var(--radius)',
                fontSize: 12
              }}>
                <strong style={{ color: 'var(--orange)' }}>Engine failures during this probe:</strong>
                <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                  {Object.entries(snapshot.engine_health)
                    .filter(([, h]) => h.errors > 0)
                    .map(([id, h]) => (
                      <li key={id} style={{ marginBottom: 4 }}>
                        <strong>{h.label}</strong> — {h.errors}/{h.runs} iterations failed
                        {h.all_failed && <span style={{ color: 'var(--red)' }}> (every iteration)</span>}
                        {h.sample_error && (
                          <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{h.sample_error}</div>
                        )}
                      </li>
                    ))}
                </ul>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Check Suite Settings → engine API keys, or update the engine model if it's been retired.
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <strong>Query × Engine</strong>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Big number is <strong>retrieval</strong> visibility (web search on) with avg. position when named.
              The grey <em>web off</em> line is <strong>parametric</strong> visibility (no web search) — shown for
              ChatGPT and Claude only, and never blended into the score.
            </div>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Query</th>
                    {ALL_ENGINES.filter(e => e.isConfigured()).map(e => (
                      <th key={e.id}>{e.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(snapshot.per_query.map(r => r.query))].map(q => (
                    <tr key={q}>
                      <td style={{ maxWidth: 280 }}>{q}</td>
                      {ALL_ENGINES.filter(e => e.isConfigured()).map(eng => {
                        const row = snapshot.per_query.find(r => r.query === q && r.engine === eng.id);
                        if (!row) return <td key={eng.id} className="muted">—</td>;
                        if (row.error) return <td key={eng.id} className="muted" title={row.error}>err</td>;
                        const v = row.visibility ?? (row.mentioned ? 100 : 0);
                        const off = row.modes?.search_off;
                        const paramPct = off ? Math.round((off.appearanceRate || 0) * 100) : null;
                        const paramLine = paramPct != null
                          ? <div className="muted" style={{ fontSize: 9, marginTop: 2 }} title="parametric: brand named without web search">web off {paramPct}%</div>
                          : null;
                        const color = v >= 70 ? 'green' : v >= 30 ? 'orange' : 'blue';
                        return (
                          <td key={eng.id}>
                            <span className={v === 0 ? 'badge' : 'badge ' + color} title={(row.excerpt || '') + ' · ' + (row.hits || 0) + '/' + (row.iterations || 1) + ' retrieval runs'}>
                              {v}%{v > 0 ? ' · #' + (row.avg_position ?? row.position ?? '—') + (row.avg_list_length ? ' of ' + row.avg_list_length : '') : ''}
                            </span>
                            {paramLine}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {snapshot.per_query?.some(r => r.mentioned) && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <strong>What the engines recommend you for</strong>
                <button onClick={exportCsv} style={{ fontSize: 11, padding: '4px 12px' }}>Export CSV</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 8 }}>
                The exact segment label and reason each engine attached to {client.name}. This is the actionable core: the angles you already win, in the engine's own words.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Prompt</th><th>Engine</th><th>Appears</th><th>Avg pos when named</th><th>Segment / reason</th></tr>
                  </thead>
                  <tbody>
                    {snapshot.per_query
                      .filter(r => r.mentioned)
                      .slice()
                      .sort((a, b) => (b.visibility || 0) - (a.visibility || 0))
                      .map((r, i) => (
                        <tr key={i}>
                          <td style={{ maxWidth: 240 }}>{r.query}</td>
                          <td>{r.engine_label || r.engine}</td>
                          <td className="pos">{r.appearance_rate ?? r.visibility}%</td>
                          <td className="muted">{r.avg_position != null ? '#' + r.avg_position + (r.avg_list_length ? ' of ' + r.avg_list_length : '') : '—'}</td>
                          <td style={{ maxWidth: 340, fontSize: 12 }}>
                            {(r.segment_labels || []).length > 0 && <div style={{ color: 'var(--green)', fontWeight: 600 }}>{r.segment_labels.join(' · ')}</div>}
                            {r.reason && <div className="muted" style={{ marginTop: 2 }}>{r.reason}</div>}
                            {!(r.segment_labels || []).length && !r.reason && <span className="muted">—</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {snapshot.intent_breakdown?.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Visibility by Buyer Intent</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 8 }}>
                Where you show up across the census — strong on some intents, room to grow on others.
              </div>
              {snapshot.intent_breakdown.map(b => (
                <ScoreBar
                  key={b.intent}
                  label={`${intentLabel(b.intent)} · ${b.queries} ${b.queries === 1 ? 'prompt' : 'prompts'}`}
                  value={b.visibility}
                />
              ))}
            </div>
          )}

          {snapshot.competitors.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Competitive Landscape</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 8 }}>
                Same metrics as the brand — visibility, top-3 rate, mentions, citations.
              </div>
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th>Visibility</th>
                    <th>Top-3</th>
                    <th>Mentions</th>
                    <th>Citations</th>
                    <th>Avg Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: client.name, isBrand: true,
                      visibility: snapshot.visibility_score ?? 0,
                      top3: snapshot.top3_rate ?? 0,
                      mentions: snapshot.mentions ?? 0,
                      citations: snapshot.citations ?? 0,
                      avg_position: snapshot.avg_position
                    },
                    ...snapshot.competitors.map(c => ({
                      name: c.name, isBrand: false,
                      visibility: c.visibility ?? 0,
                      top3: c.top3_rate ?? 0,
                      mentions: c.mentions ?? c.appearances ?? 0,
                      citations: c.citations ?? 0,
                      avg_position: c.avg_position
                    }))
                  ]
                    .sort((a, b) => b.visibility - a.visibility)
                    .map((c, i) => (
                      <tr key={c.name} style={c.isBrand ? { background: 'rgba(167,139,250,.06)' } : undefined}>
                        <td style={{ fontWeight: c.isBrand ? 700 : 400 }}>
                          {c.isBrand ? '✦ ' : ''}#{i + 1} {c.name}
                        </td>
                        <td>{c.visibility}%</td>
                        <td>{c.top3}%</td>
                        <td>{c.mentions}</td>
                        <td>{c.citations}</td>
                        <td className="muted">{c.avg_position != null ? '#' + c.avg_position : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {snapshot.citation_gaps?.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Citation Gaps</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 8 }}>
                Commercial prompts where {client.name} was absent but competitors were cited. These sources are the growth plan — earn the brand a presence on them.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Source domain</th><th>Hits</th><th>Competitors surfaced</th><th>Example prompt</th><th>Brand present?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.citation_gaps.map((g, i) => (
                      <tr key={g.domain}>
                        <td style={{ fontWeight: 600 }}>{g.domain}</td>
                        <td>{g.hitCount}</td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.competitors.join(', ')}>{g.competitors.join(', ') || '—'}</td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.exampleQueries.join(' · ')}>{g.exampleQueries[0] || '—'}</td>
                        <td>
                          <select value={g.brandPresent || 'unknown'} onChange={e => setGapBrandPresent(i, e.target.value)} style={{ fontSize: 11, padding: '2px 6px' }}>
                            <option value="unknown">Unknown</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <strong>Response Excerpts</strong>
            <div style={{ marginTop: 10 }}>
              {(snapshot.excerpts || snapshot.per_query.filter(r => r.mentioned || r.error))
                .map((r, i) => (
                  <details key={i} style={{ marginBottom: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                      <span className="badge" style={{ marginRight: 8 }}>{r.engine}</span>
                      {r.query}
                      {r.sentiment && <span style={{ marginLeft: 8, color: 'var(--green)', fontSize: 11 }}>{r.sentiment}</span>}
                      {r.error && <span style={{ marginLeft: 8, color: 'var(--red)', fontSize: 11 }}>error</span>}
                    </summary>
                    <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.error || r.excerpt || '(no excerpt)'}
                    </div>
                  </details>
                ))}
            </div>
          </div>
        </>
      )}

      {(fanoutBusy || fanoutProposals.length > 0) && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + ACCENT }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>Discovered prompts</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Fanned out from the segment labels, reasons and competitors the engines attached to {client.name}.
                Approve to add as active tier-2 probes — the tier-1 panel stays untouched for trend comparability.
              </div>
            </div>
            {fanoutProposals.length > 0 && (
              <button onClick={() => approveProbes(fanoutProposals)} style={{ borderColor: ACCENT, color: ACCENT, whiteSpace: 'nowrap' }}>
                Approve all ({fanoutProposals.length})
              </button>
            )}
          </div>
          {fanoutBusy && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Generating proposals…</div>}
          {fanoutProposals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
              {fanoutProposals.map(p => (
                <div key={p.query} className="row" style={{ justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.query}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {p.type} · {p.intent} · novelty {Math.round((p.novelty || 0) * 100)}%{p.parentProbeId ? ' · from ' + p.parentProbeId : ''}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => approveProbes([p])} style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--green)', color: 'var(--green)' }}>Approve</button>
                    <button onClick={() => dismissProbe(p)} style={{ fontSize: 11, padding: '4px 10px' }}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
