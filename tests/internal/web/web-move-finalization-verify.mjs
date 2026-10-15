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
const fixture = await json('fixture.json'), record = await json('web-move-finalization-loss-fixture.json');
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(record.serverId, fixture.serverId);
assert.equal(record.accountId, (await json('ownership-member.json')).accountId);
assert.equal(record.lossPassed, true);
assert.equal(record.movePassed, true);
assert.equal(record.journal.pendingCopy, null);
assert.ok(record.journal.request);
const loss = await json('web-move-finalization-loss.json'), resume = await json('web-move-finalization-resume.json'), peer = await json('web-move-finalization-peer.json');
for (const result of [loss, resume, peer]) {
  assert.equal(result.status, 'passed');
  assert.equal(result.serverId, fixture.serverId);
  assert.equal(result.serverRevision, fixture.serverRevision);
  assert.equal(result.checks.length, 3);
}
for (const result of [loss, resume]) for (const key of ['source', 'destination', 'sourceItem', 'destinationItem']) assert.equal(result[key], record[key]);
const copies = loss.mutations.filter(row => row.path === '/api/v1/vaults/' + record.destination + '/items');
assert.equal(copies.length, 1);
assert.equal(copies[0].status, 200);
assert.equal(copies[0].itemId, record.destinationItem);
assert.equal(resume.mutations.filter(row => row.path.endsWith('/items')).length, 0);
const final = [loss, resume].map(result => result.mutations.filter(row => row.path === '/api/v1/vaults/' + record.source + '/removal'));
assert.ok(final.every(rows => rows.length === 1 && rows[0].status === 200));
assert.equal(final[0][0].replyDropped, true);
assert.equal(final[0][0].requestId, final[1][0].requestId);
assert.equal(final[0][0].sha256, final[1][0].sha256);
assert.equal(final[0][0].requestId, record.journal.request.requestId);
assert.equal(final[0][0].sha256, createHash('sha256').update(JSON.stringify(record.journal.request)).digest('hex'));
assert.equal(peer.accountId, record.accountId);
assert.notEqual(peer.peerDevice, peer.browserDevice);
assert.equal(peer.verified.length, 2);
for (const row of peer.verified) {
  assert.equal(row.vaultId, record[row.kind]);
  assert.equal(row.itemId, record[row.kind + 'Item']);
  assert.equal(row.itemCount, row.kind === 'source' ? 1 : 3);
  assert.equal(row.retired, row.kind === 'source');
  if (row.kind === 'destination') {
    assert.equal(row.preservedItemId, (await json('web-move-ui-fixture.json')).destinationItem);
    assert.equal(row.preservedCopyItemId, (await json('web-move-copy-loss-fixture.json')).destinationItem);
  }
}
await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./web-move-copy-verify.mjs', import.meta.url)), work], { windowsHide: true });
await writeFile(join(work, 'web-move-finalization-combined-evidence.json'), JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), serverId: fixture.serverId, loss, resume, peer, cleanup: 'Prior lifecycle/ownership history, exact bundle/wiring, stopped owned fixtures, original server health and revoked draft verified', limits: [...resume.limits, ...peer.limits] }, null, 2) + '\n');
console.log('Web accepted-finalization loss, full restart, exact receipt replay without recopy and independent reader verified.');
