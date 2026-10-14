import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/pwa-update.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { watchPwaUpdate } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
class Registration extends EventTarget { waiting = null; installing = null; }
test('announces an already waiting release once and disposes listeners', () => {
  const registration = new Registration(); registration.waiting = new EventTarget();
  let notices = 0;
  const stop = watchPwaUpdate(registration, () => notices++);
  registration.dispatchEvent(new Event('updatefound'));
  assert.equal(notices, 1);
  stop(); registration.waiting = new EventTarget(); registration.dispatchEvent(new Event('updatefound'));
  assert.equal(notices, 1);
});
test('detects a release downloaded after registration without activating or reloading it', () => {
  const registration = new Registration(); let notices = 0;
  const stop = watchPwaUpdate(registration, () => notices++);
  const worker = new EventTarget(); registration.installing = worker;
  registration.dispatchEvent(new Event('updatefound'));
  worker.dispatchEvent(new Event('statechange')); assert.equal(notices, 0);
  registration.waiting = worker;
  worker.dispatchEvent(new Event('statechange')); worker.dispatchEvent(new Event('statechange'));
  assert.equal(notices, 1);
  const next = new EventTarget(); registration.installing = next;
  registration.dispatchEvent(new Event('updatefound')); registration.waiting = next;
  next.dispatchEvent(new Event('statechange')); assert.equal(notices, 2);
  stop(); registration.waiting = new EventTarget(); next.dispatchEvent(new Event('statechange'));
  assert.equal(notices, 2);
});
