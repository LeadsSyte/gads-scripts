// Shared E2E fixtures + helpers. Bypasses the lock screen by priming
// localStorage with a fake API key, drops a known test client into
// localStorage so the modules have something to render, and intercepts
// every external network call (Anthropic, Supabase, Google) so the
// suite never reaches out to real services in CI.

import { test as base, expect } from '@playwright/test';

const SEED_CLIENT = {
  id: 'test-client-1',
  name: 'Test Client',
  url: 'https://test.example/',
  industry: 'Hospitality',
  location: 'Cape Town',
  voice: 'Editorial',
  audience: 'Travellers',
  context: 'A boutique hotel chain',
  author: 'Mike',
  sitemap_url: 'https://test.example/sitemap.xml',
  gsc_property: 'sc-domain:test.example',
  ga4_property_id: '123456789',
  aeo_probe_queries: 'best hotels in Cape Town',
  competitors: 'OneAndOnly',
  does_content: true,
  does_technical: true,
  does_aeo: true,
  pages_per_month: 4,
  client_type: 'lead_gen'
};

export const test = base.extend({
  // `page` already exists; we layer route-stubbing + storage seeding on top.
  page: async ({ page }, use) => {
    // Stub external APIs *before* the page loads so we never hit the network.
    await page.route('**/api.anthropic.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ type: 'text', text: 'Stubbed Claude response' }],
          stop_reason: 'end_turn'
        })
      });
    });
    await page.route('**/api.openai.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/generativelanguage.googleapis.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/searchconsole.googleapis.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"rows":[]}' });
    });
    await page.route('**/analyticsdata.googleapis.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"rows":[]}' });
    });
    await page.route('**/oauth2/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    // Supabase project URLs — usually `*.supabase.co`. Stub everything.
    await page.route('**/*.supabase.co/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    // Page-proxy and CORS proxy used by the crawler.
    await page.route('**/page-proxy*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 200, html: '<html><body>x</body></html>', source: 'stub' })
      });
    });
    await page.route('**/cors-proxy*', (route) => {
      route.fulfill({ status: 200, body: '<html><body>x</body></html>' });
    });

    // Prime localStorage on the *first* navigation so unlock + first
    // client both happen automatically.
    await page.addInitScript((seed) => {
      localStorage.setItem('syte-suite-api-key', 'sk-test-stub');
      localStorage.setItem('syte-suite-clients', JSON.stringify([seed]));
      localStorage.setItem('syte-suite-selected-client', seed.id);
    }, SEED_CLIENT);

    await use(page);
  }
});

export { expect };
export const TEST_CLIENT = SEED_CLIENT;
