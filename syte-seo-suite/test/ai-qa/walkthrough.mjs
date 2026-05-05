// AI-driven exploratory walkthrough.
//
// Drives a real browser through the Content Engine as a named persona,
// captures a screenshot at each step, and asks Claude (vision) "does
// this look right?" Claude flags anything broken — formatting issues,
// missing elements, error text, unexpected empty states — without
// needing a hand-written assertion for every check.
//
// Inputs (env):
//   BASE_URL           — full URL of the deploy preview / staging site
//   ANTHROPIC_API_KEY  — for Claude vision calls
//   NETLIFY_PASSWORD   — optional, if the deploy preview is protected
//
// Output (stdout, JSON line per finding):
//   {"step":"...","status":"ok"|"broken","summary":"...","details":"..."}
//
// Exit code: 0 if every step ok, 1 if any step broken.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = resolve(here, '../../test-results/ai-qa');
mkdirSync(ARTIFACT_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NETLIFY_PASSWORD = process.env.NETLIFY_PASSWORD || '';
const MODEL = process.env.AI_QA_MODEL || 'claude-sonnet-4-6';

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — AI-QA walkthrough cannot run.');
  process.exit(2);
}

// ----- Persona + flow -------------------------------------------------------
// Add new personas here. The persona shapes what the AI looks for at each
// step (what "looks right" means for THIS user) without needing scripted
// assertions.
const PERSONA = {
  name: 'Mike — SEO operator at Syte',
  role: 'Senior SEO content writer',
  goal: 'Write a complete article for a hospitality client and verify it' +
        ' appears in Articles Written with formatted preview, ready to push' +
        ' to WordPress.',
  expectations: [
    'The Content Engine module loads with sub-navigation visible',
    'Auto Write shows a pipeline view with client cards in clear sections',
    'Articles Written, when expanded, shows a Rendered Preview block with' +
    ' actual headings, lists, tables — never raw markdown like "# Heading"' +
    ' or "| col | col |"',
    'Buttons do what their labels say (Generate, Push to WP, Mark Implemented)',
    'No "undefined", "NaN", "[object Object]", or visible stack traces'
  ]
};

// Each step: navigate, take screenshot, ask Claude to validate.
const SEED_CLIENT = {
  id: 'ai-qa-client', name: 'AI-QA Hotel Group', url: 'https://ai-qa.example/',
  industry: 'Hospitality', location: 'Cape Town',
  voice: 'Editorial', audience: 'Travellers', author: 'Test Author',
  sitemap_url: 'https://ai-qa.example/sitemap.xml',
  gsc_property: 'sc-domain:ai-qa.example', ga4_property_id: '123',
  does_content: true, does_technical: true, does_aeo: true,
  pages_per_month: 4, client_type: 'lead_gen'
};

const SEED_ARTICLE = {
  id: 'ai-qa-article-1',
  client_id: SEED_CLIENT.id, client_name: SEED_CLIENT.name,
  topic: 'Best Cape Town Hotels 2026',
  keyword: 'cape town hotels', length: 1500,
  output: '**Meta Title:** Best Cape Town Hotels 2026 | Syte\n' +
    '**Meta Description:** Discover the best boutique hotels in Cape Town.\n\n' +
    '# Best Cape Town Hotels 2026\n' +
    "**AEO Summary Block:** Cape Town's top boutique hotels combine sea views and fine dining.\n\n" +
    '## Top Picks\n\n- **Hotel A** — beachfront\n- **Hotel B** — city centre\n\n' +
    '## Pricing\n\n| Hotel | Per night | Stars |\n|-------|-----------|-------|\n' +
    '| Hotel A | 4500 | 5 |\n| Hotel B | 2800 | 4 |\n\n' +
    '```json\n{"@type":"FAQPage"}\n```\n\n```json\n{"overall":88}\n```',
  tab: 'Auto Write', generated_at: new Date().toISOString(),
  created_at: new Date().toISOString()
};

