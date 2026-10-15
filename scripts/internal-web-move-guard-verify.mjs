import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const [work] = process.argv.slice(2);
assert.ok(work && isAbsolute(work));
const json = async name => JSON.parse(await readFile(join(work, name), 'utf8'));
const fixture = await json('fixture.json'), record = await json('web-move-guard-loss-fixture.json');
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(record.serverId, fixture.serverId);
assert.equal(record.accountId, (await json('ownership-member.json')).accountId);
for (const key of ['lossPassed', 'peerEditPassed', 'guardPassed', 'abortPassed']) assert.equal(record[key], true);
assert.notEqual(record.changedTitle, record.title);
assert.equal(record.journal.sourceRevision, record.peerEdit.beforeRevision);
assert.notEqual(record.peerEdit.beforeRevision, record.peerEdit.afterRevision);
const loss = await json('web-move-guard-loss.json'), edit = await json('web-move-guard-peer-edit.json'), guard = await json('web-move-guard-guard.json'), abort = await json('web-move-guard-abort.json'), peer = await json('web-move-guard-peer.json');
for (const result of [loss, edit, guard, abort, peer]) {
  assert.equal(result.status, 'passed');
  assert.equal(result.serverId, fixture.serverId);
}
assert.equal(edit.opId, record.peerEdit.opId);
assert.equal(edit.sourceItem, record.sourceItem);
const copies = loss.mutations.filter(row => row.path === '/api/v1/vaults/' + record.destination + '/items');
assert.equal(copies.length, 1);
assert.equal(copies[0].status, 200);
assert.equal(copies[0].replyDropped, true);
assert.equal(copies[0].itemId, record.destinationItem);
assert.equal(copies[0].requestId, record.journal.pendingCopy.payload.requestId);
assert.equal(copies[0].sha256, createHash('sha256').update(JSON.stringify(record.journal.pendingCopy.payload)).digest('hex'));
assert.equal(record.journal.request, null);
for (const phase of [guard, abort]) {
  assert.equal(phase.checks.length, 2);
  assert.equal(phase.mutations.filter(row => row.path.endsWith('/removal') || row.path === '/api/v1/vaults/' + record.destination + '/items').length, 0);
}
assert.equal(peer.accountId, record.accountId);
assert.notEqual(peer.peerDevice, peer.browserDevice);
assert.equal(peer.verified.length, 2);
for (const row of peer.verified) {
  assert.equal(row.vaultId, record[row.kind]);
  assert.equal(row.itemId, record[row.kind + 'Item']);
  assert.equal(row.retired, false);
  assert.equal(row.itemCount, row.kind === 'source' ? 1 : 4);
  if (row.kind === 'destination') {
    assert.equal(row.preservedItemId, (await json('web-move-ui-fixture.json')).destinationItem);
    assert.equal(row.preservedCopyItemId, (await json('web-move-copy-loss-fixture.json')).destinationItem);
    assert.equal(row.preservedFinalizationItemId, (await json('web-move-finalization-loss-fixture.json')).destinationItem);
  }
}
await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./internal-web-move-finalization-verify.mjs', import.meta.url)), work], { windowsHide: true });
await writeFile(join(work, 'web-move-guard-combined-evidence.json'), JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), serverId: fixture.serverId, loss, edit, guard, abort, peer, cleanup: 'Prior lifecycle/ownership history and exact isolated cleanup/original health/revoked draft checks pass', limits: [...abort.limits, ...peer.limits] }, null, 2) + '\n');
console.log('Web changed-source refusal, exact journal retention, explicit cancel and peer data preservation verified.');
