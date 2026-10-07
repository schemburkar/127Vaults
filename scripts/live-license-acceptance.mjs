// Fictitious owner only. Verifies the authenticated license status of a test installation.
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { authenticationContextHash } from '../apps/server/src/opaque-adapter.mjs';
import { deviceProofBytes } from '../apps/server/src/auth-policy.mjs';

const origin = new URL(process.argv[2]).origin;
const expectedMode = process.argv[3] ?? 'active';
const b64 = value => Buffer.from(value).toString('base64url');
const un = value => Buffer.from(value, 'base64url');
const id = value => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuid = bytes => [bytes.subarray(0, 4), bytes.subarray(4, 6), bytes.subarray(6, 8), bytes.subarray(8, 10), bytes.subarray(10)]
  .map(part => part.toString('hex')).join('-');
let cookie;
let csrf;
async function call(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) { headers['content-type'] = 'application/json'; headers.origin = origin; headers['x-127v-csrf'] = csrf; }
  const response = await fetch(origin + path, { method, headers, body: body && JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return value;
}

const ceremony = await call('/api/v1/ceremony');
csrf = ceremony.csrf;
const password = new TextEncoder().encode('fictitious password 127vaults');
const secret = new Uint8Array(32).fill(7);
const deviceId = '22222222-2222-4222-8222-222222222222';
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 9)]),
  format: 'der', type: 'pkcs8' });
const step = wasm.ExperimentalOpaqueBridge.client_login_start(secret, password);
const started = await call('/api/v1/auth/', { method: 'POST', body: { username: 'owner_127', deviceId, request: b64(step.message()) } });
csrf = started.csrf;
const finish = wasm.ExperimentalOpaqueBridge.client_login_finish(step.state(), secret, password, un(started.challenge), un(started.binding));
const root = await call(`/api/v1/auth/${started.attemptId}/password`, { method: 'POST', body: { finalization: b64(finish.message()) } });
const binding = un(started.binding);
let offset = 2 + binding.readUInt16BE();
const installation = uuid(binding.subarray(offset, offset += 16));
const account = uuid(binding.subarray(offset, offset += 16));
offset += 16;
const epoch = Number(binding.readBigUInt64BE(offset));
const proof = deviceProofBytes({ contextHash: authenticationContextHash({ origin, installation, account, device: deviceId,
  epoch, attempt: un(started.attemptId), serverPublicKey: binding.subarray(-32) }),
transcriptHash: createHash('sha512').update(step.message()).update(un(started.challenge)).digest(),
installation: id(installation), account: id(account), device: id(deviceId), epoch,
rootHash: createHash('sha512').update(un(root.descriptor)).update(un(root.envelope)).digest() });
const logged = await call(`/api/v1/auth/${started.attemptId}/device-proof`, { method: 'POST',
  body: { signature: b64(sign(null, proof, privateKey)) } });
csrf = logged.csrf;
const license = await call('/api/v1/license');
assert.equal(license.mode, expectedMode);
assert.equal(license.enforcement, 'disabled');
console.log(JSON.stringify({ ok: true, mode: license.mode, plan: license.plan, enforcement: license.enforcement }));
