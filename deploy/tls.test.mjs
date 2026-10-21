import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsOperatorSid, certificateSan } from '../scripts/tls.mjs';

test('private-CA SAN is exact DNS or IP and cannot inject certificate extensions', () => {
  assert.equal(certificateSan('vault.home.arpa'), 'DNS:vault.home.arpa');
  assert.equal(certificateSan('home.tail123.ts.net'), 'DNS:home.tail123.ts.net');
  assert.equal(certificateSan('127.0.0.1'), 'IP:127.0.0.1');
  for (const name of ['*.example.com','vault.local','home.localhost','Vault.Example.com','example.com\nDNS:evil.test','example.com,IP:8.8.8.8','8.8.999.1']) {
    assert.throws(() => certificateSan(name));
  }
});

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
