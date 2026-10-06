import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = ['index', 'product', 'security', 'deployment', 'pricing', 'downloads', 'get-started', 'faq'];

test('public pages clearly label Cloud and release availability', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(`./${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /\* Coming soon:<\/strong> 127Vaults Cloud is planned and not available yet/, page);
    assert.match(html, /No public vault release is available/, page);
  }
});

test('public copy does not advertise shared vaults', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(`./${page}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /shared vaults/i, page);
  }
});
