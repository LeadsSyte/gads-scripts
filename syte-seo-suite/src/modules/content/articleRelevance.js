// Relevance verification — does this article actually belong to this brand?
//
// The Content Engine once produced an article about property listings in
// Chamdor under a lifting-equipment client. The prompt-side guards (brand
// reference as ground truth, the subject-matter guard) try to PREVENT that;
// this CATCHES it, after generation, before a human or a CMS ever sees it.
// Same relationship as publishing profiles and verifyDraft.js in the CMS
// module.
//
// THE TRAP THIS IS BUILT AROUND
// In the real incident the article's LOCATION was right — the client really
// is in Chamdor — and only the SUBJECT was wrong. A naive "do the article
// and the brand share words?" check passes it, because they share "Chamdor".
// The client's own location and brand name are therefore excluded from the
// terms that count towards relevance: relevance has to be earned on what the
// business DOES, not on where it is or what it is called.
//
// checkArticleRelevance() is pure (no network, no DOM) so it is fully
// testable — see test/articleRelevance.test.mjs. verifyArticleRelevance()
// wraps it and escalates anything not clearly relevant to Claude, which has
// the final say.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { parseScanBlock } from '../../lib/brandScan.js';

// Words carrying no subject signal. Deliberately short — this only has to
// stop obvious filler from manufacturing false overlap.
const STOPWORDS = new Set((
  'a an and are as at be been best but by can do does for from get great guide ' +
  'has have how in into is it its more most new of on or our out over should so ' +
  'than that the their them then there these they this to up us use using was we ' +
  'what when where which who why will with you your vs versus about after all also ' +
  'any because before being between both during each few if just like made make ' +
  'many may much must need needs no not now only other own same see some such take ' +
  'through under until very want way well why your top choose choosing complete ' +
  'ultimate everything know needtoknow tips ways things guide2026 year years'
).split(/\s+/));

// Normalise to comparable content words. Light suffix folding only — enough
// that "properties" matches "property" and "liftings" matches "lifting",
// without pulling in a stemmer dependency.
export function contentTerms(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  const out = new Set();
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    out.add(fold(w));
  }
  return out;
}

