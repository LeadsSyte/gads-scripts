import React, { useState, useMemo } from 'react';
import { useClients } from '../store/useClients.js';
import { normalizeGa4Id, normalizeGscProperty } from '../lib/googleProperties.js';
import GoogleConnectionsPicker from './GoogleConnectionsPicker.jsx';
import {
  generateCensus, inferLikelyTopics, topRankingSeeds, censusToProbeList,
  parseCensus, intentCoverage, DEFAULT_CENSUS_TARGET
} from '../modules/reports/aeoCensus.js';
import { topQueriesByImpression } from '../modules/technical/gsc.js';

// Brand voice presets — the dropdown contents. Picking Custom… reveals the
// free text box so you can still type something bespoke.
const BRAND_VOICES = [
  'Professional & authoritative',
  'Warm & friendly',
  'Confident & bold',
  'Playful & casual',
  'Expert & educational',
  'Luxury & sophisticated',
  'Direct & straightforward',
  'Approachable & conversational',
  'Inspirational & empowering',
  'Technical & precise'
];

// Base client fields (brand/content). Voice is rendered separately as a
// dropdown. AEO probe queries + competitors are rendered separately too so
// they can have their own auto-generate + validation behaviour.
// GA4 Property ID and GSC Property are rendered separately via the
// GoogleConnectionsPicker so they can be picked from a dropdown after
// signing in with Google. See below.
const BASE_FIELDS = [
  ['name',              'Client Name',        'input'],
  ['url',               'Website URL',        'input'],
  ['industry',          'Industry',           'input'],
  ['location',          'Location / Service Area', 'input'],
  ['org_name',          'Organization Name',  'input'],
  ['author',            'Default Author',     'input'],
  ['author_creds',      'Author Credentials', 'input'],
  ['audience',          'Target Audience',    'textarea'],
  ['context',           'Brand Context',      'textarea'],
  ['internal_links',    'Internal Links (one per line)', 'textarea'],
  ['sitemap_url',       'Sitemap URL',        'input'],
  ['wceo_project_id',   'WebCEO Project ID',  'input'],
  ['pages_per_month',   'Pages / month',      'number']
];

const REPORTING_FIELDS = [
  ['reporting_email',    'Reporting Email',    'input'],
  ['start_date',         'Start Date with Syte', 'date'],
  ['looker_url',         'Looker Dashboard URL', 'input'],
  ['rankscale_url',      'Rankscale Share URL (optional)', 'input']
];

const SERVICES = [
  ['does_technical', 'Technical SEO', 'var(--mod-technical)'],
  ['does_content',   'Content Engine', 'var(--mod-content)'],
  ['does_aeo',       'AEO Engine',     'var(--mod-aeo)'],
  ['does_reporting', 'Monthly Reporting', 'var(--mod-reports)']
];

// ---- validation helpers ---------------------------------------------------

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function stripToDomain(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}

