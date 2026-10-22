// Load shedding is long over: the writer is told never to mention it, and an
// article that still does is held by the autopilot and refused at push.
import { findStaleTopics, staleTopicReason } from '../src/modules/content/staleTopics.js';
import { CORE_RULES } from '../src/modules/content/prompts.js';
import { unsupportedPushReason } from '../src/modules/cms/pushAction.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

await t('every spelling of load shedding is caught', async () => {
  for (const s of ['Beat load shedding with solar', 'during load-shedding', 'Loadshedding tips', 'loadsheding schedule', 'Eskom outages', 'rolling blackouts in Joburg', 'stage 6 power cuts'])
    ok(findStaleTopics(s).length, s);
});

await t('ordinary energy writing is not caught', async () => {
  for (const s of ['Solar panels cut your electricity bill', 'Stage 2 of the project', 'a backup inverter for your home office', 'shedding pounds before summer'])
    ok(!findStaleTopics(s).length, s);
});

await t('the writer is told never to mention it', async () => {
  ok(/NEVER mention load shedding/.test(CORE_RULES));
});

await t('an article that mentions it is refused at push, with the line quoted', async () => {
  const r = unsupportedPushReason({ module: 'content', change_type: 'article', payload: { html: '<p>Keep the lights on during load shedding.</p>' } });
  ok(/Not pushed: Mentions load shedding/.test(r), r);
  ok(!unsupportedPushReason({ module: 'content', change_type: 'article', payload: { html: '<p>Solar for your home.</p>' } }));
  ok(staleTopicReason('Eskom').includes('"Eskom"'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
