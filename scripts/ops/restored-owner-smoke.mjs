// Fictitious deterministic owner from live-mvp-acceptance.mjs only.
// Proves a restored database plus restored identity can authenticate and read.
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import wasm from '../../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { authenticationContextHash } from '../../apps/server/src/opaque-adapter.mjs';
import { deviceProofBytes } from '../../apps/server/src/auth-policy.mjs';

const origin = process.argv[2];
if (!origin?.startsWith('https://')) throw Error('Supply the HTTPS origin.');
const deviceId = '22222222-2222-4222-8222-222222222222';
const secret = new Uint8Array(32).fill(7);
const password = new TextEncoder().encode('fictitious password 127vaults');
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 9)]), format: 'der', type: 'pkcs8' });
const b64 = value => Buffer.from(value).toString('base64url');
const un = value => Buffer.from(value, 'base64url');
const id = value => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuid = value => [value.subarray(0, 4), value.subarray(4, 6), value.subarray(6, 8), value.subarray(8, 10), value.subarray(10)].map(x => x.toString('hex')).join('-');
let cookie, csrf;
async function call(path, { method = 'GET', body } = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin, 'x-127v-csrf': csrf } : {}) };
  const response = await fetch(origin + path, { method, headers, body: body && JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`);
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
  return value;
}
const ceremony = await call('/api/v1/ceremony');
csrf = ceremony.csrf;
const step = wasm.ExperimentalOpaqueBridge.client_login_start(secret, password);
const begun = await call('/api/v1/auth/', { method: 'POST', body: { username: 'owner_127', deviceId, request: b64(step.message()) } });
csrf = begun.csrf;
const finished = wasm.ExperimentalOpaqueBridge.client_login_finish(step.state(), secret, password, un(begun.challenge), un(begun.binding));
const root = await call(`/api/v1/auth/${begun.attemptId}/password`, { method: 'POST', body: { finalization: b64(finished.message()) } });
const binding = un(begun.binding), n = binding.readUInt16BE();
let p = 2 + n;
const installation = uuid(binding.subarray(p, p += 16)), account = uuid(binding.subarray(p, p += 16));
p += 16;
const epoch = Number(binding.readBigUInt64BE(p));
const proof = deviceProofBytes({
  contextHash: authenticationContextHash({ origin, installation, account, device: deviceId, epoch, attempt: un(begun.attemptId), serverPublicKey: binding.subarray(-32) }),
  transcriptHash: createHash('sha512').update(step.message()).update(un(begun.challenge)).digest(),
  installation: id(installation), account: id(account), device: id(deviceId), epoch,
  rootHash: createHash('sha512').update(un(root.descriptor)).update(un(root.envelope)).digest()
});
const session = await call(`/api/v1/auth/${begun.attemptId}/device-proof`, { method: 'POST', body: { signature: b64(sign(null, proof, key)) } });
csrf = session.csrf;
const vaults = await call('/api/v1/vaults');
assert.ok(vaults.vaultEnvelopes.length > 0);
const vaultId = vaults.vaultEnvelopes[0].vaultId;
const items = await call(`/api/v1/vaults/${vaultId}/items`);
assert.ok(items.indices.length > 0);
const core = new wasm.ExperimentalEcf1Core();
let openedRoot, openedVault, indexBytes, bodyBytes;
try {
  openedRoot = core.unwrap_root(un(root.envelope), un(root.descriptor), password, secret);
  const envelope = vaults.vaultEnvelopes.find(row => row.vaultId === vaultId);
  openedVault = core.open_private_vault(openedRoot, un(vaults.directory), id(vaultId), un(envelope.envelope));
  const item = items.indices[0], catalogue = un(items.catalogue);
  const body = await call(`/api/v1/vaults/${vaultId}/items/${item.itemId}?catalogueRevision=${uuid(catalogue.subarray(44, 60))}`);
  indexBytes = core.decrypt_private_part(openedVault, catalogue, id(item.itemId), un(item.envelope), 4);
  bodyBytes = core.decrypt_private_part(openedVault, catalogue, id(item.itemId), un(body.envelope), 3);
  const index = JSON.parse(new TextDecoder().decode(indexBytes)), plaintext = JSON.parse(new TextDecoder().decode(bodyBytes));
  assert.ok(['Race A', 'Race B'].includes(index.title));
  assert.equal(plaintext.password, index.title === 'Race A' ? 'race-a' : 'race-b');
  const encryptedItemSha256 = createHash('sha256').update(catalogue).update(un(item.envelope)).update(un(body.envelope)).digest('hex');
  console.log(JSON.stringify({ ok: true, installation, vaultCount: vaults.vaultEnvelopes.length, itemCount: items.indices.length, decryptedIndexBody: true, encryptedItemSha256 }));
} finally {
  indexBytes?.fill(0); bodyBytes?.fill(0);
  if (openedVault) { core.release_vault(openedVault); openedVault.free(); }
  core.lock();
}
