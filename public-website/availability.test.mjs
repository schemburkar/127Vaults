import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = ['index', 'product', 'security', 'deployment', 'pricing', 'downloads', 'get-started', 'faq'];

test('Cloud availability appears on its disabled plan button', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(`./${page}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /availability-note/, page);
    if (page === "pricing" || page === "index") assert.match(html, /<button class="plan-cta" type="button" disabled>Coming Soon<\/button>/);
    else assert.doesNotMatch(html, /coming soon/i, page);
  }
});

test('public copy does not advertise shared vaults', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(`./${page}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /shared vaults/i, page);
  }
});
