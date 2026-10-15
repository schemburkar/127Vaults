// One signed edit by the already registered member device; no database seeding.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, sign, randomUUID } from 'node:crypto';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { verifySyncHistory } from '../apps/web/src/signed-sync.mjs';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work] = process.argv.slice(2), client = await ownershipClient(work);
const json = async name => JSON.parse(await readFile(join(work, name), 'utf8'));
const record = await json('web-move-guard-loss-fixture.json'), metadata = await json('ownership-member.json');
assert.equal(record.serverId, client.fixture.serverId);
assert.equal(record.accountId, metadata.accountId);
assert.equal(record.lossPassed, true);
assert.ok(!record.peerEditPassed, 'Do not repeat the preserved peer edit');
assert.notEqual(metadata.deviceId, (await json('ownership-customer-device.json')).deviceId);
for (let attempt = 0; ; attempt++) {
  try { assert.equal((await client.http('/api/v1/setup')).status, 200); break; }
  catch (error) { if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code) || attempt >= 44) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
}
const peer = new client.Account(metadata.accountId, metadata.deviceId, metadata.username, 10), call = peer.call.bind(peer);
let wrapped;
peer.call = async (path, options) => { const response = await call(path, options); if (path.endsWith('/password')) wrapped = response.value; return response; };
await peer.login();
const un = value => Buffer.from(value, 'base64url'), id = value => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuid = bytes => { const hex = Buffer.from(bytes).toString('hex'); return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'); };
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const core = new wasm.ExperimentalEcf1Core(), root = core.unwrap_root(un(wrapped.envelope), un(wrapped.descriptor), peer.password, peer.secret);
try {
  const data = (await peer.call('/api/v1/vaults')).value, row = data.vaultEnvelopes.find(row => row.vaultId === record.source);
  assert.ok(row && !row.retired);
  const path = '/api/v1/vaults/' + record.source + '/items', listed = (await peer.call(path)).value;
  assert.equal(listed.indices.length, 1);
  assert.equal(listed.indices[0].itemId, record.sourceItem);
  const revision = uuid(un(listed.catalogue).subarray(44, 60));
  assert.equal(revision, record.journal.sourceRevision);
  const body = (await peer.call(path + '/' + record.sourceItem + '?catalogueRevision=' + revision)).value;
  const vault = core.open_private_vault(root, un(data.directory), id(record.source), un(row.envelope));
  const indexBytes = core.decrypt_private_part(vault, un(listed.catalogue), id(record.sourceItem), un(listed.indices[0].envelope), 4);
  const bodyBytes = core.decrypt_private_part(vault, un(listed.catalogue), id(record.sourceItem), un(body.envelope), 3);
  let made;
  try {
    const index = JSON.parse(new TextDecoder().decode(indexBytes));
    assert.equal(index.title, record.title);
    record.changedTitle = record.title + ' peer source edit';
    index.title = record.changedTitle;
    const history = (await peer.call('/api/v1/vaults/' + record.source + '/operations')).value;
    await verifySyncHistory(history, { tenantId: client.fixture.serverId, vaultId: record.source });
    made = core.upsert_private_item(vault, un(listed.catalogue), id(record.sourceItem), new TextEncoder().encode(JSON.stringify(index)), bodyBytes);
    const parts = [made.catalogue(), made.index(), made.body()].map(value => Buffer.from(value));
    const framed = Buffer.concat(parts.flatMap(part => { const length = Buffer.alloc(4); length.writeUInt32BE(part.length); return [length, part]; }));
    const operation = { protocolVersion: 1, tenantId: client.fixture.serverId, vaultId: record.source, deviceId: metadata.deviceId, epoch: Number(parts[0].readBigUInt64BE(36)), causalBase: history.cursor, previousDeviceOpId: [...history.operations].reverse().find(row => row.operation.deviceId === metadata.deviceId)?.operation.opId ?? null, kind: 'item.update', itemId: record.sourceItem, payloadHash: digest(framed) };
    const opId = digest(Buffer.from(canonical(operation))), signedOperation = { ...operation, opId, signature: sign(null, Buffer.from(canonical({ ...operation, opId })), peer.key).toString('base64url') };
    const payload = { requestId: randomUUID(), baseCatalogueRevision: revision, catalogue: parts[0].toString('base64url'), index: parts[1].toString('base64url'), body: parts[2].toString('base64url'), signedOperation };
    const response = await client.http(path + '/' + record.sourceItem, { method: 'PUT', body: payload, headers: { cookie: peer.cookie, 'x-127v-csrf': peer.csrf } });
    assert.equal(response.status, 200);
    const after = (await peer.call(path)).value;
    const afterRevision = uuid(un(after.catalogue).subarray(44, 60));
    assert.notEqual(afterRevision, revision);
    record.peerEditPassed = true;
    record.peerEdit = { deviceId: metadata.deviceId, requestId: payload.requestId, opId, beforeRevision: revision, afterRevision };
    await writeFile(join(work, 'web-move-guard-loss-fixture.json'), JSON.stringify(record, null, 2) + '\n');
    await writeFile(join(work, 'web-move-guard-peer-edit.json'), JSON.stringify({ status: 'passed', serverId: client.fixture.serverId, source: record.source, sourceItem: record.sourceItem, ...record.peerEdit }, null, 2) + '\n');
  } finally { indexBytes.fill(0); bodyBytes.fill(0); made?.free(); core.release_vault(vault); vault.free(); }
} finally { core.lock(); }
console.log('Distinct registered device made an accepted signed source edit.');
