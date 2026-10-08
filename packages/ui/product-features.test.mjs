import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_ID, TOTP_ID, isFavorite, setFavorite, setAuthenticator, parseTotp, totp, analyzePasswords } from './src/product-features.mjs';

const base32 = bytes => {
  let buffer = 0, bits = 0, result = '';
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer >>> bits) & 31]; } }
  if (bits) result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer << (5 - bits)) & 31];
  return result;
};
test('TOTP matches all RFC 6238 Appendix B vectors including times after 2038', async () => {
  const times = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
  const vectors = {
    SHA1: ['94287082','07081804','14050471','89005924','69279037','65353130'],
    SHA256: ['46119246','68084774','67062674','91819424','90698825','77737706'],
    SHA512: ['90693936','25091201','99943326','93441116','38618901','47863826'],
  };
  for (const [algorithm, codes] of Object.entries(vectors)) {
    const length = { SHA1: 20, SHA256: 32, SHA512: 64 }[algorithm];
    const secret = base32(new TextEncoder().encode('1234567890'.repeat(7).slice(0, length)));
    for (let index = 0; index < times.length; index++) {
      const result = await totp(`otpauth://totp/Test?secret=${secret}&algorithm=${algorithm}&digits=8`, times[index]);
      assert.equal(result.code, codes[index]); assert.equal(result.remaining, 30 - times[index] % 30);
    }
  }
});
test('TOTP refreshes on a period boundary and supports plain setup keys', async () => {
  const key = 'JBSWY3DPEHPK3PXP';
  const before = await totp(key, 29), after = await totp(key, 30);
  assert.equal(before.remaining, 1); assert.equal(after.remaining, 30); assert.notEqual(before.code, after.code);
  assert.equal(after.code, (await totp(`otpauth://totp/Test?secret=${key}`, 30)).code);
  assert.equal(parseTotp(`otpauth://totp/Test?secret=${key}&period=60`).period, 60);
});
test('invalid authenticator options are rejected without echoing secrets', () => {
  for (const value of ['', 'INVALID1', 'ABC', 'otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP', 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=MD5', 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7', 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=0']) assert.throws(() => parseTotp(value));
});
test('favorites and authenticator edits preserve other fields and do not mutate originals', () => {
  const original = [{ id: 'note', label: 'Note', type: 'text', value: 'keep me' }];
  let fields = setFavorite(original, true); assert.equal(isFavorite(fields), true);
  fields = setAuthenticator(fields, 'JBSWY3DPEHPK3PXP');
  fields = setFavorite(fields, false); assert.equal(isFavorite(fields), false);
  assert.equal(fields.find(f => f.id === TOTP_ID).type, 'password');
  assert.deepEqual(fields[0], original[0]); assert.equal(original.length, 1);
  assert.equal(setFavorite(setFavorite(original, true), true).filter(f => f.id === FAVORITE_ID).length, 1);
  assert.deepEqual(setAuthenticator(fields, ''), original);
});
test('health finds cross-vault reuse and weak passwords without returning secret values', () => {
  const items = [
    { itemId: 'same-id', vaultId: 'one', title: 'One', password: 'long-shared-synthetic-password', customFields: [] },
    { itemId: 'same-id', vaultId: 'two', title: 'Two', password: 'long-shared-synthetic-password', customFields: [] },
    { itemId: 'three', vaultId: 'one', title: 'Three', password: 'password1', customFields: [{ id: TOTP_ID, label: 'Authenticator password', type: 'password', value: '123' }] },
    { itemId: 'four', title: 'Four', password: '', customFields: [{ id: 'related', label: 'App password', type: 'password', value: 'short' }, { id: 'pin', label: 'PIN', type: 'password', value: '1234' }] }
  ];
  const findings = analyzePasswords(items);
  assert.equal(findings.length, 4); assert.match(findings[0].issues.join(), /Reused across 2 items/);
  assert.match(findings[2].issues.join(), /Common/); assert.equal(findings[3].label, 'App password');
  assert.ok(!JSON.stringify(findings).includes('password1')); assert.ok(!JSON.stringify(findings).includes('long-shared-synthetic-password'));
});
test('reuse within the same item is not counted as another account', () => {
  assert.deepEqual(analyzePasswords([{ itemId: 'one', title: 'One', password: 'long-unique-synthetic-value', customFields: [{ id: 'related', label: 'Related password', type: 'password', value: 'long-unique-synthetic-value' }] }]), []);
});
