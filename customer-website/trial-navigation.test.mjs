import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./trial.mjs', import.meta.url), 'utf8');
const startup = source.slice(0, source.indexOf('const base ='));

test('recommended installer commands omit credentials and offer copying only with an invitation', () => {
  const renderer = source.slice(source.indexOf('function showInstaller'), source.indexOf("\n$('copy-installer-invitation').addEventListener"));
  for (const [artifacts, visible] of [[[{ product: 'installer', supporting: false }], true],
    [[{ product: 'server' }], false], [[{ product: 'installer', supporting: true }], false]]) {
    const nodes = { 'trial-installer': { hidden: true }, 'trial-manual': { open: true }, 'trial-installer-command': { textContent: '' }, 'trial-installer-command-help': { textContent: '' }, 'copy-installer-invitation': { hidden: true } };
    const context = vm.createContext({ token: 'A'.repeat(43), match: [null, 'a'.repeat(64)],
      location: { origin: 'https://vaults.example' }, $: id => nodes[id], record: { artifacts } });
    vm.runInContext(`${renderer}\nshowInstaller(record);`, context);
    assert.equal(nodes['trial-installer'].hidden, !visible);
    assert.equal(nodes['trial-manual'].open, !visible);
    if (visible) {
      assert.doesNotMatch(nodes['trial-installer-command'].textContent, /https:|--invitation/);
      assert.equal(nodes['copy-installer-invitation'].hidden, false);
      assert.ok(nodes['trial-installer-command'].textContent.includes('.\\127vaults-install.exe'));
      assert.ok(nodes['trial-installer-command'].textContent.includes('./127vaults-install'));
      vm.runInContext('token = undefined; showInstaller(record);', context);
      assert.equal(nodes['copy-installer-invitation'].hidden, true);
    } else assert.equal(nodes['trial-installer-command'].textContent, '');
  }
});

test('the copy button hands off the full private URL only on request', async () => {
  const start = source.indexOf("$('copy-installer-invitation').addEventListener");
  const handler = source.slice(start, source.indexOf('function showLicense', start));
  let click;
  const copied = [], notice = {};
  const token = 'A'.repeat(43), requestId = 'a'.repeat(64);
  const nodes = {
    'copy-installer-invitation': { addEventListener: (_event, callback) => { click = callback; } },
    'installer-invitation-status': notice,
  };
  const context = vm.createContext({
    token, match: [null, requestId], location: { origin: 'https://manage.example' }, $: id => nodes[id],
    navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
  });
  vm.runInContext(handler, context);
  assert.deepEqual(copied, []);
  await click();
  assert.deepEqual(copied, [`https://manage.example/trial.html#${requestId}.${token}`]);
  assert.doesNotMatch(notice.textContent, /https:/);
});

test('opening another invitation in the same tab reloads its document rather than retaining old packages', () => {
  const browser = new EventTarget(), paths = [];
  let reloads = 0;
  browser.location = { pathname: '/trial', hash: `#${'a'.repeat(64)}.${'A'.repeat(43)}`, reload() { reloads++; } };
  browser.history = { replaceState(_state, _title, path) { paths.push(path); browser.location.hash = ''; } };
  const context = vm.createContext({ URLSearchParams, window: browser, location: browser.location, history: browser.history });
  vm.runInContext(`${startup}\nglobalThis.parsed = match;`, context);
  assert.equal(context.parsed[1], 'a'.repeat(64));
  assert.deepEqual(paths, ['/trial'], 'the URL retains neither the bearer nor the navigation query');
  assert.equal(reloads, 0);
  browser.location.hash = `#${'b'.repeat(64)}.${'B'.repeat(43)}`;
  browser.dispatchEvent(new Event('hashchange'));
  assert.equal(reloads, 1, 'a new invitation must replace the old document and token');
  browser.location.hash = '';
  browser.dispatchEvent(new Event('hashchange'));
  assert.equal(reloads, 1, 'clearing the fragment must not create a reload loop');
});

test('invalid fragments remain invalid and are never sent as a query credential', () => {
  const browser = new EventTarget();
  browser.location = { pathname: '/trial', hash: '#invalid', reload() {} };
  browser.history = { replaceState(_state, _title, path) { assert.equal(path, '/trial'); } };
  const context = vm.createContext({ URLSearchParams, window: browser, location: browser.location, history: browser.history });
  vm.runInContext(`${startup}\nglobalThis.parsed = match;`, context);
  assert.equal(context.parsed, null);
});


test('a former operator-review URL never enables admin behavior on the customer site', () => {
  const browser = new EventTarget(), paths = [];
  browser.location = { pathname: '/trial', search: '?review=1', hash: '', reload() {} };
  browser.history = { replaceState(_state, _title, path) { paths.push(path); } };
  const context = vm.createContext({ URLSearchParams, window: browser, location: browser.location, history: browser.history });
  vm.runInContext(`${startup}\nglobalThis.parsed = match;`, context);
  assert.equal(context.parsed, null);
  assert.deepEqual(paths, ['/trial']);
  assert.ok(!source.includes('/api/access-admin/'));
});
