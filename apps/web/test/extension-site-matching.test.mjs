import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function extensionOrigin(website) {');
const end = source.indexOf('window.__vaultsExtensionActions =', start);
const { extensionOrigin, extensionRelatedLogins } = new Function(`${source.slice(start, end)}; return {extensionOrigin, extensionRelatedLogins}`)();

test('web source matches bare websites without modifying stored data', () => {
  const website = ' VERCEL.COM/login ';
  assert.equal(extensionOrigin(website), 'https://vercel.com');
  assert.equal(extensionOrigin('vercel.com:444/path'), 'https://vercel.com:444');
  for (const value of ['http://vercel.com', '//vercel.com', 'user@vercel.com', '*.vercel.com', 'vercel.com\\evil', 'vercel.\tcom']) {
    assert.equal(extensionOrigin(value), null, value);
  }
  const section = 'related';
  const item = { itemId: 'item', body: { customFields: [
    { id: `__127vaults_section:${section}`, type: 'metadata', value: 'login|Related' },
    { id: `__127vaults_field:${section}:website`, type: 'url', value: website },
    { id: `__127vaults_field:${section}:password`, type: 'password', value: '[redacted]' },
  ] } };
  const entries = extensionRelatedLogins(item, 'https://vercel.com');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].website, website);
  assert.equal(extensionRelatedLogins(item, 'https://app.vercel.com').length, 0);
});
