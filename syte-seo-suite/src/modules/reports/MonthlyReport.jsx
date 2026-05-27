import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { listAeoSnapshots, logReportSent, logReportGenerated, getCachedReportData, setCachedReportData } from '../../lib/supabase.js';
import {
  ALICE_SYSTEM, MICROSITE_SYSTEM, QA_SYSTEM,
  ALICE_AEO_SYSTEM, MICROSITE_AEO_SYSTEM, QA_AEO_SYSTEM,
  buildAlicePayload, getWorkSummary, buildAeoPayload
} from './reportPrompts.js';
import { buildMicrositeHtml, downloadMicrosite } from './microsite.js';
import { runSnapshot, snapshotPreflight } from './aeoRunner.js';
import { compareSnapshots, rankBrandWithCompetitors, normalizeSnapshot } from './aeoCompare.js';
import { ensureToken, SCOPES, getToken, switchAccount, silentRefresh } from '../technical/googleAuth.js';
import { fetchReportData } from './reportData.js';
import ReportDashboard from './ReportDashboard.jsx';

const ACCENT = '#a78bfa';

// Reports always default to the PREVIOUS month (you're reporting on last month's work).
function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function parseAliceOutput(text) {
  if (!text) return { subject: '', body: '' };
  const lines = text.split('\n');
  let subject = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^SUBJECT:\s*(.+)/i);
    if (m) { subject = m[1].trim(); continue; }
    if (lines[i].trim() === '---') { bodyStart = i + 1; break; }
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  return { subject, body: body || text };
}

