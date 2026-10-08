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
  core.lock();
  assert.throws(() => core.decrypt_private_part(vault, item.catalogue(), item.item(), item.body(), 3));
  core.free();
});
