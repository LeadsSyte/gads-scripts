// Fix sheet: one brief per client of the Technical SEO and AEO work the
// suite can't apply itself — for a developer, or to paste into a Grok Bot.
// Each item says what's wrong, exactly what to change, where to change it,
// and how to check it's done. Items the suite CAN apply (Preview → Apply in
// the Tech / AEO Autopilot panels) are left out so nothing is done twice.
// Pure; rendered by netlify/functions/fix-sheet.js and in the suite.

// Kept in step with netlify/functions/lib/techFix.js AUTO_FIX_TYPES.
const TECH_AUTO = ['meta_title', 'meta_description', 'image_alt'];

const WHERE = {
  wordpress: {
    meta_title: 'The SEO plugin box on that page (Yoast / Rank Math → SEO title).',
    meta_description: 'The SEO plugin box on that page (Yoast / Rank Math → Meta description).',
    image_alt: 'Media Library → the image → "Alternative Text" (and the image block on the page, if it was inserted in the content).',
    h1: 'The page or post template: the theme (Appearance → Theme File Editor / child theme) or the page builder\'s theme template (e.g. Elementor → Templates → Theme Builder).',
    canonical: 'SEO plugin → Advanced → Canonical URL on that page.',
    robots: 'SEO plugin → Advanced → allow search engines to index; also Settings → Reading → "Discourage search engines" must be off, and the SEO plugin\'s robots.txt editor.',
    redirect: 'A redirect plugin (e.g. Redirection / Rank Math → Redirections) or the hosting control panel.',
    schema: 'SEO plugin → Schema tab on that page, or a header/footer code plugin for site-wide schema.',
    structured_data: 'SEO plugin → Schema tab on that page, or a header/footer code plugin for site-wide schema.',
    internal_link: 'Edit the page content and add the link at the spot described.',
    sitemap: 'SEO plugin → Sitemaps settings.',
    page_speed: 'Caching / image optimisation plugin and hosting — usually a developer task.',
    aeo_content: 'Edit the page (in its page builder if it uses one) and add a Text / HTML block at the place described.',
    aeo_schema: 'SEO plugin → Schema tab on that page, or a Custom HTML block at the end of the page content.',
    aeo_structure: 'Edit the page content and make the change described.'
  },
  shopify: {
    meta_title: 'Shopify admin → the page/product/article → "Search engine listing" → Page title.',
    meta_description: 'Shopify admin → the page/product/article → "Search engine listing" → Description.',
    image_alt: 'Shopify admin → the product/article image → "Add alt text".',
    h1: 'Online Store → Themes → Edit code → the template for that page type.',
    aeo_content: 'Edit the page/article content in Shopify admin and add the section at the place described.',
    aeo_schema: 'Online Store → Themes → Edit code → add the JSON-LD to the template, or via a schema app.'
  },
  other: {}
};

const CHECK = {
  meta_title: 'Open the page, View Source (Ctrl+U), find <title> — it shows the new title.',
  meta_description: 'View Source, find name="description" — it shows the new text.',
  image_alt: 'Right-click the image → Inspect — the <img> has the new alt="…".',
  h1: 'View Source and search for "<h1" — there is exactly one, with the page\'s title.',
  canonical: 'View Source, find rel="canonical" — it points to the right URL.',
  robots: 'View Source has no "noindex"; yoursite/robots.txt doesn\'t block the page.',
  redirect: 'Open the old URL — it lands on the new one (a 301 redirect).',
  schema: 'Test the URL at search.google.com/test/rich-results — the schema is detected with no errors.',
  structured_data: 'Test the URL at search.google.com/test/rich-results — the schema is detected with no errors.',
  sitemap: 'Open the sitemap URL — it loads and lists the site\'s pages; Search Console shows it as "Success".',
  sitemap_submission: 'Search Console → Sitemaps shows the sitemap with status "Success".',
  page_speed: 'Re-test at pagespeed.web.dev — the score and the flagged metric improved.',
  aeo_content: 'Open the page — the new section is visible where described and reads correctly.',
  aeo_schema: 'Test the URL at search.google.com/test/rich-results — the schema is detected with no errors.'
};

const platformOf = client => (client?.cms_type === 'WordPress' ? 'wordpress' : client?.cms_type === 'Shopify' ? 'shopify' : 'other');