export default function MonthlyReport() {
  const client = useClients(s => s.current());
  const [month, setMonth] = useState(previousMonth());
  const [form, setForm] = useState({});
  const [algContext, setAlgContext] = useState('');
  const [aeoSnap, setAeoSnap] = useState(null);
  const [workSummary, setWorkSummary] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | fetching | alice | micro | qa | review
  const [err, setErr] = useState('');
  const [fetchStatus, setFetchStatus] = useState('');
  const [email, setEmail] = useState({ subject: '', body: '' });
  const [microJson, setMicroJson] = useState(null);
  const [qa, setQa] = useState(null);
  const [sent, setSent] = useState(false);
  const [showMicroFull, setShowMicroFull] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [liveAeoProbe, setLiveAeoProbe] = useState(null);
  const [previousAeoSnap, setPreviousAeoSnap] = useState(null);
  const [aeoOnly, setAeoOnly] = useState(false);

  // Auto-fetch GA4 + GSC data when client or month changes.
  useEffect(() => {
    setEmail({ subject: '', body: '' });
    setMicroJson(null); setQa(null); setSent(false); setPhase('idle'); setErr('');
    setAeoOnly(false);
    const hasSeo = client?.does_content !== false || client?.does_technical !== false;
    const hasAeo = client?.does_aeo !== false;
    setForm({ hasSeo, hasAeo, industry: client?.industry || '' });
    if (client?.id) {
      setWorkSummary(getWorkSummary(client.id, month));
      autoFetchMetrics(client, month);
    }
  }, [client?.id, month]);

  useEffect(() => {
    if (!client) { setAeoSnap(null); setPreviousAeoSnap(null); setWorkSummary(null); return; }
    listAeoSnapshots(client.id).then(rows => {
      // Sort newest-first then find this month + the most recent prior month.
      const sorted = (rows || []).slice().sort((a, b) => (b.month || '').localeCompare(a.month || ''));
      const match = sorted.find(r => r.month === month) || null;
      const prev = sorted.find(r => r.month && r.month < month) || null;
      setAeoSnap(match);
      setPreviousAeoSnap(prev);
    }).catch(() => {});
  }, [client?.id, month]);

  // Bump this whenever the report data shape changes in a way that
  // makes old cache entries stale (e.g. keyword pull went 50 → 500,
  // pagination added at v3). Cache entries without a matching version
  // are treated as a miss and refetched.
  const REPORT_DATA_VERSION = 3;

  // Pull all report data (GA4 traffic + conversions + GSC keywords) via reportData.js.
  async function autoFetchMetrics(c, m, forceRefresh = false) {
    if (!c) return;

    // Check cache first (unless forced refresh).
    if (!forceRefresh) {
      try {
        const cached = await getCachedReportData(c.id, m);
        const isCurrentVersion = cached?.data?.version === REPORT_DATA_VERSION;
        // Cache is also stale if the client's GA4/GSC properties have
        // changed since the cached fetch — otherwise fixing a wrong
        // property URL leaves the old permission error stuck on screen.
        const propsMatch = cached?.data
          && cached.data.ga4_property_id === (c.ga4_property_id || null)
          && cached.data.gsc_property === (c.gsc_property || null);
        if (cached?.data && isCurrentVersion && propsMatch) {
          setReportData(cached.data);
          setFetchStatus('Loaded from cache (fetched ' + new Date(cached.fetched_at).toLocaleDateString() + ') · Click Refresh Data to re-fetch');
          return;
        }
        if (cached?.data && isCurrentVersion && !propsMatch) {
          // Properties changed on the client — drop the cached result
          // entirely and fall through to a fresh fetch.
          setReportData(null);
          setFetchStatus('GA4/GSC property changed — refetching…');
        } else if (cached?.data && !isCurrentVersion) {
          // Old-shape cache exists. Show it as a fallback so the page
          // isn't blank, then silently try to refresh in the background
          // ONLY if a token is already present (no popup).
          setReportData(cached.data);
          setFetchStatus('Loaded older cache · Refreshing with new keyword depth…');
          if (!getToken()?.access_token) {
            setFetchStatus('Loaded older cache · Click Refresh Data to pull the latest keyword set');
            return;
          }
        }
      } catch {}
    }

    // ── Auth handling ──
    // Don't auto-pop the Google sign-in modal on mount/month change.
    // First try a silent refresh — works without a popup if the user is
    // still signed into Google in this browser. Only if that fails do
    // we surface the Connect Google control.
    let token = getToken();
    const needsGoogle = c.ga4_property_id || c.gsc_property;
    if (!token?.access_token && needsGoogle && !forceRefresh) {
      setFetchStatus('Reconnecting to Google in the background…');
      token = await silentRefresh([SCOPES.ga4, SCOPES.gsc]);
      if (!token?.access_token) {
        setFetchStatus('Not connected to Google — click Connect Google to fetch fresh SEO data (cached AEO and saved client data still available)');
        return;
      }
    }

    if (!token?.access_token && needsGoogle && forceRefresh) {
      // forceRefresh = user explicitly clicked a button, OK to pop auth.
      setFetchStatus('Connecting to Google — please sign in if prompted…');
      try {
        token = await ensureToken([SCOPES.ga4, SCOPES.gsc]);
      } catch {
        setFetchStatus('Google auth failed — try again');
        return;
      }
    }

    const [year, mo] = m.split('-').map(Number);
    setFetchStatus('Pulling GA4 + GSC data for ' + monthLabel(m) + '…');
    try {
      const data = await fetchReportData(c, year, mo);
      data.version = REPORT_DATA_VERSION;
      data.ga4_property_id = c.ga4_property_id || null;
      data.gsc_property = c.gsc_property || null;
      setReportData(data);
      // Cache for future visits.
      setCachedReportData(c.id, m, data).catch(() => {});

      // Also populate form fields for the Alice email generator.
      if (data.traffic?.current) {
        const t = data.traffic;
        setForm(prev => ({
          ...prev,
          seoOrganicThis: String(t.current.users),
          seoOrganicLast: String(t.previous?.users || ''),
          seoUsersYoy: String(t.yoy?.users || ''),
          seoConvThis: String(t.current.conversions),
          seoConvLast: String(t.previous?.conversions || ''),
          seoSessThis: String(t.current.sessions),
          seoSessLast: String(t.previous?.sessions || ''),
          seoRevenueThis: String(t.current.revenue || ''),
          seoRevenueLast: String(t.previous?.revenue || '')
        }));
      }
      if (data.keywords?.length > 0) {
        setForm(prev => ({
          ...prev,
          topQueries: data.keywords.slice(0, 10).map(k =>
            k.query + ' — pos ' + k.position + (k.change != null ? ' (' + (k.change > 0 ? '+' : '') + k.change + ')' : '') + ', ' + k.clicks + ' clicks'
          ).join('\n')
        }));
      }
      if (data.topPages?.length > 0) {
        setForm(prev => ({
          ...prev,
          topPages: data.topPages.slice(0, 10).map(p => {
            let path = p.page;
            try { path = new URL(p.page).pathname; } catch {}
            return path + ' — ' + p.clicks + ' clicks';
          }).join('\n')
        }));
      }

      const parts = [];
      if (data.traffic?.current) parts.push('GA4 ✓');
      if (data.keywords?.length > 0) parts.push('GSC ✓ (' + data.keywords.length + ' keywords)');
      if (data.errors?.length > 0) parts.push(data.errors.join(' · '));
      setFetchStatus(parts.join(' · ') || 'No data available');
    } catch (e) {
      setFetchStatus('Failed: ' + e.message.slice(0, 80));
    }
  }

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const micrositeHtml = useMemo(() => {
    if (!microJson || !client) return '';
    // Use the live probe if we just ran one; otherwise fall back to the
    // saved snapshot for this month so the report renders even without
    // a fresh probe in the same session. Normalize either way so legacy
    // snapshots get derived visibility / detection / keyword_wins fields.
    const aeoProbe = normalizeSnapshot(liveAeoProbe || aeoSnap || null);
    const aeoCompare = aeoProbe
      ? compareSnapshots(aeoProbe, normalizeSnapshot(previousAeoSnap))
      : null;
    const aeoRanking = aeoProbe
      ? rankBrandWithCompetitors(aeoProbe, client.name)
      : null;
    return buildMicrositeHtml({
      micro: microJson,
      client,
      monthLabel: monthLabel(month),
      previousMonthLabel: previousAeoSnap ? monthLabel(previousAeoSnap.month) : null,
      rankscale: client.rankscale_url,
      reportData,
      aeoProbe,
      aeoCompare,
      aeoRanking,
      aeoOnly
    });
  }, [microJson, client, month, reportData, liveAeoProbe, aeoSnap, previousAeoSnap, aeoOnly]);

  // Generate AEO-only report — skips SEO data, focuses on AI visibility.
  async function generateAeoOnly() {
    if (!client) return;
    setErr(''); setEmail({ subject: '', body: '' }); setMicroJson(null); setQa(null); setSent(false); setLiveAeoProbe(null);
    setAeoOnly(true);

    try {
      // Step 1: Run AEO probe
      const preflight = snapshotPreflight(client);
      if (!preflight.canRun) {
        setErr('Add AEO probe queries to this client first (Edit → AEO Probe Queries → Generate from brand context).');
        return;
      }
      setPhase('aeo-probe');
      const probeResult = await runSnapshot(client, {
        onProgress: (p) => setPhase('aeo-probe: ' + (p.engine || '') + ' — ' + (p.query || '').slice(0, 40))
      });
      setLiveAeoProbe(probeResult);

      // Step 2: Generate AEO-focused email
      setPhase('alice');
      const compare = compareSnapshots(probeResult, previousAeoSnap);
      const ranking = rankBrandWithCompetitors(probeResult, client.name);
      const brandRank = ranking.findIndex(r => r.isBrand) + 1;
      const aeoPayload = buildAeoPayload({
        client,
        monthLabel: monthLabel(month),
        previousMonthLabel: previousAeoSnap ? monthLabel(previousAeoSnap.month) : null,
        probe: probeResult,
        compare,
        ranking,
        brandRank
      });

      const aliceText = await claudeComplete({
        system: ALICE_AEO_SYSTEM,
        messages: [{ role: 'user', content: aeoPayload }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        temperature: 0.7
      });
      setEmail(parseAliceOutput(aliceText));

      // Step 3: Generate microsite JSON (AEO-only shape)
      setPhase('micro');
      const micrositeText = await claudeComplete({
        system: MICROSITE_AEO_SYSTEM,
        messages: [{ role: 'user', content: aeoPayload }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        temperature: 0.5
      });
      const microObj = extractJSON(micrositeText);
      if (!microObj) throw new Error('Microsite JSON could not be parsed.');
      if (!microObj.clientName) microObj.clientName = client.name;
      setMicroJson(microObj);

      // Step 4: QA (AEO-specific checks: no SEO talk, no doom framing)
      setPhase('qa');
      const qaText = await claudeComplete({
        system: QA_AEO_SYSTEM,
        messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0
      });
      const qaObj = extractJSON(qaText);
      if (qaObj) setQa(qaObj);

      logReportGenerated({
        client_id: client.id,
        month,
        report_type: 'aeo',
        qa_score: qaObj?.overallScore || null,
        email_subject: parseAliceOutput(aliceText).subject || ''
      }).catch(() => {});

      setPhase('review');
    } catch (e) {
      setErr(e.message);
      setPhase('idle');
    }
  }

  async function generate() {
    if (!client) return;
    setErr(''); setEmail({ subject: '', body: '' }); setMicroJson(null); setQa(null); setSent(false);
    setAeoOnly(false);

    // Compute MoM comparison and ranking from saved snapshot if we have one,
    // so Alice can lead with momentum metrics ("+68% citations MoM") even
    // when not running a fresh probe.
    const aeoForCompare = aeoSnap || liveAeoProbe;
    const aeoCompare = aeoForCompare ? compareSnapshots(aeoForCompare, previousAeoSnap) : null;
    const aeoRanking = aeoForCompare ? rankBrandWithCompetitors(aeoForCompare, client.name) : null;
    const brandRank = aeoRanking ? aeoRanking.findIndex(r => r.isBrand) + 1 : null;

    const payload = buildAlicePayload({
      clientName: client.name,
      industry: client.industry || '',
      goals: client.context,
      month: monthLabel(month),
      previousMonthLabel: previousAeoSnap ? monthLabel(previousAeoSnap.month) : null,
      algorithmContext: algContext,
      aeoCompare,
      aeoRanking,
      brandRank,
      ...form
    }, aeoSnap, workSummary);

    try {
      // 0. Live AEO probe — run probe queries against available AI engines
      // to check brand visibility. Uses existing snapshot infrastructure.
      const preflight = snapshotPreflight(client);
      if (preflight.canRun) {
        setPhase('aeo-probe');
        try {
          const probeResult = await runSnapshot(client, {
            onProgress: (p) => setPhase('aeo-probe: ' + (p.engine || '') + ' — ' + (p.query || '').slice(0, 40))
          });
          setLiveAeoProbe(probeResult);
          // Feed probe results into form for Alice email
          setForm(prev => ({
            ...prev,
            aeoScore: probeResult.overall_score,
            aeoSentiment: probeResult.sentiment,
            aeoEngines: probeResult.engines_used?.join(', '),
            aeoCitations: probeResult.per_query?.filter(r => r.mentioned).length + ' of ' + probeResult.per_query?.length
          }));
        } catch (e) {
          console.warn('[Report] AEO probe failed:', e.message);
        }
      }

      // 1. Alice email
      setPhase('alice');
      const aliceText = await claudeComplete({
        system: ALICE_SYSTEM,
        messages: [{ role: 'user', content: payload }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.7
      });
      const parsed = parseAliceOutput(aliceText);
      setEmail(parsed);

      // 2. Microsite JSON
      setPhase('micro');
      const micrositeText = await claudeComplete({
        system: MICROSITE_SYSTEM,
        messages: [{ role: 'user', content: payload }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.5
      });
      const microObj = extractJSON(micrositeText);
      if (!microObj) throw new Error('Microsite JSON could not be parsed from model output.');
      if (!microObj.clientName) microObj.clientName = client.name;
      setMicroJson(microObj);

      // 3. QA
      setPhase('qa');
      const qaText = await claudeComplete({
        system: QA_SYSTEM,
        messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0
      });
      const qaObj = extractJSON(qaText);
      if (qaObj) setQa(qaObj);

      logReportGenerated({
        client_id: client.id,
        month,
        report_type: 'full',
        qa_score: qaObj?.overallScore || null,
        email_subject: parsed.subject || ''
      }).catch(() => {});

      setPhase('review');
    } catch (e) {
      setErr(e.message);
      setPhase('idle');
    }
  }

  async function markSent() {
    if (!client) return;
    try {
      await logReportSent({
        client_id: client.id,
        month,
        sent_date: new Date().toISOString(),
        qa_score: qa?.overallScore || null,
        aeo_snapshot_score: aeoSnap?.overall_score || null,
        email_subject: email.subject || ''
      });
      setSent(true);
    } catch (e) { setErr(e.message); }
  }

  function copyEmail() {
    const text = (email.subject ? 'Subject: ' + email.subject + '\n\n' : '') + email.body;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function downloadHtml() {
    if (!micrositeHtml) return;
    const safeName = (client.name || 'client').replace(/[^a-z0-9]+/gi, '-');
    downloadMicrosite(micrositeHtml, `${safeName}-${month}-Report.html`);
  }

  if (!client) return <div className="muted">Select a client first.</div>;

  const hasSnapshot = !!aeoSnap;

  const PHASES = [
    { key: 'aeo-probe', label: 'AEO Probe' },
    { key: 'alice', label: 'Alice email' },
    { key: 'micro', label: 'Microsite JSON' },
    { key: 'qa',    label: 'QA check' }
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Monthly Report</h2>

      {/* Step 1: client + month */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="grid-2">
          <div>
            <label>Client</label>
            <div style={{ padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              {client.name}
            </div>
          </div>
          <div>
            <label>Report Month</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
          {hasSnapshot ? (
            <span className="badge green">AEO snapshot: {aeoSnap.overall_score}/100</span>
          ) : (
            form.hasAeo && (
              <span className="badge orange">No AEO snapshot for {month} — run one first for richer insights</span>
            )
          )}
        </div>
      </div>

      {/* Data fetch status */}
      {fetchStatus && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px', borderColor: fetchStatus.includes('✓') ? 'rgba(52,211,153,.3)' : fetchStatus.includes('403') || fetchStatus.includes('permission') ? 'rgba(255,77,77,.3)' : 'var(--border)' }}>
          <div className="row" style={{ gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
            {fetchStatus.includes('Pulling') && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
            <span style={{ color: fetchStatus.includes('✓') ? 'var(--green)' : fetchStatus.includes('failed') || fetchStatus.includes('403') ? 'var(--orange)' : 'var(--text-muted)', flex: 1 }}>
              {fetchStatus}
            </span>
            {(fetchStatus.includes('cache') || fetchStatus.includes('Not connected')) && (
              <button
                onClick={() => autoFetchMetrics(client, month, true)}
                style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--green)', color: 'var(--green)', whiteSpace: 'nowrap' }}
              >
                {fetchStatus.includes('Not connected') ? 'Connect Google' : 'Refresh Data'}
              </button>
            )}
            {(fetchStatus.includes('403') || fetchStatus.includes('permission') || fetchStatus.includes('failed')) && (
              <button
                onClick={async () => {
                  try {
                    setFetchStatus('Switching Google account…');
                    await switchAccount([SCOPES.ga4, SCOPES.gsc]);
                    autoFetchMetrics(client, month, true);
                  } catch (e) {
                    setFetchStatus('Re-auth failed: ' + e.message);
                  }
                }}
                style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--blue)', color: 'var(--blue)', whiteSpace: 'nowrap' }}
              >
                Switch Google Account
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: SEO Performance Dashboard (auto-fetched) */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <strong>SEO Performance — {monthLabel(month)}</strong>
          <div className="row" style={{ gap: 8 }}>
            {reportData && <span className="badge green" style={{ fontSize: 9 }}>Auto-populated from GA4 + GSC</span>}
            {client.looker_url && (
              <a href={client.looker_url} target="_blank" rel="noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                borderRadius: 'var(--radius)', background: 'rgba(167,139,250,.1)',
                border: '1px solid rgba(167,139,250,.3)', color: ACCENT, fontSize: 12,
                fontWeight: 600, textDecoration: 'none'
              }}>
                Open Looker Report →
              </a>
            )}
          </div>
        </div>
        <ReportDashboard data={reportData} client={client} monthLabel={monthLabel(month)} />
        {!reportData && (() => {
          // Only show a generic loading note when we're actually loading.
          // If fetchStatus already says "Not connected" / "Click Refresh"
          // / "Loaded older cache" the banner above is the signal — adding
          // "Loading…" underneath it just looks broken.
          const isPulling = fetchStatus.includes('Pulling') || fetchStatus.includes('Reconnecting');
          const isStopped = fetchStatus.includes('Not connected') ||
                            fetchStatus.includes('Click Refresh') ||
                            fetchStatus.includes('Loaded older cache') ||
                            fetchStatus.includes('failed');
          if (isStopped) {
            return (
              <div className="muted" style={{ fontSize: 12 }}>
                SEO performance data unavailable until you reconnect Google. AEO snapshot, work history, and AI tools all still work without it.
              </div>
            );
          }
          if (!isPulling && !client.ga4_property_id && !client.gsc_property) {
            return (
              <div className="muted" style={{ fontSize: 12 }}>
                No GA4 or GSC configured — set up in Edit Client → Google Connections.
              </div>
            );
          }
          if (isPulling) {
            return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
          }
          return null;
        })()}
      </div>

      {/* Step 3: AEO manual override (only shown if snapshot missing) */}
      {form.hasAeo && !hasSnapshot && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>AEO Summary (manual — no snapshot for this month)</strong>
          <div className="grid-2" style={{ marginTop: 10 }}>
            <div><label>Score</label><input value={form.aeoScoreManual || ''} onChange={e => update('aeoScoreManual', e.target.value)} /></div>
            <div><label>Share of mentions</label><input value={form.aeoSomManual || ''} onChange={e => update('aeoSomManual', e.target.value)} /></div>
            <div><label>Citations</label><input value={form.aeoCitationsManual || ''} onChange={e => update('aeoCitationsManual', e.target.value)} /></div>
            <div><label>Sentiment</label><input value={form.aeoSentimentManual || ''} onChange={e => update('aeoSentimentManual', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Engines covered</label><input value={form.aeoEnginesManual || ''} onChange={e => update('aeoEnginesManual', e.target.value)} /></div>
          </div>
        </div>
      )}
      {form.hasAeo && hasSnapshot && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>AEO Summary</strong>
          <span className="badge green" style={{ marginLeft: 10 }}>Auto-populated from AEO Snapshot ✓</span>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Score {aeoSnap.overall_score}/100 · {aeoSnap.sentiment} · engines {(aeoSnap.engines_used || []).join(', ')}
          </div>
        </div>
      )}

      {/* What Syte Did This Month (auto-pulled) */}
      {workSummary && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>What Syte Did This Month</strong>
          <span className="badge green" style={{ marginLeft: 10, fontSize: 9 }}>Auto-pulled from suite</span>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workSummary.content.summary && (
              <div className="row" style={{ gap: 8 }}>
                <span style={{ color: 'var(--mod-content)', fontSize: 11, fontWeight: 600, minWidth: 80 }}>Content</span>
                <span style={{ fontSize: 13 }}>{workSummary.content.summary}</span>
                {workSummary.content.topics?.length > 0 && (
                  <span className="muted" style={{ fontSize: 11 }}>({workSummary.content.topics.slice(0, 3).join(', ')})</span>
                )}
              </div>
            )}
            {workSummary.technical.summary && (
              <div className="row" style={{ gap: 8 }}>
                <span style={{ color: 'var(--mod-technical)', fontSize: 11, fontWeight: 600, minWidth: 80 }}>Technical</span>
                <span style={{ fontSize: 13 }}>{workSummary.technical.summary}</span>
              </div>
            )}
            {workSummary.aeo.summary && (
              <div className="row" style={{ gap: 8 }}>
                <span style={{ color: 'var(--mod-aeo)', fontSize: 11, fontWeight: 600, minWidth: 80 }}>AEO</span>
                <span style={{ fontSize: 13 }}>{workSummary.aeo.summary}</span>
              </div>
            )}
            {workSummary.implementations.summary && (
              <div className="row" style={{ gap: 8 }}>
                <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 600, minWidth: 80 }}>Verified</span>
                <span style={{ fontSize: 13 }}>{workSummary.implementations.summary}</span>
              </div>
            )}
            {!workSummary.content.summary && !workSummary.technical.summary && !workSummary.aeo.summary && (
              <div className="muted" style={{ fontSize: 12 }}>No tracked work for this month yet. Generate articles, run scans, or run AEO optimizations first.</div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Additional work (not tracked in suite)</label>
            <textarea
              value={form.additionalWork || ''}
              onChange={e => update('additionalWork', e.target.value)}
              rows={2}
              placeholder="e.g. Migrated blog to new CMS, set up Google Business Profile, manual link building…"
            />
          </div>
        </div>
      )}

      {/* Looker + context */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <strong>Report Settings</strong>
          {client.looker_url && (
            <a href={client.looker_url} target="_blank" rel="noreferrer" style={{ color: ACCENT, fontSize: 12 }}>
              Open Looker Dashboard →
            </a>
          )}
        </div>
        <div>
          <label>Tone</label>
          <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>
            Auto-detect: always positive-first. Dips acknowledged with action plan.
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Algorithm / market context (optional)</label>
          <textarea value={algContext} onChange={e => setAlgContext(e.target.value)} rows={2} placeholder="e.g. Google March 2025 core update rolled out mid-month…" />
        </div>

        {/* Generate CTAs — pulled into their own row above the phase
            pills so they're obvious. Big targets, accent-coloured. */}
        <div style={{
          marginTop: 18, padding: 18,
          background: 'linear-gradient(135deg, rgba(167,139,250,.08), rgba(167,139,250,.02))',
          border: '1px solid rgba(167,139,250,.25)',
          borderRadius: 12
        }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                Ready to generate the report
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Pulls the latest data, runs Alice + microsite + QA, then opens for review.
              </div>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {(client.does_content !== false || client.does_technical !== false) && (
                <button
                  className="primary"
                  onClick={generate}
                  disabled={phase !== 'idle' && phase !== 'review'}
                  style={{
                    background: ACCENT, borderColor: ACCENT, color: '#0a0a0c',
                    padding: '12px 22px', fontSize: 14, fontWeight: 600
                  }}
                >
                  {phase === 'idle' || phase === 'review' ? '▶ Generate Full Report' : 'Working…'}
                </button>
              )}
              {client.does_aeo !== false && (
                <button
                  onClick={generateAeoOnly}
                  disabled={phase !== 'idle' && phase !== 'review'}
                  style={{
                    borderColor: 'var(--mod-aeo)', color: 'var(--mod-aeo)',
                    padding: '12px 22px', fontSize: 14, fontWeight: 600
                  }}
                >
                  {phase === 'idle' || phase === 'review' ? '▶ Generate AEO Report' : 'Working…'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Phase indicators — moved below the CTA so the buttons lead. */}
        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Pipeline:</span>
          <div className="row" style={{ gap: 6 }}>
            {PHASES.map(p => (
              <span key={p.key} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 999,
                border: '1px solid var(--border)',
                background: phase.startsWith(p.key) ? ACCENT : 'transparent',
                color: phase.startsWith(p.key) ? '#0a0a0c'
                       : (phase === 'review' || (phase === 'micro' && p.key === 'alice') || (phase === 'qa' && p.key !== 'qa')) ? 'var(--green)' : 'var(--text-muted)'
              }}>{p.label}</span>
            ))}
          </div>
        </div>
        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
      </div>

      {/* Review section */}
      {phase === 'review' && (
        <>
          {qa && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <strong>QA Review</strong>
                <div className="row" style={{ gap: 10 }}>
                  <span className="badge" style={{
                    background: qa.overallScore >= 8 ? 'rgba(52,211,153,.1)'
                              : qa.overallScore >= 6 ? 'rgba(255,159,67,.1)'
                              : 'rgba(255,77,77,.1)',
                    color: qa.overallScore >= 8 ? 'var(--green)' : qa.overallScore >= 6 ? 'var(--orange)' : 'var(--red)',
                    borderColor: 'transparent'
                  }}>
                    {qa.overallScore}/10
                  </span>
                  {qa.readyToSend
                    ? <span className="badge green">Ready to send</span>
                    : <span className="badge red">Revise before sending</span>}
                </div>
              </div>
              {(qa.checks || []).map((c, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: c.pass ? 'var(--green)' : 'var(--red)', marginRight: 8 }}>
                      {c.pass ? '✓' : '✗'}
                    </span>
                    {c.label}
                  </span>
                  {c.note && <span className="muted" style={{ fontSize: 11 }}>{c.note}</span>}
                </div>
              ))}
              {qa.suggestion && (
                <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 13 }}>
                  <strong>Suggestion:</strong> {qa.suggestion}
                  <div style={{ marginTop: 8 }}>
                    <button onClick={generate}>Regenerate</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>Alice Email</strong>
              <button onClick={copyEmail}>Copy to clipboard</button>
            </div>
            <label>Subject</label>
            <input value={email.subject} onChange={e => setEmail(prev => ({ ...prev, subject: e.target.value }))} />
            <label style={{ marginTop: 10 }}>Body</label>
            <textarea value={email.body} onChange={e => setEmail(prev => ({ ...prev, body: e.target.value }))} rows={12} style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 14 }} />
          </div>

          {micrositeHtml && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <strong>Microsite Preview</strong>
                <div className="row" style={{ gap: 8 }}>
                  <button onClick={downloadHtml}>Download .html</button>
                  <button onClick={() => setShowMicroFull(v => !v)}>{showMicroFull ? 'Collapse' : 'Open full screen'}</button>
                </div>
              </div>
              <iframe
                title="microsite"
                srcDoc={micrositeHtml}
                style={{
                  width: '100%',
                  height: showMicroFull ? '80vh' : 520,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg)'
                }}
              />
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{sent ? 'Sent ✓' : 'Approve & Mark Sent'}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  Logs to the report history for {client.name} — {monthLabel(month)}.
                </div>
              </div>
              <button
                className="primary"
                onClick={markSent}
                disabled={sent}
                style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
              >
                {sent ? 'Logged' : 'Approve & Mark Sent'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
