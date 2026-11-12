// The article blueprint is learned from the client's own published posts
// (lib/articleBlueprint.js) and fed to the writer (content/prompts.js).

import { htmlToOutline, pickSamplePosts, buildBlueprintPrompt, learnBlueprint, blueprintIsEdited, MAX_SAMPLES } from '../netlify/functions/lib/articleBlueprint.js';
import { buildSystemPrompt } from '../src/modules/content/prompts.js';
import { getPublishingProfile } from '../src/modules/cms/publishingProfile.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const long = 'Pallet racking keeps a warehouse safe and efficient when it is specified properly. '.repeat(30);
const post = (title, extra = '') => ({ title, url: 'https://x.co.za/' + title.toLowerCase().replace(/\W+/g, '-'), html: '<h2>What it is</h2><p>' + long + '</p><ul><li>One</li><li>Two</li></ul><h2>FAQs</h2><p>' + extra + '</p>' });
const BP = 'STRUCTURE\nIntro, 4 H2 sections, FAQ.\nOPENING\nA question.\nHEADINGS\nSentence case.\nPARAGRAPHS AND LISTS\nShort.\nTONE AND VOICE\nSecond person, South African English.\nLENGTH\n900 words.\nRECURRING ELEMENTS\nFAQ.\nCLOSING\nContact line.\nAVOID\nJargon.' + ' More detail here.'.repeat(5);

await t('post HTML becomes an outline that keeps the structure', () => {
  const o = htmlToOutline('<style>p{}</style><h2 class="x">Costs</h2><p>Text <strong>bold</strong> <a href="/contact/">us</a> <a href="https://other.com/a">x</a></p><ul><li>One</li></ul><img src="a.png"><script>bad()</script>');
  ok(o.includes('## Costs') && o.includes('- One') && o.includes('[image]') && o.includes('**bold**'), o);
  ok(o.includes('[link:internal]') && o.includes('[link:other.com]'), o);
  ok(!o.includes('bad()') && !o.includes('p{}') && !o.includes('<'), o);
});

await t("samples skip the suite's own articles and short posts, newest first, capped", () => {
  const posts = [post('Ours: VNA Racking'), { title: 'Tiny', url: '', html: '<p>Short.</p>' }, ...Array.from({ length: 9 }, (_, i) => post('Client post ' + i))];
  const s = pickSamplePosts(posts, ['ours  vna racking']);
  eq([s.length, s[0].title], [MAX_SAMPLES, 'Client post 0']);
  ok(s.every(x => x.words > 100 && x.text.length <= 6000));
});

await t('learning needs two usable posts; otherwise it says why and calls no AI', async () => {
  let called = 0;
  const out = await learnBlueprint({ client: { name: 'K' }, posts: [post('Only one')] }, { complete: async () => { called++; return BP; } });
  eq([out.result, called], ['not_enough', 0]);
  ok(/Only 1 article/.test(out.reason), out.reason);
});

await t('a learned blueprint records its sources and date; a bad reply is an error', async () => {
  const deps = { complete: async (o) => { ok(o.messages[0].content.includes('ARTICLE 2:'), 'samples in prompt'); return '```\n' + BP + '\n```'; }, now: () => new Date('2026-11-12T08:00:00Z') };
  const out = await learnBlueprint({ client: { name: 'Krost', industry: 'Shelving' }, posts: [post('A'), post('B')] }, deps);
  eq([out.result, out.blueprint.learned_at, out.blueprint.sources.map(s => s.title)], ['learned', '2026-11-12T08:00:00.000Z', ['A', 'B']]);
  ok(out.blueprint.text.startsWith('STRUCTURE'), 'fence unwrapped');
  let threw = false;
  try { await learnBlueprint({ client: { name: 'K' }, posts: [post('A'), post('B')] }, { complete: async () => 'Sorry.' }); } catch { threw = true; }
  ok(threw, 'bad reply must throw');
});

await t('the prompt asks for form only', () => {
  const p = buildBlueprintPrompt({ name: 'Krost' }, pickSamplePosts([post('A'), post('B')]));
  ok(p.includes('at least two') && p.includes('do not state facts about the business') && p.includes('RECURRING ELEMENTS'), p.slice(0, 300));
});

await t("the writer gets the blueprint, below the client's rules; no blueprint, no block", () => {
  const client = { name: 'Krost', content_rules: 'Never mention prices.', publishing_profile: { article_blueprint: { text: BP } } };
  const s = buildSystemPrompt(client, '');
  ok(s.includes('HOUSE BLUEPRINT') && s.includes('Second person, South African English'), 'blueprint missing');
  ok(s.indexOf('CLIENT-SPECIFIC RULES') < s.indexOf('HOUSE BLUEPRINT'), 'rules come first');
  ok(s.includes('never overrides the client-specific rules'), 'precedence stated');
  ok(!buildSystemPrompt({ name: 'Krost' }, '').includes('HOUSE BLUEPRINT'), 'no block without a blueprint');
  ok(buildSystemPrompt({ name: 'K', publishing_profile: JSON.stringify({ article_blueprint: { text: BP } }) }, '').includes('HOUSE BLUEPRINT'), 'string profile');
});

await t('profile default is no blueprint; an edited one is protected', () => {
  eq(getPublishingProfile({}).article_blueprint, null);
  eq([blueprintIsEdited({ article_blueprint: { text: 'x', edited_at: '2026-11-12' } }), blueprintIsEdited({ article_blueprint: { text: 'x' } }), blueprintIsEdited({})], [true, false, false]);
});

console.log(`\narticleBlueprint: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
