import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { listAeoSnapshots, logReportSent, logReportGenerated, getGeneratedReport, getCachedReportData, setCachedReportData, persistAeoRuns, saveAeoSnapshot } from '../../lib/supabase.js';
import {
  ALICE_SYSTEM, MICROSITE_SYSTEM, QA_SYSTEM,
  ALICE_AEO_SYSTEM, MICROSITE_AEO_SYSTEM, QA_AEO_SYSTEM,
  buildAlicePayload, getWorkSummary, buildAeoPayload
} from './reportPrompts.js';
import { buildMicrositeHtml, downloadMicrosite, downloadMicrositePdf } from './microsite.js';
import { sanitizeEmail } from './sanitize.js';
import { probeCandidatesFromGSC, groundedProbeSet } from './keywordBuckets.js';
import { parseProbes, migrateClientProbes, addProbes, probesToProbeList } from './aeoProbes.js';
import { buildGoldProbesForClient } from './gridProfile.js';
import { groundClientForAeo } from './grounding.js';

function gscKeywordStrings(reportData) {
  return (reportData?.keywords || [])
    .map(k => (typeof k === 'string' ? k : (k?.query || k?.keyword || '')))
    .map(s => String(s).trim()).filter(Boolean);
}

// Ground a client's probe set in a strategic, buyer-intent GOLD GRID derived
// from their website (LLM extraction) + Search Console + competitors. The
// decision logic (upgrade to gold, retire old junk, never shrink the active
// set) lives in the pure, unit-tested grounding module; here we just wire in the
// browser-coupled builder and a GSC-derived fallback set.
async function groundClientGold(c, reportData) {
  if (!c) return c;
  const kws = gscKeywordStrings(reportData);
  const competitors = (c.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  const fallbackSet = kws.length
    ? groundedProbeSet(probeCandidatesFromGSC(reportData.keywords, c.name, { limit: 40 }), { geo: c.location || c.market, competitors, limit: 24 })
    : [];
  const res = await groundClientForAeo(c, { gscQueries: kws, buildGold: buildGoldProbesForClient, fallbackSet });
  return res.client;
}
import { runSnapshot, snapshotPreflight } from './aeoRunner.js';
import { compareSnapshots, rankBrandWithCompetitors, normalizeSnapshot } from './aeoCompare.js';
import { ensureToken, SCOPES, getToken, switchAccount, silentRefresh, getCurrentEmail, getTokenForEmail, TOKEN_EVENT } from '../technical/googleAuth.js';
import { serverAuthEnabled } from '../../lib/googleServerAuth.js';
import { fetchReportData } from './reportData.js';
import ReportDashboard from './ReportDashboard.jsx';

const ACCENT = '#a78bfa';

// Cap for the live AEO probe that runs inside "Generate Full Report" when a
// client has no saved snapshot for the month. Each query is swept across
// every engine × iterations as live LLM calls, so an uncapped run over a
// large probe-query list takes many minutes and looks like a frozen tab.
const LIVE_PROBE_MAX_QUERIES = 25;

// Hard ceiling on the HTML we'll inline into the microsite preview iframe.
// A srcDoc iframe renders on the SAME main thread as the app, so a multi-MB
// document locks the whole tab while it parses + lays out. A freshly built
// microsite is well under this, but a persisted microsite_html_override is a
// raw stored blob that bypasses the in-builder row caps — one saved before
// those caps existed can be many MB and freeze the report view on load.
// Above this size we don't inline it; we offer download / rebuild instead.
const MAX_INLINE_REPORT_HTML = 1_800_000;

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

// Turn a probe result's per-engine health into human-readable warning lines
// so a timed-out / rate-limited / bad-key engine is visible in the UI instead
// of silently showing up as "0% visibility". Reads the engine_health map that
// runSnapshot returns ({ [id]: { label, runs, errors, sample_error, all_failed } }).
function summarizeProbeIssues(probe) {
  const out = [];
  // Degenerate probe set: too few queries actually ran, which means the
  // strategic grid did not build (site/LLM/GSC signal missing) and the report
  // fell back to a thin set. Flag it up front, independent of engine health.
  const qCount = probe?.per_query?.length || 0;
  if (qCount > 0 && qCount < 12) {
    out.push(`Only ${qCount} probe queries ran — the strategic grid likely did not build. Check the client website URL and Search Console connection, then re-run (expected 20+ queries).`);
  }
  const health = probe?.engine_health;
  if (!health) return out;
  const engines = Object.values(health);
  const failing = engines.filter(h => h.errors > 0);
  if (!failing.length) return out;

  const withData = engines.filter(h => h.runs > 0 && !h.all_failed).length;
  if (engines.length > 0 && withData === 0) {
    out.push('Every AI engine failed to respond — the AEO numbers below are all zero because no engine returned data, not because visibility is actually zero.');
  }
  for (const h of failing) {
    const sample = (h.sample_error || 'failed').trim();
    const reason = /timed out/i.test(sample) ? 'timed out'
      : /\b(401|403)\b|unauthor|invalid.*key|x-api-key/i.test(sample) ? 'auth failed (check API key in Suite Settings)'
      : /\b429\b|rate.?limit|quota/i.test(sample) ? 'rate limited / quota exhausted'
      : /\b400\b/.test(sample) ? 'bad request (check the API key type in Suite Settings)'
      : sample.slice(0, 120);
    const label = h.label || 'Engine';
    out.push(`${label}: ${reason}${h.all_failed ? ' — no usable responses' : ` (${h.errors} of ${h.runs} probes failed)`}`);
  }
  return out;
}

function fmtEta(ms) {
  if (!isFinite(ms) || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `~${m}m ${s % 60}s left` : `~${s}s left`;
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
  const saveClient = useClients(s => s.save);
  const [month, setMonth] = useState(previousMonth());
  const [form, setForm] = useState({});
  const [algContext, setAlgContext] = useState('');
  const [aeoSnap, setAeoSnap] = useState(null);
  const [workSummary, setWorkSummary] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | fetching | alice | micro | qa | review
  const [aeoProgress, setAeoProgress] = useState(null); // { index, total, engine, query, iteration, iterations }
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
  const [probeWarnings, setProbeWarnings] = useState([]);
  // In-place visual editing state. When set, renders verbatim instead of
  // rebuilding from microJson — that's how operator edits to copy/figures
  // survive download / PDF / saved-report reload.
  const [htmlOverride, setHtmlOverride] = useState(null);
  const [editingMicro, setEditingMicro] = useState(false);
  const microIframeRef = useRef(null);
  // Guards autoFetchMetrics against re-entrancy. Auth (ensureToken /
  // silentRefresh) persists tokens, which dispatches TOKEN_EVENT, which the
  // listener below turns back into an autoFetchMetrics(force) call — and the
  // listener reads a stale fetchStatus closure, so that fed back on itself
  // into a loop that re-popped the Google auth tab and froze the report view.
  const fetchInFlightRef = useRef(false);
  const probeStartRef = useRef(0); // wall-clock start of the AEO probe, for ETA

  const [savedReportLoaded, setSavedReportLoaded] = useState(false);

  // When client / month changes: rehydrate any previously-generated report
  // (so review mode shows up without regenerating), then fetch fresh GA4 +
  // GSC data only if there's nothing saved to render.
  useEffect(() => {
    setEmail({ subject: '', body: '' });
    setMicroJson(null); setQa(null); setSent(false); setPhase('idle'); setErr('');
    setAeoOnly(false);
    setSavedReportLoaded(false);
    setLiveAeoProbe(null); setProbeWarnings([]);
    setHtmlOverride(null); setEditingMicro(false);
    const hasSeo = client?.does_content !== false || client?.does_technical !== false;
    const hasAeo = client?.does_aeo !== false;
    setForm({ hasSeo, hasAeo, industry: client?.industry || '' });
    if (!client?.id) return;
    setWorkSummary(getWorkSummary(client.id, month));

    let cancelled = false;
    (async () => {
      const saved = await getGeneratedReport(client.id, month).catch(() => null);
      if (cancelled) return;
      // Microsite JSON is required to render the iframe preview, so review
      // mode only kicks in if at least that survived the save.
      if (saved?.microsite_json) {
        setMicroJson(saved.microsite_json);
        setEmail({ subject: saved.email_subject || '', body: saved.email_body || '' });
        if (saved.qa) setQa(saved.qa);
        if (saved.aeo_probe) setLiveAeoProbe(saved.aeo_probe);
        if (saved.report_type === 'aeo') setAeoOnly(true);
        if (saved.microsite_html_override) setHtmlOverride(saved.microsite_html_override);
        // Saved snapshot of report_data wins over a live fetch — the
        // generated copy was written against this data and the numbers
        // would mismatch otherwise.
        if (saved.report_data) {
          setReportData(saved.report_data);
          setFetchStatus('Loaded saved report from ' + new Date(saved.generated_at || saved.created_at || Date.now()).toLocaleDateString());
        } else {
          autoFetchMetrics(client, month);
        }
        setPhase('review');
        setSavedReportLoaded(true);
      } else {
        autoFetchMetrics(client, month);
      }
    })();
    return () => { cancelled = true; };
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

  // Re-trigger the data fetch whenever a Google token lands — covers the
  // case where the operator signs in elsewhere (the client modal's picker,
  // a background refresh resolving late, switching accounts) while the
  // Monthly Report is already on screen. Without this they had to navigate
  // away and back, or "reset it in the client part", to see data load.
  // The fetchStatus guard avoids a redundant pull when autoFetchMetrics
  // itself just persisted the token mid-cycle.
  useEffect(() => {
    if (!client?.id) return;
    const onTokenChange = () => {
      if (!getToken()?.access_token) return;
      // Never react to a token change while a fetch/auth cycle is already
      // running — otherwise the token writes that cycle performs feed back
      // into another fetch and the report view locks up.
      if (fetchInFlightRef.current) return;
      // Only react when we're currently in an unconnected / mismatched
      // state. If a fetch is already in progress or data is already
      // loaded, the in-flight cycle will handle it.
      if (
        fetchStatus.includes('Not connected') ||
        fetchStatus.includes('Wrong Google') ||
        fetchStatus.includes('sign-in needed') ||
        fetchStatus.includes('Reconnecting') ||
        fetchStatus === ''
      ) {
        autoFetchMetrics(client, month, true);
      }
    };
    window.addEventListener(TOKEN_EVENT, onTokenChange);
    return () => window.removeEventListener(TOKEN_EVENT, onTokenChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, month, fetchStatus]);

  // Bump this whenever the report data shape changes in a way that
  // makes old cache entries stale (e.g. keyword pull went 50 → 500,
  // pagination added at v3). Cache entries without a matching version
  // are treated as a miss and refetched.
  const REPORT_DATA_VERSION = 3;

  // Pull all report data (GA4 traffic + conversions + GSC keywords) via reportData.js.
  // Re-entrancy guard wrapper: a single fetch/auth cycle can dispatch several
  // TOKEN_EVENTs (each persisted token fires one). Without this guard the
  // token listener re-enters here mid-cycle and the calls pile up until the
  // tab freezes. While one cycle is running, further calls are no-ops; the
  // running cycle already picks up whatever token just landed.
  async function autoFetchMetrics(c, m, forceRefresh = false) {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      await runAutoFetchMetrics(c, m, forceRefresh);
    } finally {
      fetchInFlightRef.current = false;
    }
  }

  async function runAutoFetchMetrics(c, m, forceRefresh = false) {
    if (!c) return;

    // Per-API account bindings: a client can have GA4 in one Google account
    // and GSC in another. Each API uses its own binding; both fall back to
    // the legacy single google_account_email if the per-API field isn't set
    // yet (clients created before this split). Computed up front so the cache
    // check below can invalidate when the binding changes, not just the
    // property IDs.
    const ga4Email = c.ga4_account_email || c.google_account_email || null;
    const gscEmail = c.gsc_account_email || c.google_account_email || null;

    // Check cache first (unless forced refresh).
    if (!forceRefresh) {
      try {
        const cached = await getCachedReportData(c.id, m);
        const isCurrentVersion = cached?.data?.version === REPORT_DATA_VERSION;
        // Cache is also stale if the client's GA4/GSC properties OR the
        // Google account they're bound to have changed since the cached
        // fetch — otherwise fixing a wrong property URL, or re-binding a
        // client to a working Google account after its credentials went
        // stale, leaves the old data / permission error stuck on screen.
        const propsMatch = cached?.data
          && cached.data.ga4_property_id === (c.ga4_property_id || null)
          && cached.data.gsc_property === (c.gsc_property || null)
          && (cached.data.ga4_account_email ?? null) === ga4Email
          && (cached.data.gsc_account_email ?? null) === gscEmail;
        if (cached?.data && isCurrentVersion && propsMatch) {
          setReportData(cached.data);
          setFetchStatus('Loaded from cache (fetched ' + new Date(cached.fetched_at).toLocaleDateString() + ') · Click Refresh Data to re-fetch');
          return;
        }
        if (cached?.data && isCurrentVersion && !propsMatch) {
          // Properties or account binding changed on the client — drop the
          // cached result entirely and fall through to a fresh fetch.
          setReportData(null);
          setFetchStatus('GA4/GSC property or Google account changed — refetching…');
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
    // ga4Email / gscEmail were resolved above (the per-API bindings, with a
    // fallback to the legacy single google_account_email).
    const needsGa4 = !!c.ga4_property_id;
    const needsGsc = !!c.gsc_property;
    const needsGoogle = needsGa4 || needsGsc;

    // If both APIs already have a valid cached token under the right
    // account, we can fetch silently with zero round-trips. Otherwise we
    // try a silent refresh per missing API; if that fails, defer to an
    // explicit Connect Google CTA (don't auto-pop on mount).
    //
    // Skip this entire browser-auth preflight when server auth is on: the
    // proxy holds the tokens, so there's nothing to sign into here. Running
    // it anyway would pop a pointless browser sign-in AND auto-save the
    // current browser account onto the client (the wrong-credentials bug).
    if (needsGoogle && !serverAuthEnabled()) {
      const ga4Cached = needsGa4 && ga4Email ? !!getTokenForEmail(ga4Email, [SCOPES.ga4]) : !needsGa4;
      const gscCached = needsGsc && gscEmail ? !!getTokenForEmail(gscEmail, [SCOPES.gsc]) : !needsGsc;
      const allCached = ga4Cached && gscCached;

      if (!allCached && !forceRefresh) {
        setFetchStatus('Reconnecting to Google in the background…');
        // Silent refresh whichever API is missing, hinting at its bound
        // account. If both succeed silently we proceed; if either still
        // fails, fall back to the Connect Google CTA.
        const tasks = [];
        if (needsGa4 && !ga4Cached) tasks.push(silentRefresh([SCOPES.ga4], { loginHint: ga4Email }));
        if (needsGsc && !gscCached) tasks.push(silentRefresh([SCOPES.gsc], { loginHint: gscEmail }));
        const results = await Promise.all(tasks);
        const stillMissing =
          (needsGa4 && ga4Email && !getTokenForEmail(ga4Email, [SCOPES.ga4])) ||
          (needsGsc && gscEmail && !getTokenForEmail(gscEmail, [SCOPES.gsc])) ||
          (!ga4Email && !gscEmail && !results.some(t => t?.access_token));
        if (stillMissing) {
          setFetchStatus('Not connected to Google — click Connect Google to fetch fresh SEO data (cached AEO and saved client data still available)');
          return;
        }
      }

      if (!allCached && forceRefresh) {
        setFetchStatus('Connecting to Google — please sign in if prompted…');
        try {
          // Pop the picker for whichever account the user needs to add.
          // GA4 binding takes priority; if GA4 is already cached we'll
          // pop GSC's binding instead.
          if (needsGa4 && ga4Email && !getTokenForEmail(ga4Email, [SCOPES.ga4])) {
            await ensureToken([SCOPES.ga4], { expectedEmail: ga4Email });
          } else if (needsGsc && gscEmail && !getTokenForEmail(gscEmail, [SCOPES.gsc])) {
            await ensureToken([SCOPES.gsc], { expectedEmail: gscEmail });
          } else {
            // No per-API binding saved yet — first-time setup. Pop the
            // combined picker and capture whatever the operator chose.
            await ensureToken([SCOPES.ga4, SCOPES.gsc]);
            try {
              const email = await getCurrentEmail();
              if (email) {
                const patch = { ...c };
                if (!c.google_account_email) patch.google_account_email = email;
                if (needsGa4 && !c.ga4_account_email) patch.ga4_account_email = email;
                if (needsGsc && !c.gsc_account_email) patch.gsc_account_email = email;
                await saveClient(patch);
              }
            } catch {}
          }
        } catch (e) {
          if (e?.accountMismatch) {
            setFetchStatus(`Wrong Google account: signed in as ${e.currentEmail}, but ${c.name} expected ${e.expectedEmail}. Click Switch Google Account.`);
          } else if (e?.requiresInteraction || /popup|denied|interaction/i.test(e?.message || '')) {
            setFetchStatus('Google sign-in needed — click Switch Google Account to continue.');
          } else {
            setFetchStatus('Google auth failed: ' + (e?.message || 'unknown'));
          }
          return;
        }
      }
    }

    const [year, mo] = m.split('-').map(Number);
    setFetchStatus('Pulling GA4 + GSC data for ' + monthLabel(m) + '…');
    try {
      const data = await fetchReportData(c, year, mo);
      data.version = REPORT_DATA_VERSION;
      data.ga4_property_id = c.ga4_property_id || null;
      data.gsc_property = c.gsc_property || null;
      // Stamp the account binding this pull used so a later re-bind (after
      // stale credentials are re-added) is detected as a cache miss.
      data.ga4_account_email = ga4Email;
      data.gsc_account_email = gscEmail;
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
    // Only weave AEO into the report when the client is actually on AEO
    // (ticked as an AEO client), or when this is a dedicated AEO-only
    // report. Otherwise a non-AEO client that happens to have an old
    // snapshot on file would still get the full "AI Visibility" sections
    // in its Full Report. `does_aeo !== false` matches the tick convention
    // used across the suite (undefined/true = on, explicit false = off).
    const includeAeo = aeoOnly || client.does_aeo !== false;
    // Use the live probe if we just ran one; otherwise fall back to the
    // saved snapshot for this month so the report renders even without
    // a fresh probe in the same session. Normalize either way so legacy
    // snapshots get derived visibility / detection / keyword_wins fields.
    const aeoProbe = includeAeo ? normalizeSnapshot(liveAeoProbe || aeoSnap || null) : null;
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

  // What we actually render / download / print: the operator's visual
  // edits if any, otherwise the freshly built microsite. Override is
  // cleared when client/month change.
  const displayHtml = htmlOverride || micrositeHtml;

  // Guard the inline preview against an oversized HTML blob (almost always a
  // stale microsite_html_override saved before the per-table row caps). If
  // the override is too big to inline safely, preview the freshly built
  // (capped) microsite instead — the original is still downloadable and can
  // be dropped with "Discard edits". previewTooLarge is the final backstop:
  // if even the rebuilt HTML somehow exceeds the ceiling we skip the iframe
  // entirely rather than freeze the tab.
  const overrideTooLarge = !!htmlOverride && htmlOverride.length > MAX_INLINE_REPORT_HTML;
  const previewHtml = overrideTooLarge ? (micrositeHtml || '') : displayHtml;
  const previewTooLarge = previewHtml.length > MAX_INLINE_REPORT_HTML;

  // Generate AEO-only report — skips SEO data, focuses on AI visibility.
  // Auto-save this month's probe as a snapshot so next month has a baseline to
  // compare against (this is what turns "first snapshot" into MoM deltas).
  // Only saves once per client per report-month; the report month is used so the
  // History timeline lines up with the reports.
  async function autoSaveSnapshot(probeResult) {
    if (!client || !probeResult || aeoSnap) return; // already have a snapshot this month
    try {
      const saved = await saveAeoSnapshot({ ...probeResult, client_id: client.id, month });
      setAeoSnap(saved);
    } catch { /* non-fatal — report still works without the saved baseline */ }
  }

  async function generateAeoOnly() {
    if (!client) return;
    setErr(''); setEmail({ subject: '', body: '' }); setMicroJson(null); setQa(null); setSent(false); setLiveAeoProbe(null);
    setAeoOnly(true); setProbeWarnings([]);

    try {
      // Step 1: Run AEO probe
      const preflight = snapshotPreflight(client);
      if (!preflight.canRun) {
        setErr('Add AEO probe queries to this client first (Edit → AEO Probe Queries → Generate from brand context).');
        return;
      }
      setPhase('aeo-probe');
      // Ground the probe set in a strategic gold grid (website + GSC + competitors).
      const groundedClient = await groundClientGold(client, reportData);
      if (groundedClient !== client && groundedClient.aeo_probes) saveClient(groundedClient).catch(() => {});
      const probeResult = await runSnapshot(groundedClient, {
        retrievalOnly: true, // headline is retrieval-first; skip the parametric pass to halve engine calls
        expandWinners: true, winnerTarget: 30, maxExpansionQueries: 40, // spider-web long-tail off every winner
        onRuns: (records, raws) => persistAeoRuns(records, raws).catch(() => {}),
        onProgress: (p) => { if (!p.index) probeStartRef.current = Date.now(); setPhase('aeo-probe'); setAeoProgress(p); }
      });
      setLiveAeoProbe(probeResult);
      setProbeWarnings(summarizeProbeIssues(probeResult));
      autoSaveSnapshot(probeResult);

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
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        temperature: 0.7
      });
      setEmail(sanitizeEmail(parseAliceOutput(aliceText)));

      // Step 3: Generate microsite JSON (AEO-only shape)
      setPhase('micro');
      const micrositeText = await claudeComplete({
        system: MICROSITE_AEO_SYSTEM,
        messages: [{ role: 'user', content: aeoPayload }],
        model: 'claude-sonnet-4-6',
        // Was 1200 — the AEO microsite JSON has narratives, priorities,
        // highlights, work items etc. that easily blow past that and
        // truncate mid-JSON, which then fails extractJSON. 4000 leaves
        // headroom while still being well under the model limit.
        max_tokens: 4000,
        temperature: 0.5
      });
      const microObj = extractJSON(micrositeText);
      if (!microObj) {
        console.error('[Report] Microsite (AEO) raw output:', micrositeText);
        throw new Error('Microsite JSON could not be parsed. Raw output logged to console — usually means truncated output (raise max_tokens) or model wrapped JSON in stray prose.');
      }
      if (!microObj.clientName) microObj.clientName = client.name;
      setMicroJson(microObj);

      // Step 4: QA (AEO-specific checks: no SEO talk, no doom framing)
      setPhase('qa');
      const qaText = await claudeComplete({
        system: QA_AEO_SYSTEM,
        messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
        model: 'claude-sonnet-4-6',
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
        email_subject: parseAliceOutput(aliceText).subject || '',
        // Full content snapshot so the report can be re-rendered on a
        // future visit without regenerating.
        email_body: parseAliceOutput(aliceText).body || aliceText,
        microsite_json: microObj,
        qa: qaObj || null,
        aeo_probe: probeResult,
        report_data: null
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
    setAeoOnly(false); setProbeWarnings([]);

    // Only include AEO in a Full Report when the client is ticked as an
    // AEO client (`does_aeo !== false`). Without this gate, any client with
    // an old snapshot on file — or one for which the live probe below ran —
    // would get AEO momentum metrics and the full AI Visibility microsite
    // sections even though they aren't doing AEO.
    const clientDoesAeo = client.does_aeo !== false;

    // Compute MoM comparison and ranking from saved snapshot if we have one,
    // so Alice can lead with momentum metrics ("+68% citations MoM") even
    // when not running a fresh probe.
    const aeoForCompare = clientDoesAeo ? (aeoSnap || liveAeoProbe) : null;
    const aeoCompare = aeoForCompare ? compareSnapshots(aeoForCompare, previousAeoSnap) : null;
    const aeoRanking = aeoForCompare ? rankBrandWithCompetitors(aeoForCompare, client.name) : null;
    const brandRank = aeoRanking ? aeoRanking.findIndex(r => r.isBrand) + 1 : null;

    const payload = buildAlicePayload({
      clientName: client.name,
      industry: client.industry || '',
      goals: client.context,
      startDate: client.start_date,
      month: monthLabel(month),
      previousMonthLabel: previousAeoSnap ? monthLabel(previousAeoSnap.month) : null,
      algorithmContext: algContext,
      aeoCompare,
      aeoRanking,
      brandRank,
      ...form
    }, clientDoesAeo ? aeoSnap : null, workSummary);

    try {
      // 0. Live AEO probe — only for AEO-ticked clients, and only when
      // there's no saved AEO snapshot for this month.
      //   - clientDoesAeo: a Full Report must never run (or surface) AEO for
      //     a client that isn't ticked as an AEO client.
      //   - !aeoSnap: a live probe is (probe queries × engines × iterations)
      //     live LLM calls; for a client with a large probe-query list that's
      //     many minutes of sequential work, which made "Generate Full Report"
      //     look frozen. When a snapshot already exists the report renders
      //     every AEO section from it (micrositeHtml prefers liveAeoProbe, then
      //     falls back to aeoSnap; the Alice payload uses aeoSnap directly), so
      //     re-probing live on each generate is pure waste — skip it. Use the
      //     dedicated AEO Snapshot tool, or the "Generate AEO Report" button,
      //     to pull fresh probe data on demand.
      const preflight = snapshotPreflight(client);
      if (clientDoesAeo && !aeoSnap && preflight.canRun) {
        setPhase('aeo-probe');
        try {
          // Cap the in-report fallback probe so a client with a large
          // probe-query list can't turn Generate into a many-minute sweep.
          // The full set is available via the AEO Snapshot tool / Generate
          // AEO Report.
          const groundedClient = await groundClientGold(client, reportData);
          if (groundedClient !== client && groundedClient.aeo_probes) saveClient(groundedClient).catch(() => {});
          const probeResult = await runSnapshot(groundedClient, {
            maxQueries: LIVE_PROBE_MAX_QUERIES,
            retrievalOnly: true, // headline is retrieval-first; skip the parametric pass to halve engine calls
            expandWinners: true, winnerTarget: 30, maxExpansionQueries: 40, // spider-web long-tail off every winner
            onRuns: (records, raws) => persistAeoRuns(records, raws).catch(() => {}),
            onProgress: (p) => { if (!p.index) probeStartRef.current = Date.now(); setPhase('aeo-probe'); setAeoProgress(p); }
          });
          setLiveAeoProbe(probeResult);
          setProbeWarnings(summarizeProbeIssues(probeResult));
          autoSaveSnapshot(probeResult);
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        temperature: 0.7
      });
      const parsed = sanitizeEmail(parseAliceOutput(aliceText));
      setEmail(parsed);

      // 2. Microsite JSON
      setPhase('micro');
      const micrositeText = await claudeComplete({
        system: MICROSITE_SYSTEM,
        messages: [{ role: 'user', content: payload }],
        model: 'claude-sonnet-4-6',
        // Was 1000 — same truncation issue as the AEO path. Bumped to 4000.
        max_tokens: 4000,
        temperature: 0.5
      });
      const microObj = extractJSON(micrositeText);
      if (!microObj) {
        console.error('[Report] Microsite raw output:', micrositeText);
        throw new Error('Microsite JSON could not be parsed from model output. Raw output logged to console — usually means truncated output (raise max_tokens) or model wrapped JSON in stray prose.');
      }
      if (!microObj.clientName) microObj.clientName = client.name;
      setMicroJson(microObj);

      // 3. QA
      setPhase('qa');
      const qaText = await claudeComplete({
        system: QA_SYSTEM,
        messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
        model: 'claude-sonnet-4-6',
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
        email_subject: parsed.subject || '',
        // Full content snapshot so the report can be re-rendered on a
        // future visit without regenerating.
        email_body: parsed.body || aliceText,
        microsite_json: microObj,
        qa: qaObj || null,
        aeo_probe: liveAeoProbe,
        report_data: reportData
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
    if (!displayHtml) return;
    const safeName = (client.name || 'client').replace(/[^a-z0-9]+/gi, '-');
    downloadMicrosite(displayHtml, `${safeName}-${month}-Report.html`);
  }

  // Print to PDF — opens the microsite in a new window with print-
  // friendly CSS injected, then triggers window.print() so the user
  // gets the browser's "Save as PDF" dialog. No server-side renderer
  // needed; works in every modern browser.
  function downloadPdf() {
    if (!displayHtml) return;
    const safeName = (client.name || 'client').replace(/[^a-z0-9]+/gi, '-');
    downloadMicrositePdf(displayHtml, `${safeName}-${month}-Report.pdf`);
  }

  // Toggle in-place visual editing on the microsite preview iframe. Sets
  // body.contentEditable so the operator can click into any rendered
  // text and tweak it. Click Apply Edits to capture the resulting HTML
  // as the override; from then on download / PDF / saved-report reload
  // all reflect the edits.
  function toggleMicroEdit() {
    const iframe = microIframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body) return;
    if (editingMicro) {
      doc.body.contentEditable = 'false';
      doc.designMode = 'off';
      setEditingMicro(false);
    } else {
      doc.body.contentEditable = 'true';
      // designMode = 'on' makes the whole document editable (richer
      // selection / paste behaviour than per-element contentEditable).
      try { doc.designMode = 'on'; } catch {}
      setEditingMicro(true);
      try { iframe.contentWindow?.focus(); } catch {}
    }
  }

  async function applyMicroEdits() {
    const iframe = microIframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    // Capture the full document including <head> / <style> so the saved
    // HTML re-renders identically — the microsite's CSS lives in the
    // iframe's <style> block.
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    setHtmlOverride(html);
    // Persist immediately so a tab close or refresh keeps the edits.
    try {
      await logReportGenerated({
        client_id: client.id,
        month,
        report_type: aeoOnly ? 'aeo' : 'full',
        qa_score: qa?.overallScore || null,
        email_subject: email.subject || '',
        email_body: email.body || '',
        microsite_json: microJson,
        microsite_html_override: html,
        qa: qa || null,
        aeo_probe: liveAeoProbe,
        report_data: aeoOnly ? null : reportData
      });
    } catch {}
    // Exit edit mode — the iframe will reload from the new srcDoc.
    if (doc.body) {
      doc.body.contentEditable = 'false';
      try { doc.designMode = 'off'; } catch {}
    }
    setEditingMicro(false);
  }

  function discardMicroEdits() {
    setHtmlOverride(null);
    setEditingMicro(false);
  }

  if (!client) return <div className="muted">Select a client first.</div>;

  const hasSnapshot = !!aeoSnap;

  // Drop the AEO Probe step from the pipeline display for clients that
  // aren't ticked as AEO clients — a Full Report for them never probes,
  // so advertising the step is misleading (this is what made Gym Gear,
  // which is not on AEO, still "show AEO probe"). form.hasAeo mirrors the
  // does_aeo !== false tick convention.
  const PHASES = [
    ...(form.hasAeo ? [{ key: 'aeo-probe', label: 'AEO Probe' }] : []),
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
            {(fetchStatus.includes('cache') || fetchStatus.includes('Not connected') || fetchStatus.includes('Loaded saved report')) && (
              <button
                onClick={async () => {
                  // Refresh-data path also clears the saved-report-loaded
                  // state so the UI flow doesn't keep flagging stale data.
                  setSavedReportLoaded(false);
                  setReportData(null);
                  await autoFetchMetrics(client, month, true);
                }}
                style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--green)', color: 'var(--green)', whiteSpace: 'nowrap' }}
              >
                {fetchStatus.includes('Not connected') ? 'Connect Google' : 'Refresh Data'}
              </button>
            )}
            {(fetchStatus.includes('403') || fetchStatus.includes('permission') || fetchStatus.includes('failed') || fetchStatus.includes('Wrong Google account') || fetchStatus.includes('sign-in needed') || fetchStatus.includes('Not connected')) && (
              <button
                onClick={async () => {
                  try {
                    setFetchStatus('Switching Google account…');
                    // No loginHint here: the operator is hitting Switch
                    // because the bound account is wrong / unavailable.
                    // forcePicker shows the chooser so they can pick any
                    // signed-in account.
                    await switchAccount([SCOPES.ga4, SCOPES.gsc]);
                    // Re-bind to whatever the operator picked. Without this,
                    // the next mount silentRefresh keeps trying the old
                    // email and fails the same way.
                    try {
                      const email = await getCurrentEmail();
                      if (email && email !== client.google_account_email) {
                        await saveClient({
                          ...client,
                          google_account_email: email,
                          ga4_account_email: email,
                          gsc_account_email: email
                        });
                      }
                    } catch {}
                    autoFetchMetrics(client, month, true);
                  } catch (e) {
                    setFetchStatus('Re-auth failed: ' + e.message);
                  }
                }}
                style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--blue)', color: 'var(--blue)', whiteSpace: 'nowrap' }}
              >
                {client.google_account_email ? `Switch from ${client.google_account_email}` : 'Switch Google Account'}
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
        {/* Live progress while the AEO probe sweeps the engines — the long
            phase. Shows it's working, not frozen. */}
        {phase === 'aeo-probe' && aeoProgress && aeoProgress.total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, gap: 8 }}>
              <span>
                Probing AI engines… {aeoProgress.index} / {aeoProgress.total} responses
                {(() => {
                  if (!probeStartRef.current || !aeoProgress.index) return '';
                  const per = (Date.now() - probeStartRef.current) / aeoProgress.index;
                  const eta = fmtEta((aeoProgress.total - aeoProgress.index) * per);
                  return eta ? ' · ' + eta : '';
                })()}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                {aeoProgress.engine}{aeoProgress.query ? ' · ' + aeoProgress.query.slice(0, 48) : ''}
              </span>
            </div>
            <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: Math.round((aeoProgress.index / aeoProgress.total) * 100) + '%', height: '100%', background: ACCENT, transition: 'width .3s' }} />
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
              This is the slow step (live calls to every AI engine). Leave it running — it does not hang.
            </div>
          </div>
        )}
        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}

        {/* AEO probe health — explains why the probe was thin/zeroed
            (timeout, bad key, rate limit) instead of failing silently. */}
        {probeWarnings.length > 0 && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(255,159,67,.08)', border: '1px solid rgba(255,159,67,.3)'
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)', marginBottom: 6 }}>
              ⚠ AEO probe ran with issues
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>
              {probeWarnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Review section */}
      {phase === 'review' && (
        <>
          {savedReportLoaded && (
            <div className="card" style={{ marginBottom: 14, padding: '10px 16px', borderColor: 'rgba(167,139,250,.4)', background: 'rgba(167,139,250,.06)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13 }}>
                  <strong style={{ color: ACCENT }}>Saved report loaded.</strong>{' '}
                  <span className="muted">Showing the report generated for {monthLabel(month)}. Refresh data to pull live GA4 + GSC, or Regenerate to rewrite the email + microsite from scratch.</span>
                </span>
                <button
                  onClick={async () => {
                    // Discard the frozen reportData snapshot and pull live
                    // GA4 + GSC. Useful when the saved report was generated
                    // before the operator wired up the client's properties
                    // (or when the operator just wants the latest numbers
                    // without regenerating the email + microsite copy).
                    setSavedReportLoaded(false);
                    setReportData(null);
                    await autoFetchMetrics(client, month, true);
                  }}
                  style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--green)', color: 'var(--green)', whiteSpace: 'nowrap' }}
                >
                  Refresh data
                </button>
              </div>
            </div>
          )}
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

          {displayHtml && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>Microsite Preview</strong>
                  {htmlOverride && !editingMicro && (
                    <span className="badge" style={{ fontSize: 9, background: 'rgba(167,139,250,.15)', color: ACCENT, borderColor: ACCENT }}>EDITED</span>
                  )}
                  {editingMicro && (
                    <span className="badge" style={{ fontSize: 9, background: 'rgba(255,159,67,.15)', color: 'var(--orange)', borderColor: 'var(--orange)' }}>EDITING — click into the preview to change text</span>
                  )}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {!editingMicro && (
                    <button onClick={toggleMicroEdit} style={{ borderColor: ACCENT, color: ACCENT }}>
                      {htmlOverride ? 'Edit again' : 'Edit visually'}
                    </button>
                  )}
                  {editingMicro && (
                    <>
                      <button onClick={applyMicroEdits} className="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}>Apply edits</button>
                      <button onClick={toggleMicroEdit}>Cancel</button>
                    </>
                  )}
                  {htmlOverride && !editingMicro && (
                    <button onClick={discardMicroEdits} style={{ color: 'var(--red)' }}>Discard edits</button>
                  )}
                  <button onClick={downloadHtml} disabled={editingMicro}>Download .html</button>
                  <button onClick={downloadPdf} className="primary" disabled={editingMicro}>Download PDF</button>
                  <button onClick={() => setShowMicroFull(v => !v)}>{showMicroFull ? 'Collapse' : 'Open full screen'}</button>
                </div>
              </div>
              {overrideTooLarge && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 10, padding: '8px 10px', border: '1px solid var(--orange)', borderRadius: 8, color: 'var(--orange)' }}>
                  This report has large saved manual edits ({Math.round(htmlOverride.length / 1024)} KB). Previewing the freshly built version instead to keep the page responsive — the saved edits are still in your downloads, or click <strong>Discard edits</strong> to drop them.
                </div>
              )}
              {previewTooLarge ? (
                <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 'var(--radius)', textAlign: 'center', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Preview skipped — report too large to render inline</div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
                    This report is {Math.round(previewHtml.length / 1024)} KB, which would lock the page if rendered here. Use the buttons above to download the .html or PDF, where it opens in its own window.
                  </div>
                  {htmlOverride && (
                    <button onClick={discardMicroEdits} style={{ color: 'var(--red)' }}>Discard manual edits and rebuild</button>
                  )}
                </div>
              ) : (
                <iframe
                  ref={microIframeRef}
                  title="microsite"
                  srcDoc={previewHtml}
                  style={{
                    width: '100%',
                    height: showMicroFull ? '80vh' : 520,
                    border: editingMicro ? '2px solid ' + ACCENT : '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--bg)'
                  }}
                />
              )}
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
