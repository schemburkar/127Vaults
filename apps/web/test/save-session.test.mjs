import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual save continuation with synthetic UI and encrypted records.
// No account, browser storage, network or real secret is used by this fixture.
async function harness() {
  const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function save(event'), source.indexOf('function resolveConflict('));
  const values = { title: 'Dummy item', url: 'https://dummy.invalid', 'item-id': '',
    'item-username': 'dummy-user', 'item-password': 'dummy-secret' };
  const elements = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    { value, setAttribute() {}, focus() {}, classList: { toggle() {} } }]));
  elements['title-error'] = { classList: { toggle() {} } };
  const changes = [], requests = [], busyChanges = [];
  const record = new Uint8Array(80);
  const context = vm.createContext({ root: {}, vault: {}, vaultId: 'dummy-vault',
    sessionGeneration: 1, busy: false, loadedItems: [], catalogue: record, replica: null,
    $: key => elements[key], setBusy: value => busyChanges.push(value),
    collectCustomFields: () => [], normalizeWebsite: value => value, itemKind: () => 'login',
    features: { isFavorite: () => false }, readMetadata: () => null,
    core: { upsert_private_item: () => ({ item: () => record, catalogue: () => record,
      index: () => record, body: () => record }) },
    id: value => value, uuid: () => 'dummy-item', b64: () => 'dummy-ciphertext',
    te: new TextEncoder(), crypto, Date,
    signedMutation: async () => ({}),
    call: async (...args) => { requests.push(args); throw Error('HTTP_409'); },
    reload: async () => {}, fetchItem: async () => ({ body: { password: 'dummy-server-secret' } }),
    beginEdit: item => { changes.push(['edit', item]); elements['item-password'].value = item.body.password; },
    displayItem: item => changes.push(['display', item]), clearItem: () => changes.push(['clear']),
    updateSessionDates() {}, toast: (...args) => changes.push(['toast', ...args]),
    safeError: error => error.message, document: { querySelector: () => null },
    resolveConflict: async () => 'cancel', requestAnimationFrame: callback => callback(),
  });
  vm.runInContext(code + '\nglobalThis.runSave = save;', context);
  const lock = () => { context.sessionGeneration++; context.root = null; elements['item-password'].value = ''; };
  return { context, elements, changes, requests, busyChanges, lock,
    run: () => context.runSave({ preventDefault() {} }) };
}

test('locking during conflict choice cannot restore a plaintext draft', async () => {
  const h = await harness();
  h.context.resolveConflict = async () => { h.lock(); return 'cancel'; };
  await h.run();
  assert.equal(h.elements['item-password'].value, '');
  assert.deepEqual(h.changes, []);
  assert.deepEqual(h.busyChanges, [true]);
});

test('locking during failed conflict reload cannot restore the draft', async () => {
  const h = await harness();
  h.context.reload = async () => { h.lock(); throw Error('LOCKED'); };
  await h.run();
  assert.equal(h.elements['item-password'].value, '');
  assert.deepEqual(h.changes, []);
});

test('a stale save cannot send or update a replacement unlocked session', async () => {
  const h = await harness();
  h.context.signedMutation = async () => { h.lock(); h.context.root = {}; return {}; };
  await h.run();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.changes, []);
});

test('an accepted response after locking does not update UI or catalogue', async () => {
  const h = await harness(), original = h.context.catalogue;
  h.context.call = async () => { h.lock(); return {}; };
  await h.run();
  assert.equal(h.context.catalogue, original);
  assert.deepEqual(h.changes, []);
});

test('same-session conflict cancellation preserves the user draft', async () => {
  const h = await harness();
  await h.run();
  assert.equal(h.elements['item-password'].value, 'dummy-secret');
  assert.equal(h.changes[0][0], 'edit');
  assert.deepEqual(h.busyChanges, [true, false]);
});
