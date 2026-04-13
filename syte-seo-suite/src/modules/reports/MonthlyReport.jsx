import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { listAeoSnapshots, logReportSent } from '../../lib/supabase.js';
import { ALICE_SYSTEM, MICROSITE_SYSTEM, QA_SYSTEM, buildAlicePayload, getWorkSummary } from './reportPrompts.js';
import { buildMicrositeHtml, downloadMicrosite } from './microsite.js';
import { runReport } from '../aeo/ga4.js';
import { querySearchAnalytics } from '../technical/gsc.js';
import { ensureToken, SCOPES, getToken } from '../technical/googleAuth.js';

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

  // Auto-fetch GA4 + GSC data when client or month changes.
  useEffect(() => {
    setEmail({ subject: '', body: '' });
    setMicroJson(null); setQa(null); setSent(false); setPhase('idle'); setErr('');
    const hasSeo = client?.does_content !== false || client?.does_technical !== false;
    const hasAeo = client?.does_aeo !== false;
    setForm({ hasSeo, hasAeo, industry: client?.industry || '' });
    if (client?.id) {
      setWorkSummary(getWorkSummary(client.id, month));
      autoFetchMetrics(client, month);
    }
  }, [client?.id, month]);

  useEffect(() => {
    if (!client) { setAeoSnap(null); setWorkSummary(null); return; }
    listAeoSnapshots(client.id).then(rows => {
      const match = rows.find(r => r.month === month) || null;
      setAeoSnap(match);
    }).catch(() => {});
  }, [client?.id, month]);

  // Pull GA4 traffic + GSC search data automatically.
  async function autoFetchMetrics(c, m) {
    if (!c) return;
    setFetchStatus('Checking Google connection…');

    // Calculate date ranges for the report month.
    const [year, mo] = m.split('-').map(Number);
    const thisStart = new Date(year, mo - 1, 1);
    const thisEnd = new Date(year, mo, 0); // last day of month
    const lastStart = new Date(year, mo - 2, 1);
    const lastEnd = new Date(year, mo - 1, 0);
    // Same month last year
    const yoyStart = new Date(year - 1, mo - 1, 1);
    const yoyEnd = new Date(year - 1, mo, 0);

    const token = getToken();
    if (!token?.access_token) {
      setFetchStatus('Google not connected — enter metrics manually or connect in Settings');
      return;
    }

    // GA4 traffic data
    if (c.ga4_property_id) {
      setFetchStatus('Pulling GA4 traffic data…');
      try {
        // This month
        const thisMonth = await fetchGA4Month(c.ga4_property_id, thisStart, thisEnd);
        // Last month
        const lastMonth = await fetchGA4Month(c.ga4_property_id, lastStart, lastEnd);
        // Same month last year
        let yoyMonth = null;
        try { yoyMonth = await fetchGA4Month(c.ga4_property_id, yoyStart, yoyEnd); } catch {}

        setForm(prev => ({
          ...prev,
          seoUsersThis: thisMonth.totalUsers,
          seoUsersLast: lastMonth.totalUsers,
          seoUsersYoy: yoyMonth?.totalUsers || '',
          seoOrganicThis: thisMonth.organicUsers,
          seoOrganicLast: lastMonth.organicUsers,
          seoConvThis: thisMonth.conversions,
          seoConvLast: lastMonth.conversions,
          seoSessThis: thisMonth.sessions,
          seoSessLast: lastMonth.sessions
        }));
        setFetchStatus('GA4 ✓');
      } catch (e) {
        setFetchStatus('GA4 failed: ' + e.message.slice(0, 60));
      }
    }

    // GSC search data
    if (c.gsc_property) {
      setFetchStatus(prev => (prev.includes('✓') ? prev + ' · ' : '') + 'Pulling GSC data…');
      try {
        const daysDiff = Math.round((thisEnd - thisStart) / 86400000) + 1;
        const thisDaysAgo = Math.round((Date.now() - thisStart) / 86400000);

        // This month's GSC data
        const gscThis = await querySearchAnalytics(c.gsc_property, {
          days: daysDiff,
          dimensions: ['page'],
          rowLimit: 50
        });

        const totalClicks = (gscThis.rows || []).reduce((s, r) => s + (r.clicks || 0), 0);
        const totalImpressions = (gscThis.rows || []).reduce((s, r) => s + (r.impressions || 0), 0);
        const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) + '%' : '—';
        const avgPos = (gscThis.rows || []).length > 0
          ? ((gscThis.rows || []).reduce((s, r) => s + (r.position || 0), 0) / gscThis.rows.length).toFixed(1)
          : '—';

        // Top pages
        const topPages = (gscThis.rows || [])
          .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
          .slice(0, 10)
          .map(r => {
            const path = r.keys?.[0] || '';
            try { return new URL(path).pathname + ' — ' + (r.clicks || 0) + ' clicks'; } catch { return path + ' — ' + (r.clicks || 0) + ' clicks'; }
          })
          .join('\n');

        // Top queries
        const gscQueries = await querySearchAnalytics(c.gsc_property, {
          days: daysDiff,
          dimensions: ['query'],
          rowLimit: 20
        });
        const topQueries = (gscQueries.rows || [])
          .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
          .slice(0, 10)
          .map(r => r.keys?.[0] + ' — ' + (r.clicks || 0) + ' clicks, pos ' + (r.position || 0).toFixed(1))
          .join('\n');

        setForm(prev => ({
          ...prev,
          gscClicksThis: String(totalClicks),
          gscImpressionsThis: String(totalImpressions),
          gscCtrThis: avgCtr,
          gscPosThis: avgPos,
          topPages,
          topQueries
        }));
        setFetchStatus(prev => prev.replace('Pulling GSC data…', 'GSC ✓'));
      } catch (e) {
        setFetchStatus(prev => prev.replace('Pulling GSC data…', 'GSC failed: ' + e.message.slice(0, 40)));
      }
    }

    if (!c.ga4_property_id && !c.gsc_property) {
      setFetchStatus('No GA4 or GSC configured — enter metrics manually or set up in client settings');
    }
  }

  // Helper to fetch GA4 metrics for a specific date range.
  async function fetchGA4Month(propertyId, start, end) {
    const res = await fetch(
      'https://analyticsdata.googleapis.com/v1beta/properties/' + propertyId + ':runReport',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + getToken().access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dateRanges: [{
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10)
          }],
          metrics: [
            { name: 'totalUsers' },
            { name: 'sessions' },
            { name: 'conversions' }
          ],
          dimensionFilter: {
            filter: {
              fieldName: 'sessionDefaultChannelGroup',
              stringFilter: { matchType: 'EXACT', value: 'Organic Search' }
            }
          }
        })
      }
    );
    if (!res.ok) throw new Error('GA4 ' + res.status);
    const data = await res.json();
    const row = data.rows?.[0];
    // Also get total (all channels) users
    const totalRes = await fetch(
      'https://analyticsdata.googleapis.com/v1beta/properties/' + propertyId + ':runReport',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + getToken().access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dateRanges: [{
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10)
          }],
          metrics: [{ name: 'totalUsers' }]
        })
      }
    );
    const totalData = totalRes.ok ? await totalRes.json() : null;

    return {
      totalUsers: totalData?.rows?.[0]?.metricValues?.[0]?.value || '—',
      organicUsers: row?.metricValues?.[0]?.value || '0',
      sessions: row?.metricValues?.[1]?.value || '0',
      conversions: row?.metricValues?.[2]?.value || '0'
    };
  }

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const micrositeHtml = useMemo(() => {
    if (!microJson || !client) return '';
    return buildMicrositeHtml({
      micro: microJson,
      client,
      monthLabel: monthLabel(month),
      rankscale: client.rankscale_url
    });
  }, [microJson, client, month]);

  async function generate() {
    if (!client) return;
    setErr(''); setEmail({ subject: '', body: '' }); setMicroJson(null); setQa(null); setSent(false);

    const payload = buildAlicePayload({
      clientName: client.name,
      industry: client.industry || '',
      goals: client.context,
      month: monthLabel(month),
      algorithmContext: algContext,
      ...form
    }, aeoSnap, workSummary);

    try {
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
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px', borderColor: fetchStatus.includes('✓') ? 'rgba(52,211,153,.3)' : 'var(--border)' }}>
          <div className="row" style={{ gap: 8, fontSize: 12 }}>
            {fetchStatus.includes('Pulling') && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
            <span style={{ color: fetchStatus.includes('✓') ? 'var(--green)' : fetchStatus.includes('failed') ? 'var(--orange)' : 'var(--text-muted)' }}>
              {fetchStatus}
            </span>
          </div>
        </div>
      )}

      {/* Step 2: SEO data (auto-fetched, editable) */}
      {form.hasSeo && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>SEO Data</strong>
            {(form.seoUsersThis || form.gscClicksThis) && (
              <span className="badge green" style={{ fontSize: 9 }}>Auto-populated from GA4 + GSC</span>
            )}
          </div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)', margin: '12px 0 6px' }}>Traffic</div>
          <div className="grid-3">
            <div><label>Total users (this)</label><input value={form.seoUsersThis || ''} onChange={e => update('seoUsersThis', e.target.value)} /></div>
            <div><label>Total users (last)</label><input value={form.seoUsersLast || ''} onChange={e => update('seoUsersLast', e.target.value)} /></div>
            <div><label>Total users (YoY)</label><input value={form.seoUsersYoy || ''} onChange={e => update('seoUsersYoy', e.target.value)} /></div>
            <div><label>Organic users (this)</label><input value={form.seoOrganicThis || ''} onChange={e => update('seoOrganicThis', e.target.value)} /></div>
            <div><label>Organic users (last)</label><input value={form.seoOrganicLast || ''} onChange={e => update('seoOrganicLast', e.target.value)} /></div>
            <div></div>
            <div><label>Organic conv. (this)</label><input value={form.seoConvThis || ''} onChange={e => update('seoConvThis', e.target.value)} /></div>
            <div><label>Organic conv. (last)</label><input value={form.seoConvLast || ''} onChange={e => update('seoConvLast', e.target.value)} /></div>
            <div></div>
            <div><label>Organic sessions (this)</label><input value={form.seoSessThis || ''} onChange={e => update('seoSessThis', e.target.value)} /></div>
            <div><label>Organic sessions (last)</label><input value={form.seoSessLast || ''} onChange={e => update('seoSessLast', e.target.value)} /></div>
          </div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)', margin: '14px 0 6px' }}>Search Console</div>
          <div className="grid-3">
            <div><label>Clicks (this)</label><input value={form.gscClicksThis || ''} onChange={e => update('gscClicksThis', e.target.value)} /></div>
            <div><label>Clicks (last)</label><input value={form.gscClicksLast || ''} onChange={e => update('gscClicksLast', e.target.value)} /></div>
            <div><label>Impressions (this)</label><input value={form.gscImpressionsThis || ''} onChange={e => update('gscImpressionsThis', e.target.value)} /></div>
            <div><label>Site CTR % (this)</label><input value={form.gscCtrThis || ''} onChange={e => update('gscCtrThis', e.target.value)} /></div>
            <div><label>Avg position (this)</label><input value={form.gscPosThis || ''} onChange={e => update('gscPosThis', e.target.value)} /></div>
            <div><label>Avg position (last)</label><input value={form.gscPosLast || ''} onChange={e => update('gscPosLast', e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Top pages (paste from Looker)</label>
            <textarea value={form.topPages || ''} onChange={e => update('topPages', e.target.value)} rows={3} placeholder="/page/ — 57 users (+42%)" />
          </div>
          <div>
            <label>Top queries</label>
            <textarea value={form.topQueries || ''} onChange={e => update('topQueries', e.target.value)} rows={3} />
          </div>
        </div>
      )}

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

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            {PHASES.map(p => (
              <span key={p.key} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 999,
                border: '1px solid var(--border)',
                background: phase === p.key ? ACCENT : 'transparent',
                color: phase === p.key ? '#0a0a0c'
                       : (phase === 'review' || (phase === 'micro' && p.key === 'alice') || (phase === 'qa' && p.key !== 'qa')) ? 'var(--green)' : 'var(--text-muted)'
              }}>{p.label}</span>
            ))}
          </div>
          <button className="primary" onClick={generate} disabled={phase !== 'idle' && phase !== 'review'} style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}>
            {phase === 'idle' || phase === 'review' ? 'Generate Report' : 'Working…'}
          </button>
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
