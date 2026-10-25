import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
for (const accepted of [false, true]) test(`app close waits for the in-app decision: ${accepted}`, async () => {
  let handler, decide, prevented = 0, destroyed = 0;
  const calls = [];
  const answer = new Promise(resolve => { decide = resolve; });
  const context = vm.createContext({ dirtyRef: { current: true }, confirmAction: () => answer,
    getCurrentWindow: () => ({ onCloseRequested: callback => { handler = callback; return Promise.resolve(() => {}); }, destroy: () => { destroyed++; } }),
    emit: async () => calls.push('emit'), invoke: async () => calls.push('lock'), useEffect: callback => callback(),
  });
  const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('onCloseRequested(async'));
  const end = source.indexOf('\n  const refreshSyncStatus', start);
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const pending = handler({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(destroyed, 0);
  assert.deepEqual(calls, []);
  decide(accepted);
  await pending;
  await new Promise(setImmediate);
  assert.equal(destroyed, accepted ? 1 : 0);
  assert.deepEqual(calls, accepted ? ['emit', 'lock'] : []);
});
test('desktop uses in-app confirmations throughout', () => {
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(source, /beforeunload/);
});
