import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream } from '../../lib/anthropic.js';
import { addToCmsQueue } from '../../lib/supabase.js';
import {
  buildSystemPrompt,
  buildNewArticleUserPrompt,
  buildRewritePrompt,
  buildMetadataPrompt,
  buildEditorialPrompt,
  QA_PROMPT,
} from './prompts.js';

const ACCENT = '#c8ff00';

const HISTORY_KEY = 'syte-suite:content-history';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 100)));
}

function parseQa(text) {
  const grab = (label) => {
    const r = new RegExp(`${label}[:\\s]*([0-9]+)\\/(10|100)`, 'i');
    const m = text.match(r);
    return m ? { score: +m[1], max: +m[2] } : null;
  };
  return {
    keyword: grab('Keyword Integration'),
    headings: grab('Heading Structure'),
    readability: grab('Readability'),
    aeo: grab('AEO Readiness'),
    geo: grab('GEO Authority'),
    eeat: grab('E-E-A-T Signals'),
    visual: grab('Visual Aids'),
    linking: grab('Internal Linking'),
    overall: grab('Overall'),
  };
}

function downloadTxt(name, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadDocx(name, content) {
  try {
    const htmlDocx = await import('html-docx-js/dist/html-docx');
    const html = `<!doctype html><html><body><pre>${content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre></body></html>`;
    const blob = htmlDocx.asBlob(html);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    downloadTxt(name.replace(/\.docx$/, '.txt'), content);
  }
}

function extractMetaSection(text) {
  // crude extraction of meta title/description/schema/faq for CMS queue
  const titleMatch = text.match(/Meta Title[:\s]*([^\n]+)/i);
  const descMatch = text.match(/Meta Description[:\s]*([^\n]+)/i);
  const schemaMatch = text.match(/```json\s*([\s\S]+?)```/);
  const faqMatch = text.match(/FAQ[\s\S]*?(?=QA SCORECARD|$)/i);
  return {
    meta_title: titleMatch?.[1]?.trim(),
    meta_description: descMatch?.[1]?.trim(),
    schema_jsonld: schemaMatch?.[1]?.trim(),
    faq: faqMatch?.[0]?.trim(),
  };
}

function Generator({ tab, client }) {
  const [topic, setTopic] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [secondaryKeywords, setSecondaryKeywords] = useState('');
  const [wordTarget, setWordTarget] = useState('1500-2000');
  const [notes, setNotes] = useState('');
  const [original, setOriginal] = useState('');
  const [goal, setGoal] = useState('');
  const [pageContent, setPageContent] = useState('');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [qa, setQa] = useState(null);
  const [queueMsg, setQueueMsg] = useState('');

  async function run() {
    if (!client) {
      alert('Select a client first.');
      return;
    }
    setStreaming(true);
    setOutput('');
    setQa(null);
    setQueueMsg('');

    const system = buildSystemPrompt(client) + '\n\n' + QA_PROMPT;
    let userPrompt = '';
    if (tab === 'New Article') {
      userPrompt = buildNewArticleUserPrompt({
        topic,
        primaryKeyword,
        secondaryKeywords,
        wordTarget,
        notes,
      });
    } else if (tab === 'Rewrite & Expand') {
      userPrompt = buildRewritePrompt({ original, goal });
    } else if (tab === 'Metadata & Schema') {
      userPrompt = buildMetadataPrompt({ pageContent, primaryKeyword });
    } else if (tab === 'Editorial Feedback') {
      userPrompt = buildEditorialPrompt({ content: pageContent || original });
    }

    try {
      const full = await claudeStream({
        system,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 6000,
        temperature: 0.7,
        onDelta: (d) => setOutput((prev) => prev + d),
      });
      setQa(parseQa(full));
      const hist = loadHistory();
      hist.unshift({
        id: Date.now(),
        client_id: client.id,
        client_name: client.name,
        tab,
        topic: topic || goal || 'metadata',
        output: full,
        created_at: new Date().toISOString(),
      });
      saveHistory(hist);
    } catch (e) {
      setOutput((prev) => prev + `\n\n[ERROR] ${e.message}`);
    } finally {
      setStreaming(false);
    }
  }

  async function queueForCms() {
    if (!client || !output) return;
    const meta = extractMetaSection(output);
    const items = [];
    if (meta.meta_title || meta.meta_description) {
      items.push({
        client_id: client.id,
        module: 'content',
        page_url: topic || pageContent?.slice(0, 80) || '',
        page_title: meta.meta_title || topic || 'Untitled',
        change_type: 'meta',
        payload: {
          meta_title: meta.meta_title,
          meta_description: meta.meta_description,
        },
        status: 'pending',
      });
    }
    if (meta.schema_jsonld) {
      items.push({
        client_id: client.id,
        module: 'content',
        page_url: topic || '',
        page_title: meta.meta_title || topic || 'Schema',
        change_type: 'schema',
        payload: { jsonld: meta.schema_jsonld },
        status: 'pending',
      });
    }
    if (meta.faq) {
      items.push({
        client_id: client.id,
        module: 'content',
        page_url: topic || '',
        page_title: meta.meta_title || topic || 'FAQ',
        change_type: 'faq',
        payload: { faq: meta.faq },
        status: 'pending',
      });
    }
    if (!items.length) {
      setQueueMsg('Nothing detected to queue.');
      return;
    }
    try {
      await addToCmsQueue(items);
      setQueueMsg(`Queued ${items.length} items for CMS Push.`);
    } catch (e) {
      setQueueMsg(`Queue failed: ${e.message}`);
    }
  }

  return (
    <div className="stack">
      {tab === 'New Article' && (
        <div className="card stack">
          <div className="grid-2">
            <div>
              <label>Topic</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} />
            </div>
            <div>
              <label>Primary Keyword</label>
              <input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} />
            </div>
            <div>
              <label>Secondary Keywords</label>
              <input value={secondaryKeywords} onChange={(e) => setSecondaryKeywords(e.target.value)} />
            </div>
            <div>
              <label>Target Length</label>
              <input value={wordTarget} onChange={(e) => setWordTarget(e.target.value)} />
            </div>
          </div>
          <div>
            <label>Notes / Angle</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      )}
      {tab === 'Rewrite & Expand' && (
        <div className="card stack">
          <div>
            <label>Rewrite Goal</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div>
            <label>Original Content</label>
            <textarea
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              style={{ minHeight: 240 }}
            />
          </div>
        </div>
      )}
      {tab === 'Metadata & Schema' && (
        <div className="card stack">
          <div>
            <label>Primary Keyword</label>
            <input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} />
          </div>
          <div>
            <label>Page Content (paste URL body or draft)</label>
            <textarea
              value={pageContent}
              onChange={(e) => setPageContent(e.target.value)}
              style={{ minHeight: 240 }}
            />
          </div>
        </div>
      )}
      {tab === 'Editorial Feedback' && (
        <div className="card stack">
          <div>
            <label>Content to Review</label>
            <textarea
              value={pageContent}
              onChange={(e) => setPageContent(e.target.value)}
              style={{ minHeight: 240 }}
            />
          </div>
        </div>
      )}

      <div className="row">
        <button className="primary" onClick={run} disabled={streaming} style={{ background: ACCENT, borderColor: ACCENT }}>
          {streaming ? 'Generating…' : 'Generate'}
        </button>
        {output && (
          <>
            <button onClick={() => downloadTxt('article.txt', output)}>Export .txt</button>
            <button onClick={() => downloadDocx('article.docx', output)}>Export .docx</button>
            <button onClick={queueForCms}>Queue for CMS Push</button>
            {queueMsg && <span className="muted" style={{ fontSize: 12 }}>{queueMsg}</span>}
          </>
        )}
      </div>

      {output && <pre className="output">{output}</pre>}

      {qa && qa.overall && (
        <div className="card">
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            QA Scorecard
          </div>
          <div className="grid-3">
            {[
              ['Keyword', qa.keyword],
              ['Headings', qa.headings],
              ['Readability', qa.readability],
              ['AEO', qa.aeo],
              ['GEO', qa.geo],
              ['E-E-A-T', qa.eeat],
              ['Visuals', qa.visual],
              ['Linking', qa.linking],
              ['Overall', qa.overall],
            ].map(([label, v]) => (
              <div key={label} style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 'var(--radius)' }}>
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
                <div style={{ fontSize: 20, color: ACCENT }}>
                  {v ? `${v.score}/${v.max}` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ client }) {
  const [hist, setHist] = useState([]);
  useEffect(() => {
    setHist(loadHistory().filter((h) => !client || h.client_id === client.id));
  }, [client]);

  if (!hist.length) return <div className="muted">No history yet.</div>;
  return (
    <div className="stack">
      {hist.map((h) => (
        <div key={h.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{h.topic}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {h.client_name} · {h.tab} · {new Date(h.created_at).toLocaleString()}
              </div>
            </div>
            <button onClick={() => downloadTxt(`${h.topic}.txt`, h.output)}>Export</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ContentEngine({ tab }) {
  const { getSelected } = useClients();
  const client = getSelected();

  return (
    <div>
      <h1 className="h1-title">Content Engine</h1>
      <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        {client ? `Writing for ${client.name}` : 'Select a client to load brand presets.'}
      </div>
      {tab === 'History' ? <HistoryTab client={client} /> : <Generator tab={tab} client={client} />}
    </div>
  );
}
