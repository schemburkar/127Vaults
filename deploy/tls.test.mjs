import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsOperatorSid } from '../scripts/tls.mjs';

test('Windows ACL identity comes from the token SID, independent of domain and localized account names', () => {
  assert.equal(windowsOperatorSid((program, args) => {
    assert.equal(program, 'whoami.exe');
    assert.deepEqual(args, ['/user', '/fo', 'csv', '/nh']);
    return { status: 0, stdout: '"SUNRISE\\shubh","S-1-5-21-111-222-333-1001"\r\n' };
  }), '*S-1-5-21-111-222-333-1001');
});

test('Windows ACL provisioning fails closed on missing or ambiguous token identity', () => {
  for (const result of [{ status: 1, stdout: '' }, { status: 0, stdout: 'WORKGROUP\\shubh' },
    { status: 0, stdout: 'S-1-5-21-1 S-1-5-21-2' }]) {
    assert.throws(() => windowsOperatorSid(() => result), /operator SID/);
  }
});
