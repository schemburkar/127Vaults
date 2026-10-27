import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('clipboard writes are delegated to native cleanup without a renderer timer', async () => {
  const code = source.slice(source.indexOf('  const copyValue = async'), source.indexOf('  const toggleReveal ='));
  const calls = [];
  const context = vm.createContext({ invoke: async (...args) => calls.push(args), setStatus() {} });
  vm.runInContext(compile(code + '\nglobalThis.copy = copyValue;'), context);
  await context.copy('synthetic-secret');
  assert.equal(calls[0][0], 'clipboard_copy');
  assert.equal(calls[0][1].value, 'synthetic-secret');
  const detached = await readFile(new URL('../src/detached-item.tsx', import.meta.url), 'utf8');
  assert.match(detached, /invoke\("clipboard_copy", \{ value: text \}\)/);
  assert.doesNotMatch(detached, /navigator\.clipboard|setTimeout/);
});

test('locking clears decrypted conflict comparisons as well as displayed items', async () => {
  const code = source.slice(source.indexOf('  const lock = async'), source.indexOf('  useEffect(', source.indexOf('  const lock = async')));
  const values = { setConflict: { draft: { password: 'synthetic-secret' } }, setSettingsReview: { local: 'private-name' } };
  const context = vm.createContext({ Set, Event: class {}, cancelConfirmation() {},
    sessionRevocation: { current: { lock() {} } }, syncReviewGeneration: { current: 0 },
    openRequest: { current: 0 }, importGeneration: { current: 0 }, window: { dispatchEvent() {} },
    emit: async () => {}, dragSession: { lock() {} }, invoke: async () => {} });
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) context[name] = value => { values[name] = value; };
  vm.runInContext(compile(code + '\nglobalThis.lockNow = lock;'), context);
  await context.lockNow();
  assert.equal(values.setConflict, null);
  assert.equal(values.setSettingsReview, null);
  assert.equal(values.setSelected, null);
  assert.equal(values.setUnlocked, false);
});