const STEPS = [
  {
    name: 'app-boot',
    description: 'App boots past the lock screen and shows the sidebar.',
    do: async (page) => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
    }
  },
  {
    name: 'content-engine-loads',
    description: 'Content Engine module renders without crash text.',
    do: async (page) => {
      await page.getByRole('button', { name: 'Content Engine' }).first().click();
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'auto-write-pipeline',
    description: 'Auto Write shows the pipeline view with the seeded client.',
    do: async (page) => {
      await page.getByRole('button', { name: 'Auto Write' }).first().click();
      await page.waitForTimeout(800);
    }
  },
  {
    name: 'expand-articles-written',
    description: 'Click the seeded client card to expand it. The expanded ' +
      'view should list the seeded article with a "View article" toggle.',
    do: async (page) => {
      const card = page.locator('.content-area').getByText(SEED_CLIENT.name).first();
      if (await card.count() > 0) await card.click();
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'rendered-preview',
    description: 'Click "View article" — the Rendered Preview block must ' +
      'show formatted HTML (real <h1>, <table>, lists), NOT raw markdown.',
    do: async (page) => {
      const view = page.getByText(/View article/i).first();
      if (await view.count() > 0) await view.click();
      await page.waitForTimeout(500);
    }
  }
];

// ----- Claude vision call ---------------------------------------------------
async function askClaude(stepName, stepDescription, screenshotBase64) {
  const personaSummary = PERSONA.name + ' — ' + PERSONA.role + '. Goal: ' + PERSONA.goal;
  const expectations = PERSONA.expectations.map((e, i) => (i + 1) + '. ' + e).join('\n');

  const userText = [
    'You are a QA reviewer watching ' + personaSummary,
    '',
    'Step: ' + stepName,
    'Expected: ' + stepDescription,
    '',
    'General expectations for the whole walkthrough:',
    expectations,
    '',
    'Look at the screenshot. Reply ONLY with strict JSON:',
    '{ "status": "ok" | "broken", "summary": "<one sentence>", "details": "<what is broken or empty string>" }',
    '',
    'Mark "broken" only for visible regressions: raw markdown rendering as text, error messages, missing critical UI elements, broken layout. Do NOT flag things like "could be more polished" or minor styling preferences.'
  ].join('\n');

  const body = {
    model: MODEL,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
        { type: 'text', text: userText }
      ]
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Anthropic API ' + res.status + ': ' + txt.slice(0, 300));
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Pull the first JSON object out of the response (be lenient about prose).
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { status: 'broken', summary: 'Claude returned no parseable JSON', details: text.slice(0, 400) };
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return { status: 'broken', summary: 'Claude JSON parse failed: ' + e.message, details: match[0].slice(0, 400) };
  }
}

// ----- Run ------------------------------------------------------------------
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Pass Netlify password protection if set.
  ...(NETLIFY_PASSWORD ? { httpCredentials: { username: 'netlify', password: NETLIFY_PASSWORD } } : {})
});

// Seed localStorage so the suite has a client + article to render.
await context.addInitScript(({ client, article }) => {
  localStorage.setItem('syte-suite-api-key', 'sk-test-stub');
  localStorage.setItem('syte-suite-clients', JSON.stringify([client]));
  localStorage.setItem('syte-suite-selected-client', client.id);
  localStorage.setItem('syte-suite-content_blogs', JSON.stringify([article]));
}, { client: SEED_CLIENT, article: SEED_ARTICLE });

// Stub Anthropic + Supabase so the walkthrough doesn't hit real services
// from inside the live preview app. (We're only using Anthropic ourselves
// for the vision validation calls, made directly from this script.)
const STUB_ROUTES = [
  ['**/api.anthropic.com/**', { content: [{ type: 'text', text: 'stub' }], stop_reason: 'end_turn' }],
  ['**/api.openai.com/**', {}],
  ['**/generativelanguage.googleapis.com/**', {}],
  ['**/searchconsole.googleapis.com/**', { rows: [] }],
  ['**/analyticsdata.googleapis.com/**', { rows: [] }],
  ['**/oauth2/**', {}]
];
for (const [pattern, body] of STUB_ROUTES) {
  await context.route(pattern, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}
// Supabase content_blogs returns the seeded article; everything else returns [].
await context.route('**/*.supabase.co/**', (route) => {
  const url = route.request().url();
  const body = url.includes('syte_suite_content_blogs') ? [SEED_ARTICLE] : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const page = await context.newPage();

let brokenCount = 0;
const results = [];

for (const step of STEPS) {
  try {
    await step.do(page);
  } catch (e) {
    const finding = {
      step: step.name, status: 'broken',
      summary: 'Step threw before screenshot: ' + e.message.slice(0, 120),
      details: ''
    };
    console.log(JSON.stringify(finding));
    results.push(finding);
    brokenCount++;
    continue;
  }

  const png = await page.screenshot({ fullPage: false });
  const file = resolve(ARTIFACT_DIR, step.name + '.png');
  writeFileSync(file, png);

  let finding;
  try {
    finding = await askClaude(step.name, step.description, png.toString('base64'));
  } catch (e) {
    finding = { status: 'broken', summary: 'Vision call failed: ' + e.message.slice(0, 120), details: '' };
  }
  finding.step = step.name;
  finding.screenshot = file;
  console.log(JSON.stringify(finding));
  results.push(finding);
  if (finding.status !== 'ok') brokenCount++;
}

// Markdown summary for the GitHub Action to comment on the PR.
const summaryPath = resolve(ARTIFACT_DIR, 'summary.md');
const summary = [
  '# AI-QA Walkthrough — ' + PERSONA.name,
  '',
  '| Step | Status | Summary |',
  '|---|---|---|',
  ...results.map(r => `| ${r.step} | ${r.status === 'ok' ? '✓' : '✗'} | ${(r.summary || '').replace(/\|/g, '\\|')} |`),
  '',
  brokenCount === 0 ? '**All steps ok.**' : '**' + brokenCount + ' step(s) flagged.** See screenshots in `test-results/ai-qa/`.'
].join('\n');
writeFileSync(summaryPath, summary);

await browser.close();
console.error(brokenCount === 0
  ? '\nAll ' + results.length + ' steps ok'
  : '\n' + brokenCount + ' / ' + results.length + ' steps flagged — see ' + summaryPath);
process.exit(brokenCount === 0 ? 0 : 1);
