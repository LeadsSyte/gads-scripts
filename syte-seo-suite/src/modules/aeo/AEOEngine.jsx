import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import { pushItemInline } from '../cms/pushAction.js';
import ClientCardsGrid from '../../components/ClientCardsGrid.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import LogExternalWork from '../../components/LogExternalWork.jsx';
import { aeoPipelineStatus } from '../../lib/pipelineStatus.js';
import { listAllImplementations, saveAeoResult, loadAeoResults as loadAeoResultsFromDb, deleteAeoResult, saveDeepResult, listDeepResults, deleteDeepResult, listAeoRejections, saveAeoRejection } from '../../lib/supabase.js';
import { AEO_SYSTEM, AEO_TYPES, AEO_DEEP_SYSTEM } from './aeoTypes.js';
import { fetchSitemapUrls } from './sitemap.js';
import { listAccountSummaries, runReport } from './ga4.js';
import { ensureToken, SCOPES, getToken, clearToken } from '../technical/googleAuth.js';

const ACCENT = '#00d4aa';
const RESULTS_KEY = 'syte-suite-aeo-results';
const HISTORY_KEY = 'syte-suite-aeo-history';
const BATCH_SIZE = 3;

function loadResults() { try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}'); } catch { return {}; } }
// Supabase is the source of truth for AEO results — localStorage is only a
// best-effort offline cache. Once accounts accumulate enough optimizations
// the JSON exceeds the ~5MB quota and setItem throws QuotaExceededError,
// which (without a catch) propagates out of the useEffect and crashes the
// whole module. Swallow quota errors and clear the stale cache so
// subsequent saves don't keep failing on the same boundary.
function saveResults(r) {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); }
  catch (e) {
    if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
      try { localStorage.removeItem(RESULTS_KEY); } catch {}
      console.warn('[AEO] localStorage quota exceeded — using Supabase only.');
    }
  }
}
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 100))); }
  catch {}
}

// Deep optimization — full page rewrite with FAQ + changes log.
// Returns { description, faq, changesDescription, changesFaq, productSchema, faqSchema }.
async function generateDeepForPage(pageUrl, client, onPhase) {
  onPhase?.('fetch', 'Fetching page content…');
  let pageHtml = '';
  let pageTitle = '';
  try {
    pageHtml = (await corsFetchText(pageUrl)).slice(0, 50000);
    const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) pageTitle = titleMatch[1].trim();
    onPhase?.('fetched', `Fetched ${Math.round(pageHtml.length / 1000)}k chars${pageTitle ? ' · "' + pageTitle.slice(0, 50) + '"' : ''}`);
  } catch {
    onPhase?.('fetched', 'Page HTML not accessible — inferring from URL');
  }

  let slug = '';
  try { slug = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || ''; } catch {}
  const inferredTopic = pageTitle || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  onPhase?.('generating', 'Generating full rewrite with Claude…');
  const text = await claudeComplete({
    system: AEO_DEEP_SYSTEM,
    messages: [{
      role: 'user',
      content: `Deep-optimize this page for AI engine citability. Produce a full rewrite + FAQ + changes explanation.

Page URL: ${pageUrl}
Page topic: ${inferredTopic}
Client: ${client?.name || ''}
Industry: ${client?.industry || ''}
Location: ${client?.location || ''}
${client?.context ? 'Business context: ' + client.context : ''}

${pageHtml ? 'Current page HTML (source material — reorganize and clarify, do not invent new facts):\n' + pageHtml : 'Page HTML not accessible (CORS). Infer conservatively from URL, topic, and client context.'}

Return the JSON object as specified in the system prompt.`
    }],
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    temperature: 0.4
  });
  onPhase?.('parsing', 'Parsing JSON response…');
  return extractJSON(text);
}

async function generateForPage(pageUrl, client) {
  // Try to fetch the actual page HTML for analysis.
  let pageHtml = '';
  let pageTitle = '';
  try {
    pageHtml = (await corsFetchText(pageUrl)).slice(0, 60000);
    // Extract the <title> tag for context.
    const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) pageTitle = titleMatch[1].trim();
  } catch {
    // CORS blocked — that's fine, Claude will work from the URL alone.
  }

  // Extract the page slug for topic inference when HTML isn't available.
  let slug = '';
  try { slug = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || ''; } catch {}
  const inferredTopic = pageTitle || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const text = await claudeComplete({
    system: AEO_SYSTEM,
    messages: [{
      role: 'user',
      content: `Generate AEO optimizations for this page. Focus on CONTENT optimizations first (answer blocks, FAQs, key takeaways, snippet paragraphs), then schema.

Page URL: ${pageUrl}
Page topic: ${inferredTopic}
Client: ${client?.name || ''}
Industry: ${client?.industry || ''}
Location: ${client?.location || ''}
Organization: ${client?.org_name || client?.name || ''}
Author: ${client?.author || ''} ${client?.author_creds ? '(' + client.author_creds + ')' : ''}
${client?.context ? 'Business context: ' + client.context : ''}

${pageHtml ? 'Page HTML (truncated — TWO uses: (1) analyse what content optimizations are MISSING; (2) READ the CSS classes, heading patterns, container structure, and component conventions so your output matches this page\'s design system. The optimization will be pasted into THIS page — make it look native, not bolted-on. Reuse the page\'s class names verbatim wherever they fit. See DESIGN-MATCHING in the system prompt.):\n' + pageHtml : 'Page HTML not available (CORS blocked) — generate optimizations based on the URL, topic, and client context. Focus on content that would make this page citable by AI engines. Use simple semantic HTML without inline styles since we cannot match the page\'s design system.'}`
    }],
    max_tokens: 6000,
    temperature: 0.4
  });
  const parsed = extractJSON(text);
  return parsed?.optimizations || [];
}

// Stable key for an AEO optimization. Combines type + name (or title) so
// the same logical optimization regenerated for a page next month resolves
// to the same key and can be filtered against the rejection blocklist.
export function aeoOptKey(o) {
  return (o.type || '') + '::' + (o.name || o.title || '');
}

// Expandable optimization card for a single page — shows each optimization
// with type badge, description, and copy-paste ready code block.
const OPT_TYPE_COLORS = {
  schema: { bg: 'rgba(167,139,250,.12)', color: 'var(--purple)', border: 'rgba(167,139,250,.2)' },
  content: { bg: 'rgba(0,212,170,.12)', color: 'var(--teal)', border: 'rgba(0,212,170,.2)' },
  meta: { bg: 'rgba(77,171,255,.12)', color: 'var(--blue)', border: 'rgba(77,171,255,.2)' },
  structure: { bg: 'rgba(255,159,67,.12)', color: 'var(--orange)', border: 'rgba(255,159,67,.2)' }
};

