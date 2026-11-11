import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { createHash } from 'node:crypto';
import { serverConnection } from '../src/server-connection.mjs';

const input = { serverUrl: 'https://192.168.1.10:12780', installationId: '10000000-0000-4000-8000-000000000001',
  caCertificate: rootCertificates[0], leafCertificate: rootCertificates[0] };
test('connection export contains only portable public material and the exact PEM fingerprint used by clients', () => {
  const connection = serverConnection(input);
  assert.equal(connection.schemaVersion, 1);
  assert.equal(connection.serverUrl, input.serverUrl);
  assert.equal(connection.caSha256, createHash('sha256').update(connection.caCertificate).digest('hex'));
  assert.deepEqual(Object.keys(connection).sort(), ['schemaVersion', 'kind', 'serverName', 'serverUrl', 'installationId', 'caCertificate', 'caSha256'].sort());
  assert.ok(!JSON.stringify(connection).includes('PRIVATE KEY'));
});
test('connection export rejects malformed identity, credentials, non-HTTPS and a CA unrelated to the server', () => {
  for (const changed of [{ serverUrl: 'http://192.168.1.10' }, { serverUrl: 'https://user:password@192.168.1.10' },
    { serverUrl: 'https://192.168.1.10/?key=secret' }, { installationId: 'invalid' }, { serverName: 'Server\nInjected' },
    { leafCertificate: rootCertificates[1] }, { caCertificate: '-----BEGIN PRIVATE KEY-----' }]) {
    assert.throws(() => serverConnection({ ...input, ...changed }));
  }
});
