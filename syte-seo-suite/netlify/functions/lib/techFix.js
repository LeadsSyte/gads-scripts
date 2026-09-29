// Applying Technical SEO fixes on the client's WordPress site — only the
// kinds the REST API can change in place safely. Each one records what was
// there before, so it can be put back (undoResults):
//
//   meta_title / meta_description → the page's Yoast / Rank Math fields
//   image_alt                      → the image's alt text in the media library
//
// Everything else (theme/template changes, redirects, robots.txt, schema in
// page builders, admin-console work) is not applied here — that's for a
// developer or a Grok Bot. `wp` is injected: wp(path) GETs, wp(path, body)
// POSTs, both against /wp-json/ with the client's app password.

export const AUTO_FIX_TYPES = ['meta_title', 'meta_description', 'image_alt'];

const YOAST = { meta_title: '_yoast_wpseo_title', meta_description: '_yoast_wpseo_metadesc' };
const RANK = { meta_title: 'rank_math_title', meta_description: 'rank_math_description' };

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// The new value(s) out of the triage's copy_paste_fix. Returns null when the
// fix doesn't state a value plainly enough to apply without a person.
export function parseFixValues(task) {
  const fix = String(task?.copy_paste_fix || '');
  const type = task?.fix_type;
  if (type === 'meta_title') {
    const tag = fix.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const labelled = fix.match(/(?:meta\s*)?title\s*[:=]\s*["“]?([^"\n”]{10,120})["”]?/i);
    const plain = !/[<>]/.test(fix) && fix.trim().split('\n').length === 1 ? fix.trim() : '';
    const v = decode(tag?.[1] || labelled?.[1] || plain);
    return v && v.length >= 10 && v.length <= 120 && !/\[[^\]]+\]/.test(v) ? { value: v } : null;
  }
  if (type === 'meta_description') {
    const tag = fix.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)
      || fix.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const labelled = fix.match(/description\s*[:=]\s*["“]?([^"\n”]{40,320})["”]?/i);
    const plain = !/[<>]/.test(fix) && fix.trim().split('\n').length === 1 ? fix.trim() : '';
    const v = decode(tag?.[1] || labelled?.[1] || plain);
    return v && v.length >= 40 && v.length <= 320 && !/\[[^\]]+\]/.test(v) ? { value: v } : null;
  }
  if (type === 'image_alt') {
    const images = [];
    for (const m of fix.matchAll(/<img\b[^>]*>/gi)) {
      const src = (m[0].match(/\bsrc=["']([^"']+)["']/i) || [])[1];
      const alt = (m[0].match(/\balt=["']([^"']*)["']/i) || [])[1];
      if (src && alt !== undefined && alt.trim() && !/\[[^\]]+\]/.test(alt)) images.push({ src, alt: decode(alt) });
    }
    return images.length ? { images } : null;
  }
  return null;
}

const norm = u => { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return String(u || '').toLowerCase(); } };

// The page/post behind a URL. Tries pages then posts by slug and checks the
// link matches, so a same-slug item elsewhere is never edited.
export async function resolveWpObject(wp, pageUrl) {
  let path;
  try { path = new URL(pageUrl).pathname.replace(/\/+$/, ''); } catch { return null; }
  const slug = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  if (!slug) return null; // homepage: its SEO title lives in the SEO plugin's settings, not a page
  for (const type of ['pages', 'posts']) {
    const found = await wp('wp/v2/' + type + '?slug=' + encodeURIComponent(slug) + '&context=edit&_fields=id,link,meta,title');
    const hit = (Array.isArray(found) ? found : []).find(p => norm(p.link) === norm(pageUrl));
    if (hit) return { type, id: hit.id, link: hit.link, meta: hit.meta || {}, title: hit.title?.raw || hit.title?.rendered || '' };
  }
  return null;
}

// Strip WordPress' size suffix: name-1024x512.jpg → name
const stemOf = src => { try { return decodeURIComponent(new URL(src, 'https://x').pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, ''); } catch { return ''; } };

export async function findMedia(wp, src) {
  const stem = stemOf(src);
  if (!stem) return null;
  const found = await wp('wp/v2/media?search=' + encodeURIComponent(stem) + '&per_page=20&context=edit&_fields=id,source_url,alt_text,media_details');
  for (const m of Array.isArray(found) ? found : []) {
    const urls = [m.source_url, ...Object.values(m.media_details?.sizes || {}).map(s => s.source_url)].filter(Boolean).map(norm);
    if (urls.includes(norm(src)) || stemOf(m.source_url) === stem) return { id: m.id, alt: m.alt_text || '', source_url: m.source_url };
  }
  return null;
}

