import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';

function fixture(status = 'revoked') {
  const keys = generateKeyPairSync('ed25519');
  const raw = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const id = '10000000-0000-4000-8000-000000000001';
  const device = '20000000-0000-4000-8000-000000000001';
  const account = '30000000-0000-4000-8000-000000000001';
  const approver = '40000000-0000-4000-8000-000000000001';
  const enrollment = { id, tenant_id: id, account_id: account, proposed_device_id: device,
    proposed_signing_public_key: raw, approver_device_id: approver,
    approved_at: new Date(0), consumed_at: null, expires_at: new Date(600000) };
  const binding = { accountId: account, enrollmentId: id, newDeviceId: device,
    newDevicePublicKey: raw.toString('base64url'), expiresAt: enrollment.expires_at.toISOString(),
    purpose: 'device-possession' };
  const proof = sign(null, Buffer.from(JSON.stringify(binding, Object.keys(binding).sort())), keys.privateKey).toString('base64url');
  const queries = [], inserted = [];
  const client = { async query(sql, params) {
    queries.push(sql);
    if (sql.includes('FROM vaults.device_enrollment_requests')) return { rows: [enrollment] };
    if (sql.includes('FROM vaults.devices')) return { rows: status === 'active' ? [{ credential_epoch: 1 }] : [] };
    if (sql.includes('FROM vaults.authentication_credentials')) return { rows: [{ credential_epoch: 1 }] };
    if (sql.startsWith('INSERT INTO vaults.devices')) inserted.push(params);
    return { rows: [], rowCount: 1 };
  }, release() {} };
  return { store: new PgDeviceLifecycleStore({ connect: async () => client }, { now: () => new Date(1000) }),
    input: { enrollmentId: id, pollToken: 'p'.repeat(43), possessionSignature: proof }, queries, inserted };
}

for (const status of ['revoked', 'replaced', 'missing']) {
  test(`unconsumed approval from a ${status} device cannot enroll another device`, async () => {
    const h = fixture(status);
    await assert.rejects(h.store.completeEnrollmentRequest(h.input), { code: 'ENROLLMENT_INVALID' });
    assert.equal(h.inserted.length, 0);
    assert.ok(h.queries.includes('ROLLBACK'));
  });
}

test('a current active approver still permits ordinary completion', async () => {
  const h = fixture('active');
  const result = await h.store.completeEnrollmentRequest(h.input);
  assert.equal(result.credentialEpoch, 1);
  assert.equal(h.inserted.length, 1);
  assert.ok(h.queries.some(sql => sql.includes('FOR UPDATE OF d,a,c')));
});
