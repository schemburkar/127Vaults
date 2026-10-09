import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPasskey, passkeyFields, encode, readMetadata, assertPasskey } from '../../extension/src/passkeys.mjs';

test('a website passkey survives real Rust vault encryption and lock prevents decryption', async () => {
  const { default: init, ExperimentalEcf1Core } = await import('../wasm/vaults_browser_fixture.js');
  await init({ module_or_path: await readFile(new URL('../wasm/vaults_browser_fixture_bg.wasm', import.meta.url)) });
  const core = new ExperimentalEcf1Core(), enc = new TextEncoder(), dec = new TextDecoder();
  const template = new Uint8Array(77); template[0] = 1;
  template.set(new Uint8Array(16).fill(1), 1); template.set(new Uint8Array(16).fill(2), 17);
  template[7] = template[23] = 0x40; template[9] = template[25] = 0x80;
  template.set([0, 0, 0, 1], 65); template[76] = 1;
  const root = core.create_root(template, enc.encode('disposable-passkey-test-master-password'), new Uint8Array(32).fill(3));
  const created = core.create_private_vault(root, core.create_empty_directory(root)), vault = created.vault();
  const origin = 'https://example.test', options = { challenge: encode(new Uint8Array(32).fill(4)), rp: { id: 'example.test' }, user: { id: 'AQ', name: 'sample', displayName: 'Sample' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] };
  const credential = await createPasskey(options, origin, true), fields = passkeyFields(credential.metadata, credential.privateKey);
  const item = core.upsert_private_item(vault, created.catalogue(), undefined, enc.encode(JSON.stringify({ title: 'Example', itemType: 'passkey', website: origin })), enc.encode(JSON.stringify({ username: 'sample', password: '', customFields: fields })));
  assert.equal(Buffer.from(item.body()).toString().includes(credential.privateKey), false);
  const plain = JSON.parse(dec.decode(core.decrypt_private_part(vault, item.catalogue(), item.item(), item.body(), 3)));
  assert.deepEqual(readMetadata(plain.customFields), credential.metadata);
  assert.equal((await assertPasskey(credential.metadata, plain.customFields.find(f => f.id === '__127vaults_passkey_key').value, { challenge: options.challenge }, origin, true)).id, credential.metadata.credentialId);
  // Exercise the real web attachment action against Rust encryption. Existing
  // password and custom secrets must survive, and the update keeps its item ID.
  const loginIndex = { title: 'Existing account', itemType: 'login', website: origin + '/account' };
  const loginBody = { username: 'existing-user', password: 'existing-password', customFields: [{ id: 'note', label: 'Note', type: 'text', value: 'Keep me' }, { id: 'pin', label: 'PIN', type: 'password', value: '1234' }] };
  const login = core.upsert_private_item(vault, item.catalogue(), undefined, enc.encode(JSON.stringify(loginIndex)), enc.encode(JSON.stringify(loginBody)));
  const uuid = bytes => { const value = Buffer.from(bytes).toString('hex'); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`; };
  const loginId = uuid(login.item());
  const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('window.__vaultsExtensionActions = ') + 'window.__vaultsExtensionActions = '.length;
  const end = source.indexOf('\n};', start) + 2;
  let delivered;
  const deps = { root, vault, catalogue: login.catalogue(), vaultId: 'vault', busy: false, availableVaults: [], loadedItems: [{ row: { itemId: loginId }, index: loginIndex }], core, te: enc,
    $: () => ({ hidden: true }), setBusy: value => { deps.busy = value; }, passkeyFields, readMetadata,
    extensionOrigin: value => new URL(value).origin, fetchItem: async () => ({ body: loginBody }), verifyPasskeyPassword: async () => {},
    id: value => Uint8Array.from(Buffer.from(value.replaceAll('-', ''), 'hex')), uuid, b64: value => Buffer.from(value).toString('base64url'),
    signedMutation: async () => ({}), call: async (path, request) => { delivered = { path, ...request }; }, reload: async () => {}, toast() {}, window: {} };
  deps.window.__vaultsExtensionActions = new Function('deps', `with (deps) { return (${source.slice(start,end)}); }`)(deps);
  const attached = await createPasskey(options, origin, true);
  assert.equal((await deps.window.__vaultsExtensionActions.passkeyTargets(origin))[0].itemId, loginId);
  const saved = await deps.window.__vaultsExtensionActions.passkeySave(attached.metadata, attached.privateKey, origin, 'verified-test-password', 'vault', loginId);
  assert.equal(saved.itemId, loginId); assert.equal(delivered.method, 'PUT');
  const payload = delivered.body;
  const updated = JSON.parse(dec.decode(core.decrypt_private_part(vault, Buffer.from(payload.catalogue, 'base64url'), login.item(), Buffer.from(payload.body, 'base64url'), 3)));
  assert.equal(updated.password, loginBody.password); assert.equal(updated.username, loginBody.username);
  for (const field of loginBody.customFields) assert.deepEqual(updated.customFields.find(row => row.id === field.id), field);
  assert.deepEqual(readMetadata(updated.customFields), attached.metadata);
  assert.equal(updated.customFields.some(row => row.id === '__127vaults_item_type' && row.value === 'passkey'), false);
  assert.equal(JSON.stringify(delivered).includes(attached.privateKey), false);
  core.lock();
  assert.throws(() => core.decrypt_private_part(vault, item.catalogue(), item.item(), item.body(), 3));
  core.free();
});
