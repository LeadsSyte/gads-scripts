// E2E smoke tests — boot the actual app in a real browser and click
// through the critical flows. Catches the "button onClick is wired to
// nothing", "module crashes on render", "navigation route broken" tier
// of bugs that pure unit tests miss.

import { test, expect, TEST_CLIENT } from './fixtures.js';

// Scope client-name assertions to the module's content area — the topbar's
// client-picker <select> also renders an <option>Test Client</option>, which
// trips strict-mode locator matches and (because <option> is hidden until
// the select opens) also fails toBeVisible() on .first().
const inContent = (page) => page.locator('.content-area');

test('app boots, lock screen bypassed, sidebar present', async ({ page }) => {
  await page.goto('/');
  // Sidebar logo is the simplest "we got past the lock screen" signal.
  await expect(page.getByText('Syte', { exact: false })).toBeVisible();
  // The seeded client appears once we navigate to Clients.
  await page.getByRole('button', { name: 'Clients' }).first().click();
  await expect(inContent(page).getByText(TEST_CLIENT.name).first()).toBeVisible();
});

test('Technical SEO → Run Scan button is reachable for the seeded client', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Technical SEO' }).first().click();
  // Default sub is Dashboard; the pipeline lists clients and renders the
  // Run Scan action button. The bug we fixed had this button hidden.
  await expect(inContent(page).getByText(TEST_CLIENT.name).first()).toBeVisible();
  // The button's label may be 'Run Scan' or 'Re-scan' depending on bucket.
  const scanBtn = page.getByRole('button', { name: /Run Scan|Re-scan/i }).first();
  await expect(scanBtn).toBeVisible();
});

test('Reports → Monthly Report shows the client and a Generate button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reports' }).first().click();
  await expect(inContent(page).getByText(TEST_CLIENT.name).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate Report/i }).first()).toBeVisible();
});

test('AEO Engine sub-nav loads without crashing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AEO Engine' }).first().click();
  // We only assert: page didn't blow up. The sub views all render
  // *something* — a heading or section title.
  await expect(page.locator('body')).not.toContainText(/error|crash|undefined is not a function/i);
});

test('Content Engine sub-nav loads without crashing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  await expect(page.locator('body')).not.toContainText(/error|crash|undefined is not a function/i);
});

test('CMS sub-nav loads without crashing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CMS' }).first().click();
  await expect(page.locator('body')).not.toContainText(/error|crash|undefined is not a function/i);
});

// =============================================================================
// REGRESSION GUARD: the WebCEO -> crawler pipeline-status bug. With the bug
// in place, the seeded client (URL + sitemap, no GSC) would be bucketed as
// 'Credentials Missing' and the Run Scan button would NEVER render, even
// though the crawler is perfectly capable of scanning it.
// =============================================================================
test('regression: crawler-only client does NOT land in Credentials Missing', async ({ page }) => {
  // Re-seed BEFORE the first navigation so we don't need a reload — reload
  // under Vite/HMR was flaky in CI and the test ran out its 30s budget.
  // addInitScript runs again on the next goto.
  await page.addInitScript((seed) => {
    const c = { ...seed, gsc_property: '', wceo_project_id: '' };
    localStorage.setItem('syte-suite-clients', JSON.stringify([c]));
    localStorage.setItem('syte-suite-selected-client', c.id);
  }, TEST_CLIENT);
  await page.goto('/');
  await page.getByRole('button', { name: 'Technical SEO' }).first().click();
  // The pipeline view is async — wait for the seeded client to render in
  // the content area before asserting on action buttons. Without this
  // wait CI's slower runner races the load() → bucket → render cycle and
  // the Run Scan button hasn't mounted yet when the 5s expect kicks in.
  await expect(inContent(page).getByText(TEST_CLIENT.name).first()).toBeVisible({ timeout: 10000 });
  // The Credentials Missing section header may exist with 0 clients;
  // what we want is that the seeded client is NOT in that section.
  // Easiest check: a Run Scan button is reachable for this client.
  await expect(page.getByRole('button', { name: /Run Scan|Re-scan/i }).first()).toBeVisible();
});
