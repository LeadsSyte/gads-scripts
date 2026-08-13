// Monthly optimization export — bundles everything the team produced for a
// given month into a single ZIP a developer can implement from:
//   • Blog articles (Content Engine)            -> articles/*.html
//   • Technical SEO fixes (Technical SEO)       -> technical-seo-fixes.txt
//   • AEO quick optimizations (AEO Engine)      -> aeo-optimizations.txt
//   • AEO deep page rewrites (AEO Engine)       -> aeo-optimizations.txt
//
// Grouped per client so each client folder is self-contained.

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  listBlogResults,
  loadTseoTasks,
  loadAeoResults,
  listDeepResults
} from './supabase.js';

// 'YYYY-MM' for a date-ish value (ISO string). Empty string if unparseable.
function monthKeyOf(v) {
  const s = (v || '').toString();
  return s.length >= 7 ? s.slice(0, 7) : '';
}

// Turn "October 2026 Guide!" into "october-2026-guide" for filenames.
function slugify(s) {
  return (s || 'untitled')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

// Safe, still-readable folder name for a client.
function safeName(s) {
  return (s || 'client').toString().replace(/[\/\\:*?"<>|]+/g, '-').trim() || 'client';
}

function indent(text, pad = '     ') {
  return (text || '').toString().split('\n').map(l => pad + l).join('\n');
}

const RULE = '   ' + '-'.repeat(64);

// Gather every optimization produced in `monthKey` (YYYY-MM), optionally for a
// single client. Returns data grouped by client plus totals for a preview.
export async function collectMonthlyOptimizations({ monthKey, clientId = null, clients = [] } = {}) {
  const nameById = {};
  for (const c of clients) nameById[c.id] = c.name;

  const [blogs, tseo, aeoObj, deep] = await Promise.all([
    listBlogResults().catch(() => []),
    loadTseoTasks().catch(() => []),
    loadAeoResults().catch(() => ({})),
    listDeepResults().catch(() => [])
  ]);

  const inMonth = (v) => monthKeyOf(v) === monthKey;
  const forClient = (cid) => !clientId || cid === clientId;

  const articles = (blogs || []).filter(b =>
    forClient(b.client_id) &&
    inMonth(b.generated_at || b.created_at) &&
    (b.output || '').trim().length > 0   // skip manually-logged rows with no body
  );

  const techFixes = (tseo || []).filter(t =>
    forClient(t.client_id) && inMonth(t.created_at)
  );

  const aeoQuick = Object.values(aeoObj || {}).filter(r =>
    forClient(r.client_id) &&
    inMonth(r.generated_at) &&
    Array.isArray(r.optimizations) && r.optimizations.length > 0
  );

  const aeoDeep = (deep || []).filter(d =>
    forClient(d.client_id) && inMonth(d.generated_at)
  );

  // Group everything by client_id.
  const byClient = {};
  const ensure = (cid, cname) => {
    if (!byClient[cid]) {
      byClient[cid] = {
        client_id: cid,
        client_name: nameById[cid] || cname || 'Unknown client',
        articles: [], techFixes: [], aeoQuick: [], aeoDeep: []
      };
    }
    return byClient[cid];
  };

  for (const a of articles) ensure(a.client_id, a.client_name).articles.push(a);
  for (const t of techFixes) ensure(t.client_id, t.client_name).techFixes.push(t);
  for (const r of aeoQuick) ensure(r.client_id).aeoQuick.push(r);
  for (const d of aeoDeep) ensure(d.client_id, d.client_name).aeoDeep.push(d);

  const groups = Object.values(byClient).sort((a, b) =>
    a.client_name.localeCompare(b.client_name)
  );

  const totals = {
    clients: groups.length,
    articles: articles.length,
    techFixes: techFixes.length,
    aeoQuick: aeoQuick.reduce((n, r) => n + r.optimizations.length, 0),
    aeoDeep: aeoDeep.length
  };
  totals.grandTotal = totals.articles + totals.techFixes + totals.aeoQuick + totals.aeoDeep;

  return { groups, totals };
}

// ---- text formatters -------------------------------------------------------

function fmtTechFixes(clientName, monthLabel, tasks) {
  const out = [];
  out.push(`TECHNICAL SEO FIXES — ${clientName} — ${monthLabel}`);
  out.push('='.repeat(70));
  out.push(`${tasks.length} fix(es). Each includes the page and a copy-paste-ready change.`);
  out.push('');
  tasks.forEach((t, i) => {
    out.push(`${i + 1}. [${(t.priority || 'normal').toString().toUpperCase()}] ${t.title || 'Untitled fix'}`);
    if (t.page_url) out.push(`   Page:   ${t.page_url}`);
    const meta = [
      t.fix_type && `type: ${t.fix_type}`,
      t.impact && `impact: ${t.impact}`,
      t.effort && `effort: ${t.effort}`,
      t.status && `status: ${t.status}`
    ].filter(Boolean).join('  ·  ');
    if (meta) out.push(`   ${meta}`);
    if (t.description) out.push(`   Problem: ${t.description}`);
    if (t.copy_paste_fix) {
      out.push('   Fix (copy-paste):');
      out.push(indent(t.copy_paste_fix));
    }
    out.push('');
    out.push(RULE);
    out.push('');
  });
  return out.join('\n');
}

function fmtAeo(clientName, monthLabel, quick, deep) {
  const out = [];
  out.push(`AEO OPTIMIZATIONS — ${clientName} — ${monthLabel}`);
  out.push('='.repeat(70));
  out.push('AI-search optimizations: content blocks and schema to add to each page.');
  out.push('');

  if (quick.length) {
    out.push('── PER-PAGE OPTIMIZATION BLOCKS ──');
    out.push('');
    quick.forEach((r) => {
      out.push(`PAGE: ${r.url || r.path || '(page)'}`);
      (r.optimizations || []).forEach((o, i) => {
        const title = o.name || o.title || 'Optimization';
        const type = o.type || '';
        out.push(`  [${i + 1}] ${title}${type ? ' (' + type + ')' : ''}`);
        if (o.description) out.push(`      Why: ${o.description}`);
        const where = o.where || o.placement;
        if (where) out.push(`      Placement: ${where}`);
        const code = o.implementation || o.code;
        if (code) {
          out.push('      Code (copy-paste):');
          out.push(indent(code, '        '));
        }
        out.push('');
      });
      out.push(RULE);
      out.push('');
    });
  }

  if (deep.length) {
    out.push('── DEEP PAGE REWRITES ──');
    out.push('');
    deep.forEach((d) => {
      out.push(`PAGE: ${d.pageUrl || '(page)'}${d.pageTitle ? '  —  ' + d.pageTitle : ''}`);
      if (d.description) {
        out.push('  New meta description / intro:');
        out.push(indent(d.description, '    '));
      }
      if (d.faq) {
        out.push('  FAQ content:');
        out.push(indent(d.faq, '    '));
      }
      if (d.faqSchema) {
        out.push('  FAQ schema (JSON-LD):');
        out.push(indent(d.faqSchema, '    '));
      }
      if (d.productSchema) {
        out.push('  Product schema (JSON-LD):');
        out.push(indent(d.productSchema, '    '));
      }
      if (Array.isArray(d.internalLinks) && d.internalLinks.length) {
        out.push('  Internal links to add:');
        d.internalLinks.forEach(l => {
          const line = typeof l === 'string' ? l : (l.anchor ? `${l.anchor} -> ${l.url || ''}` : JSON.stringify(l));
          out.push('    - ' + line);
        });
      }
      out.push('');
      out.push(RULE);
      out.push('');
    });
  }

  return out.join('\n');
}

function fmtArticleIndex(clientName, monthLabel, articles) {
  const out = [];
  out.push(`ARTICLES — ${clientName} — ${monthLabel}`);
  out.push('='.repeat(70));
  articles.forEach((a, i) => {
    out.push(`${i + 1}. ${a.topic || a.keyword || 'Untitled'}`);
    if (a.keyword) out.push(`   Keyword: ${a.keyword}`);
    const approxWords = Math.round((a.output || '').length / 6);
    out.push(`   File: ${String(i + 1).padStart(2, '0')}-${slugify(a.topic || a.keyword)}.html  (~${approxWords} words)`);
    out.push('');
  });
  return out.join('\n');
}

// ---- ZIP builder -----------------------------------------------------------

export async function buildMonthlyZipBlob({ monthKey, monthLabel, scopeLabel, groups, totals }) {
  const zip = new JSZip();
  const generatedAt = new Date().toISOString();

  // Top-level README.
  const readme = [
    'Syte SEO Suite — Monthly Optimization Package',
    '='.repeat(70),
    `Month:      ${monthLabel}`,
    `Scope:      ${scopeLabel}`,
    `Generated:  ${generatedAt}`,
    '',
    'SUMMARY',
    `  Clients:            ${totals.clients}`,
    `  Blog articles:      ${totals.articles}`,
    `  Technical SEO fixes:${' '.repeat(1)} ${totals.techFixes}`,
    `  AEO optimizations:  ${totals.aeoQuick}`,
    `  AEO deep rewrites:  ${totals.aeoDeep}`,
    '',
    "WHAT'S INSIDE",
    '  Each client has its own folder containing only what was produced this month:',
    '    • articles/                 new blog posts as ready-to-publish HTML',
    '    • technical-seo-fixes.txt   meta / schema / on-page fixes with copy-paste code',
    '    • aeo-optimizations.txt     AI-search content blocks + schema to add per page',
    '',
    'HOW TO IMPLEMENT',
    '  1. Technical SEO fixes: apply each per its Page URL. Fixes are copy-paste ready.',
    '  2. AEO optimizations: paste each block at the noted placement on its page.',
    '  3. Articles: publish each HTML file as a new post (strip the QA JSON block at',
    '     the end first — it is an internal quality score, not for publishing).',
    '  Nothing here is applied automatically. Review before publishing.',
    '',
    'PER-CLIENT BREAKDOWN',
    ...groups.map(g =>
      `  ${g.client_name}: ${g.articles.length} articles, ${g.techFixes.length} technical fixes, ` +
      `${g.aeoQuick.reduce((n, r) => n + (r.optimizations?.length || 0), 0)} AEO blocks, ${g.aeoDeep.length} deep rewrites`
    )
  ].join('\n');
  zip.file('README.txt', readme);

  // Machine-readable manifest.
  zip.file('manifest.json', JSON.stringify({
    month: monthKey,
    month_label: monthLabel,
    scope: scopeLabel,
    generated_at: generatedAt,
    totals,
    clients: groups.map(g => ({
      client: g.client_name,
      articles: g.articles.map(a => ({ topic: a.topic, keyword: a.keyword, generated_at: a.generated_at })),
      technical_fixes: g.techFixes.length,
      aeo_optimizations: g.aeoQuick.reduce((n, r) => n + (r.optimizations?.length || 0), 0),
      aeo_deep_rewrites: g.aeoDeep.length
    }))
  }, null, 2));

  for (const g of groups) {
    const folder = zip.folder(safeName(g.client_name));

    if (g.techFixes.length) {
      folder.file('technical-seo-fixes.txt', fmtTechFixes(g.client_name, monthLabel, g.techFixes));
    }
    if (g.aeoQuick.length || g.aeoDeep.length) {
      folder.file('aeo-optimizations.txt', fmtAeo(g.client_name, monthLabel, g.aeoQuick, g.aeoDeep));
    }
    if (g.articles.length) {
      const art = folder.folder('articles');
      art.file('_index.txt', fmtArticleIndex(g.client_name, monthLabel, g.articles));
      g.articles.forEach((a, i) => {
        const name = `${String(i + 1).padStart(2, '0')}-${slugify(a.topic || a.keyword)}.html`;
        const header =
          `<!-- ${a.topic || ''} | keyword: ${a.keyword || ''} | ${a.generated_at || ''} -->\n`;
        art.file(name, header + (a.output || ''));
      });
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

// Convenience: collect + build + trigger the browser download in one call.
export async function downloadMonthlyOptimizations({ monthKey, monthLabel, clientId = null, clients = [] }) {
  const { groups, totals } = await collectMonthlyOptimizations({ monthKey, clientId, clients });
  if (totals.grandTotal === 0) {
    throw new Error(`Nothing was produced in ${monthLabel} for this scope — nothing to export.`);
  }
  const scopeClient = clientId ? (clients.find(c => c.id === clientId)?.name || 'One client') : 'All clients';
  const blob = await buildMonthlyZipBlob({ monthKey, monthLabel, scopeLabel: scopeClient, groups, totals });
  const fname = `syte-optimizations-${monthKey}${clientId ? '-' + slugify(scopeClient) : ''}.zip`;
  saveAs(blob, fname);
  return totals;
}
