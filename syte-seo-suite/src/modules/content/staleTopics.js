// Topics the writer must never bring up because they are out of date.
//
// Load shedding ended in South Africa long ago, but models trained on older
// web text still reach for it ("beat load shedding with...", "during stage 6")
// in any SA article about energy, homes, business or tech. Nothing in our
// prompts asks for it; the model adds it on its own. So the rule is stated to
// the writer (prompts.js) AND checked on the result: an article that still
// mentions it is held back by the autopilot and refused at push.
//
// Pure and node-testable: no imports.

export const STALE_TOPICS = [
  {
    id: 'load-shedding',
    label: 'load shedding',
    // load shedding / load-shedding / loadshedding / common misspellings,
    // Eskom power cuts, and "stage N" outages.
    pattern: /\bload[\s-]?shed+ing\b|\bloadshed\w*|\bload[\s-]?shed\b|\beskom\b|\brolling blackouts?\b|\bstage\s?[1-8]\s+(?:load|power|outage|cuts?)\b/i
  }
];

export const STALE_TOPICS_RULE =
  '- NEVER mention load shedding, Eskom power cuts, rolling blackouts or "stage" outages, in any form. Load shedding is long over in South Africa; an article that brings it up reads as out of date. Do not use it as a hook, an example, a benefit, a pain point or a FAQ.';

// [{ id, label, excerpt }] for every stale topic the text mentions.
export function findStaleTopics(text) {
  const s = String(text || '');
  const out = [];
  for (const t of STALE_TOPICS) {
    const m = s.match(t.pattern);
    if (m) {
      const i = m.index || 0;
      out.push({ id: t.id, label: t.label, excerpt: s.slice(Math.max(0, i - 60), i + m[0].length + 60).replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
}

export function staleTopicReason(text) {
  const hits = findStaleTopics(text);
  return hits.length
    ? 'Mentions ' + hits.map(h => h.label).join(', ') + ', which is out of date: "' + hits[0].excerpt + '"'
    : '';
}
