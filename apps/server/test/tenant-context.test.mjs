import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cloudTenantDirectory, requireTenantPrincipal, resolveCloudTenant, withTenantTransaction } from '../src/tenant-context.mjs';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const directory = cloudTenantDirectory([
  { id: a, host: 'alice.asia.example.com', region: 'asia', state: 'active' },
  { id: b, host: 'bob.asia.example.com', region: 'asia', state: 'suspended' }
], 'asia');
const req = (host, origin = `https://${host}`, extra = {}) => ({
  rawHeaders: ['Host', host], headers: { host, origin, ...extra }
});

test('regional hostname resolution rejects unknown, inactive, and spoofed authorities', () => {
  assert.equal(resolveCloudTenant(req('alice.asia.example.com'), directory).id, a);
  for (const request of [
    req('bob.asia.example.com'), req('other.asia.example.com'),
    req('alice.asia.example.com', 'https://bob.asia.example.com'),
    req('alice.asia.example.com', undefined, { 'x-forwarded-host': 'bob.asia.example.com' }),
    { ...req('alice.asia.example.com'), rawHeaders: ['Host', 'alice.asia.example.com', 'Host', 'bob.asia.example.com'] }
  ]) assert.throws(() => resolveCloudTenant(request, directory));
});

test('session tenant must match routed tenant', () => {
  const principal = { tenantId: a, accountId: b, deviceId: b };
  assert.equal(requireTenantPrincipal(directory.lookup('alice.asia.example.com'), principal), principal);
  assert.throws(() => requireTenantPrincipal(directory.lookup('alice.asia.example.com'), { ...principal, tenantId: b }));
});

test('tenant context is transaction local and connections are released on success and error', async () => {
  const calls = [];
  let released = 0;
  const pool = { connect: async () => ({ query: async (...args) => { calls.push(args); }, release: () => { released++; } }) };
  assert.equal(await withTenantTransaction(pool, a, async () => 7), 7);
  assert.deepEqual(calls.map(x => x[0]), ['BEGIN', "SELECT set_config('vaults.tenant_id', $1, true)", 'COMMIT']);
  assert.deepEqual(calls[1][1], [a]);
  await assert.rejects(withTenantTransaction(pool, b, async () => { throw new Error('failed'); }));
  assert.equal(calls.at(-1)[0], 'ROLLBACK');
  assert.equal(released, 2);
  await assert.rejects(withTenantTransaction(pool, 'untrusted', async () => {}));
});

test('regional Cloud mode refuses the singleton executable before provisioning', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/entry.mjs', import.meta.url)), 'serve'], {
    env: { ...process.env, VAULTS_ACCESS_MODE: 'regional-cloud' }, encoding: 'utf8'
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Regional Cloud tenancy is not enabled/);
});
