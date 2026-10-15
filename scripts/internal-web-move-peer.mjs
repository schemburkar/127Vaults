// Independent registered-device reader; no writes, seeding or browser action calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work, caseName] = process.argv.slice(2);
assert.ok(caseName === undefined || caseName === 'copy-loss');
const copyLoss = caseName === 'copy-loss';
const client = await ownershipClient(work);
for (let attempt = 0; ; attempt++) {
  try { assert.equal((await client.http('/api/v1/setup')).status, 200); break; }
  catch (error) {
    if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code) || attempt >= 44) throw error;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
const json = async name => JSON.parse(await readFile(join(work, name), 'utf8'));
const record = await json(copyLoss ? 'web-move-copy-loss-fixture.json' : 'web-move-ui-fixture.json');
const metadata = await json('ownership-member.json');
const browser = await json('ownership-customer-device.json');
assert.equal(record.serverId, client.fixture.serverId);
assert.equal(record.accountId, metadata.accountId);
assert.equal(record.movePassed, true);
assert.equal((await json(copyLoss ? 'web-move-copy-resume.json' : 'web-move-ui.json')).status, 'passed');
assert.notEqual(metadata.deviceId, browser.deviceId);
assert.equal(metadata.fixtureSigningSeed, 10);
const peer = new client.Account(metadata.accountId, metadata.deviceId, metadata.username, 10);
const call = peer.call.bind(peer);
let wrapped;
peer.call = async (path, options) => {
  const response = await call(path, options);
  if (path.endsWith('/password')) wrapped = response.value;
  return response;
};
await peer.login();
assert.ok(wrapped?.descriptor && wrapped.envelope);
const un = value => Buffer.from(value, 'base64url');
const id = value => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuid = bytes => { const hex = Buffer.from(bytes).toString('hex'); return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'); };
const core = new wasm.ExperimentalEcf1Core();
const root = core.unwrap_root(un(wrapped.envelope), un(wrapped.descriptor), peer.password, peer.secret);
const verified = [];
try {
  const data = (await peer.call('/api/v1/vaults')).value;
  assert.equal(data.vaultEnvelopes.length, copyLoss ? 3 : 2);
  for (const [kind, itemId] of [['source', record.sourceItem], ['destination', record.destinationItem]]) {
    const vaultId = record[kind], row = data.vaultEnvelopes.find(row => row.vaultId === vaultId);
    assert.ok(row);
    assert.equal(Boolean(row.retired), kind === 'source');
    const listed = (await peer.call('/api/v1/vaults/' + vaultId + '/items')).value;
    const expectedCount = copyLoss && kind === 'destination' ? 2 : 1;
    assert.equal(listed.indices.length, expectedCount);
    let preservedItemId;
    if (copyLoss && kind === 'destination') {
      const baseline = await json('web-move-ui-fixture.json');
      assert.equal(baseline.destination, vaultId);
      assert.ok(listed.indices.some(row => row.itemId === baseline.destinationItem));
      preservedItemId = baseline.destinationItem;
    }
    const item = listed.indices.find(row => row.itemId === itemId);
    assert.ok(item);
    const vault = core.open_private_vault(root, un(data.directory), id(vaultId), un(row.envelope));
    const revision = uuid(un(listed.catalogue).subarray(44, 60));
    const body = (await peer.call('/api/v1/vaults/' + vaultId + '/items/' + itemId + '?catalogueRevision=' + revision)).value;
    const indexBytes = core.decrypt_private_part(vault, un(listed.catalogue), id(itemId), un(item.envelope), 4);
    const bodyBytes = core.decrypt_private_part(vault, un(listed.catalogue), id(itemId), un(body.envelope), 3);
    try {
      const index = JSON.parse(new TextDecoder().decode(indexBytes)), plaintext = JSON.parse(new TextDecoder().decode(bodyBytes));
      assert.equal(index.title, record.title);
      assert.equal(index.website, record.website);
      assert.equal(plaintext.username, record.username);
      assert.equal(plaintext.password, record.password);
    } finally { indexBytes.fill(0); bodyBytes.fill(0); core.release_vault(vault); vault.free(); }
    verified.push({ kind, vaultId, itemId, itemCount: expectedCount, retired: kind === 'source', ...(preservedItemId ? { preservedItemId } : {}) });
  }
} finally { core.lock(); }
await writeFile(join(work, copyLoss ? 'web-move-copy-peer.json' : 'web-move-peer.json'), JSON.stringify({ status: 'passed', serverId: client.fixture.serverId, serverRevision: client.fixture.serverRevision, accountId: metadata.accountId, peerDevice: metadata.deviceId, browserDevice: browser.deviceId, verified, checks: ['Distinct genuinely registered device authenticates using production OPAQUE/device proof', 'Independently decrypts retained original and unique moved copy with exact ordinary fields and password', 'Source retired, destination active, one newly identified copy with exact expected catalogue counts'], limits: ['Production crypto Node reader, not a packaged CLI/Desktop reader claim'] }, null, 2) + '\n');
console.log('Independent production-crypto device verifies original and moved copy.');