// Independent-check label the Tech Autopilot appends to a task description.
function techCheckFrom(description) {
  const d = String(description || '');
  if (/fix itself looks wrong/.test(d)) return { verdict: 'fix_wrong' };
  if (/Independent check: confirmed/.test(d)) return { verdict: 'confirmed', reason: (d.match(/confirmed — (.*)$/m) || [])[1] || '' };
  if (/needs a human look/.test(d)) return { verdict: 'needs_human', reason: (d.match(/needs a human look — (.*)$/m) || [])[1] || '' };
  return null;
}
const stripCheck = d => String(d || '').replace(/\n+[✓⚠?] Independent check:[\s\S]*$/, '').trim();

// techTasks: open syte_suite_tseo_tasks rows; techFixes: { taskId → techfix status };
// aeoRows: syte_suite_aeo_results rows; aeoFixes: { 'url|optKey' → aeofix status }.
export function buildFixSheet({ client, techTasks = [], techFixes = {}, aeoRows = [], aeoFixes = {}, now = new Date() }) {
  const platform = platformOf(client);
  const where = k => WHERE[platform][k] || WHERE.wordpress[k] || 'On the page described.';
  const items = [];
  let suiteCanDo = 0;
  const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  for (const t of techTasks) {
    if (t.status !== 'open') continue;
    const check = techCheckFrom(t.description);
    if (check?.verdict === 'fix_wrong') continue; // the reviewer thinks the fix is wrong — not for briefing
    const fix = techFixes[t.id];
    const auto = platform === 'wordpress' && TECH_AUTO.includes(t.fix_type);
    if (auto && fix?.status !== 'manual') { suiteCanDo++; continue; }
    items.push({
      source: 'Technical SEO', title: t.title, page_url: t.page_url, priority: t.priority || 'medium',
      problem: stripCheck(t.description), change: t.copy_paste_fix || '',
      where: where(t.fix_type) + (fix?.status === 'manual' && fix.reason ? ' (The suite couldn\'t do it: ' + fix.reason + ')' : ''),
      how_to_check: CHECK[t.fix_type] || 'Open the page and confirm the change is there.',
      check: check && check.verdict !== 'confirmed' ? 'Needs a human look: ' + (check.reason || '') : check?.reason ? 'Independently checked: ' + check.reason : ''
    });
  }

  for (const row of aeoRows) {
    for (const o of row.optimizations || []) {
      if (o.check && o.check.verdict !== 'confirmed') continue; // only work the reviewer confirmed
      const key = (o.type || '') + '::' + (o.name || o.title || '');
      const fix = aeoFixes[row.url + '|' + key];
      if (fix?.status === 'applied') continue;
      const structural = o.type === 'structure';
      if (!structural && platform === 'wordpress' && fix?.status !== 'manual') { suiteCanDo++; continue; }
      const kind = o.type === 'schema' ? 'aeo_schema' : structural ? 'aeo_structure' : 'aeo_content';
      items.push({
        source: 'AEO', title: o.name || o.type, page_url: row.url, priority: o.impact === 'high' ? 'high' : 'medium',
        problem: o.description || '', change: o.implementation || o.code || '',
        where: where(kind) + (o.where ? ' Place it: ' + o.where + '.' : '') + (fix?.reason ? ' (The suite couldn\'t do it: ' + fix.reason + ')' : ''),
        how_to_check: CHECK[kind] || CHECK.aeo_content,
        check: o.check?.reason ? 'Independently checked: ' + o.check.reason : ''
      });
    }
  }

  items.sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || a.page_url.localeCompare(b.page_url));
  return { client: { name: client?.name || '', url: client?.url || '', cms: client?.cms_type || '' }, generated_at: now.toISOString(), items, suite_can_do: suiteCanDo };
}

