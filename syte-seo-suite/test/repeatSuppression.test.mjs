// Regression test for "the monthly re-scan hands back last month's work".
//
// Both engines re-scan a client every month. Before this, a revisited page
// was generated from a blank slate, so the AEO Engine re-proposed the answer
// block it shipped in March and Technical SEO re-briefed a meta title that
// had already been rewritten. These checks pin the three properties that
// stop it: prior work is recognised across rewording, it is filtered before
// it can take a shortlist slot, and the ledger survives the results row being
// overwritten by the next run.

import {
  pageIdentity, normalizeLabel, labelSimilarity, matchesAnyLabel,
  bundledLabels, implementedByPage
} from '../src/lib/priorWork.js';
import {
  optKind, optKey, priorWorkForClient, isRepeatOptimization,
  filterRepeatOptimizations, priorLabelsForPage, nextPriorKeys,
  MAX_PRIOR_KEYS_PER_PAGE
} from '../src/modules/aeo/aeoHistory.js';
import {
  completedWorkForClient, isRepeatTask, filterRepeatTasks,
  completedWorkPrompt, SINGLE_INSTANCE_FIX_TYPES
} from '../src/modules/technical/taskHistory.js';

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  failed++;
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''));
}

// ---- page identity --------------------------------------------------------
console.log('page identity');
{
  check('trailing slash and www collapse to one page',
    pageIdentity('https://www.example.com/pricing/') === pageIdentity('https://example.com/pricing'));
  check('different pages stay different',
    pageIdentity('https://example.com/a') !== pageIdentity('https://example.com/b'));
  check('a non-URL degrades to its own string', pageIdentity('not a url') === 'not a url');
}

// ---- label matching -------------------------------------------------------
console.log('label matching');
{
  check('imperative rewording still matches',
    labelSimilarity('Add an FAQ Content Section', 'FAQ Content Section') >= 0.7,
    String(labelSimilarity('Add an FAQ Content Section', 'FAQ Content Section')));
  check('unrelated items do not match',
    labelSimilarity('Answer Block', 'Breadcrumb Schema') < 0.7);
  check('matchesAnyLabel finds the reworded one',
    matchesAnyLabel('Write a lead answer block', ['Comparison Table', 'Lead Answer Block']));
  check('matchesAnyLabel says no when nothing is close',
    !matchesAnyLabel('Internal Linking', ['Comparison Table', 'Answer Block']));
  check('normalizeLabel strips markup and punctuation',
    normalizeLabel('<b>FAQ</b> — Section!') === 'faq section');
}

// ---- the implementation log ----------------------------------------------
console.log('implementation log');
{
  const impls = [
    { module: 'aeo', client_id: 'c1', page_url: 'https://example.com/a/', title: 'Answer Block',
      change_type: 'content', verification_status: 'verified' },
    // Logged, then verification came back failed — the change never landed,
    // so it must NOT count as done.
    { module: 'aeo', client_id: 'c1', page_url: 'https://example.com/b', title: 'FAQ Section',
      change_type: 'content', verification_status: 'failed' },
    { module: 'technical', client_id: 'c1', page_url: 'https://example.com/a', title: 'Meta title',
      change_type: 'meta_title', verification_status: 'pending' },
    { module: 'aeo', client_id: 'c2', page_url: 'https://example.com/a', title: 'Other client',
      change_type: 'content', verification_status: 'verified' }
  ];
  const aeo = implementedByPage(impls, { module: 'aeo', clientId: 'c1' });
  check('only this client + module is counted', aeo.size === 1 && aeo.has('example.com/a'));
  check('failed verification does not count as done', !aeo.has('example.com/b'));
  check('pending / sent-to-developer still counts as done',
    implementedByPage(impls, { module: 'technical', clientId: 'c1' }).has('example.com/a'));

  const bundle = bundledLabels(
    'Combined AEO push for https://example.com/a. Verify the page contains content matching these themes:\n\n' +
    '1. Answer Block — a 40-60 word direct answer\n' +
    'Implementation excerpt: Acme is a…\n\n' +
    '2. FAQ Content Section — five questions\n' +
    'Implementation excerpt: What is…'
  );
  check('a bundle row expands to its individual items',
    bundle.length === 2 && bundle[0] === 'Answer Block' && bundle[1] === 'FAQ Content Section',
    JSON.stringify(bundle));
}

