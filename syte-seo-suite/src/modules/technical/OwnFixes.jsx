import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { supabase, saveTseoTasks, loadTseoTasks, addAeoOptimizations } from '../../lib/supabase.js';
import { OWN_FIXES_SYSTEM, OWN_SOURCE, normaliseOwnFixes, additionsByPage, ownOptKey, clientOrigin } from './ownFixes.js';
import ApplyFixControls from './ApplyFixControls.jsx';
import AddAeoControls from '../aeo/AddAeoControls.jsx';

// Technical SEO → Own Fixes. Chris (29 Oct 2026): "I'll generate the
// optimisations and give it to the tool, and it just runs them." Paste or
// type the changes for a client; the AI turns them into items in the shapes
// the suite applies (ownFixes.js); each is saved and gets the same
// Preview → Apply → Undo controls as everything else.
const ACCENT = '#ff6b35';

export default function OwnFixes() {
  const client = useClients(s => s.current());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [draft, setDraft] = useState(null);   // normalised, not yet saved
  const [saved, setSaved] = useState({ fixes: [], additions: [] });

  async function loadSaved() {
    if (!client) { setSaved({ fixes: [], additions: [] }); return; }
    const [tasks, { data: rows }] = await Promise.all([
      loadTseoTasks().catch(() => []),
      supabase ? supabase.from('syte_suite_aeo_results').select('url, optimizations').eq('client_id', client.id) : Promise.resolve({ data: [] })
    ]);
    const fixes = (tasks || []).filter(t => t.client_id === client.id && t.data_source === OWN_SOURCE)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const additions = (rows || []).flatMap(r => (r.optimizations || []).filter(o => o?.own).map(opt => ({ url: r.url, opt })));
    setSaved({ fixes, additions });
  }
  useEffect(() => { setDraft(null); setErr(''); setMsg(''); loadSaved(); }, [client?.id]);

  async function turnIntoFixes() {
    if (!client) { setErr('Select a client first.'); return; }
    if (!text.trim()) { setErr('Write or paste the optimisations first.'); return; }
    setBusy(true); setErr(''); setMsg(''); setDraft(null);
    try {
      const raw = await claudeComplete({
        system: OWN_FIXES_SYSTEM,
        messages: [{ role: 'user', content: 'Client: ' + client.name + '\nWebsite: ' + (clientOrigin(client) || '(unknown)') + '\n\nNOTES:\n' + text }],
        max_tokens: 4000, temperature: 0
      });
      const parsed = extractJSON(raw);
      if (!parsed) throw new Error('The AI did not return a usable list — try again, or make the notes more specific.');
      const n = normaliseOwnFixes(parsed, client);
      setDraft(n);
      if (!n.fixes.length && !n.additions.length) setMsg('Nothing in those notes can be applied automatically yet — see the reasons below.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!draft || !client) return;
    setBusy(true); setErr('');
    try {
      if (draft.fixes.length) await saveTseoTasks(draft.fixes);
      for (const { url, opts } of additionsByPage(draft.additions)) await addAeoOptimizations(client.id, url, opts);
      setMsg('Saved ' + draft.fixes.length + ' fix' + (draft.fixes.length === 1 ? '' : 'es') + ' and ' + draft.additions.length + ' addition' + (draft.additions.length === 1 ? '' : 's') + ' for ' + client.name + '. Preview each one, then apply it.');
      setDraft(null); setText('');
      await loadSaved();
    } catch (e) { setErr('Could not save: ' + e.message); }
    finally { setBusy(false); }
  }

  const fixCard = (t, controls) => (
    <div key={t.id} style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
      <div className="muted" style={{ fontSize: 11 }}>{t.fix_type.replace(/_/g, ' ')} · {t.page_url}</div>
      <pre style={{ background: 'var(--bg)', padding: 8, marginTop: 6, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{t.copy_paste_fix}</pre>
      {controls}
    </div>
  );
  const addCard = ({ url, opt }, controls) => (
    <div key={url + '|' + ownOptKey(opt)} style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.name} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· {opt.type} · {opt.where || 'end of the content'}</span></div>
      <div className="muted" style={{ fontSize: 11 }}>{url}</div>
      <pre style={{ background: 'var(--bg)', padding: 8, marginTop: 6, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{opt.implementation}</pre>
      {controls}
    </div>
  );

  return (
    <div className="content-area">
      <h2 style={{ marginTop: 0 }}>Own Fixes</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Write or paste the changes you want made on {client ? <strong>{client.name}</strong> : 'a client'}'s site — in plain words or HTML, with the page for each.
        The suite turns them into fixes it can apply (titles, descriptions, alt text, H1s, schema, canonical, robots, redirects) and sections it can add
        (answers, FAQs, takeaways, tables, schema blocks). You preview each one, then apply it; everything can be undone.
      </div>
      {!client && <div className="card" style={{ marginBottom: 14 }}>Select a client in the top bar first.</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <textarea rows={10} value={text} onChange={e => setText(e.target.value)} disabled={busy || !client}
          placeholder={'Examples:\n/about/ — meta title: Industrial Shelving & Racking in Johannesburg | Krost\n/racking/ — add an FAQ: What load can pallet racking take? … (3 questions)\nhttps://site.co.za/old-page/ — redirect to https://site.co.za/new-page/\n/products/ — the hero image (hero.jpg) alt text: Blue pallet racking in a warehouse'}
          style={{ width: '100%', fontSize: 12, fontFamily: 'inherit' }} />
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={turnIntoFixes} disabled={busy || !client || !text.trim()} style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}>
            {busy && !draft ? 'Reading your notes…' : 'Turn into fixes'}
          </button>
          {draft && (draft.fixes.length > 0 || draft.additions.length > 0) && (
            <button onClick={saveDraft} disabled={busy}>Save {draft.fixes.length + draft.additions.length} item{draft.fixes.length + draft.additions.length === 1 ? '' : 's'} for {client.name}</button>
          )}
          {draft && <button className="ghost" onClick={() => setDraft(null)} disabled={busy}>Discard</button>}
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}
        {msg && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 8 }}>{msg}</div>}
      </div>

      {draft && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Ready to save</strong>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Check these read as you meant. Nothing touches the site until you preview and apply each one.</div>
          {draft.fixes.map(t => fixCard(t, null))}
          {draft.additions.map(a => addCard(a, null))}
          {(draft.rejected.length > 0 || draft.notes.length > 0) && (
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 12, color: 'var(--orange, #e8a33d)' }}>Not turned into items</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 11 }}>
                {draft.rejected.map((r, i) => <li key={'r' + i} style={{ marginBottom: 2 }}><em>{r.item.title || r.item.name || r.item.fix_type || 'item'}</em> ({r.item.page_url || 'no page'}): {r.reason}</li>)}
                {draft.notes.map((n, i) => <li key={'n' + i} style={{ marginBottom: 2 }}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {client && (saved.fixes.length > 0 || saved.additions.length > 0) && (
        <div className="card">
          <strong>Your fixes for {client.name}</strong>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Fixes also appear on the Task Board; additions on the AEO Engine page for their page.</div>
          {saved.fixes.map(t => fixCard(t, <ApplyFixControls task={t} client={client} accent={ACCENT} />))}
          {saved.additions.map(a => addCard(a, <AddAeoControls client={client} url={a.url} optKey={ownOptKey(a.opt)} accent={ACCENT} />))}
        </div>
      )}
    </div>
  );
}