// Combine N optimizations for a single page into ONE paste-ready HTML
// block. Each optimization is wrapped in a styled <section> with inline
// styles so the result looks decent on ANY host page CSS — no
// dependency on the destination's typography. Schema (JSON-LD) blocks
// are placed at the END so they render to the page <body> safely.
function buildCombinedAeoHtml(opts) {
  if (!opts || !opts.length) return '';

  // Strip any HTML <script> tag — schema blocks — out of opt code, then
  // join them at the end so the visible-content sections come first.
  const schemaBlocks = [];
  const visible = opts.map(o => {
    const code = (o.implementation || o.code || '').trim();
    if (!code) return { ...o, _code: '' };
    // Pull <script type="application/ld+json"> blocks aside.
    const stripped = code.replace(/<script[\s\S]*?<\/script>/gi, (m) => {
      schemaBlocks.push(m);
      return '';
    }).trim();
    return { ...o, _code: stripped };
  });

  // EVERY opt is wrapped in a <details>/<summary> accordion for
  // consistent visual presentation regardless of host page CSS. AEO-
  // safe: the content is in the rendered HTML on initial load, so
  // bots and humans both see every word — humans just toggle whether
  // it's visually expanded. The first opt defaults to `open` so the
  // page lead (typically the answer block) is visible without a
  // click.
  //
  // Agent-facing context (CONTENT badge, name, description, placement
  // hint) lives in HTML comments only — recoverable from page source
  // by a developer, invisible to the page and to crawlers.
  const sections = visible
    .filter(o => o._code)
    .map((o, i) => {
      const label = (o.type || 'content').toUpperCase();
      const name = (o.name || o.title || 'Optimization').replace(/-->/g, '-- >');
      const desc = (o.description || '').replace(/-->/g, '-- >');
      const where = (o.where || '').replace(/-->/g, '-- >');
      const summaryLabel = escapeHtmlForBlock(o.name || o.title || 'Optimization');
      const openAttr = i === 0 ? ' open' : '';
      return `
<!--
  AEO ${i + 1}/${visible.length} · ${label} · ${name}${desc ? '\n  ' + desc : ''}${where ? '\n  Placement: ' + where : ''}
-->
<details${openAttr} class="aeo-opt aeo-opt-${o.type || 'content'}">
  <summary><strong>${summaryLabel}</strong></summary>
  <div class="aeo-opt-body">
    ${o._code}
  </div>
</details>
`;
    }).join('\n');

  const schemaJoined = schemaBlocks.length
    ? `\n<!-- AEO Schema Blocks (JSON-LD) -->\n${schemaBlocks.join('\n')}\n`
    : '';

  return `<!--
  AEO Optimizations — ${opts.length} block${opts.length === 1 ? '' : 's'} for this page
  Generated by Syte AEO Engine. Paste the whole chunk on the page.
  Each block is a native <details>/<summary> accordion. The first one
  is open by default so the lead answer is immediately visible. AEO-
  safe: every word is in the source HTML on initial load — bots see
  it regardless of whether a human has expanded it.
-->
${sections}${schemaJoined}`.trim();
}

// (wrapFaqAsAccordion / stripTags removed — every opt is now wrapped
// at the section level with its own <details>/<summary>, so the
// per-question FAQ-specific wrap is no longer needed.)

