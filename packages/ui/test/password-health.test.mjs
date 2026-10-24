import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { analyzePasswords, breachedPasswords, changePasswordUrl, TOTP_ID } from '../src/product-features.mjs';
const item = { itemId: 'one', vaultId: 'vault', title: 'Example', website: 'https://example.com/login', password: 'password', customFields: [] };
test('health findings combine categories and preserve website without exposing passwords', () => {
  const findings = analyzePasswords([item, { ...item, itemId: 'two' }], new Set(['password']));
  assert.equal(findings.length, 2);
  assert.equal(findings[0].issues.length, 4);
  assert.equal(findings[0].website, item.website);
  assert.equal('password' in findings[0], false);
});
test('change password URL uses origin and rejects unsafe URLs', () => {
  assert.equal(changePasswordUrl(item.website), 'https://example.com/.well-known/change-password');
  for (const value of ['javascript:alert(1)', 'file:///tmp/test', 'https://user:secret@example.com', '', undefined]) assert.equal(changePasswordUrl(value), null);
});
test('breach lookup sends only hash prefix, requests padding, and ignores padding matches', async () => {
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-1', new TextEncoder().encode(item.password))).toString('hex').toUpperCase();
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(options.headers['Add-Padding'], 'true');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(`${hash.slice(5)}:42\r\n${'0'.repeat(35)}:0`);
  };
  assert.deepEqual(await breachedPasswords([item, item], { request }), new Set(['password']));
  assert.equal(calls, 1);
  assert.deepEqual(await breachedPasswords([item], { request: async () => new Response(`${hash.slice(5)}:0`) }), new Set());
});
test('breach failures and cancellation never masquerade as clean results', async () => {
  await assert.rejects(breachedPasswords([item], { request: async () => new Response('', { status: 503 }) }));
  await assert.rejects(breachedPasswords([item], { request: async () => new Response('invalid') }));
  await assert.rejects(breachedPasswords([item], { signal: AbortSignal.abort() }));
});
test('authenticator secrets are excluded from breach checks', async () => {
  const result = await breachedPasswords([{ ...item, password: '', customFields: [{ id: TOTP_ID, type: 'password', label: 'Password', value: 'secret' }] }], { request: async () => { throw Error('must not request'); } });
  assert.equal(result.size, 0);
});
