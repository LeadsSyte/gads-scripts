// Shared "we already did this" vocabulary for the monthly re-scans.
//
// The AEO Engine and Technical SEO both re-scan a client every month, and
// until now every re-scan started from a blank slate: the crawler saw the
// site as it is, the model produced its best list, and the hand-off repeated
// the work that was briefed — often already shipped — the month before.
// Account managers were re-briefing developers on live changes, and the
// genuinely new opportunities never made the shortlist because repeats had
// taken the slots.
//
// The generic half of the answer lives here: how a page is identified across
// trailing-slash / www drift, how a human-written label is normalised, and
// how close two labels have to be before they count as the same piece of
// work. The module-specific rules — what counts as the same AEO optimization
// "kind", which technical fix_types can only exist once per page — live next
// to their engines in aeoHistory.js and taskHistory.js.

// Words that carry no identity: "Add an FAQ section" and "FAQ section" are
// the same piece of work, and the imperative verb is the only difference.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'for', 'to', 'of', 'on', 'in', 'with', 'this',
  'that', 'its', 'add', 'adds', 'added', 'fix', 'fixes', 'create', 'creates',
  'update', 'updates', 'improve', 'implement', 'page', 'pages', 'site'
]);

// Identity of a page for coverage tracking — ignores the trailing-slash and
// www differences that would otherwise make the same page look untouched.
export function pageIdentity(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return u.hostname.replace(/^www\./, '') + path.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

// Lowercase, strip markup and punctuation, collapse whitespace. The model
// rewords its own suggestions month to month ("FAQ Content Section" vs
// "Add FAQ section"), so raw string equality is not a usable test.
export function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function labelTokens(s) {
  return normalizeLabel(s)
    .split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Dice coefficient over the two token sets: 1 = identical, 0 = disjoint.
// Chosen over Jaccard because it is more forgiving of one label carrying
// extra qualifiers ("FAQ section" vs "FAQ section for shipping questions").
export function labelSimilarity(a, b) {
  const A = new Set(labelTokens(a));
  const B = new Set(labelTokens(b));
  if (!A.size || !B.size) return normalizeLabel(a) === normalizeLabel(b) ? 1 : 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

// Where the line sits. Tuned on real hand-offs: "Add an FAQ Content Section"
// vs "FAQ Section" scores 1.0, "Answer Block" vs "Key Takeaways" scores 0.
export const SIMILAR_ENOUGH = 0.7;

// True when `label` says the same thing as anything in `labels`.
export function matchesAnyLabel(label, labels) {
  const norm = normalizeLabel(label);
  if (!norm) return false;
  for (const prev of labels || []) {
    if (normalizeLabel(prev) === norm) return true;
    if (labelSimilarity(label, prev) >= SIMILAR_ENOUGH) return true;
  }
  return false;
}

// The bundle button logs one implementation row for a whole page's worth of
// optimizations, with the individual names in the description:
//   1. Answer Block — why it helps
//   Implementation excerpt: …
// Pull those names back out so a bundle counts as covering each item in it,
// not just as one row titled "AEO bundle: 3 optimizations".
export function bundledLabels(description) {
  const out = [];
  for (const line of String(description || '').split('\n')) {
    const m = line.match(/^\s*\d+\.\s*(.+?)\s*[—–-]\s+/);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

// Group the permanent implementation log into per-page work records.
//
// A row whose verification came back 'failed' is deliberately NOT counted:
// the change was logged but never landed on the page, so the next scan
// should raise it again. Everything else — verified, pending, sent to the
// developer — counts as done and must not be re-suggested.
export function implementedByPage(impls, { module, clientId, includeFailed = false } = {}) {
  const map = new Map();
  for (const impl of Array.isArray(impls) ? impls : []) {
    if (!impl) continue;
    if (module && impl.module !== module) continue;
    if (clientId && impl.client_id !== clientId) continue;
    if (!includeFailed && impl.verification_status === 'failed') continue;
    const key = pageIdentity(impl.page_url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    const bucket = map.get(key);
    const bundled = bundledLabels(impl.description);
    if (bundled.length) {
      for (const label of bundled) {
        bucket.push({ label, changeType: impl.change_type || '', source: 'implementation' });
      }
    } else if (impl.title) {
      bucket.push({ label: impl.title, changeType: impl.change_type || '', source: 'implementation' });
    }
  }
  return map;
}
