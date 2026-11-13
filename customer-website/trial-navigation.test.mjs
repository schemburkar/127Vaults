import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./trial.mjs', import.meta.url), 'utf8');
const startup = source.slice(0, source.indexOf('const base =')).replace(/^import .*;\r?\n/gm, '');

test('paid setup opens its subscription action before rendering downloads', async () => {
  const body=source.slice(source.indexOf('async function open()'),source.indexOf("\n$('trial-activate').addEventListener"));
  const nodes=new Map(),links=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',after:link=>links.push(link),replaceChildren(){},addEventListener(){},setAttribute(){}});return nodes.get(id);};
  const context=vm.createContext({requestId:'a'.repeat(64),match:null,token:undefined,
    api:async()=>({json:async()=>({billingAvailable:true,artifacts:[],sourceRevision:'review-source'})}),
    document:{createElement:()=>({append(){}})},$:node,status:()=>{},showInstaller:()=>{},showLicense:()=>{},renderPackages:()=>{}});
  await vm.runInContext(body+'\nopen();',context);
  assert.equal(node('trial-content').hidden,false);
  assert.equal(links.length,1);
  assert.equal(links[0].href,'/billing?request='+'a'.repeat(64));
  assert.equal(links[0].textContent,'Manage subscription, invoices and payment methods');
});

test('recommended installer commands omit credentials and offer setup links for portal customers', () => {
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
      assert.equal(nodes['copy-installer-invitation'].hidden, false);
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
    token, requestId, match: [null, requestId], location: { origin: 'https://manage.example' }, $: id => nodes[id],
    navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
  });
  vm.runInContext(handler, context);
  assert.deepEqual(copied, []);
  await click();
  assert.deepEqual(copied, [`https://manage.example/trial.html#${requestId}.${token}`]);
  assert.doesNotMatch(notice.textContent, /https:/);
  const paidContext = vm.createContext({
    token: undefined, requestId, $: id => nodes[id],
    portalApi: async (path, value) => {
      assert.equal(path, 'installer-link');
      assert.equal(value.requestId, requestId);
      return { link: 'https://manage.example/trial#fresh-setup-link' };
    },
    navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
  });
  vm.runInContext(handler, paidContext);
  await click();
  assert.equal(copied.at(-1), 'https://manage.example/trial#fresh-setup-link');
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
