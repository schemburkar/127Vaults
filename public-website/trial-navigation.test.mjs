import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./trial.mjs', import.meta.url), 'utf8');
const startup = source.slice(0, source.indexOf('const base ='));

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


test('operator review uses a credential-free mode and preserves it on reload', () => {
  const browser = new EventTarget(), paths = [];
  browser.location = { pathname: '/trial', search: '?review=1', hash: '', reload() {} };
  browser.history = { replaceState(_state, _title, path) { paths.push(path); } };
  const context = vm.createContext({ URLSearchParams, window: browser, location: browser.location, history: browser.history });
  vm.runInContext(`${startup}\nglobalThis.review = operatorReview; globalThis.parsed = match;`, context);
  assert.equal(context.review, true); assert.equal(context.parsed, null);
  assert.deepEqual(paths, ['/trial?review=1']);
});
