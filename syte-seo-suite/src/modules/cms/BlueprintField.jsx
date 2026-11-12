import React, { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { fnUrl } from '../../lib/fnUrl.js';

// "Article blueprint" in the Publishing Profile: how this client's own
// published articles are written, learned from their blog
// (netlify/functions/blueprint-learn-background.js) and editable here. The
// writer follows it for structure and tone; the client's rules always win.
// Edits are saved with "Save Profile" and are never replaced by a re-learn
// unless the team asks for it.
export default function BlueprintField({ client, profile, setP, disabled }) {
  const [state, setState] = useState('');   // '' | 'learning' | message
  const [error, setError] = useState('');
  const bp = profile.article_blueprint;

  const learn = async (force) => {
    if (!client?.id) return;
    setError(''); setState('learning');
    try {
      const startedAt = Date.now();
      const res = await fetch(fnUrl('blueprint-learn-background'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await (globalThis.__SYTE_AUTH_HEADERS?.() ?? {})) },
        body: JSON.stringify({ clientId: client.id, force: !!force })
      });
      if (res.status !== 202) throw new Error('The suite did not accept the request (' + res.status + ').');
      // The function answers before it runs; its result lands in the settings row.
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const { data } = await supabase.from('syte_suite_settings').select('data, updated_at').eq('id', 'blueprint:' + client.id).maybeSingle();
        const d = data?.data;
        if (!d || new Date(data.updated_at).getTime() < startedAt - 5000 || d.status === 'running') continue;
        if (d.status === 'done') { setP('article_blueprint', d.blueprint); setState('Learned from ' + d.blueprint.sources.length + ' published articles. Already saved.'); return; }
        if (d.status === 'skipped') { setState(''); setError(d.reason + ' Use "Learn again (replace my edits)" to replace it.'); return; }
        throw new Error(d.reason || d.error || 'It did not finish.');
      }
      throw new Error('Still running after a few minutes. Reload the page later to see the result.');
    } catch (e) {
      setState(''); setError(String(e.message || e));
    }
  };

  const edit = text => setP('article_blueprint', { ...(bp || { sources: [] }), text, edited_at: new Date().toISOString() });

  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ margin: 0 }}>Article blueprint</label>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        How this client's own published articles are written: structure, headings, tone, recurring elements. The suite learns it
        from the articles on their blog (never from ones it wrote itself), and every new article and rewrite follows it. Correct
        anything that is wrong; the client's content rules always win over it.
      </div>
      {bp?.text ? (
        <>
          <textarea rows={12} value={bp.text} disabled={disabled} onChange={e => edit(e.target.value)}
            aria-label="Article blueprint" style={{ width: '100%', fontSize: 12, marginTop: 6 }} />
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {bp.learned_at ? 'Learned ' + String(bp.learned_at).slice(0, 10) + ' from ' + (bp.sources || []).length + ' articles' : 'Written by the team'}
            {bp.edited_at ? ' · edited ' + String(bp.edited_at).slice(0, 10) + ' (click Save Profile to keep an edit)' : ''}
            {(bp.sources || []).length > 0 && (
              <details style={{ marginTop: 2 }}>
                <summary style={{ cursor: 'pointer' }}>Articles it was learned from</summary>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {bp.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</li>)}
                </ul>
              </details>
            )}
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>None yet. Articles follow the brand scan and content rules only.</div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <button className="ghost" style={{ fontSize: 11, padding: '3px 10px' }} disabled={disabled || state === 'learning'}
          onClick={() => learn(!!bp?.edited_at)}>
          {state === 'learning' ? 'Reading their articles…' : bp?.text ? (bp.edited_at ? 'Learn again (replace my edits)' : 'Learn again') : 'Learn from their published articles'}
        </button>
        {bp?.text && (
          <button className="ghost" style={{ fontSize: 11, padding: '3px 10px' }} disabled={disabled}
            onClick={() => setP('article_blueprint', null)}>Remove</button>
        )}
      </div>
      {state && state !== 'learning' && <div style={{ fontSize: 11, marginTop: 4 }}>✓ {state}</div>}
      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