function fold(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// What the article is ABOUT: the parts that declare its subject, rather than
// the whole body (a 1500-word article shares plenty of incidental vocabulary
// with anything).
export function articleSubject(output, { topic = '', keyword = '' } = {}) {
  const text = String(output || '');
  const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || '';
  const metaTitle = (text.match(/\*\*Meta Title:\*\*\s*(.+)/i) || text.match(/Meta Title[:\s]+(.+)/i) || [])[1] || '';
  const metaDesc = (text.match(/\*\*Meta Description:\*\*\s*(.+)/i) || text.match(/Meta Description[:\s]+(.+)/i) || [])[1] || '';
  const summary = (text.match(/\*\*AEO Summary Block:\*\*\s*([\s\S]{0,600}?)(?:\n\s*\n|$)/i) || [])[1] || '';
  // Section headings say what the article covers.
  const headings = (text.match(/^##\s+(.+)$/gm) || []).map(h => h.replace(/^##\s+/, '')).slice(0, 12);

  return {
    h1: h1.trim(),
    metaTitle: metaTitle.trim(),
    metaDesc: metaDesc.trim(),
    summary: summary.trim(),
    headings,
    topic: String(topic || '').trim(),
    keyword: String(keyword || '').trim(),
    text: [h1, metaTitle, metaDesc, summary, headings.join(' '), topic, keyword].join(' ')
  };
}

// What the BRAND does, drawn from the website scan first and the typed
// fields second. The brand name and location are collected separately so
// they can be discounted.
export function brandVocabulary(client) {
  const c = client || {};
  const scan = parseScanBlock(c.brand_docs);
  const reference = (scan?.block || c.brand_docs || '').trim();

  const subjectSource = [reference, c.industry, c.context, c.audience, c.services]
    .filter(Boolean).join(' ');

  // Excluded from the terms that earn relevance — see the header note.
  const identity = new Set([
    ...contentTerms(c.name),
    ...contentTerms(c.location),
    ...contentTerms((() => { try { return new URL(/^https?:/.test(c.url || '') ? c.url : 'https://' + (c.url || '')).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })())
  ]);

  const subject = new Set();
  for (const term of contentTerms(subjectSource)) {
    if (!identity.has(term)) subject.add(term);
  }

  return { subject, identity, reference, hasReference: !!reference };
}

// The model can self-report under the prompt's subject-matter guard. That is
// the strongest possible signal — it had the brand reference in front of it.
export function detectSelfReportedMismatch(output) {
  const m = String(output || '').match(/TOPIC MISMATCH:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

// Pure relevance check.
//
// verdict:
//   'mismatch' — the article's subject has no footing in what the brand does
//   'unclear'  — weak overlap, or nothing to check against; needs a human
//                or Claude to decide
//   'relevant' — the subject is clearly the brand's own field
export function checkArticleRelevance({ output, client, topic = '', keyword = '' } = {}) {
  const findings = [];
  const add = (name, ok, severity, detail) => findings.push({ name, ok, severity, detail });

  const selfReported = detectSelfReportedMismatch(output);
  const subject = articleSubject(output, { topic, keyword });
  const vocab = brandVocabulary(client);

  if (selfReported) {
    add('Subject matches the brand', false, 'error',
      'The writer flagged it itself: ' + selfReported);
    return {
      verdict: 'mismatch', score: 0, findings, selfReported,
      subject, sharedTerms: [], brandTermCount: vocab.subject.size,
      needsAdjudication: false
    };
  }

  const subjectTerms = contentTerms(subject.text);
  const shared = [...subjectTerms].filter(t => vocab.subject.has(t));
  // Terms that matched only the brand's name or location prove nothing about
  // subject relevance, but they are worth reporting — they are exactly what
  // made the Chamdor article look plausible.
  const identityOnly = [...subjectTerms].filter(t => vocab.identity.has(t) && !vocab.subject.has(t));

  if (!vocab.hasReference) {
    add('Subject matches the brand', false, 'warning',
      'No website scan or brand documents on file, so the article could not be checked against what this business actually does.');
    return {
      verdict: 'unclear', score: 0, findings, selfReported: null,
      subject, sharedTerms: [], identityOnlyTerms: identityOnly,
      brandTermCount: 0, needsAdjudication: true
    };
  }

  // Share of the article's declared subject that lands in the brand's field.
  const score = subjectTerms.size ? shared.length / subjectTerms.size : 0;

  let verdict;
  if (shared.length === 0) verdict = 'mismatch';
  else if (shared.length < 3 || score < 0.12) verdict = 'unclear';
  else verdict = 'relevant';

  const detail = verdict === 'relevant'
    ? 'Subject overlaps the brand on: ' + shared.slice(0, 8).join(', ')
    : (shared.length
        ? 'Only ' + shared.length + ' subject term(s) in common with what this brand does: ' + shared.join(', ')
        : 'Nothing in the article’s title, summary or headings matches what this brand does.')
      + (identityOnly.length
        ? ' It does mention the brand’s own name/location (' + identityOnly.slice(0, 5).join(', ')
          + '), which is not evidence the subject is theirs.'
        : '');

  add('Subject matches the brand', verdict === 'relevant',
    verdict === 'mismatch' ? 'error' : 'warning', detail);

  return {
    verdict, score, findings, selfReported: null,
    subject, sharedTerms: shared, identityOnlyTerms: identityOnly,
    brandTermCount: vocab.subject.size,
    needsAdjudication: verdict !== 'relevant'
  };
}

const ADJUDICATOR_SYSTEM = `You check whether a drafted article belongs to the brand it was written for. Answer ONLY with JSON — no prose, no code fences.

{
  "relevant": true | false,
  "confidence": "high" | "medium" | "low",
  "article_subject": "what the article is actually about, in a few words",
  "reason": "one sentence"
}

Judge SUBJECT only. Rules:
- Relevant means the article is about something this brand actually does, sells, or serves according to the brand reference.
- Sharing a town, city or service area with the brand is NOT relevance. A brand located in a place does not write about every industry in that place.
- Sharing the brand's own name is NOT relevance.
- Adjacent-but-plausible counts as relevant (a supplier writing about safety standards for what it supplies). A different industry does not.
- If the brand reference is thin, prefer "low" confidence over guessing.`;

// Full check: the pure pass, escalating anything not clearly relevant to
// Claude. Never throws — if adjudication fails, the pure verdict stands and
// the failure is recorded, because a verifier that errors open is worse than
// one that says "unclear".
export async function verifyArticleRelevance({ output, client, topic = '', keyword = '' } = {}) {
  const base = checkArticleRelevance({ output, client, topic, keyword });
  if (!base.needsAdjudication) return { ...base, adjudicated: false };

  const vocab = brandVocabulary(client);
  const s = base.subject;
  const userMessage = `BRAND: ${client?.name || '(unnamed)'}
WEBSITE: ${client?.url || '(none)'}
STATED INDUSTRY: ${client?.industry || '(none)'}
STATED LOCATION / SERVICE AREA: ${client?.location || '(none)'}

BRAND REFERENCE (from the brand's own website — authoritative):
${vocab.reference ? '"""\n' + vocab.reference.slice(0, 5000) + '\n"""' : '(none on file)'}

DRAFTED ARTICLE — subject only:
- H1: ${s.h1 || '(none)'}
- Meta title: ${s.metaTitle || '(none)'}
- Meta description: ${s.metaDesc || '(none)'}
- Opening summary: ${s.summary || '(none)'}
- Section headings: ${s.headings.length ? s.headings.join(' | ') : '(none)'}
- Requested topic: ${s.topic || '(none)'}
- Primary keyword: ${s.keyword || '(none)'}

Does this article belong to this brand?`;

  try {
    const raw = await claudeComplete({
      system: ADJUDICATOR_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 400,
      temperature: 0
    });
    const parsed = extractJSON(raw);
    if (!parsed || typeof parsed.relevant !== 'boolean') {
      return {
        ...base, adjudicated: false,
        findings: [...base.findings, {
          name: 'Relevance review', ok: false, severity: 'warning',
          detail: 'The relevance reviewer returned something unreadable — the automatic check above stands.'
        }]
      };
    }

    const verdict = parsed.relevant
      ? (parsed.confidence === 'low' ? 'unclear' : 'relevant')
      : 'mismatch';

    return {
      ...base,
      verdict,
      adjudicated: true,
      adjudication: parsed,
      findings: [...base.findings, {
        name: 'Relevance review',
        ok: verdict === 'relevant',
        severity: verdict === 'mismatch' ? 'error' : 'warning',
        detail: (parsed.article_subject ? 'Reads as: ' + parsed.article_subject + '. ' : '')
          + (parsed.reason || '') + ' (confidence: ' + (parsed.confidence || 'unknown') + ')'
      }]
    };
  } catch (e) {
    return {
      ...base, adjudicated: false,
      findings: [...base.findings, {
        name: 'Relevance review', ok: false, severity: 'warning',
        detail: 'Could not run the relevance review (' + (e?.message || e) + ') — the automatic check above stands.'
      }]
    };
  }
}

// One-line summary for the UI.
export function relevanceHeadline(result, client) {
  const name = client?.name || 'this client';
  if (!result) return '';
  if (result.verdict === 'relevant') return 'Checked against ' + name + '’s website — on topic.';
  if (result.verdict === 'mismatch') {
    const what = result.adjudication?.article_subject || result.subject?.h1 || 'this article';
    return 'Off topic for ' + name + ': reads as ' + what + '.';
  }
  return 'Could not confirm this is on topic for ' + name + ' — worth a read before pushing.';
}