// ---- AEO: optimization kinds ---------------------------------------------
console.log('AEO optimization kinds');
{
  check('answer block variants share a kind',
    optKind({ type: 'content', name: 'Lead Answer Block' }) ===
    optKind({ type: 'content', name: 'Add an answer block after the H1' }));
  check('FAQ content and FAQ schema are different work',
    optKind({ type: 'content', name: 'FAQ Content Section' }) !==
    optKind({ type: 'schema', name: 'FAQ Schema JSON-LD' }));
  check('an unrecognised name has no kind (falls back to label matching)',
    optKind({ type: 'content', name: 'Rewrite the third paragraph' }) === '');
  check('two uncommon schema types are not collapsed into one kind',
    optKind({ type: 'schema', name: 'Review Schema' }) === '' &&
    optKind({ type: 'schema', name: 'Event Schema' }) === '');
}

// ---- AEO: repeat suppression ---------------------------------------------
console.log('AEO repeat suppression');
{
  const results = {
    'c1::https://example.com/a': {
      client_id: 'c1', url: 'https://example.com/a/',
      optimizations: [{ type: 'content', name: 'Answer Block' }],
      prior_keys: ['content::FAQ Content Section']
    },
    'c2::https://example.com/a': {
      client_id: 'c2', url: 'https://example.com/a',
      optimizations: [{ type: 'content', name: 'Comparison Table' }]
    }
  };
  const impls = [{
    module: 'aeo', client_id: 'c1', page_url: 'https://example.com/a',
    title: 'Internal Linking', change_type: 'structure', verification_status: 'verified'
  }];
  const rejections = new Map([
    ['c1::https://example.com/a', new Set(['schema::Breadcrumb Schema'])]
  ]);
  const prior = priorWorkForClient({ results, impls, rejectionsByPage: rejections, clientId: 'c1' });
  const rec = prior.get('example.com/a');

  check('last run\'s items are prior work', isRepeatOptimization({ type: 'content', name: 'Answer Block' }, rec));
  check('the ledger from runs before that is prior work too',
    isRepeatOptimization({ type: 'content', name: 'FAQ Content Section' }, rec));
  check('a reworded repeat is still a repeat',
    isRepeatOptimization({ type: 'content', name: 'Add a short answer block below the H1' }, rec));
  check('implemented work is prior work',
    isRepeatOptimization({ type: 'structure', name: 'Internal Linking' }, rec));
  check('rejected work is not offered again',
    isRepeatOptimization({ type: 'schema', name: 'Breadcrumb Schema' }, rec));
  check('another client\'s work is not counted',
    !isRepeatOptimization({ type: 'content', name: 'Comparison Table' }, rec));
  check('genuinely new work survives',
    !isRepeatOptimization({ type: 'content', name: 'Key Takeaways' }, rec));

  const drafts = [
    { url: 'https://www.example.com/a/', optimizations: [
      { type: 'content', name: 'Answer Block (40-60 words)' },   // repeat
      { type: 'content', name: 'FAQ Section' },                   // repeat via ledger
      { type: 'content', name: 'Key Takeaways' }                  // new
    ] },
    { url: 'https://example.com/never-touched', optimizations: [
      { type: 'content', name: 'Answer Block' },
      { type: 'content', name: 'Lead answer paragraph' }          // same kind, one run
    ] }
  ];
  const out = filterRepeatOptimizations(drafts, prior);
  check('repeats are dropped before ranking', out.removed === 3, 'removed=' + out.removed);
  check('the new item on the seen page survives',
    out.rows[0].optimizations.length === 1 && out.rows[0].optimizations[0].name === 'Key Takeaways');
  check('an untouched page keeps its first item',
    out.rows[1].optimizations.length === 1);
  check('a page cannot be handed the same kind twice in one run',
    out.rows[1].optimizations[0].name === 'Answer Block');
  check('rows without prior work pass through untouched',
    filterRepeatOptimizations([{ url: 'https://other.com/x', optimizations: [{ type: 'content', name: 'Answer Block' }] }], prior)
      .removed === 0);

  const labels = priorLabelsForPage(prior, 'https://example.com/a/');
  check('the prompt exclusion list names prior work',
    labels.includes('Answer Block') && labels.includes('FAQ Content Section'), JSON.stringify(labels));
  check('a page with no history gets an empty exclusion list',
    priorLabelsForPage(prior, 'https://example.com/zzz').length === 0);
}

