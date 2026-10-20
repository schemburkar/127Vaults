import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEntitlement, PwaReplica } from '../src/pwa-replica.mjs';

const entitlement = { kind: 'license-entitlement-v1', origin: 'https://127.0.0.1:12780', device: 'device', installation: 'installation', observedAt: Date.parse('2030-01-01T00:00:00Z'),
  status: { mode: 'active', expiresAt: '2030-01-02T00:00:00Z', readOnlyUntil: '2030-02-01T00:00:00Z' } };
const context = { origin: entitlement.origin, device: entitlement.device, installation: entitlement.installation, now: entitlement.observedAt + 1000 };
test('offline access binds entitlement to this installation and allows export only within grace', () => {
  assert.equal(requireEntitlement(entitlement, { ...context, write: true }).mode, 'active');
  const grace = { ...context, now: Date.parse('2030-01-03T00:00:00Z') };
  assert.doesNotThrow(() => requireEntitlement(entitlement, grace));
  assert.throws(() => requireEntitlement(entitlement, { ...grace, write: true }));
  for (const altered of [{ device: 'other' }, { installation: 'other' }, { origin: 'https://other' }, { now: 0 }, { now: Date.parse('2030-02-01T00:00:00Z') }]) {
    assert.throws(() => requireEntitlement(entitlement, { ...context, ...altered }));
  }
  for (const mode of ['missing', 'revoked', 'locked', 'experimental']) {
    assert.throws(() => requireEntitlement({ ...entitlement, status: { ...entitlement.status, mode } }, context));
  }
});
test('replica persists only the protected license envelope and preserves it through snapshots', async () => {
  let stored;
  const replica = await new PwaReplica({ scope: 'device', store: { read: async () => stored, write: async (_, value) => { stored = structuredClone(value); } } }).load();
  await replica.saveLicense('encrypted-envelope');
  await replica.saveUnlock({ envelope: 'encrypted-root' });
  assert.equal(stored.licenseEnvelope, 'encrypted-envelope');
  assert.ok(!JSON.stringify(stored).includes('readOnlyUntil'));
});
