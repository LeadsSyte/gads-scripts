// Regression specs for the Content Engine bugs we fixed during the
// May article-formatting bug hunt. Each test is a hard regression guard
// for a specific report — if anyone re-introduces the bug, the relevant
// test fails by name so triage is instant.

import { test, expect, TEST_CLIENT } from './fixtures.js';

const SAMPLE_ARTICLE = `**Meta Title:** Best Cape Town Hotels 2026 | Syte
**Meta Description:** Discover the best boutique hotels in Cape Town.

# Best Cape Town Hotels 2026
**AEO Summary Block:** Cape Town's top boutique hotels combine sea views and fine dining.

## Top Picks

- **Hotel A** — beachfront
- **Hotel B** — city centre

## Pricing

| Hotel | Per night | Stars |
|-------|-----------|-------|
| Hotel A | 4500 | 5 |
| Hotel B | 2800 | 4 |

\`\`\`json
{ "@type": "FAQPage" }
\`\`\`

\`\`\`json
{ "overall": 88 }
\`\`\`
`;

const seedArticle = (clientId, output = SAMPLE_ARTICLE, overrides = {}) => ({
  id: 'seeded-article-1',
  client_id: clientId,
  client_name: 'Test Client',
  topic: 'Best Cape Town Hotels 2026',
  keyword: 'cape town hotels',
  length: 1500,
  output,
  tab: 'Auto Write',
  opportunity_type: 'low-hanging-fruit',
  generated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
});

// Override the fixture's blanket `[]` Supabase stub for the
// content_blogs endpoint — return the seeded rows so loadContentHistory
// (which always queries Supabase first when configured) populates the
// pipeline view with our data instead of wiping it.
async function stubContentBlogs(page, rows) {
  await page.route('**/syte_suite_content_blogs**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows)
    });
  });
}

// Seed BOTH the client (with pages_per_month: 1 so a single article meets
// quota and the client lands in the open "Articles Written" section) and
// the article. The fixture's addInitScript already sets the original test
// client; this overrides it with our quota-of-1 variant.
async function seedClientAndArticle(page, article) {
  await page.addInitScript(({ client, art }) => {
    localStorage.setItem('syte-suite-clients', JSON.stringify([client]));
    localStorage.setItem('syte-suite-selected-client', client.id);
    localStorage.setItem('syte-suite-content_blogs', JSON.stringify([art]));
  }, { client: { ...TEST_CLIENT, pages_per_month: 1 }, art: article });
}

// =============================================================================
// REGRESSION: AutoWrite "Articles Written" expanded view shows the article body
// as a Rendered Preview (formatted HTML), not raw markdown text.
// Original bug: ParsedSection wrapped content in <pre> with white-space:pre-wrap
// so users saw "# Heading", "- bullet", "| col |" as plain text instead of the
// formatted article. Fixed in PR #46 by adding a .article-rendered preview
// block above the raw-text copy panels.
// =============================================================================
test('regression: Articles Written expanded view renders body as formatted HTML', async ({ page }) => {
  const article = seedArticle(TEST_CLIENT.id);
  await stubContentBlogs(page, [article]);
  await seedClientAndArticle(page, article);

  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  await page.getByRole('button', { name: 'Auto Write' }).first().click();

  // The "Articles Written" section is open by default. With pages_per_month=1
  // the seeded client meets quota and renders as a clickable card there.
  // Scope the click to the .card element so we don't accidentally hit the
  // section's collapsed-text fallback or the topbar select option.
  const clientCard = page.locator('.content-area .card').filter({ hasText: TEST_CLIENT.name }).first();
  await clientCard.click();

  // Open the per-article view.
  const viewSummary = page.getByText(/View article/).first();
  await viewSummary.click();

  // The Rendered Preview block must contain real <h1>, <h2>, <table>, <ul>
  // elements — not raw markdown text.
  const preview = page.locator('.article-rendered').first();
  await expect(preview).toBeVisible();
  await expect(preview.locator('h1')).toContainText(/Best Cape Town Hotels/);
  await expect(preview.locator('h2').first()).toBeVisible();
  await expect(preview.locator('ul li').first()).toBeVisible();
  await expect(preview.locator('table th').first()).toBeVisible();

  // Belt-and-braces: the rendered text should NOT contain literal markdown
  // syntax — that would mean the body is being shown as raw text again.
  const text = await preview.innerText();
  expect(text.includes('# Best Cape Town')).toBe(false);
  expect(text.includes('| Hotel')).toBe(false);
});

// =============================================================================
// REGRESSION: Content Engine "History" tab preview is also formatted HTML.
// This was the third place the raw <pre> rendering hid — we fixed the live
// generation view + Auto Write expanded view but the History tab kept showing
// raw markdown until the follow-up.
// =============================================================================
test('regression: History tab preview renders as formatted HTML', async ({ page }) => {
  // Seed the localStorage history (the History tab reads this, not the
  // shared content_blogs table).
  await page.addInitScript((sample) => {
    const h = [{
      id: 'hist-1', client_id: 'test-client-1', client_name: 'Test Client',
      tab: 'New Article', topic: 'Best Cape Town Hotels 2026', keyword: 'cape town hotels',
      output: sample, created_at: new Date().toISOString()
    }];
    localStorage.setItem('syte-suite-content-history', JSON.stringify(h));
  }, SAMPLE_ARTICLE);

  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  await page.getByRole('button', { name: 'History' }).first().click();

  // Click the client summary card to expand the article list.
  await page.locator('.content-area').getByText(TEST_CLIENT.name).first().click();

  // Open the article preview details.
  await page.getByText('Preview').first().click();

  // Same DOM-shape assertions as the Auto Write test.
  const preview = page.locator('.article-rendered').first();
  await expect(preview).toBeVisible();
  await expect(preview.locator('h1')).toContainText(/Best Cape Town Hotels/);
  await expect(preview.locator('table')).toBeVisible();
});

// =============================================================================
// REGRESSION: AutoWrite refreshes shared content history when the tab regains
// focus. Original bug: a user wrote an article in one place, navigated away,
// came back to Auto Write, and the article looked missing because the
// component never re-fetched. Fixed by adding focus + visibilitychange
// listeners that re-call loadContentHistory().
// =============================================================================
test('regression: AutoWrite re-fetches history on window focus', async ({ page }) => {
  // Step 1: prime with a single article so the page mounts populated.
  let stubRows = [seedArticle(TEST_CLIENT.id)];
  await page.route('**/syte_suite_content_blogs**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stubRows)
    });
  });
  await seedClientAndArticle(page, stubRows[0]);

  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  await page.getByRole('button', { name: 'Auto Write' }).first().click();

  // Step 2: simulate "an article was written elsewhere" by swapping
  // the stubbed response, then fire focus. The focus listener should
  // re-call loadContentHistory which now returns the new row.
  // Click the client card to expand so the new article shows in the list.
  const clientCard = page.locator('.content-area .card').filter({ hasText: TEST_CLIENT.name }).first();
  await clientCard.click();

  stubRows = [
    seedArticle(TEST_CLIENT.id),
    seedArticle(TEST_CLIENT.id, SAMPLE_ARTICLE, { id: 'seeded-article-2', topic: 'Refreshed Article Title' })
  ];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  // The new article's topic should appear once the history reloads.
  await expect(page.locator('.content-area').getByText('Refreshed Article Title').first())
    .toBeVisible({ timeout: 5000 });
});
