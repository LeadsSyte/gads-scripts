// E2E sad-path coverage. The smoke tests cover happy paths; these cover
// what happens when things break — auth fails, network drops, modules
// receive empty/malformed data. The kind of bugs that pass unit tests
// but show up as a blank white page in production.
//
// Strategy: each test takes the standard fixture (which stubs every
// external API as 200 OK) and selectively reroutes the relevant
// endpoint to a failure state, then asserts the UI degrades gracefully
// instead of crashing or going blank.

import { test as base, expect } from '@playwright/test';

// Build the standard fixture WITHOUT the auto-API-stubs so we can
// override per-test with concrete failure states.
const SEED_CLIENT = {
  id: 'sad-client-1',
  name: 'Sad Path Client',
  url: 'https://sad.example/',
  industry: 'Hospitality',
  location: 'Cape Town',
  voice: 'Editorial',
  audience: 'Travellers',
  context: 'Test',
  author: 'Mike',
  sitemap_url: 'https://sad.example/sitemap.xml',
  gsc_property: 'sc-domain:sad.example',
  ga4_property_id: '123456789',
  aeo_probe_queries: 'best hotels',
  competitors: 'OneAndOnly',
  does_content: true, does_technical: true, does_aeo: true,
  pages_per_month: 4
};

const test = base.extend({
  page: async ({ page }, use) => {
    // Default: fail every external API. Tests can override.
    await page.route('**/api.anthropic.com/**', r => r.fulfill({ status: 500, body: '{"error":"down"}' }));
    await page.route('**/api.openai.com/**',    r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/generativelanguage.googleapis.com/**', r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/searchconsole.googleapis.com/**', r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/analyticsdata.googleapis.com/**', r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/oauth2/**', r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 500, body: '[]' }));
    await page.route('**/page-proxy*', r => r.fulfill({ status: 500, body: '{}' }));
    await page.route('**/cors-proxy*', r => r.fulfill({ status: 500, body: '' }));

    await page.addInitScript((seed) => {
      localStorage.setItem('syte-suite-api-key', 'sk-test-stub');
      localStorage.setItem('syte-suite-clients', JSON.stringify([seed]));
      localStorage.setItem('syte-suite-selected-client', seed.id);
    }, SEED_CLIENT);

    await use(page);
  }
});

// =============================================================================
// Lock screen sad paths — wrong password, no cached key
// =============================================================================
test('lock screen: shown when no cached API key in storage', async ({ page }) => {
  await page.addInitScript(() => {
    // Override the seeded init: clear the API key so the lock screen shows.
    localStorage.removeItem('syte-suite-api-key');
  });
  await page.goto('/');
  await expect(page.getByPlaceholderText('Password')).toBeVisible();
});

test('lock screen: wrong password shows "Wrong password" + does NOT advance', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('syte-suite-api-key'));
  await page.goto('/');
  await page.getByPlaceholderText('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/Wrong password/i)).toBeVisible();
  // Sidebar must still be hidden — we're stuck on the lock screen.
  await expect(page.getByText('SEO Suite')).not.toBeVisible();
});

// =============================================================================
// Network-down sad paths — every external API returns 500
// =============================================================================
test('app boots even when every external API is unreachable', async ({ page }) => {
  await page.goto('/');
  // Sidebar still renders. We're inside the shell, just with no data.
  await expect(page.locator('aside.sidebar, [class*="sidebar" i]').first()).toBeVisible({ timeout: 5000 });
});

test('Technical SEO loads with no Google + no Supabase + no proxy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Technical SEO' }).first().click();
  // Page renders. No "TypeError" or "undefined is not a function" leaks.
  await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
  await expect(page.locator('body')).not.toContainText(/TypeError/);
});

test('Reports loads even when Supabase + Google are both down', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reports' }).first().click();
  // Should still see the client card grid.
  await expect(page.getByText(SEED_CLIENT.name)).toBeVisible({ timeout: 5000 });
  // No crash language in the body.
  await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
});

test('Content Engine loads when Anthropic + Supabase are 500', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
  await expect(page.locator('body')).not.toContainText(/TypeError/);
});

test('AEO Engine loads when Anthropic + Google + Supabase are all down', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AEO Engine' }).first().click();
  await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
});

// =============================================================================
// Empty-data sad paths — API succeeds but returns nothing useful
// =============================================================================
test('Reports → Monthly Report renders with empty Supabase responses', async ({ page }) => {
  // Override the default 500s — return empty 200s.
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, body: '[]' }));
  await page.route('**/api.anthropic.com/**', r => r.fulfill({
    status: 200, body: JSON.stringify({ content: [{ type: 'text', text: '' }] })
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Reports' }).first().click();
  await expect(page.getByText(SEED_CLIENT.name)).toBeVisible();
  // Pending badge should be visible (no sent + no generated reports).
  // We don't assert on the exact label — modules may localise it.
  await expect(page.locator('body')).not.toContainText(/undefined/i);
});

test('AutoWrite renders with no articles in Supabase + no Google token', async ({ page }) => {
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, body: '[]' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Content Engine' }).first().click();
  // No "Articles Written" expected, but the section headers + empty
  // states still render.
  await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
});

// =============================================================================
// Missing-config sad path — client without any of the optional fields
// =============================================================================
test('client with just name + url renders in every module without crashing', async ({ page }) => {
  await page.addInitScript(() => {
    const minimal = { id: 'min-1', name: 'Bare Bones', url: 'https://bare.example/' };
    localStorage.setItem('syte-suite-clients', JSON.stringify([minimal]));
    localStorage.setItem('syte-suite-selected-client', 'min-1');
  });
  await page.goto('/');

  for (const moduleName of ['Clients', 'Technical SEO', 'Reports', 'AEO Engine', 'Content Engine', 'CMS']) {
    await page.getByRole('button', { name: moduleName }).first().click();
    // Module rendered without throwing.
    await expect(page.locator('body')).not.toContainText(/undefined is not a function/i);
    await expect(page.locator('body')).not.toContainText(/TypeError/);
  }
});