// Plain text for a developer email or a Grok Bot.
export function renderFixSheetText(sheet) {
  const c = sheet.client;
  const lines = [
    'FIX SHEET — ' + c.name + ' (' + c.url + ')' + (c.cms ? ' · ' + c.cms : ''),
    'Prepared by Syte Digital, ' + sheet.generated_at.slice(0, 10) + '. ' + sheet.items.length + ' change' + (sheet.items.length === 1 ? '' : 's') + '.',
    '',
    'HOW TO WORK THROUGH THIS',
    '- Do the items in order (most important first).',
    '- Change only what each item describes. Don\'t touch other content.',
    '- After each change, do the "Check" step. If it doesn\'t pass, stop and report that item.',
    '- If something isn\'t possible (no access, the page is different), skip it and say why.',
    '- When finished, reply with, for each item: done / skipped (reason).',
    ''
  ];
  sheet.items.forEach((it, i) => {
    lines.push('────────────────────────────────────────');
    lines.push((i + 1) + '. [' + it.priority.toUpperCase() + '] ' + it.title + '  (' + it.source + ')');
    lines.push('Page: ' + it.page_url);
    if (it.problem) lines.push('What\'s wrong: ' + it.problem);
    lines.push('Where to change it: ' + it.where);
    if (it.change) { lines.push('The change:'); lines.push(String(it.change).trim()); }
    lines.push('Check: ' + it.how_to_check);
    if (it.check) lines.push('(' + it.check + ')');
    lines.push('');
  });
  if (!sheet.items.length) lines.push('Nothing to do by hand right now.');
  if (sheet.suite_can_do) lines.push('', 'Not listed: ' + sheet.suite_can_do + ' more change(s) the Syte suite applies itself.');
  return lines.join('\n');
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Printable page for a developer.
export function renderFixSheetHtml(sheet) {
  const c = sheet.client;
  const PRIO = { critical: '#b91c1c', high: '#c2410c', medium: '#1d4ed8', low: '#0f766e' };
  const cards = sheet.items.map((it, i) => `
  <section class="item">
    <div class="head"><span class="n">${i + 1}</span><span class="p" style="background:${PRIO[it.priority] || '#555'}">${esc(it.priority)}</span>
      <span class="src">${esc(it.source)}</span></div>
    <h2>${esc(it.title)}</h2>
    <p class="url"><a href="${esc(it.page_url)}">${esc(it.page_url)}</a></p>
    ${it.problem ? `<p><b>What's wrong:</b> ${esc(it.problem)}</p>` : ''}
    <p><b>Where to change it:</b> ${esc(it.where)}</p>
    ${it.change ? `<p><b>The change:</b></p><pre>${esc(String(it.change).trim())}</pre>` : ''}
    <p class="check"><b>Check it's done:</b> ${esc(it.how_to_check)}</p>
    ${it.check ? `<p class="note">${esc(it.check)}</p>` : ''}
  </section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fix sheet — ${esc(c.name)}</title>
<style>
body{font:15px/1.5 Arial,Helvetica,sans-serif;color:#1f2937;background:#f5f6f8;margin:0;padding:24px}
.wrap{max-width:860px;margin:0 auto}
header{background:#111827;color:#fff;border-radius:10px;padding:20px 24px;margin-bottom:18px}
header h1{margin:0 0 4px;font-size:22px} header p{margin:0;color:#cbd5e1;font-size:13px}
.how{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 20px;margin-bottom:18px;font-size:14px}
.item{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:14px;break-inside:avoid}
.head{display:flex;gap:8px;align-items:center;font-size:12px}
.n{background:#111827;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}
.p{color:#fff;border-radius:4px;padding:1px 7px;text-transform:uppercase;font-weight:bold;font-size:11px}
.src{color:#6b7280}
h2{font-size:17px;margin:8px 0 2px} .url{margin:0 0 8px;font-size:13px;word-break:break-all}
pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12.5px}
.check{background:#ecfdf5;border-left:3px solid #10b981;padding:8px 12px;border-radius:4px}
.note{color:#6b7280;font-size:12.5px}
@media print{body{background:#fff;padding:0} header{background:#fff;color:#000;border:1px solid #000} header p{color:#333} pre{background:#f3f4f6;color:#111}}
</style></head><body><div class="wrap">
<header><h1>Fix sheet — ${esc(c.name)}</h1>
<p>${esc(c.url)}${c.cms ? ' · ' + esc(c.cms) : ''} · prepared by Syte Digital on ${esc(sheet.generated_at.slice(0, 10))} · ${sheet.items.length} change${sheet.items.length === 1 ? '' : 's'}</p></header>
<div class="how"><b>How to work through this:</b> do the items in order (most important first); change only what each item describes;
after each change do the green "Check" step; if something isn't possible, skip it and note why; when finished, reply with done / skipped (reason) for each item.</div>
${cards || '<div class="how">Nothing to do by hand right now.</div>'}
${sheet.suite_can_do ? `<p class="note">Not listed: ${sheet.suite_can_do} more change(s) the Syte suite applies itself.</p>` : ''}
</div></body></html>`;
}