function escapeHtmlForBlock(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function OptPageCard({ result: r, onDelete, onVerified, optClient, rejectedOptKeys, onRejectOpt }) {
  const [open, setOpen] = React.useState(false);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const rawOpts = Array.isArray(r.optimizations) ? r.optimizations : [];
  // Hide any optimization on this page whose (type, name) is in the
  // operator's rejection blocklist for this client.
  const opts = React.useMemo(() => {
    if (!rejectedOptKeys || !rejectedOptKeys.size) return rawOpts;
    return rawOpts.filter(o => !rejectedOptKeys.has(aeoOptKey(o)));
  }, [rawOpts, rejectedOptKeys]);
  const hiddenCount = rawOpts.length - opts.length;

  // Build a single styled HTML block that combines every optimization
  // for this page into one paste-ready chunk. The user asked: "if there
  // are optimizations for a single page they should list them as one
  // block to paste". Inline styles only — works on any host page CSS.
  const combinedHtml = React.useMemo(() => buildCombinedAeoHtml(opts), [opts]);

  // Plain-text version for users that paste into a non-HTML editor.
  const combinedText = React.useMemo(() => opts.map((o, i) =>
    `[${i + 1}] ${o.name || o.title || ''} (${o.type || ''})\n${o.description || ''}\n${o.where ? 'Where: ' + o.where + '\n' : ''}\n${o.implementation || o.code || ''}\n`
  ).join('\n' + '─'.repeat(40) + '\n\n'), [opts]);

  // Copy the combined HTML to the clipboard. Sets BOTH text/html and
  // text/plain so paste into Google Docs / Word / WordPress visual
  // editor preserves formatting; paste into a code editor gets the raw
  // HTML source.
  async function copyAll() {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([combinedHtml], { type: 'text/html' }),
          'text/plain': new Blob([combinedHtml], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(combinedHtml);
      }
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      try { await navigator.clipboard.writeText(combinedText); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500); } catch {}
    }
  }

  // Combined push-to-CMS item — pushes ALL optimizations for this page
  // as one HTML payload in a single CMS push. Used by the new "Push
  // All to CMS" button at the page-card level.
  const combinedPushItem = {
    module: 'aeo',
    page_url: r.url,
    page_title: r.url || 'AEO Optimizations',
    change_type: 'aeo_optimization',
    payload: {
      code: combinedHtml,
      placement: 'Multi-block: see inline section comments',
      reason: opts.length + ' AEO optimizations combined into one block'
    }
  };

  // Show a readable page path: /about-us/ instead of full URL
  const displayUrl = r.url || 'Page';
  let pagePath = '';
  try { pagePath = new URL(displayUrl).pathname; } catch { pagePath = displayUrl; }
  const domain = r.url ? r.url.replace(/^https?:\/\//, '').split('/')[0] : '';

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
        onClick={() => setOpen(v => !v)}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0, maxWidth: '100%' }}>
          <div style={{
            fontWeight: 600, fontSize: 13,
            // Truncate long URLs (e.g. /product/ives-dressing-table-dunblane-grey/)
            // so the right-side button row always has room. Title wraps at most
            // two lines with ellipsis on overflow.
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {pagePath === '/' ? domain + ' (homepage)' : pagePath}
          </div>
          <div className="muted" style={{
            fontSize: 10, marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{displayUrl}</div>
        </div>
        <div className="row" style={{
          gap: 6,
          flex: '0 1 auto',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: 11, color: 'var(--teal)', background: 'rgba(0,212,170,.08)', padding: '2px 8px', borderRadius: 12 }}>
            {opts.length} opts
          </span>
          <button onClick={(e) => { e.stopPropagation(); copyAll(); }} style={{ fontSize: 10, padding: '2px 8px' }}>
            {copiedAll ? 'Copied ✓' : 'Copy all (1 block)'}
          </button>
          {opts.length > 0 && (
            <span onClick={(e) => e.stopPropagation()}>
              <PushToCmsButton item={combinedPushItem} label="Push all to CMS" />
            </span>
          )}
          {opts.length > 0 && (
            <span onClick={(e) => e.stopPropagation()}>
              {/* One verify call for the whole page. Description is a
                  combined summary of every opt's name + a snippet of
                  its implementation, so Claude checks the page against
                  all opts at once and uses the lenient AEO 60%-themes-
                  present rule (already in verification.js prompt). */}
              <MarkImplementedButton
                module="aeo"
                changeType="aeo_optimization"
                pageUrl={r.url}
                title={'AEO bundle: ' + opts.length + ' optimizations'}
                description={
                  'Combined AEO push for ' + (r.url || 'this page') + '. Verify the page contains content matching these themes:\n\n' +
                  opts.map((o, i) =>
                    (i + 1) + '. ' + (o.name || o.title || 'Opt') +
                    ' — ' + (o.description || '').slice(0, 200) + '\n' +
                    'Implementation excerpt: ' + (o.implementation || o.code || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
                  ).join('\n\n')
                }
                client={optClient}
                onVerified={onVerified}
              />
            </span>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)', borderColor: 'rgba(255,77,77,.3)' }}>Delete</button>
          )}
          <span className="muted" style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        </div>
      </div>
      {r.error && <div style={{ padding: '0 14px 8px', color: 'var(--red)', fontSize: 12 }}>{r.error}</div>}
      {open && opts.map((o, i) => {
        const typeColors = OPT_TYPE_COLORS[o.type] || OPT_TYPE_COLORS.content;
        const code = o.implementation || o.code || '';
        return (
          <div key={i} style={{ margin: '0 14px 10px', padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '.05em', padding: '2px 7px', borderRadius: 4,
                textTransform: 'uppercase', background: typeColors.bg, color: typeColors.color,
                border: '1px solid ' + typeColors.border
              }}>{o.type || 'content'}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{o.name || o.title || 'Optimization'}</span>
            </div>
            {o.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{o.description}</div>}
            {o.where && <div style={{ fontSize: 11, color: 'var(--teal)', marginBottom: 6 }}>📍 {o.where}</div>}
            {code && (
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)' }}>Copy-paste ready</span>
                  <button onClick={() => navigator.clipboard.writeText(code).catch(() => {})} style={{
                    fontSize: 10, padding: '2px 8px', background: 'var(--surface-3)',
                    border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer'
                  }}>Copy</button>
                </div>
                <pre style={{
                  background: '#0d0e11', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                  lineHeight: 1.6, color: '#c8d0d8', overflowX: 'auto', whiteSpace: 'pre-wrap',
                  maxHeight: 200
                }}>{code}</pre>
              </div>
            )}
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <PushToCmsButton
                item={{
                  module: 'aeo',
                  page_url: r.url,
                  page_title: o.name || o.title || 'AEO Optimization',
                  change_type: o.type || 'aeo_optimization',
                  payload: { code: code, placement: o.where, reason: o.description }
                }}
                label="Push to CMS"
              />
              <MarkImplementedButton
                module="aeo"
                changeType={o.type || 'aeo_optimization'}
                pageUrl={r.url}
                title={o.name || o.title || 'AEO Optimization'}
                description={code.slice(0, 500)}
                client={optClient}
                onVerified={onVerified}
              />
              {onRejectOpt && (
                <button
                  onClick={() => {
                    const reason = window.prompt('Reject this optimization? It will be filtered out of future runs for this page.\n\nOptional reason:');
                    if (reason === null) return;
                    onRejectOpt(r.url, o, reason || '');
                  }}
                  title="Reject this optimization so it won't appear in future runs for this page"
                  style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)', borderColor: 'rgba(255,77,77,.3)' }}
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div className="muted" style={{ padding: '4px 14px 8px', fontSize: 10 }}>
          {hiddenCount} rejected optimization{hiddenCount > 1 ? 's' : ''} hidden for this page.
        </div>
      )}
    </div>
  );
}

// Copy-to-clipboard button for deep optimization sections.
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text || '').catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{ fontSize: 10, padding: '3px 10px' }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

// Displays the full deep optimization result — description, FAQ, changes logs, schemas.
function DeepResultDisplay({ result }) {
  if (!result) return null;
  const {
    pageUrl, pageTitle, description = '', faq = '',
    changesDescription = [], changesFaq = [],
    productSchema = '', faqSchema = '',
    internalLinks = []
  } = result;

  const sectionStyle = { marginBottom: 18, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' };
  const headerStyle = { padding: '10px 14px', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 };
  const bodyStyle = { padding: 14, maxHeight: 500, overflowY: 'auto' };
  const htmlStyle = { fontSize: 13, lineHeight: 1.6, color: 'var(--text)' };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{pageTitle || pageUrl}</div>
          <div className="muted" style={{ fontSize: 11 }}>{pageUrl}</div>
        </div>
        <span className="badge" style={{ fontSize: 10, borderColor: ACCENT, color: ACCENT }}>Deep Optimization</span>
      </div>

      {/* Section 1: Optimized Page Description */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>1. Optimized Product/Page Description</div>
            <div className="muted" style={{ fontSize: 11 }}>Full rewrite — paste into your product description field</div>
          </div>
          <CopyBtn text={description} label="Copy HTML" />
        </div>
        <div style={bodyStyle}>
          <div style={htmlStyle} dangerouslySetInnerHTML={{ __html: description || '<em class="muted">(empty)</em>' }} />
        </div>
      </div>

      {/* Section 2: Optimized FAQ */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>2. FAQ Section (AEO-Optimized)</div>
            <div className="muted" style={{ fontSize: 11 }}>10–15 conversational questions with direct answers</div>
          </div>
          <CopyBtn text={faq} label="Copy HTML" />
        </div>
        <div style={bodyStyle}>
          <div style={htmlStyle} dangerouslySetInnerHTML={{ __html: faq || '<em class="muted">(empty)</em>' }} />
        </div>
      </div>

      {/* Section 3: Internal Linking Suggestions */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>3. Internal Linking Opportunities</div>
            <div className="muted" style={{ fontSize: 11 }}>Concrete links to add — comparisons, variants, related content, buying guides</div>
          </div>
          <CopyBtn
            text={internalLinks.map((l, i) => `${i + 1}. ${l.anchor}\n   Target: ${l.targetHint}\n   Why: ${l.reason}`).join('\n\n')}
            label="Copy List"
          />
        </div>
        <div style={bodyStyle}>
          {internalLinks.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>(none suggested)</div> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {internalLinks.map((l, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{l.anchor}</strong>
                    {l.targetHint && (
                      <span style={{ fontSize: 11, color: 'var(--teal)', marginLeft: 8, fontFamily: 'JetBrains Mono, monospace' }}>
                        → {l.targetHint}
                      </span>
                    )}
                  </div>
                  {l.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{l.reason}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Section 4: Changes Description */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>4. Changes Made — Product Description</div>
            <div className="muted" style={{ fontSize: 11 }}>Explains each change so the AM can review + justify to the client</div>
          </div>
          <CopyBtn
            text={changesDescription.map((c, i) => `${i + 1}. ${c.title}\n   ${c.detail}`).join('\n\n')}
            label="Copy List"
          />
        </div>
        <div style={bodyStyle}>
          {changesDescription.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>(none)</div> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {changesDescription.map((c, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.detail}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Section 4: Changes FAQ */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>5. Changes Made — FAQ</div>
            <div className="muted" style={{ fontSize: 11 }}>Rationale for each FAQ addition, edit, or disclaimer</div>
          </div>
          <CopyBtn
            text={changesFaq.map((c, i) => `${i + 1}. ${c.title}\n   ${c.detail}`).join('\n\n')}
            label="Copy List"
          />
        </div>
        <div style={bodyStyle}>
          {changesFaq.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>(none)</div> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {changesFaq.map((c, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.detail}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Section 5: Schemas (optional) */}
      {(productSchema || faqSchema) && (
        <div style={sectionStyle}>
          <div style={headerStyle}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ACCENT }}>6. Structured Data (JSON-LD)</div>
              <div className="muted" style={{ fontSize: 11 }}>Paste into &lt;head&gt; or the page's schema field</div>
            </div>
          </div>
          <div style={bodyStyle}>
            {productSchema && (
              <div style={{ marginBottom: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Product Schema</span>
                  <CopyBtn text={productSchema} />
                </div>
                <pre style={{ background: '#0d0e11', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: 10, lineHeight: 1.5, color: '#c8d0d8', overflowX: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>{productSchema}</pre>
              </div>
            )}
            {faqSchema && (
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>FAQPage Schema</span>
                  <CopyBtn text={faqSchema} />
                </div>
                <pre style={{ background: '#0d0e11', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: 10, lineHeight: 1.5, color: '#c8d0d8', overflowX: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>{faqSchema}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AEOEngine({ sub }) {
  const clients = useClients(s => s.clients);
  const client = useClients(s => s.current());
  const [urls, setUrls] = useState('');
  const [results, setResults] = useState(loadResults());
  const [history, setHistory] = useState(loadHistory());
  const [properties, setProperties] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  // Map of "clientId::url" → Set of rejected opt keys. An optimization
  // generated by a future run that matches a rejected (type, name) pair on
  // the same page is hidden from the UI.
  const [rejectionsByPage, setRejectionsByPage] = useState(() => new Map());

  // Deep optimization state — single page, full rewrite + FAQ + changes log.
  const [deepUrl, setDeepUrl] = useState('');
  const [deepClientId, setDeepClientId] = useState('');
  const [deepResult, setDeepResult] = useState(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepErr, setDeepErr] = useState('');
  const [deepPhase, setDeepPhase] = useState('');     // human-readable status line
  const [deepProgress, setDeepProgress] = useState(0); // 0–100 for the bar
  const [deepHistory, setDeepHistory] = useState([]);  // persisted list of past runs

  // Default the deep-opt client to the top-bar selected client when one is set.
  useEffect(() => {
    if (!deepClientId && client?.id) setDeepClientId(client.id);
  }, [client?.id]);

  // Load deep optimization history from Supabase on mount.
  useEffect(() => {
    listDeepResults().then(setDeepHistory).catch(() => {});
  }, []);

  async function runDeepOptimization() {
    const dc = clients.find(c => c.id === deepClientId) || client;
    if (!dc) { setDeepErr('Select a client to link this optimization to.'); return; }
    const url = deepUrl.trim();
    if (!url) { setDeepErr('Enter a page URL.'); return; }
    try { new URL(url); } catch { setDeepErr('Enter a valid URL (e.g. https://example.com/page/)'); return; }

    setDeepBusy(true); setDeepErr(''); setDeepResult(null);
    setDeepPhase('Starting…'); setDeepProgress(2);

    // Smooth progress simulation while we wait on the long Claude call.
    // Phases set hard checkpoints; the timer fills the gaps so the bar
    // never looks frozen during the 30–60s generate step.
    let phaseTarget = 5;
    const phaseFloor = { fetch: 5, fetched: 15, generating: 20, parsing: 92, done: 100 };
    const phaseCeil  = { fetch: 12, fetched: 18, generating: 90, parsing: 96, done: 100 };
    const setPhase = (key, label) => {
      setDeepPhase(label);
      if (phaseFloor[key] !== undefined) {
        setDeepProgress(p => Math.max(p, phaseFloor[key]));
        phaseTarget = phaseCeil[key];
      }
    };

    const ticker = setInterval(() => {
      setDeepProgress(p => {
        if (p >= phaseTarget) return p;
        // Slow asymptotic approach to the current phase ceiling.
        return Math.min(phaseTarget, p + Math.max(0.3, (phaseTarget - p) * 0.04));
      });
    }, 400);

    try {
      const result = await generateDeepForPage(url, dc, setPhase);
      setPhase('done', 'Done ✓');
      setDeepProgress(100);
      const enriched = {
        ...result,
        pageUrl: result?.pageUrl || url,
        client_id: dc.id,
        client_name: dc.name,
        generated_at: new Date().toISOString()
      };
      setDeepResult(enriched);
      // Persist to Supabase and refresh history.
      try {
        const saved = await saveDeepResult(enriched);
        setDeepResult(saved);
        const fresh = await listDeepResults();
        setDeepHistory(fresh);
      } catch (saveErr) {
        console.warn('[AEO Deep] save failed:', saveErr.message);
      }
    } catch (e) {
      setDeepErr(e.message);
      setDeepPhase('Failed');
    } finally {
      clearInterval(ticker);
      setDeepBusy(false);
    }
  }

  async function removeDeepResult(id) {
    try {
      await deleteDeepResult(id);
      setDeepHistory(prev => prev.filter(r => r.id !== id));
      if (deepResult?.id === id) setDeepResult(null);
    } catch (e) {
      console.warn('[AEO Deep] delete failed:', e.message);
    }
  }

  // Load from Supabase on mount (merges with localStorage).
  useEffect(() => {
    loadAeoResultsFromDb().then(dbResults => {
      if (Object.keys(dbResults).length > 0) {
        setResults(prev => ({ ...prev, ...dbResults }));
      }
    }).catch(() => {});
    listAeoRejections().then(rows => {
      const map = new Map();
      for (const r of rows || []) {
        const k = (r.client_id || '') + '::' + r.page_url;
        if (!map.has(k)) map.set(k, new Set());
        map.get(k).add(r.opt_key);
      }
      setRejectionsByPage(map);
    }).catch(() => {});
  }, []);

  async function rejectAeoOpt(pageUrl, opt, reason) {
    const cid = (() => {
      // Find which client this page belongs to by scanning results.
      for (const r of Object.values(results)) {
        if (r.url === pageUrl) return r.client_id;
      }
      return null;
    })();
    if (!cid) return;
    const key = aeoOptKey(opt);
    setRejectionsByPage(prev => {
      const next = new Map(prev);
      const mapKey = cid + '::' + pageUrl;
      const set = new Set(next.get(mapKey) || []);
      set.add(key);
      next.set(mapKey, set);
      return next;
    });
    try {
      await saveAeoRejection(cid, pageUrl, key, reason || '');
    } catch (e) {
      console.warn('[AEO] saveAeoRejection failed:', e.message);
    }
  }

  useEffect(() => { saveResults(results); }, [results]);
  useEffect(() => { saveHistory(history); }, [history]);

  async function loadGa4Properties() {
    try {
      await ensureToken([SCOPES.ga4]);
      const data = await listAccountSummaries();
      const props = [];
      for (const acc of data.accountSummaries || []) {
        for (const p of acc.propertySummaries || []) {
          props.push({ id: p.property.replace('properties/', ''), name: p.displayName, account: acc.displayName });
        }
      }
      setProperties(props);
    } catch (e) { setErr(e.message); }
  }

  // Full AEO pipeline — ported from old Syte AEO Engine v2.
  // Steps: 0) Pre-check auth  1) Fetch sitemap  2) Pull GA4 data  3) Prioritize  4) Batch optimize
  async function runForClient(c) {
    if (!c) return;
    setBusy(true); setErr(''); setProgress('');
    try {
      // STEP 0: Pre-check Google credentials if client has GA4.
      // Do this BEFORE the pipeline so the OAuth popup appears up-front,
      // not mid-flow where it can hang or confuse the user.
      //
      // Hint Google to the client's saved account (per-API field wins
      // over the legacy single google_account_email) so the picker is
      // skipped when that account already has a live cached token.
      const ga4Email = c.ga4_account_email || c.google_account_email || null;
      let ga4Ready = false;
      if (c.ga4_property_id) {
        const existingToken = getToken();
        if (!existingToken || !existingToken.access_token) {
          setProgress('Connecting to Google Analytics — please sign in…');
          try {
            await ensureToken([SCOPES.ga4], { expectedEmail: ga4Email });
            ga4Ready = true;
            setProgress('Google connected ✓');
          } catch (e) {
            setProgress('GA4 auth skipped — will use sitemap order instead');
            ga4Ready = false;
          }
        } else {
          ga4Ready = true;
        }
      }

      // STEP 1: Fetch sitemap (with pasted XML fallback)
      setProgress('Step 1/4 — Fetching sitemap for ' + c.name + '…');
      let sitemapUrls = [];
      try {
        sitemapUrls = await fetchSitemapUrls(c.sitemap_url, c.sitemap_raw);
      } catch (e) {
        console.warn('[AEO] Sitemap fetch error:', e.message);
      }

      if (sitemapUrls.length > 0) {
        setProgress(`Step 1/4 — ${sitemapUrls.length} pages from sitemap ✓`);
      } else if (c.url) {
        // Sitemap failed — discover real pages from the homepage links instead
        // of guessing generic paths that may not exist (Shopify uses /pages/, etc.)
        setProgress('Step 1/4 — No sitemap, discovering pages from homepage links…');
        const base = c.url.replace(/\/$/, '');
        try {
          const homepageHtml = await corsFetchText(base + '/');
          const tempDoc = new DOMParser().parseFromString(homepageHtml, 'text/html');
          const origin = new URL(base).origin;
          const discovered = new Set([base + '/']);
          for (const a of tempDoc.querySelectorAll('a[href]')) {
            let href = a.getAttribute('href') || '';
            if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
            try {
              const full = new URL(href, base).href;
              if (full.startsWith(origin) && !full.includes('#')) {
                discovered.add(full.split('?')[0]);
              }
            } catch {}
          }
          sitemapUrls = Array.from(discovered);
        } catch {
          sitemapUrls = [base + '/'];
        }
        setProgress(`Step 1/4 — Discovered ${sitemapUrls.length} pages from homepage links`);
      } else {
        setErr(c.name + ' has no sitemap URL, pasted XML, or website URL.');
        setBusy(false);
        return;
      }
      setProgress(`Step 1/4 — ${sitemapUrls.length} pages from sitemap ✓`);

      // STEP 2: Pull GA4 page data for prioritization (only if auth passed in Step 0)
      let ga4Rows = [];
      if (c.ga4_property_id && ga4Ready) {
        setProgress('Step 2/4 — Pulling GA4 data for ' + c.name + '…');
        try {
          // Token is already valid from Step 0, so this won't trigger a popup.
          // Still add a timeout in case the API itself is slow.
          const ga4Promise = runReport(c.ga4_property_id, 30);
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('GA4 API timed out after 20s')), 20000)
          );
          const report = await Promise.race([ga4Promise, timeout]);
          ga4Rows = (report.rows || [])
            .map(r => ({
              path: r.dimensionValues?.[0]?.value || '',
              sessions: Number(r.metricValues?.[0]?.value || 0),
              engagement: r.metricValues?.[1]?.value ? (parseFloat(r.metricValues[1].value) * 100).toFixed(1) + '%' : ''
            }))
            .filter(r => r.path && r.path !== '(not set)' && r.sessions > 0)
            .sort((a, b) => b.sessions - a.sessions);
          setProgress(`Step 2/4 — ${ga4Rows.length} pages from GA4 ✓`);
        } catch (e) {
          setProgress('Step 2/4 — GA4 skipped (' + e.message.slice(0, 60) + '), using sitemap order');
        }
      } else {
        setProgress('Step 2/4 — ' + (c.ga4_property_id ? 'GA4 auth not available' : 'No GA4 property') + ', using sitemap order');
      }

      // STEP 3: Prioritize — merge sitemap with GA4, rank by traffic
      setProgress('Step 3/4 — Prioritizing pages…');
      const baseUrl = (c.url || '').replace(/\/$/, '');
      const ga4ByPath = new Map(ga4Rows.map(r => [r.path, r]));

      const prioritized = sitemapUrls.map(url => {
        let path;
        try { path = new URL(url).pathname; } catch { path = url; }
        const ga4 = ga4ByPath.get(path) || ga4ByPath.get(path + '/') || ga4ByPath.get(path.replace(/\/$/, ''));
        return {
          url, path,
          sessions: ga4?.sessions || 0,
          engagement: ga4?.engagement || '',
          priority: (ga4?.sessions || 0) > 100 ? 'high' : (ga4?.sessions || 0) > 20 ? 'medium' : 'low'
        };
      }).sort((a, b) => b.sessions - a.sessions);

      // Also add GA4 pages not in sitemap (they still exist on the site)
      for (const row of ga4Rows) {
        if (!prioritized.some(p => p.path === row.path || p.path === row.path + '/')) {
          prioritized.push({
            url: baseUrl + row.path,
            path: row.path,
            sessions: row.sessions,
            engagement: row.engagement,
            priority: row.sessions > 100 ? 'high' : row.sessions > 20 ? 'medium' : 'low'
          });
        }
      }

      // Take top N pages (client's pages_per_month or 15)
      const maxPages = c.pages_per_month || 15;
      const targets = prioritized.slice(0, maxPages);
      setUrls(targets.map(t => t.url).join('\n'));
      setProgress(`Step 3/4 — ${targets.length} pages selected (${prioritized.length} total) ✓`);

      // STEP 4: Generate AEO optimizations in batches
      const newResults = { ...results };
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        setProgress(`Step 4/4 — ${c.name}: Optimizing pages ${i + 1}–${Math.min(i + BATCH_SIZE, targets.length)} of ${targets.length}…`);
        const batchResults = await Promise.all(
          batch.map(t => generateForPage(t.url, c).catch(e => ({ error: e.message })))
        );
        batch.forEach((t, j) => {
          const key = c.id + '::' + t.url;
          const row = {
            url: t.url, path: t.path, client_id: c.id,
            sessions: t.sessions, priority: t.priority,
            generated_at: new Date().toISOString(),
            optimizations: Array.isArray(batchResults[j]) ? batchResults[j] : [],
            error: batchResults[j]?.error || null
          };
          newResults[key] = row;
          // Persist each result to Supabase immediately
          saveAeoResult(row).catch(() => {});
        });
        setResults({ ...newResults });
      }
      setHistory(prev => [
        { id: crypto.randomUUID(), client_id: c.id, client_name: c.name,
          count: targets.length, created_at: new Date().toISOString() },
        ...prev
      ]);
      const totalOpts = targets.reduce((a, t) => {
        const r = newResults[c.id + '::' + t.url];
        return a + (r?.optimizations?.length || 0);
      }, 0);
      setProgress(`Done. ${totalOpts} optimizations across ${targets.length} pages for ${c.name}.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function pullFromSitemap() {
    if (!client?.sitemap_url && !client?.sitemap_raw) { setErr('Client has no sitemap URL or pasted XML.'); return; }
    setBusy(true); setErr(''); setProgress('Fetching sitemap…');
    try {
      const locs = await fetchSitemapUrls(client.sitemap_url, client.sitemap_raw);
      if (!locs.length) throw new Error('No URLs found — check the sitemap URL or paste XML in the client settings.');
      setUrls(locs.slice(0, 50).join('\n'));
      setProgress(`Loaded ${locs.length} URLs (showing first 50).`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function pullFromGa4() {
    if (!client?.ga4_property_id) { setErr('Client has no GA4 property ID.'); return; }
    setBusy(true); setErr(''); setProgress('Running GA4 report…');
    try {
      const ga4Email = client.ga4_account_email || client.google_account_email || null;
      await ensureToken([SCOPES.ga4], { expectedEmail: ga4Email });
      const report = await runReport(client.ga4_property_id, 30);
      const rows = (report.rows || [])
        .map(r => ({
          path: r.dimensionValues?.[0]?.value || '',
          sessions: Number(r.metricValues?.[0]?.value || 0)
        }))
        .filter(r => r.path && r.path.startsWith('/'))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 30);
      const base = (client.url || '').replace(/\/$/, '');
      setUrls(rows.map(r => base + r.path).join('\n'));
      setProgress(`Loaded top ${rows.length} pages by sessions.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function runAll() {
    if (!client) { setErr('Select a client first.'); return; }
    const pageList = urls.split('\n').map(s => s.trim()).filter(Boolean);
    if (!pageList.length) { setErr('Enter at least one URL.'); return; }

    setBusy(true); setErr(''); setProgress('');
    const newResults = { ...results };
    try {
      // Process in batches of 3 for rate-limiting.
      for (let i = 0; i < pageList.length; i += BATCH_SIZE) {
        const batch = pageList.slice(i, i + BATCH_SIZE);
        setProgress(`Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(pageList.length / BATCH_SIZE)}`);
        const batchResults = await Promise.all(
          batch.map(u => generateForPage(u, client).catch(e => ({ error: e.message })))
        );
        batch.forEach((u, j) => {
          const key = client.id + '::' + u;
          const row = {
            url: u,
            client_id: client.id,
            generated_at: new Date().toISOString(),
            optimizations: Array.isArray(batchResults[j]) ? batchResults[j] : [],
            error: batchResults[j]?.error || null
          };
          newResults[key] = row;
          saveAeoResult(row).catch(() => {});
        });
        setResults({ ...newResults });
      }
      setHistory(prev => [
        { id: crypto.randomUUID(), client_id: client.id, client_name: client.name, count: pageList.length, created_at: new Date().toISOString() },
        ...prev
      ]);
      setProgress(`Done. Generated for ${pageList.length} pages.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function buildOptItem(pageUrl, opt) {
    return {
      module: 'aeo',
      page_url: pageUrl,
      page_title: opt.title,
      change_type: opt.type,
      payload: { code: opt.code, placement: opt.placement, reason: opt.reason }
    };
  }

  async function pushAllForClient() {
    if (!client) return;
    setBusy(true); setErr(''); setProgress('');
    const mine = Object.values(results).filter(r => r.client_id === client.id);
    let ok = 0, fail = 0;
    for (const r of mine) {
      for (const opt of r.optimizations || []) {
        try {
          await pushItemInline(client, buildOptItem(r.url, opt));
          ok++;
        } catch (e) {
          fail++;
        }
        setProgress('Pushed ' + ok + ' · failed ' + fail);
      }
    }
    setBusy(false);
  }

  // -------- Pipeline state --------
  const [aeoImpls, setAeoImpls] = useState([]);
  function refreshImplementations() {
    listAllImplementations().then(setAeoImpls).catch(() => {});
  }
  useEffect(() => { refreshImplementations(); }, []);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const aeoClients = clients.filter(c => c.does_aeo !== false);

  const aeoPipeline = useMemo(() => {
    const buckets = {
      'verified-on-site': [],
      'optimizations-generated': [],
      'not-run': [],
      'credentials-missing': []
    };
    for (const c of aeoClients) {
      let status;
      try {
        status = aeoPipelineStatus(c, aeoImpls, results, currentMonth, deepHistory);
      } catch (e) {
        console.warn('[AEO] pipeline status failed for', c?.name || c?.id, e);
        status = { section: 'not-run', detail: 'Status check failed: ' + e.message };
      }
      const bucket = buckets[status?.section] || buckets['not-run'];
      bucket.push({ client: c, summary: status?.summary, detail: status?.detail });
    }
    return [
      { key: 'verified-on-site',        label: 'Verified on Site',        color: 'var(--green)',      borderColor: 'var(--green)',      clients: buckets['verified-on-site'] },
      { key: 'optimizations-generated', label: 'Optimizations Generated', color: 'var(--blue)',       borderColor: 'var(--blue)',       clients: buckets['optimizations-generated'] },
      { key: 'not-run',                 label: 'Not Run Yet',             color: 'var(--text-muted)', borderColor: 'var(--border)',      clients: buckets['not-run'] },
      { key: 'credentials-missing',     label: 'Credentials Missing',     color: 'var(--red)',        borderColor: 'var(--red)',        clients: buckets['credentials-missing'] }
    ];
  }, [aeoClients, aeoImpls, results, currentMonth, deepHistory]);

  const [expandedClient, setExpandedClient] = useState(null);

  // Get results for a client — returns array of page results sorted by # of optimizations (most first).
  function getClientResults(clientId) {
    return Object.values(results)
      .filter(r => r.client_id === clientId)
      .sort((a, b) => (b.optimizations?.length || 0) - (a.optimizations?.length || 0));
  }

  function deleteResult(url, clientId) {
    const cid = clientId || client?.id;
    const key = cid + '::' + url;
    setResults(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    deleteAeoResult(cid, url).catch(() => {});
  }

  // -------- Subviews --------
  if (sub === 'Run Optimizations') {
    return (
      <div className="content-area">
        {/* Status bar — shows progress when running from a pipeline card */}
        {(busy || progress || err) && (
          <div className="card" style={{ marginBottom: 12, padding: '10px 16px', borderColor: busy ? ACCENT : err ? 'var(--red)' : 'var(--green)' }}>
            <div className="row" style={{ gap: 10 }}>
              {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
              <span style={{ fontSize: 13, color: err ? 'var(--red)' : busy ? 'var(--text)' : 'var(--green)' }}>
                {err || progress || 'Running…'}
              </span>
            </div>
          </div>
        )}

        {/* Pipeline overview */}
        <PipelineView
          title={`AEO Engine — ${monthLabel}`}
          month={monthLabel}
          sections={aeoPipeline}
          onAction={(c, action) => {
            if (action === 'run') {
              useClients.getState().select(c.id);
              runForClient(c);
            }
          }}
          actions={[
            { key: 'run', label: 'Run Optimizations', color: ACCENT,
              condition: (c, section) => section !== 'credentials-missing' && section !== 'verified-on-site' },
            { key: 'run', label: 'Re-run', color: ACCENT,
              condition: (c, section) => section === 'verified-on-site' }
          ]}
          onExpandClient={(c) => setExpandedClient(prev => prev === c.id ? null : c.id)}
          expandedId={expandedClient}
          renderExpanded={(c) => {
            const cResults = getClientResults(c.id);
            const cDeep = deepHistory.filter(d => d.client_id === c.id);
            if (cResults.length === 0 && cDeep.length === 0) {
              return <div className="muted" style={{ padding: 12, fontSize: 12 }}>No optimizations yet. Click Run Optimizations to generate.</div>;
            }
            // Don't count rejected optimizations in the per-client total.
            const totalOpts = cResults.reduce((a, r) => {
              const rej = rejectionsByPage.get(c.id + '::' + r.url);
              const opts = Array.isArray(r.optimizations) ? r.optimizations : [];
              return a + (rej ? opts.filter(o => !rej.has(aeoOptKey(o))).length : opts.length);
            }, 0);
            return (
              <div>
                {cResults.length > 0 && (
                  <>
                    <div className="muted" style={{ padding: '8px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      Quick-Win Optimizations · {totalOpts} across {cResults.length} page{cResults.length > 1 ? 's' : ''}
                    </div>
                    {cResults.slice(0, 5).map(r => (
                      <OptPageCard
                        key={r.url}
                        result={r}
                        onDelete={() => deleteResult(r.url, c.id)}
                        onVerified={refreshImplementations}
                        optClient={c}
                        rejectedOptKeys={rejectionsByPage.get(c.id + '::' + r.url)}
                        onRejectOpt={rejectAeoOpt}
                      />
                    ))}
                    {cResults.length > 5 && (
                      <div className="muted" style={{ padding: '8px 14px', fontSize: 11 }}>
                        …and {cResults.length - 5} more pages. View all in Latest Results.
                      </div>
                    )}
                  </>
                )}
                {cDeep.length > 0 && (
                  <>
                    <div className="muted" style={{ padding: '10px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderTop: cResults.length > 0 ? '1px solid var(--border)' : 'none', marginTop: cResults.length > 0 ? 6 : 0 }}>
                      Deep Optimizations · {cDeep.length}
                    </div>
                    {cDeep.map(d => {
                      let path = d.pageUrl;
                      try { path = new URL(d.pageUrl).pathname; } catch {}
                      const isOpen = deepResult?.id === d.id;
                      return (
                        <div key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <div className="row" style={{ padding: '10px 14px', gap: 8, justifyContent: 'space-between', alignItems: 'center', background: isOpen ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }} onClick={() => setDeepResult(isOpen ? null : d)}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {d.pageTitle || path}
                              </div>
                              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                                {path} · {new Date(d.generated_at).toLocaleDateString()} {new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                              <button style={{ fontSize: 10, padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); setDeepResult(isOpen ? null : d); }}>
                                {isOpen ? 'Hide' : 'View'}
                              </button>
                              <button
                                style={{ fontSize: 10, padding: '3px 8px', color: 'var(--red)', borderColor: 'rgba(255,77,77,.3)' }}
                                onClick={(e) => { e.stopPropagation(); if (confirm('Delete this deep optimization?')) removeDeepResult(d.id); }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          }}
        />

        {/* Log External Work — for manually-done AEO optimizations */}
        <LogExternalWork
          module="aeo"
          accent={ACCENT}
          onLog={async (entry) => {
            const key = entry.clientId + '::' + entry.url;
            const row = {
              url: entry.url,
              client_id: entry.clientId,
              generated_at: entry.verifiedAt,
              optimizations: [{ type: 'content', name: entry.title, description: 'Manually logged — done outside the tool', implementation: '', where: entry.url }],
              error: null
            };
            setResults(prev => ({ ...prev, [key]: row }));
            saveAeoResult(row).catch(() => {});
          }}
        />

        {/* ───────── Single Page Deep Optimization ───────── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 4px' }}>Single Page Deep Optimization</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Enter one page URL for a full rewrite — product description, 10–15 FAQ questions, and a changes log explaining every edit. Use this when a page needs a comprehensive overhaul, not just quick-win snippets.
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <label>Link to client</label>
              <select
                value={deepClientId}
                onChange={e => setDeepClientId(e.target.value)}
                disabled={deepBusy}
                style={{ width: '100%' }}
              >
                <option value="">— Select client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <label>Page URL to deep-optimize</label>
              <input
                type="url"
                placeholder="https://example.com/product-or-service-page/"
                value={deepUrl}
                onChange={e => setDeepUrl(e.target.value)}
                disabled={deepBusy}
                style={{ width: '100%' }}
              />
            </div>
            <button
              className="primary"
              style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }}
              onClick={runDeepOptimization}
              disabled={deepBusy || !deepClientId || !deepUrl.trim()}
            >
              {deepBusy ? 'Deep-optimizing…' : 'Deep Optimize This Page'}
            </button>
          </div>
          {!deepClientId && <div className="muted" style={{ fontSize: 11 }}>Pick a client to attribute this optimization to.</div>}
          {deepErr && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{deepErr}</div>}

          {/* Progress bar — visible during run and briefly after completion */}
          {(deepBusy || (deepProgress > 0 && deepProgress < 100)) && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  {deepBusy && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{deepPhase || 'Working…'}</span>
                </div>
                <span className="muted" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{Math.round(deepProgress)}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-3, #1a1c20)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: deepProgress + '%',
                  height: '100%',
                  background: 'linear-gradient(90deg, ' + ACCENT + ', #4dabff)',
                  transition: 'width 400ms ease-out',
                  borderRadius: 999
                }} />
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
                Full rewrite typically takes 30–60 seconds. Don't navigate away — output streams in below when complete.
              </div>
            </div>
          )}

          {deepResult && !deepBusy && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              {deepResult.client_name && (
                <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                  Linked to <strong style={{ color: ACCENT }}>{deepResult.client_name}</strong> · generated {new Date(deepResult.generated_at).toLocaleString()}
                </div>
              )}
              <DeepResultDisplay result={deepResult} />
            </div>
          )}
        </div>

        {/* Deep Optimization History now lives inline under each client's
            expanded pipeline card above. Removed standalone flat list. */}

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Run for Selected Client</h3>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <button onClick={pullFromSitemap} disabled={!client || busy}>Pull from Sitemap</button>
            <button onClick={pullFromGa4} disabled={!client || busy}>Pull from GA4 (top 30)</button>
          </div>
          <label>Target URLs (one per line)</label>
          <textarea value={urls} onChange={e => setUrls(e.target.value)} rows={10} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>{progress}</span>
            <button className="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }} onClick={runAll} disabled={busy || !client}>
              {busy ? 'Generating…' : 'Generate AEO (batches of 3)'}
            </button>
          </div>
          {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        </div>
      </div>
    );
  }

  if (sub === 'Latest Results') {
    // Group ALL results by client — not filtered by top-bar selection.
    // Lets the AM see every optimization across every client in one place.
    const allResults = Object.values(results);
    const byClient = {};
    for (const r of allResults) {
      const cid = r.client_id || 'unknown';
      if (!byClient[cid]) byClient[cid] = { client_id: cid, results: [] };
      byClient[cid].results.push(r);
    }
    const clientGroups = Object.values(byClient)
      .map(g => ({
        ...g,
        client: clients.find(c => c.id === g.client_id),
        totalOpts: g.results.reduce((a, r) => a + (r.optimizations?.length || 0), 0)
      }))
      .sort((a, b) => b.totalOpts - a.totalOpts);

    const totalOpts = allResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);

    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Latest Results — All Clients</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {totalOpts} optimizations across {allResults.length} pages · {clientGroups.length} clients
            </div>
          </div>
        </div>
        {allResults.length === 0 && <div className="muted">No results yet. Run optimizations from Run Optimizations.</div>}
        {clientGroups.map(g => {
          const cName = g.client?.name || 'Unknown client';
          const isOpen = expandedClient === g.client_id;
          return (
            <div key={g.client_id} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
              <div
                className="row"
                style={{ padding: '12px 14px', justifyContent: 'space-between', cursor: 'pointer', background: isOpen ? 'var(--surface-2)' : 'transparent' }}
                onClick={() => setExpandedClient(isOpen ? null : g.client_id)}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>{cName}</strong>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {g.totalOpts} optimizations · {g.results.length} page{g.results.length > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {g.client && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useClients.getState().select(g.client_id);
                        pushAllForClient();
                      }}
                      disabled={busy}
                      style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--mod-cms)', color: 'var(--mod-cms)' }}
                    >
                      Push All to CMS
                    </button>
                  )}
                  <span className="muted" style={{ fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                </div>
              </div>
              {isOpen && g.results.map(r => (
                <OptPageCard
                  key={r.url}
                  result={r}
                  onDelete={() => deleteResult(r.url, r.client_id)}
                  onVerified={refreshImplementations}
                  optClient={clients.find(cc => cc.id === r.client_id)}
                  rejectedOptKeys={rejectionsByPage.get(r.client_id + '::' + r.url)}
                  onRejectOpt={rejectAeoOpt}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (sub === 'Clients') {
    const aeoClients = clients.filter(c => c.does_aeo !== false);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>AEO Engine Clients</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {aeoClients.length} / {clients.length} clients have AEO enabled
          </span>
        </div>
        <ClientCardsGrid service="aeo" accent={ACCENT} clients={aeoClients} />
      </div>
    );
  }

  if (sub === 'Settings') {
    const gToken = getToken();
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>AEO Engine Settings</h2>
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Google Analytics 4</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            {gToken ? 'Connected' : 'Not connected'}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={loadGa4Properties}>Connect & List Properties</button>
            {gToken && <button onClick={() => { clearToken(); window.location.reload(); }}>Disconnect</button>}
          </div>
        </div>
        {properties.length > 0 && (
          <div className="card">
            <strong>Available GA4 Properties</strong>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Account</th><th>Property</th><th>ID</th></tr></thead>
              <tbody>
                {properties.map(p => (
                  <tr key={p.id}><td>{p.account}</td><td>{p.name}</td><td className="mono">{p.id}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card" style={{ marginTop: 14 }}>
          <strong>Supported AEO Types</strong>
          <ul style={{ columns: 2, margin: '10px 0 0' }}>
            {AEO_TYPES.map(t => <li key={t.id} style={{ fontSize: 12 }}>{t.label}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  if (sub === 'History') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>AEO Run History</h2>
        <table>
          <thead><tr><th>Date</th><th>Client</th><th>Pages</th></tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.created_at).toLocaleString()}</td>
                <td>{h.client_name}</td>
                <td>{h.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}
