import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/popup.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function refreshLocalItems() {');
const end = source.indexOf("$('search').oninput", start);
function harness() {
  let complete, renders = 0;
  const context = vm.createContext({
    selectedSource: 'desktop', sourceLoadRevision: 1, pending: false,
    targetTab: { url: 'https://example.test/' }, items: [{ itemId: 'old' }],
    document: { hidden: false }, frames: { hidden: true }, JSON,
    originOf: value => new URL(value).origin,
    native: () => new Promise(resolve => { complete = resolve; }),
    renderItems: () => { renders++; },
  });
  context.$ = () => context.frames;
  vm.runInContext(source.slice(start, end), context);
  return { context, refresh: () => vm.runInContext('refreshLocalItems()', context), resolve: value => complete(value), renders: () => renders };
}

test('an open popup receives new logins while desktop remains unlocked', async () => {
  const h = harness(), pending = h.refresh();
  h.resolve([{ itemId: 'old' }, { itemId: 'new' }]);
  await pending;
  assert.equal(h.context.items.length, 2);
  assert.equal(h.renders(), 1);
  const unchanged = h.refresh();
  h.resolve([{ itemId: 'old' }, { itemId: 'new' }]);
  await unchanged;
  assert.equal(h.renders(), 1);
});

for (const [label, change] of [
  ['source changed', h => { h.context.selectedSource = 'cli'; }],
  ['manual refresh started', h => { h.context.sourceLoadRevision++; }],
  ['fill started', h => { h.context.pending = true; }],
  ['frame chooser opened', h => { h.context.frames.hidden = false; }],
  ['popup hidden', h => { h.context.document.hidden = true; }],
]) test('late list response is ignored when ' + label, async () => {
  const h = harness(), pending = h.refresh();
  change(h);
  h.resolve([{ itemId: 'new' }]);
  await pending;
  assert.equal(h.context.items[0].itemId, 'old');
  assert.equal(h.renders(), 0);
});