// ---- AEO: the ledger survives the row being overwritten -------------------
console.log('AEO ledger');
{
  const existing = {
    prior_keys: ['content::FAQ Content Section'],
    optimizations: [{ type: 'content', name: 'Answer Block' }]
  };
  const shipped = [{ type: 'structure', name: 'Internal Linking' }];
  const keys = nextPriorKeys(existing, shipped);
  check('carries the old ledger, the replaced items, and the new ones',
    keys.length === 3 &&
    keys.includes('content::FAQ Content Section') &&
    keys.includes('content::Answer Block') &&
    keys.includes('structure::Internal Linking'), JSON.stringify(keys));
  check('no duplicates when the same item ships twice',
    nextPriorKeys(existing, [{ type: 'content', name: 'Answer Block' }]).length === 2);
  check('a first run starts a ledger from nothing',
    nextPriorKeys(undefined, shipped).length === 1);
  check('unnamed items are not written to the ledger',
    nextPriorKeys(undefined, [{ type: '', name: '' }]).length === 0);
  const many = Array.from({ length: 200 }, (_, i) => ({ type: 'content', name: 'Item ' + i }));
  const capped = nextPriorKeys(undefined, many);
  check('the ledger is capped', capped.length === MAX_PRIOR_KEYS_PER_PAGE);
  check('the cap keeps the newest keys', capped[capped.length - 1] === 'content::Item 199');
  check('optKey matches the rejection blocklist shape',
    optKey({ type: 'content', name: 'Answer Block' }) === 'content::Answer Block');
}

// ---- Technical: completed work -------------------------------------------
console.log('Technical repeat suppression');
{
  const tasks = [
    { client_id: 'c1', page_url: 'https://example.com/pricing/', status: 'verified',
      title: 'Add a meta title to the Pricing page', fix_type: 'meta_title' },
    { client_id: 'c1', page_url: 'https://example.com/about', status: 'done',
      title: 'Add FAQ schema to the About page', fix_type: 'schema' },
    // Still open — must NOT count as completed work.
    { client_id: 'c1', page_url: 'https://example.com/blog', status: 'open',
      title: 'Add alt text to the hero image', fix_type: 'image_alt' },
    { client_id: 'c2', page_url: 'https://example.com/pricing', status: 'verified',
      title: 'Other client work', fix_type: 'h1' }
  ];
  const impls = [{
    module: 'technical', client_id: 'c1', page_url: 'https://example.com/contact',
    title: 'Add a canonical tag', change_type: 'canonical', verification_status: 'verified'
  }];
  const done = completedWorkForClient({ tasks, impls, clientId: 'c1' });

  check('open tasks are not completed work', !done.has('example.com/blog'));
  check('another client\'s completed work is not counted',
    !done.get('example.com/pricing')?.labels.includes('Other client work'));
  check('implementations join the record', done.has('example.com/contact'));

  const fresh = [
    // Same page, same single-instance fix type, completely different wording.
    { client_id: 'c1', page_url: 'https://www.example.com/pricing', fix_type: 'meta_title',
      title: 'Write a unique <title> for /pricing' },
    // Same page, same wording as a done task.
    { client_id: 'c1', page_url: 'https://example.com/about', fix_type: 'schema',
      title: 'Add FAQ schema to About' },
    // Multi-instance type, different subject — legitimately new.
    { client_id: 'c1', page_url: 'https://example.com/about', fix_type: 'image_alt',
      title: 'Add alt text to the team photo' },
    // A page with no history at all.
    { client_id: 'c1', page_url: 'https://example.com/new', fix_type: 'meta_title',
      title: 'Add a meta title' }
  ];
  const out = filterRepeatTasks(fresh, done);
  check('a reworded single-instance repeat is dropped', out.removed === 2, 'removed=' + out.removed);
  check('genuinely new work survives', out.tasks.length === 2);
  check('a different image on a done page is still new work',
    out.tasks.some(t => t.title === 'Add alt text to the team photo'));
  check('an untouched page is unaffected',
    out.tasks.some(t => t.page_url === 'https://example.com/new'));
  check('image_alt is not treated as single-instance',
    !SINGLE_INSTANCE_FIX_TYPES.has('image_alt') && SINGLE_INSTANCE_FIX_TYPES.has('meta_title'));
  check('an open task on a done page is still raised',
    !isRepeatTask({ page_url: 'https://example.com/pricing', fix_type: 'page_speed',
      title: 'Compress the hero image' }, done.get('example.com/pricing')));

  const prompt = completedWorkPrompt(done);
  check('the prompt block lists completed work per page',
    prompt.includes('example.com/pricing:') &&
    prompt.includes('- Add a meta title to the Pricing page'), JSON.stringify(prompt));
  check('an empty record produces an empty block', completedWorkPrompt(new Map()) === '');
}

console.log(failed === 0 ? '\nAll repeat-suppression checks passed' : '\n' + failed + ' check(s) failed');
process.exit(failed === 0 ? 0 : 1);
