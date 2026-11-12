// "What we do for you every month": the standing monthly scope of work shown
// on the client report. This is the retainer, not this month's tally (that is
// workDone in the SEO report), so it is deterministic: never written by
// Claude, so it can't invent deliverables.
//
// Each client can override it per report (monthly_scope_seo /
// monthly_scope_aeo, one item per line, "Title: description"). When a field
// is empty the standard scope below is built from the client's settings,
// listing only the services the client actually buys.

const ENGINE_NAMES = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' };

function joinNames(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

function competitorCount(client) {
  return String(client?.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean).length;
}

// Services default to on unless explicitly switched off (suite convention).
const has = (client, flag) => client?.[flag] !== false;

// probe: optional normalized AEO snapshot, so the census line quotes the real
// prompt and engine counts that the rest of the report shows.
export function defaultScope(client, kind, probe = null) {
  const items = [];
  if (kind === 'aeo') {
    const engines = (probe?.engines_used || []).map(e => ENGINE_NAMES[e] || e);
    const prompts = probe?.scorable_probes || probe?.queries_count || 0;
    const runs = probe?.iterations || 0;
    items.push({
      title: 'AI visibility tracking',
      detail: prompts && engines.length
        ? `${prompts} real buyer prompts tested on ${joinNames(engines)}${runs > 1 ? `, each asked ${runs} times` : ''}, to measure how often AI engines name and recommend you.`
        : 'Your full set of buyer prompts tested across the major AI engines, to measure how often they name and recommend you.'
    });
    const comps = competitorCount(client);
    items.push({
      title: 'Competitor benchmarking',
      detail: comps
        ? `Your share of voice, sentiment and position tracked against ${comps} competitor${comps > 1 ? 's' : ''} in your category.`
        : 'Your share of voice, sentiment and position tracked against the competitors AI engines name in your category.'
    });
    items.push({
      title: 'Citation gap analysis',
      detail: 'The websites AI engines cite when they recommend competitors, mapped into a list of placements for you to win.'
    });
    if (has(client, 'does_aeo')) {
      const n = Number(client?.aeo_items_per_month) || 10;
      items.push({
        title: 'On-site AEO optimisation',
        detail: `${n} answer-ready improvements to your priority pages (direct answers, FAQs and structured data) so AI engines can quote you.`
      });
    }
    items.push({
      title: 'Monthly AEO report',
      detail: 'This report: every prompt, engine and metric compared month on month.'
    });
  } else {
    if (has(client, 'does_content')) {
      const n = Number(client?.pages_per_month) || 4;
      items.push({
        title: 'Content',
        detail: `${n} SEO article${n > 1 ? 's' : ''} researched from your Search Console data, written in your brand voice and published to your site.`
      });
    }
    if (has(client, 'does_technical')) {
      items.push({
        title: 'Technical SEO',
        detail: 'A full crawl of your site, with technical issues prioritised and fixed or handed to your developer.'
      });
    }
    items.push({
      title: 'Rankings and search monitoring',
      detail: 'Keyword positions, clicks and impressions tracked in Google Search Console, with dips investigated.'
    });
    items.push({
      title: 'Monthly SEO report',
      detail: 'This report: traffic, rankings and the work delivered, compared month on month.'
    });
  }
  return items;
}

// "Title: description" per line; a line with no colon is a title only.
export function parseScope(text) {
  return String(text || '').split('\n').map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean).map(l => {
    const i = l.indexOf(':');
    if (i <= 0) return { title: l, detail: '' };
    return { title: l.slice(0, i).trim(), detail: l.slice(i + 1).trim() };
  }).filter(it => it.title);
}

export function formatScope(items) {
  return (items || []).map(it => it.detail ? `${it.title}: ${it.detail}` : it.title).join('\n');
}

export function scopeField(kind) {
  return kind === 'aeo' ? 'monthly_scope_aeo' : 'monthly_scope_seo';
}

// The items the report shows: the client's own list when set, otherwise the
// standard scope.
export function monthlyScopeFor(client, kind, probe = null) {
  const custom = parseScope(client?.[scopeField(kind)]);
  return custom.length ? custom : defaultScope(client, kind, probe);
}
