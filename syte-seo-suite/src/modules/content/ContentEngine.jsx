import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream, extractJSON } from '../../lib/anthropic.js';
import { buildSystemPrompt, TAB_PROMPTS } from './prompts.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import ClientCardsGrid from '../../components/ClientCardsGrid.jsx';
import TopicResearch from './TopicResearch.jsx';
import AutoWrite from './AutoWrite.jsx';
import GenerateImageButton from '../../components/GenerateImageButton.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';

const ACCENT = '#c8ff00';
const HISTORY_KEY = 'syte-suite-content-history';
// Raised from 50 to 500 so bulk Auto Write runs (up to 20 articles per
// client × many clients) don't immediately roll off the history.
const HISTORY_CAP = 500;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_CAP))); }

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convert Markdown → HTML so .docx export preserves headings, bold, lists.
function markdownToHtml(md) {
  if (!md) return '';
  return md
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/gm, (match) => '<ul>' + match + '</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```[\s\S]*?```/g, m => '<pre>' + m.slice(3, -3).trim() + '</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hluop])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}

// .docx export — converts Markdown to HTML first so Word preserves headings,
// bold, and list structure. Uses the "save as .doc" HTML envelope trick.
function exportDocx(rawContent, filename) {
  const html = markdownToHtml(rawContent);
  const src = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8">
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #222; }
      h1 { font-size: 18pt; font-weight: bold; margin: 12pt 0 6pt; }
      h2 { font-size: 14pt; font-weight: bold; margin: 10pt 0 4pt; }
      h3 { font-size: 12pt; font-weight: bold; margin: 8pt 0 4pt; }
      p { margin: 6pt 0; }
      ul, ol { margin: 6pt 0 6pt 24pt; }
      li { margin: 2pt 0; }
      pre { background: #f5f5f5; padding: 8pt; font-family: Consolas, monospace; font-size: 9pt; }
      code { background: #f5f5f5; padding: 1pt 3pt; font-family: Consolas, monospace; font-size: 9pt; }
      table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
      th, td { border: 1px solid #ccc; padding: 6pt 8pt; text-align: left; font-size: 10pt; }
      th { background: #f0f0f0; font-weight: bold; }
    </style>
    </head><body>${html}</body></html>`;
  const blob = new Blob(['\ufeff', src], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename + '.doc';
  a.click();
  URL.revokeObjectURL(url);
}

function exportTxt(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}

const SCORE_KEYS = [
  ['keyword_integration', 'Keyword Integration'],
  ['heading_structure',   'Heading Structure'],
  ['readability',         'Readability'],
  ['aeo_readiness',       'AEO Readiness'],
  ['geo_authority',       'GEO Authority'],
  ['eeat_signals',        'E-E-A-T Signals'],
  ['visual_aids_tables',  'Visual Aids & Tables'],
  ['internal_linking',    'Internal Linking']
];

// Parse the raw Claude output into labeled sections so each piece can be
// copied individually. The model outputs in a predictable order:
//   1. HTML article body
//   2. **Meta Title:** ...
//   3. **Meta Description:** ...
//   4. **AEO Summary Block:** ...
//   5. **FAQ Schema (JSON-LD):** ```json ... ```
//   6. QA JSON block ```json { "keyword_integration": ... } ```

function parseOutputSections(raw) {
  if (!raw) return null;

  const metaTitleMatch = raw.match(/\*?\*?Meta Title\*?\*?:?\s*(.+)/i);
  const metaDescMatch  = raw.match(/\*?\*?Meta Description\*?\*?:?\s*(.+)/i);
  const aeoMatch       = raw.match(/\*?\*?AEO Summary Block\*?\*?:?\s*([\s\S]*?)(?=\n\*?\*?(?:FAQ|Meta|```)|$)/i);

  // Extract all JSON code blocks. The last one is the QA block, the second-to-last is FAQ schema.
  const jsonBlocks = [];
  const jsonRe = /```json\s*([\s\S]*?)```/gi;
  let m;
  while ((m = jsonRe.exec(raw)) !== null) jsonBlocks.push(m[1].trim());

  const qaBlock = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null;
  const faqBlock = jsonBlocks.length > 1 ? jsonBlocks[jsonBlocks.length - 2] : null;

  // The article body is everything before the first **Meta Title or **AEO or ```json.
  const bodyEnd = raw.search(/\*?\*?Meta Title\*?\*?:|```json/i);
  const body = bodyEnd > 0 ? raw.slice(0, bodyEnd).trim() : raw;

  return {
    body,
    metaTitle: metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : null,
    metaDesc:  metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '') : null,
    aeoSummary: aeoMatch ? aeoMatch[1].trim() : null,
    faqSchema: faqBlock,
    qaBlock
  };
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  return (
    <button onClick={copy} style={{ fontSize: 11, padding: '3px 10px' }}>
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function SectionCard({ title, content, accent, mono }) {
  if (!content) return null;
  return (
    <div style={{
      marginBottom: 10, padding: 12,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderLeft: '3px solid ' + (accent || 'var(--border)'),
      borderRadius: 'var(--radius)'
    }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: accent || 'var(--text-muted)' }}>
          {title}
        </strong>
        <CopyButton text={content} />
      </div>
      {mono ? (
        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text)', maxHeight: 300, overflowY: 'auto' }}>{content}</pre>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{content}</div>
      )}
    </div>
  );
}

function ParsedOutput({ output, topic, pushItem, exportTxt, exportDocx, systemPrompt, userPrompt, onOutputUpdate }) {
  const sections = React.useMemo(() => parseOutputSections(output), [output]);
  const [showRaw, setShowRaw] = React.useState(false);
  const [revision, setRevision] = React.useState('');
  const [revising, setRevising] = React.useState(false);
  const [revisionHistory, setRevisionHistory] = React.useState([]);
  // Track the real WordPress permalink returned after a CMS push so the
  // Mark Implemented verifier checks the right URL, not a re-derived slug.
  const [pushedLiveUrl, setPushedLiveUrl] = React.useState('');

  if (!sections) return null;

  async function applyRevision() {
    if (!revision.trim()) return;
    setRevising(true);
    try {
      // Send: system prompt + original generation + current output + revision instruction.
      // Claude sees the full conversation and applies the edit surgically.
      let buf = '';
      await claudeStream({
        system: systemPrompt || '',
        messages: [
          ...(userPrompt ? [{ role: 'user', content: userPrompt }] : []),
          { role: 'assistant', content: output },
          { role: 'user', content: `REVISION REQUEST: ${revision.trim()}\n\nApply this revision to the article above. Return the COMPLETE revised article (not just the changed section) with all metadata, schema, and QA JSON intact. Do not explain what you changed — just output the revised version.` }
        ],
        max_tokens: 8000,
        temperature: 0.5,
        onDelta: (t) => { buf += t; }
      });
      // Save the old version so the user can undo.
      setRevisionHistory(prev => [output, ...prev]);
      onOutputUpdate?.(buf);
      setRevision('');
    } catch (e) {
      alert('Revision failed: ' + e.message);
    } finally {
      setRevising(false);
    }
  }

  function undoRevision() {
    if (revisionHistory.length === 0) return;
    const [prev, ...rest] = revisionHistory;
    onOutputUpdate?.(prev);
    setRevisionHistory(rest);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <strong>Generated Content</strong>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => exportTxt(output, topic || 'article')}>Export .txt</button>
            <button onClick={() => exportDocx(output, topic || 'article')}>Export .docx</button>
            {pushItem && <PushToCmsButton item={pushItem} onSuccess={r => { if (r?.live_url) setPushedLiveUrl(r.live_url); }} />}
            <button onClick={() => setShowRaw(v => !v)} style={{ fontSize: 11 }}>
              {showRaw ? 'Parsed view' : 'Raw output'}
            </button>
          </div>
        </div>

        {showRaw ? (
          <div className="stream-output">{output}</div>
        ) : (
          <>
            <SectionCard title="Meta Title" content={sections.metaTitle} accent="var(--blue)" />
            <SectionCard title="Meta Description" content={sections.metaDesc} accent="var(--blue)" />
            <SectionCard title="AEO Summary Block" content={sections.aeoSummary} accent="var(--teal)" />

            <div style={{
              marginBottom: 10, padding: 12,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderLeft: '3px solid var(--mod-content)',
              borderRadius: 'var(--radius)'
            }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--mod-content)' }}>
                  Article Body
                </strong>
                <CopyButton text={sections.body} />
              </div>
              <details>
                <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>
                  Show article ({Math.round(sections.body.length / 5)} words approx.)
                </summary>
                <div className="stream-output" style={{ marginTop: 8, maxHeight: 500 }}>{sections.body}</div>
              </details>

              {/* Hero image generator — opt-in, only renders if an image API key is configured */}
              <GenerateImageButton title={topic} keyword={sections.metaTitle || topic} />

              {/* Mark as implemented + AI verification */}
              <div style={{ marginTop: 10 }}>
                <MarkImplementedButton
                  module="content"
                  changeType="article"
                  pageUrl={pushedLiveUrl || url || undefined}
                  title={sections.metaTitle || topic || 'Article'}
                  description={`Meta: ${sections.metaTitle || ''} | ${sections.metaDesc || ''}`}
                />
              </div>
            </div>

            <SectionCard title="FAQ Schema (JSON-LD)" content={sections.faqSchema} accent="var(--purple)" mono />
          </>
        )}

        {/* Revision chat — type a refinement instruction without regenerating from scratch */}
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: '1px solid var(--border)'
        }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>
              Revise Article
            </strong>
            {revisionHistory.length > 0 && (
              <button onClick={undoRevision} style={{ fontSize: 10, padding: '3px 10px' }}>
                Undo last revision ({revisionHistory.length})
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={revision}
              onChange={e => setRevision(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyRevision(); } }}
              placeholder='e.g. "Make the intro shorter" · "Add more detail to section 3" · "Rewrite in a more formal tone"'
              disabled={revising}
              style={{ flex: 1 }}
            />
            <button
              onClick={applyRevision}
              disabled={revising || !revision.trim()}
              className="primary"
              style={{ background: 'var(--mod-content)', borderColor: 'var(--mod-content)', color: '#0a0a0c', whiteSpace: 'nowrap' }}
            >
              {revising ? 'Revising…' : 'Apply'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Claude sees the full article + your instruction and returns the revised version. Hit Enter or click Apply.
          </div>
        </div>
      </div>
    </>
  );
}

export default function ContentEngine({ sub, setSub }) {
  const client = useClients(s => s.current());
  const allClients = useClients(s => s.clients);
  const [topic, setTopic] = useState('');
  const [keyword, setKeyword] = useState('');
  const [length, setLength] = useState(1500);
  const [existing, setExisting] = useState('');
  const [url, setUrl] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [history, setHistory] = useState(loadHistory());
  // When the user clicks Write Article on a topic card, we stash the full
  // research context here and the next generation uses it in the system
  // prompt. Stays alive across tab switches inside Content Engine.
  const [researchContext, setResearchContext] = useState(null);
  // Store the last generation's system + user prompts so the revision chat
  // can send them as conversation context to Claude.
  const [lastSystem, setLastSystem] = useState('');
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [expandedClient, setExpandedClient] = useState(null);

  const tab = sub || 'Auto Write';
  const scores = useMemo(() => (output ? extractJSON(output) : null), [output]);

  // Build the virtual queue item that the inline Push-to-CMS button will push.
  const pushItem = useMemo(() => {
    if (!output) return null;
    const titleMatch = output.match(/Meta Title[:\s]*(.+)/i);
    const descMatch = output.match(/Meta Description[:\s]*(.+)/i);
    const schemaMatch = output.match(/```json([\s\S]*?)```/);
    const faqMatch = output.match(/(?:FAQ|Frequently Asked)[\s\S]*/i);
    return {
      module: 'content',
      page_url: url || client?.url || '',
      page_title: topic || keyword || 'Generated Article',
      change_type: 'article',
      payload: {
        meta_title: titleMatch ? titleMatch[1].trim() : '',
        meta_description: descMatch ? descMatch[1].trim() : '',
        primary_keyword: keyword,
        schema: schemaMatch ? schemaMatch[1].trim() : '',
        faq: faqMatch ? faqMatch[0] : '',
        html: output
      }
    };
  }, [output, url, client, topic, keyword]);

  async function run() {
    if (!client) { setErr('Select a client first.'); return; }
    setErr(''); setOutput(''); setRunning(true);

    const system = buildSystemPrompt(client, '', researchContext);
    let userPromptText;
    switch (tab) {
      case 'Rewrite & Expand':    userPromptText = TAB_PROMPTS['Rewrite & Expand'](existing, keyword, length); break;
      case 'Metadata & Schema':   userPromptText = TAB_PROMPTS['Metadata & Schema'](url, topic, keyword); break;
      case 'Editorial Feedback':  userPromptText = TAB_PROMPTS['Editorial Feedback'](existing); break;
      default:                    userPromptText = TAB_PROMPTS['New Article'](topic, keyword, length);
    }
    // Stash for the revision chat.
    setLastSystem(system);
    setLastUserPrompt(userPromptText);
    const userPrompt = userPromptText;

    try {
      let buf = '';
      await claudeStream({
        system,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 8000,
        temperature: 0.7,
        onDelta: (t) => { buf += t; setOutput(buf); }
      });
      const entry = {
        id: crypto.randomUUID(),
        client_id: client.id,
        client_name: client.name,
        tab,
        topic, keyword,
        output: buf,
        created_at: new Date().toISOString()
      };
      const next = [entry, ...history];
      setHistory(next); saveHistory(next);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (tab === 'Auto Write') {
    return (
      <div className="content-area">
        <AutoWrite />
      </div>
    );
  }

  if (tab === 'Topic Research') {
    return (
      <div className="content-area">
        <TopicResearch
          onWriteArticle={(opp, ctx) => {
            // Pre-fill the New Article form from the selected opportunity
            // and stash the full ranking context so buildSystemPrompt can
            // reference it during generation.
            setTopic(opp.topic_title || '');
            setKeyword(opp.primary_keyword || '');
            setLength(opp.recommended_length || 1500);
            if (opp.target_page && opp.target_page !== 'NEW') {
              setUrl(opp.target_page);
            }
            setResearchContext(ctx);
            if (typeof setSub === 'function') setSub('New Article');
          }}
        />
      </div>
    );
  }

  if (tab === 'Clients') {
    const contentClients = allClients.filter(c => c.does_content !== false);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Content Engine Clients</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {contentClients.length} / {allClients.length} clients have Content Engine enabled
          </span>
        </div>
        <ClientCardsGrid service="content" accent={ACCENT} clients={contentClients} />
      </div>
    );
  }

  if (tab === 'History') {
    // Group history entries by client, show as summary cards.
    const byClient = {};
    for (const h of history) {
      const key = h.client_id || h.client_name || 'Unknown';
      if (!byClient[key]) byClient[key] = { name: h.client_name || 'Unknown', items: [] };
      byClient[key].items.push(h);
    }
    const clientGroups = Object.values(byClient).sort((a, b) => b.items.length - a.items.length);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Content History</h2>
          <span className="muted" style={{ fontSize: 12 }}>{history.length} articles total</span>
        </div>
        {history.length === 0 && <div className="muted">No generations yet.</div>}

        {/* Client summary cards */}
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', marginBottom: 20 }}>
          {clientGroups.map(g => {
            const types = {};
            for (const h of g.items) {
              const t = h.opportunity_type || h.tab || 'article';
              types[t] = (types[t] || 0) + 1;
            }
            const isExpanded = expandedClient === g.name;
            return (
              <div
                key={g.name}
                className="card"
                style={{
                  padding: 14, cursor: 'pointer',
                  borderColor: isExpanded ? ACCENT : 'var(--border)'
                }}
                onClick={() => setExpandedClient(isExpanded ? null : g.name)}
              >
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 14 }}>{g.name}</strong>
                  <span style={{ fontFamily: 'Instrument Serif, serif', fontSize: 24, color: ACCENT }}>
                    {g.items.length}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(types).map(([type, count]) => (
                    <span key={type} className="badge" style={{ fontSize: 9 }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
                  Latest: {new Date(g.items[0].created_at).toLocaleDateString('en-ZA')}
                </div>
              </div>
            );
          })}
        </div>

        {/* Expanded client detail */}
        {expandedClient && byClient[Object.keys(byClient).find(k => byClient[k].name === expandedClient)] && (() => {
          const group = clientGroups.find(g => g.name === expandedClient);
          if (!group) return null;
          return (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{group.name}</strong>
                  <button onClick={() => setExpandedClient(null)} style={{ fontSize: 11 }}>Close</button>
                </div>
              </div>
              {group.items.map(h => (
                <div key={h.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{h.topic || h.keyword || h.tab}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {h.tab} · {new Date(h.created_at).toLocaleString()}
                        {h.opportunity_type && <span className="badge" style={{ marginLeft: 8, fontSize: 9 }}>{h.opportunity_type}</span>}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); exportTxt(h.output, h.topic || 'article'); }} style={{ fontSize: 11, padding: '3px 8px' }}>.txt</button>
                      <button onClick={(e) => { e.stopPropagation(); exportDocx(h.output, h.topic || 'article'); }} style={{ fontSize: 11, padding: '3px 8px' }}>.docx</button>
                    </div>
                  </div>
                  {h.output && (
                    <details style={{ marginTop: 6 }}>
                      <summary className="muted" style={{ fontSize: 10, cursor: 'pointer' }}>Preview</summary>
                      <pre style={{ marginTop: 6, padding: 10, background: 'var(--bg)', fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 300, borderRadius: 6 }}>
                        {h.output.slice(0, 2000)}{h.output.length > 2000 ? '…' : ''}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{tab}</h2>
        <span className="badge" style={{ borderColor: ACCENT, color: ACCENT }}>SEO Content Engine</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid-2">
          {(tab === 'New Article' || tab === 'Metadata & Schema') && (
            <>
              <div><label>Topic / Angle</label><input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Best dentists in Manchester" /></div>
              <div><label>Primary Keyword</label><input value={keyword} onChange={e => setKeyword(e.target.value)} /></div>
            </>
          )}
          {tab === 'Metadata & Schema' && (
            <div style={{ gridColumn: 'span 2' }}><label>Page URL</label><input value={url} onChange={e => setUrl(e.target.value)} /></div>
          )}
          {tab === 'New Article' && (
            <div><label>Target length (words)</label><input type="number" value={length} onChange={e => setLength(parseInt(e.target.value) || 1500)} /></div>
          )}
          {tab === 'Rewrite & Expand' && (
            <>
              <div><label>Primary Keyword</label><input value={keyword} onChange={e => setKeyword(e.target.value)} /></div>
              <div><label>Target length (words)</label><input type="number" value={length} onChange={e => setLength(parseInt(e.target.value) || 1800)} /></div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Existing Article</label>
                <textarea value={existing} onChange={e => setExisting(e.target.value)} rows={8} />
              </div>
            </>
          )}
          {tab === 'Editorial Feedback' && (
            <div style={{ gridColumn: 'span 2' }}>
              <label>Article to Review</label>
              <textarea value={existing} onChange={e => setExisting(e.target.value)} rows={10} />
            </div>
          )}
        </div>

        {/* Research context badge — only shows when the opportunity came
            from Topic Research. Lets the operator drop the context if they
            want a pure manual run without ranking hints. */}
        {researchContext && (
          <div style={{
            marginTop: 12,
            padding: 10,
            background: 'color-mix(in srgb, ' + ACCENT + ' 10%, var(--surface-2))',
            border: '1px solid color-mix(in srgb, ' + ACCENT + ' 40%, var(--border))',
            borderLeft: '3px solid ' + ACCENT,
            borderRadius: 'var(--radius)',
            fontSize: 12
          }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={{ color: ACCENT }}>Ranking-aware generation enabled</strong>
              <button onClick={() => setResearchContext(null)} style={{ fontSize: 10, padding: '3px 8px' }}>
                Drop context
              </button>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              Writing for <strong>{researchContext.primary_keyword}</strong> · currently{' '}
              <strong>position {researchContext.current_position ?? '—'}</strong> with{' '}
              {(researchContext.current_impressions || 0).toLocaleString()} impressions · type:{' '}
              {researchContext.opportunity_type}
              {researchContext.related_queries?.length > 0 && ` · ${researchContext.related_queries.length} related queries folded in`}
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {client ? `Brand preset: ${client.name}` : 'No client selected'}
          </div>
          <button className="primary" onClick={run} disabled={running || !client} style={{ background: ACCENT, borderColor: ACCENT }}>
            {running ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
      </div>

      {output && <ParsedOutput
        output={output}
        topic={topic}
        pushItem={pushItem}
        exportTxt={exportTxt}
        exportDocx={exportDocx}
        systemPrompt={lastSystem}
        userPrompt={lastUserPrompt}
        onOutputUpdate={setOutput}
      />}

      {scores && (
        <div className="card">
          <strong>QA Scoring</strong>
          <div className="grid-4" style={{ marginTop: 12 }}>
            {SCORE_KEYS.map(([k, label]) => (
              <div className="qa-card" key={k}>
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
                <div className="qa-score">{scores[k] ?? '—'}<span className="muted" style={{ fontSize: 12 }}>/10</span></div>
              </div>
            ))}
            <div className="qa-card" style={{ borderColor: ACCENT }}>
              <div className="muted" style={{ fontSize: 11 }}>Overall</div>
              <div className="qa-score" style={{ color: ACCENT }}>{scores.overall ?? '—'}<span className="muted" style={{ fontSize: 12 }}>/100</span></div>
            </div>
          </div>
          {Array.isArray(scores.suggestions) && (
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Improvement Suggestions</div>
              <ul>{scores.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
