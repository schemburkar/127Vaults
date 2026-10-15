import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const [work] = process.argv.slice(2);
assert.ok(work && isAbsolute(work));
const json = async name => JSON.parse(await readFile(join(work, name), 'utf8'));
const fixture = await json('fixture.json'), record = await json('web-move-ui-fixture.json');
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(record.serverId, fixture.serverId);
assert.equal(record.accountId, (await json('ownership-member.json')).accountId);
assert.equal(record.movePassed, true);
const ui = await json('web-move-ui.json'), peer = await json('web-move-peer.json');
for (const result of [ui, peer]) {
  assert.equal(result.status, 'passed');
  assert.equal(result.serverId, fixture.serverId);
  assert.equal(result.serverRevision, fixture.serverRevision);
  assert.equal(result.accountId, record.accountId);
}
for (const key of ['source', 'destination', 'sourceItem', 'destinationItem']) assert.equal(ui[key], record[key]);
assert.notEqual(record.sourceItem, record.destinationItem);
assert.notEqual(peer.peerDevice, peer.browserDevice);
assert.equal(ui.checks.length, 4);
assert.equal(peer.checks.length, 3);
const copies = ui.mutations.filter(row => row.path === '/api/v1/vaults/' + record.destination + '/items');
const removals = ui.mutations.filter(row => row.path.endsWith('/removal'));
assert.equal(copies.length, 1);
assert.equal(copies[0].itemId, record.destinationItem);
assert.equal(copies[0].status, 200);
assert.match(copies[0].sha256, /^[a-f0-9]{64}$/);
assert.equal(removals.length, 1);
assert.equal(removals[0].status, 200);
assert.equal(removals[0].path, '/api/v1/vaults/' + record.source + '/removal');
assert.equal(peer.verified.length, 2);
for (const row of peer.verified) {
  assert.equal(row.vaultId, record[row.kind]);
  assert.equal(row.itemId, record[row.kind + 'Item']);
  assert.equal(row.itemCount, 1);
  assert.equal(row.retired, row.kind === 'source');
}
const run = promisify(execFile);
await run(process.execPath, [fileURLToPath(new URL('../ownership/ownership-verify.mjs', import.meta.url)), work, '--with-browser', '--with-stale', '--with-customer', '--with-customer-stale'], { windowsHide: true });
await writeFile(join(work, 'web-move-combined-evidence.json'), JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), serverId: fixture.serverId, ui, peer, cleanup: 'Ownership verifier passes exact bundle/wiring restoration, stopped lab, original server health, selected CLI hashes and revoked draft preservation', limits: [...ui.limits, ...peer.limits] }, null, 2) + '\n');
console.log('Selected web normal move UI and independent reader evidence verified; original fixtures preserved.');
