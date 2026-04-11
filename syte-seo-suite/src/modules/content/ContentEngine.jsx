import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream, extractJSON } from '../../lib/anthropic.js';
import { buildSystemPrompt, TAB_PROMPTS } from './prompts.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import ClientCardsGrid from '../../components/ClientCardsGrid.jsx';
import TopicResearch from './TopicResearch.jsx';

const ACCENT = '#c8ff00';
const HISTORY_KEY = 'syte-suite-content-history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); }

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Minimal .docx export — wraps HTML in a Word-compatible XML envelope.
function exportDocx(html, filename) {
  const src = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"></head><body>${html}</body></html>`;
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

  const tab = sub || 'Topic Research';
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
    let userPrompt;
    switch (tab) {
      case 'Rewrite & Expand':    userPrompt = TAB_PROMPTS['Rewrite & Expand'](existing, keyword, length); break;
      case 'Metadata & Schema':   userPrompt = TAB_PROMPTS['Metadata & Schema'](url, topic, keyword); break;
      case 'Editorial Feedback':  userPrompt = TAB_PROMPTS['Editorial Feedback'](existing); break;
      default:                    userPrompt = TAB_PROMPTS['New Article'](topic, keyword, length);
    }

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
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Content History</h2>
        {history.length === 0 && <div className="muted">No generations yet.</div>}
        {history.map(h => (
          <div key={h.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{h.topic || h.keyword || h.tab}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {h.client_name} · {h.tab} · {new Date(h.created_at).toLocaleString()}
                </div>
              </div>
              <div className="row">
                <button onClick={() => exportTxt(h.output, h.topic || 'article')}>.txt</button>
                <button onClick={() => exportDocx(h.output, h.topic || 'article')}>.docx</button>
              </div>
            </div>
          </div>
        ))}
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

      {output && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <strong>Output</strong>
            <div className="row">
              <button onClick={() => exportTxt(output, topic || 'article')}>Export .txt</button>
              <button onClick={() => exportDocx(output, topic || 'article')}>Export .docx</button>
              {pushItem && <PushToCmsButton item={pushItem} />}
            </div>
          </div>
          <div className="stream-output">{output}</div>
        </div>
      )}

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