function parseCompetitorList(raw) {
  return (raw || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeCompetitorList(raw) {
  return parseCompetitorList(raw).map(stripToDomain).filter(Boolean).join(', ');
}

// ---- generic field -------------------------------------------------------

function Field({ k, label, type, value, onChange }) {
  const wrapStyle = type === 'textarea' ? { gridColumn: 'span 2' } : {};
  return (
    <div style={wrapStyle}>
      <label>{label}</label>
      {type === 'textarea' ? (
        <textarea value={value || ''} onChange={e => onChange(k, e.target.value)} rows={3} />
      ) : type === 'date' ? (
        <input type="date" value={value || ''} onChange={e => onChange(k, e.target.value)} />
      ) : type === 'number' ? (
        <input type="number" value={value || ''} onChange={e => onChange(k, parseInt(e.target.value) || 0)} />
      ) : (
        <input type="text" value={value || ''} onChange={e => onChange(k, e.target.value)} />
      )}
    </div>
  );
}

// ---- main modal ----------------------------------------------------------

export default function ClientModal({ initial, onClose }) {
  const [f, setF] = useState({
    pages_per_month: 15,
    does_technical: true,
    does_content: true,
    does_aeo: true,
    does_reporting: true,
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  // Brand voice: is the current value one of the presets, or custom?
  const [voiceMode, setVoiceMode] = useState(
    f.voice && !BRAND_VOICES.includes(f.voice) ? 'custom' : 'preset'
  );
  const save = useClients(s => s.save);
  const remove = useClients(s => s.remove);

  function update(k, v) { setF(prev => ({ ...prev, [k]: v })); }

  // Intent coverage of the currently-loaded census (if any) — drives the
  // coverage chips under the prompt list so the user can see the census is
  // representative across buyer intents, not a one-sided guess.
  const census = useMemo(() => parseCensus(f), [f.aeo_census]);
  const coverage = useMemo(() => census ? intentCoverage(census) : null, [census]);

  // Highlight any competitor entries that don't look like a domain.
  const competitorIssues = useMemo(() => {
    const list = parseCompetitorList(f.competitors);
    return list
      .map(entry => ({ entry, ok: DOMAIN_RE.test(stripToDomain(entry)) }))
      .filter(x => !x.ok);
  }, [f.competitors]);

  // Generate the AEO prompt census — a grounded, intent-structured set of the
  // prompts real buyers type into AI engines for this category. This replaces
  // the old "guess ~40 probe queries" generator. It grounds generation in two
  // real signals so the census centers on what the brand is credible for:
  //   1. The brand's top NON-branded Google rankings (pulled from GSC if a
  //      property is connected) — proof of category authority.
  //   2. An LLM "direction" pass that names the topics the brand is most
  //      likely to be recommended for, given those rankings.
  // The structured census is stored on `aeo_census`; the flat newline list is
  // kept in sync on `aeo_probe_queries` for the runner.
  async function generateQueries() {
    if (!f.industry && !f.context) {
      setErr('Fill in Industry (or Brand Context) first so the census generator has direction.');
      return;
    }
    setGenBusy(true); setGenMsg(''); setErr('');
    try {
      // 1. Ground on real rankings (best-effort — skip silently if no GSC).
      let rankingSeeds = [];
      if (f.gsc_property) {
        try {
          setGenMsg('Reading your top Google rankings…');
          const gscKeywords = await topQueriesByImpression(f.gsc_property, 90);
          rankingSeeds = topRankingSeeds(gscKeywords, f.name);
        } catch (e) {
          // GSC not connected / no permission — fall back to context-only.
          rankingSeeds = [];
        }
      }

      // 2. Direction pass — what is this brand likely recommended for?
      setGenMsg('Working out what AI engines would recommend you for…');
      let likelyTopics = [];
      try {
        likelyTopics = await inferLikelyTopics({ client: f, rankingSeeds });
      } catch { likelyTopics = []; }

      // 3. Generate the intent-structured census.
      setGenMsg(`Building a ${DEFAULT_CENSUS_TARGET}-prompt census across buyer intents…`);
      const census = await generateCensus({ client: f, rankingSeeds, likelyTopics });

      // Persist both the structured census and the flat run list.
      setF(prev => ({
        ...prev,
        aeo_census: census,
        aeo_probe_queries: censusToProbeList(census)
      }));

      const cov = intentCoverage(census);
      const groundNote = rankingSeeds.length
        ? `grounded on ${rankingSeeds.length} of your top Google rankings`
        : 'grounded on your brand context (connect Search Console for ranking-grounded prompts)';
      setGenMsg(`Census ready: ${cov.total} prompts across ${cov.buckets.filter(b => b.count > 0).length} intent buckets — ${groundNote} ✓`);
    } catch (e) {
      setErr('Census generation failed: ' + e.message);
    } finally {
      setGenBusy(false);
    }
  }

  async function handleSave() {
    if (!f.name) { setErr('Name is required'); return; }
    setBusy(true); setErr('');
    try {
      // Normalize before save: strip https:// / trailing slashes from
      // competitor list so downstream brand detection works.
      const payload = { ...f };
      if (payload.competitors) {
        payload.competitors = normalizeCompetitorList(payload.competitors);
      }
      // Normalize website URL
      if (payload.url && !/^https?:\/\//.test(payload.url)) {
        payload.url = 'https://' + payload.url.trim();
      }
      // Validate + normalize GA4 property ID
      if (payload.ga4_property_id) {
        const r = normalizeGa4Id(payload.ga4_property_id);
        if (!r.ok) {
          setBusy(false);
          setErr('GA4 Property ID invalid: ' + (r.message || r.reason));
          return;
        }
        payload.ga4_property_id = r.value;
      }
      // Validate + normalize GSC property
      if (payload.gsc_property) {
        const r = normalizeGscProperty(payload.gsc_property);
        if (!r.ok) {
          setBusy(false);
          setErr('Search Console Property invalid: ' + (r.message || r.reason));
          return;
        }
        payload.gsc_property = r.value;
      }
      await save(payload);
      onClose();
    } catch (e) {
      console.error('ClientModal save error:', e);
      if (/Failed to fetch|NetworkError|fetch/i.test(e?.message || '')) {
        setErr('Network error — could not reach Supabase. Check your internet connection, or verify VITE_SUPABASE_URL is correct in Netlify env vars.');
      } else if (/column/i.test(e?.message || '') && /does not exist/i.test(e?.message || '')) {
        setErr('Database schema out of date: ' + e.message + '. Run supabase-schema-reports.sql in the Supabase SQL Editor.');
      } else {
        setErr(e?.message || String(e));
      }
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!f.id) return;
    if (!confirm('Delete this client? This cannot be undone.')) return;
    setBusy(true); setErr('');
    try {
      await remove(f.id);
      onClose();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{f.id ? 'Edit Client' : 'New Client'}</h2>
          <button onClick={onClose} className="ghost">Close</button>
        </div>

        {/* Services */}
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>
          Services
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {SERVICES.map(([k, label, color]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', margin: 0, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={f[k] !== false}
                onChange={e => update(k, e.target.checked)}
                style={{ width: 'auto', accentColor: color }}
              />
              <span style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </div>

        {/* Brand & Content */}
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '16px 0 8px' }}>
          Brand & Content
        </div>
        <div className="grid-2">
          {BASE_FIELDS.map(([k, label, type]) => (
            <Field key={k} k={k} label={label} type={type} value={f[k]} onChange={update} />
          ))}

          {/* Brand voice — dropdown with preset options + Custom… escape */}
          <div>
            <label>Brand Voice / Tone</label>
            <select
              value={voiceMode === 'custom' ? '__custom__' : (f.voice || '')}
              onChange={e => {
                const v = e.target.value;
                if (v === '__custom__') {
                  setVoiceMode('custom');
                  update('voice', '');
                } else {
                  setVoiceMode('preset');
                  update('voice', v);
                }
              }}
            >
              <option value="">— select a tone —</option>
              {BRAND_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
            {voiceMode === 'custom' && (
              <input
                value={f.voice || ''}
                onChange={e => update('voice', e.target.value)}
                placeholder="Describe the brand voice…"
                style={{ marginTop: 6 }}
              />
            )}
          </div>
        </div>

        {/* Content rules — always-enforced restrictions. Different from
            Manual Direction (which is monthly topic steering). These are
            hard constraints like gambling compliance, factual accuracy
            requirements, or topics to never cover. */}
        <div style={{ marginTop: 14 }}>
          <label>
            Content Rules & Restrictions{' '}
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              — always enforced on every article, never shown to client
            </span>
          </label>
          <textarea
            value={f.content_rules || ''}
            onChange={e => update('content_rules', e.target.value)}
            rows={3}
            placeholder={`Hard rules Claude must NEVER violate for this client, e.g.\n  "Never use the word 'win' or similar — gambling compliance"\n  "The hotel is NOT a treetop venue — do not describe it as such"\n  "Do not recommend seasonal visits — position as year-round"\n  "Only cover topics related to casino, sports betting, horse racing"\n  "All content must be geographically accurate for Century City area"`}
          />
        </div>

        {/* Manual content direction — optional override for Auto Write.
            Claude uses this to steer topic selection AND the article itself.
            Blank = pure data-driven from GSC rankings. */}
        <div style={{ marginTop: 14 }}>
          <label>
            Manual Content Direction{' '}
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              — optional monthly topic steering, never shown to client
            </span>
          </label>
          <textarea
            value={f.internal_notes || ''}
            onChange={e => update('internal_notes', e.target.value)}
            rows={3}
            placeholder={`Leave blank for pure data-driven topics from Search Console.\n\nOr steer this month's focus, e.g.\n  "Focus on South African ecommerce case studies this month"\n  "Lead every article with a real customer story"`}
          />
        </div>

        {/* Google connections (GA4 + GSC) */}
        <GoogleConnectionsPicker
          ga4Value={f.ga4_property_id}
          onChangeGa4={v => update('ga4_property_id', v)}
          gscValue={f.gsc_property}
          onChangeGsc={v => update('gsc_property', v)}
        />

        {/* Reporting & AEO */}
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '20px 0 8px' }}>
          Reporting & AEO
        </div>
        <div className="grid-2">
          <div>
            <label>Client Type</label>
            <select value={f.client_type || ''} onChange={e => update('client_type', e.target.value)}>
              <option value="">— Not set —</option>
              <option value="ecommerce">Ecommerce (tracks transactions + revenue)</option>
              <option value="lead_gen">Lead Generation (tracks form submissions + leads)</option>
            </select>
          </div>
          {REPORTING_FIELDS.map(([k, label, type]) => (
            <Field key={k} k={k} label={label} type={type} value={f[k]} onChange={update} />
          ))}
        </div>

        {/* AEO prompt census with grounded auto-generate */}
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
            <label style={{ margin: 0 }}>
              AEO Prompt Census{' '}
              <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                (a representative set of how buyers ask AI about your category — we measure your share of voice across it)
              </span>
            </label>
            <button
              type="button"
              onClick={generateQueries}
              disabled={genBusy}
              style={{ padding: '4px 10px', fontSize: 11, borderColor: 'var(--mod-reports)', color: 'var(--mod-reports)' }}
              title="Grounds on your top non-branded Google rankings + an AI direction pass, then builds an intent-structured census."
            >
              {genBusy ? 'Generating…' : (census ? '✨ Regenerate census' : '✨ Generate census')}
            </button>
          </div>

          {/* Intent coverage chips — proof the census spans buyer intents. */}
          {coverage && coverage.total > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '2px 0 8px' }}>
              <span className="muted" style={{ fontSize: 11 }}>{coverage.total} prompts ·</span>
              {coverage.buckets.map(b => (
                <span
                  key={b.id}
                  title={b.hint + (b.thin ? ' — thin coverage' : '')}
                  style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 10,
                    border: '1px solid ' + (b.thin ? 'var(--orange)' : 'var(--border)'),
                    color: b.thin ? 'var(--orange)' : 'var(--text-muted)'
                  }}
                >
                  {b.label} {b.count}
                </span>
              ))}
            </div>
          )}

          <textarea
            value={f.aeo_probe_queries || ''}
            onChange={e => update('aeo_probe_queries', e.target.value)}
            rows={6}
            placeholder={
              f.industry && f.location
                ? `Click "Generate census", or type prompts like: what's the best ${f.industry.toLowerCase()} company in ${f.location.toLowerCase()}?`
                : 'Click "Generate census", or type prompts one per line'
            }
          />
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
            Editing the list manually won't retag intents — regenerate to refresh the census structure.
          </div>
          {genMsg && <div style={{ color: 'var(--green)', fontSize: 11, marginTop: 4 }}>{genMsg}</div>}
        </div>

        {/* Competitors with domain validation */}
        <div style={{ marginTop: 12 }}>
          <label>
            Key Competitors{' '}
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              (comma-separated domains — e.g. nicolarde.co.za, flume.co.za)
            </span>
          </label>
          <textarea
            value={f.competitors || ''}
            onChange={e => update('competitors', e.target.value)}
            rows={2}
            placeholder="competitor1.co.za, competitor2.com, competitor3.net"
            onBlur={() => {
              // Auto-normalize on blur so the user sees clean values.
              if (f.competitors) update('competitors', normalizeCompetitorList(f.competitors));
            }}
          />
          {competitorIssues.length > 0 && (
            <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 4 }}>
              Not valid domains: {competitorIssues.map(x => '"' + x.entry + '"').join(', ')}. They'll be normalized on save.
            </div>
          )}
        </div>

        {err && <div style={{ color: 'var(--red)', marginTop: 12, fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'space-between' }}>
          <div>
            {f.id && <button onClick={handleDelete} disabled={busy} style={{ color: 'var(--red)' }}>Delete</button>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button onClick={handleSave} className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Client'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