// Dry run: what would change. { applicable, reason, changes: [{ kind, label, target, field(s), from, to }] }
export async function planFix(task, wp) {
  if (!AUTO_FIX_TYPES.includes(task.fix_type)) {
    return { applicable: false, reason: 'This kind of fix needs a developer (or a Grok Bot) — it isn\'t a field the suite can change safely.' };
  }
  const values = parseFixValues(task);
  if (!values) return { applicable: false, reason: 'The fix doesn\'t state the new value plainly enough to apply automatically.' };

  if (task.fix_type === 'image_alt') {
    const changes = [];
    const missing = [];
    for (const img of values.images) {
      const media = await findMedia(wp, img.src);
      if (!media) { missing.push(img.src); continue; }
      changes.push({ kind: 'image_alt', label: 'Image alt text · ' + media.source_url.split('/').pop(), target: { type: 'media', id: media.id }, from: media.alt, to: img.alt, src: img.src });
    }
    if (!changes.length) return { applicable: false, reason: 'Could not find ' + (missing.length > 1 ? 'these images' : 'this image') + ' in the WordPress media library (it may come from the theme or another site).' };
    return { applicable: true, changes, note: missing.length ? missing.length + ' image(s) not in the media library — left for a person.' : '' };
  }

  const obj = await resolveWpObject(wp, task.page_url);
  if (!obj) return { applicable: false, reason: 'Could not match ' + task.page_url + ' to a WordPress page or post (the homepage\'s SEO title is set in the SEO plugin, not on a page).' };
  const fields = [YOAST[task.fix_type], RANK[task.fix_type]].filter(k => Object.prototype.hasOwnProperty.call(obj.meta, k));
  if (!fields.length) {
    return { applicable: false, reason: 'This WordPress site doesn\'t let the SEO plugin\'s fields be changed through the connection (needs the small PHP snippet). Apply it in WordPress by hand.' };
  }
  const from = fields.map(k => obj.meta[k]).find(Boolean) || '';
  return {
    applicable: true,
    changes: [{
      kind: task.fix_type, label: (task.fix_type === 'meta_title' ? 'SEO title' : 'Meta description') + ' · ' + (obj.title || obj.link),
      target: { type: obj.type, id: obj.id }, fields, from, to: values.value,
      // What each field held, so Undo restores it exactly ('' = the SEO
      // plugin's own default title).
      fromFields: Object.fromEntries(fields.map(k => [k, obj.meta[k] || '']))
    }]
  };
}

// Apply a plan, then read each value back — a 200 from WordPress is not
// proof the value stuck (unregistered meta is ignored silently).
export async function applyPlan(plan, wp) {
  const results = [];
  for (const c of plan.changes || []) {
    try {
      if (c.kind === 'image_alt') {
        await wp('wp/v2/media/' + c.target.id, { alt_text: c.to });
        const back = await wp('wp/v2/media/' + c.target.id + '?context=edit&_fields=alt_text');
        results.push({ ...c, ok: (back?.alt_text || '') === c.to });
      } else {
        const meta = Object.fromEntries(c.fields.map(k => [k, c.to]));
        await wp('wp/v2/' + c.target.type + '/' + c.target.id, { meta });
        const back = await wp('wp/v2/' + c.target.type + '/' + c.target.id + '?context=edit&_fields=meta');
        results.push({ ...c, ok: c.fields.some(k => (back?.meta?.[k] || '') === c.to) });
      }
    } catch (e) {
      results.push({ ...c, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return results;
}

// Put back what was there before. Only where the value is still the one we
// wrote — if someone has edited it since, their edit is left alone.
export async function undoResults(results, wp) {
  const out = [];
  for (const c of (results || []).filter(r => r.ok)) {
    try {
      if (c.kind === 'image_alt') {
        const path = 'wp/v2/media/' + c.target.id;
        const cur = await wp(path + '?context=edit&_fields=alt_text');
        if ((cur?.alt_text || '') !== c.to) { out.push({ ...c, undone: false, kept: true }); continue; }
        await wp(path, { alt_text: c.from || '' });
        const back = await wp(path + '?context=edit&_fields=alt_text');
        out.push({ ...c, undone: (back?.alt_text || '') === (c.from || '') });
      } else {
        const path = 'wp/v2/' + c.target.type + '/' + c.target.id;
        const cur = await wp(path + '?context=edit&_fields=meta');
        const ours = c.fields.filter(k => (cur?.meta?.[k] || '') === c.to);
        if (!ours.length) { out.push({ ...c, undone: false, kept: true }); continue; }
        const before = k => (c.fromFields ? c.fromFields[k] : c.from) || '';
        await wp(path, { meta: Object.fromEntries(ours.map(k => [k, before(k)])) });
        const back = await wp(path + '?context=edit&_fields=meta');
        out.push({ ...c, undone: ours.every(k => (back?.meta?.[k] || '') === before(k)) });
      }
    } catch (e) {
      out.push({ ...c, undone: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return out;
}

// Is the change visible on the live page? Caches can lag, so "not yet" is
// reported as pending rather than failed.
export function checkLive(html, results) {
  const page = String(html || '');
  if (!page) return { status: 'pending', detail: 'Could not load the live page to check yet.' };
  const unescape = s => decode(s);
  const seen = results.filter(r => r.ok).map(r => {
    if (r.kind === 'meta_title') return unescape((page.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).includes(r.to.slice(0, 40));
    if (r.kind === 'meta_description') return unescape((page.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1]).includes(r.to.slice(0, 60));
    if (r.kind === 'image_alt') {
      const stem = stemOf(r.src);
      const tags = [...page.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]).filter(t => t.includes(stem));
      return tags.length > 0 && tags.every(t => /\balt=["'][^"']+["']/i.test(t));
    }
    return false;
  });
  if (seen.length && seen.every(Boolean)) return { status: 'verified', detail: 'The change is live on the page.' };
  return { status: 'pending', detail: 'Saved in WordPress; not visible on the live page yet (page cache, or the theme sets it elsewhere). Re-check later.' };
}
