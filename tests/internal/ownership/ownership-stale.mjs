// Real elapsed-time boundary: never edits session timestamps or database state.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ownershipClient } from './ownership-client.mjs';

const [work] = process.argv.slice(2);
const { fixture, Account, operator, action } = await ownershipClient(work);
const metadata = JSON.parse(await readFile(join(work, 'ownership-member.json'), 'utf8'));
assert.equal(metadata.serverId, fixture.serverId);
assert.equal(metadata.fixtureSigningSeed, 10);
assert.equal(JSON.parse(await readFile(join(work, 'ownership-evidence.json'), 'utf8')).status, 'passed');
const member = new Account(metadata.accountId, metadata.deviceId, metadata.username, 10);
const admin = await operator('lifecycleowner', 'synthetic-ownership-owner-password');
await member.login();
const started = Date.now();
const grant = await action(admin, 'ownership.request', { targetId: metadata.accountId });
let accepted = false, demoted = false;
try {
  console.log('Real member session authenticated; waiting beyond five minutes without changing timestamps.');
  for (let elapsed = Date.now() - started; elapsed < 310000; elapsed = Date.now() - started) {
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, 310000 - elapsed)));
    console.log('Owned stale-auth wait: ' + Math.floor((Date.now() - started) / 1000) + ' seconds.');
  }
  const listed = (await member.call('/api/v1/ownership/requests')).value;
  assert.ok(listed.grants.some(row => row.grantId === grant.grantId));
  const requestId = randomUUID();
  const denied = await member.call('/api/v1/ownership/requests/' + grant.grantId + '/accept', { body: { requestId }, expected: 403 });
  assert.equal(denied.value.error, 'fresh_auth_required');
  await member.login();
  const result = (await member.call('/api/v1/ownership/requests/' + grant.grantId + '/accept', { body: { requestId } })).value;
  assert.equal(result.accepted, true);
  accepted = true;
  assert.equal(result.signInRequired, true);
  await action(admin, 'role.set', { targetId: metadata.accountId, role: 'user' });
  demoted = true;
  await member.login();
  assert.equal((await member.call('/api/v1/vaults')).value.vaultEnvelopes.length, 0);
  await writeFile(join(work, 'ownership-stale-evidence.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, serverRevision: fixture.serverRevision, elapsedMs: Date.now() - started, checks: ['Real session older than five minutes still reads requests but acceptance returns fresh_auth_required', 'Fresh production OPAQUE/device-proof login accepts identical previously denied request ID', 'Member demoted back to user; empty private directory preserved; original owner untouched'], limits: ['API boundary only; customer stale-auth toast and acceptance UI separate'] }, null, 2) + '\n');
  console.log('Selected-server real stale-auth boundary and fresh-login recovery passed.');
} finally {
  if (!accepted) await action(admin, 'ownership.cancel', { targetId: grant.grantId });
  else if (!demoted) await action(admin, 'role.set', { targetId: metadata.accountId, role: 'user' });
}
