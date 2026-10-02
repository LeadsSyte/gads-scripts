// The helper plugin's download and "is it installed?" check.

import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../src/modules/cms/wpApi.js', () => ({ wpRequest: vi.fn() }));

import { HELPER_PLUGIN_VERSION, checkHelperPlugin } from '../../src/modules/cms/helperPlugin.js';

const php = fs.readFileSync(path.resolve(__dirname, '../../wordpress-plugin/syte-seo-helper/syte-seo-helper.php'), 'utf8');

describe('Syte SEO Helper plugin', () => {
  test('the version the suite offers is the plugin\'s own, in both places it is written', () => {
    expect(HELPER_PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(php).toContain("define('SYTE_SEO_HELPER_VERSION', '" + HELPER_PLUGIN_VERSION + "');");
  });

  test('the plugin file is one WordPress will accept and only administrators can use', () => {
    expect(php.startsWith('<?php')).toBe(true);
    expect(php).toMatch(/Plugin Name:\s*Syte SEO Helper/);
    expect(php).toContain("if (!defined('ABSPATH')) { exit; }");
    expect(php).toContain("current_user_can('manage_options')");
    // No file writes, no code execution: fixes are rules applied to the page.
    for (const banned of ['file_put_contents', 'fwrite(', 'eval(', 'shell_exec', 'exec(', 'system(', 'base64_decode', 'unserialize(']) expect(php).not.toContain(banned);
  });

  test('installed, out of date, missing, and "not an administrator" are told apart', async () => {
    const client = { wp_url: 'https://k.example' };
    expect(await checkHelperPlugin(client, async () => ({ plugin: 'syte-seo-helper', version: HELPER_PLUGIN_VERSION, rules: 3, enabled: 2 })))
      .toEqual({ installed: true, version: HELPER_PLUGIN_VERSION, upToDate: true, rules: 3, enabled: 2 });
    expect((await checkHelperPlugin(client, async () => ({ plugin: 'syte-seo-helper', version: '0.9.0', rules: 0, enabled: 0 }))).upToDate).toBe(false);
    expect((await checkHelperPlugin(client, async () => { throw new Error('WordPress 404: No route was found'); })).reason).toMatch(/Not installed/);
    expect((await checkHelperPlugin(client, async () => { throw new Error('WordPress 403: Sorry, you are not allowed'); })).reason).toMatch(/Administrator/);
  });
});
