import test from 'node:test';
import assert from 'node:assert/strict';
import { installPasskeyProvider } from '../src/passkey-provider.mjs';
import { encode } from '../src/passkeys.mjs';

test('approved registration persists before success; assertions never disclose keys to the page', async () => {
  let listener, updated, removed, locked = false, stored = null, delaySave, allowSave;
  let verificationSession = 'unlock-1', rotateDuringGet = false;
  const events = [];
  const origin = 'https://example.test', vaultId = '11111111-1111-4111-8111-111111111111', itemId = '22222222-2222-4222-8222-222222222222';
  globalThis.chrome = {
    runtime: { id: 'extension', async getPlatformInfo() { return { os: 'win' }; }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { async get() { return { passkeysAllSites: true, passkeyOrigins: [] }; } } },
    permissions: { async contains() { return true; } },
    tabs: { async get() { return { id: 1, url: `${origin}/login` }; }, onUpdated: { addListener(fn) { updated = fn; } }, onRemoved: { addListener(fn) { removed = fn; } } },
    action: { async setBadgeText() {}, async openPopup() {} },
  };
  const queue = installPasskeyProvider(async request => {
    if (request.action === 'passkey.list') { if (locked) throw Error('Vault locked.'); return stored ? [{ vaultId, itemId, metadata: stored.metadata, title: 'Alice' }] : []; }
    if (request.action === 'passkey.targets') return [{ vaultId, itemId: 'existing-login', title: 'Existing login' }];
    if (request.action === 'passkey.vaults') return [{ vaultId, name: 'Private' }];
    if (request.action === 'passkey.session') { if (locked) throw Error('Vault locked.'); return { verificationSession }; }
    if (request.action === 'passkey.get' && request.verificationSession) {
      if (request.verificationSession !== verificationSession || locked) throw Error('Desktop session changed.');
      if (rotateDuringGet) verificationSession = 'unlock-2';
      return { ...stored };
    }
    if (request.masterPassword !== 'correct-password') throw Error('Master password verification failed.');
    if (request.action === 'passkey.save') {
      events.push('save-start');
      if (delaySave) await new Promise(resolve => { allowSave = resolve; });
      stored = { metadata: request.metadata, privateKey: request.privateKey }; events.push('saved');
      return { itemId: request.itemId || itemId, queued: true };
    }
    if (request.action === 'passkey.get') return { ...stored };
    throw Error('Unexpected operation.');
  });
  const ui = { id: 'extension' }, page = { id: 'extension', frameId: 0, documentId: 'doc', url: origin, tab: { id: 1, url: origin } };
  const send = (message, sender = ui) => new Promise(resolve => listener(message, sender, resolve));
  const request = { kind: 'passkey.request', id: 'page-create', operation: 'create', options: { challenge: encode(new Uint8Array(32).fill(8)), rp: { id: 'example.test' }, user: { id: 'AQ', name: 'alice', displayName: 'Alice' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  delaySave = true;
  let replied = false;
  const registration = send(request, page).then(value => { replied = true; events.push('page-success'); return value; });
  await tick();
  const pending = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  assert(pending);
  const approval = send({ kind: 'passkey.approve', id: pending.id, source: 'desktop', vaultId, masterPassword: 'correct-password' });
  while (!allowSave) await tick();
  assert.equal(replied, false); allowSave();
  assert.equal((await approval).queued, true);
  const made = await registration;
  assert(made.value.response.attestationObject);
  assert.deepEqual(events, ['save-start', 'saved', 'page-success']);
  const attach = send({ ...request, id: 'attach-create' }, page);
  await tick();
  const attachRow = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  assert.equal((await send({ kind: 'passkey.choices', id: attachRow.id, source: 'desktop' })).targets[0].itemId, 'existing-login');
  delaySave = false;
  assert.equal((await send({ kind: 'passkey.approve', id: attachRow.id, source: 'desktop', vaultId, itemId: 'existing-login', masterPassword: 'correct-password' })).itemId, 'existing-login');
  assert((await attach).value.response.attestationObject);
  assert.equal(JSON.stringify(made).includes(stored.privateKey), false);
  const assertion = send({ ...request, id: 'page-get', operation: 'get', options: { challenge: request.options.challenge, rpId: 'example.test', userVerification: 'required' } }, page);
  await tick();
  const row = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  assert((await send({ kind: 'passkey.approve', id: row.id, source: 'desktop', vaultId, itemId, masterPassword: 'wrong' })).error);
  assert(queue.get(row.id)); // failed verification may be retried for an assertion
  await send({ kind: 'passkey.approve', id: row.id, source: 'desktop', vaultId, itemId, masterPassword: 'correct-password' });
  const got = await assertion; assert(got.value.response.signature); assert.equal(JSON.stringify(got).includes(stored.privateKey), false);
  const cached = send({ ...request, id: 'cached-get', operation: 'get', options: { challenge: request.options.challenge, rpId: 'example.test', userVerification: 'required' } }, page);
  await tick();
  const cachedRow = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  assert.equal((await send({ kind: 'passkey.choices', id: cachedRow.id, source: 'desktop' })).reuseDesktopUnlock, true);
  assert.equal((await send({ kind: 'passkey.approve', id: cachedRow.id, source: 'desktop', vaultId, itemId })).ok, true);
  assert((await cached).value.response.signature);
  const changed = send({ ...request, id: 'changed-get', operation: 'get', options: { challenge: request.options.challenge, rpId: 'example.test', userVerification: 'required' } }, page);
  await tick();
  const changedRow = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  await send({ kind: 'passkey.choices', id: changedRow.id, source: 'desktop' });
  rotateDuringGet = true;
  assert.match((await send({ kind: 'passkey.approve', id: changedRow.id, source: 'desktop', vaultId, itemId })).error, /session changed/);
  rotateDuringGet = false;
  await send({ kind: 'passkey.cancel', id: changedRow.id });
  assert((await changed).error);
  const excluded = send({ ...request, id: 'excluded', options: { ...request.options, excludeCredentials: [{ type: 'public-key', id: stored.metadata.credentialId }] } }, page);
  await tick();
  const excludedRow = (await send({ kind: 'passkey.pending', tabId: 1 })).requests[0];
  const failed = await send({ kind: 'passkey.approve', id: excludedRow.id, source: 'desktop', vaultId, masterPassword: 'correct-password' });
  assert.match(failed.error, /already exists/); assert((await excluded).error);
  const navigated = send({ ...request, id: 'navigation' }, page); await tick(); updated(1, { status: 'loading' }); assert((await navigated).error);
  const closed = send({ ...request, id: 'closed' }, page); await tick(); removed(1); assert((await closed).error);
  const duringLock = send({ ...request, id: 'lock' }, page); await tick(); locked = true; queue.cancelAll(); assert((await duringLock).error);
  assert((await send({ kind: 'passkey.approve', id: 'forged', source: 'desktop' }, page)).error);
  queue.cancelAll();
});
