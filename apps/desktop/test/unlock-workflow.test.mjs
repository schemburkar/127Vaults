import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createSessionRevocation } from '../src/session-revocation.mjs';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const unlock = async () => {');
const unlockSource = source.slice(start, source.indexOf('  const selectVault =', start));
const statusStart = source.indexOf('  // Ancillary status must not delay');
const statusSource = source.slice(statusStart, source.indexOf('  // Connector saves', statusStart));
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('verified desktop unlock presents the vault without awaiting ancillary status', { timeout: 1000 }, async () => {
  const calls = [], values = {};
  const context = { sessionRevocation: { current: createSessionRevocation() }, busy: false, unlocked: false, username: 'fixture', rememberedSecret: true,
    showSecretEntry: false, accountSecret: '', masterPassword: 'synthetic-password-long-enough',
    Date, requestAnimationFrame: callback => callback(),
    dragSession: { unlock() {} }, friendlyError: String, notify() {}, openItem: async () => {},
    invoke: async command => {
      calls.push(command);
      if (command !== 'unlock') return new Promise(() => {});
      return { sessionEpoch: 1, online: true, vaultId: 'fixture', vaults: [], items: [], settings: { collections: [] }, viewKind: 'all', secretRemembered: true };
    },
  };
  for (const setter of new Set(unlockSource.match(/set[A-Z]\w+/g))) context[setter] = value => { values[setter] = value; };
  const sandbox = vm.createContext(context);
  vm.runInContext(compile(unlockSource + '\nglobalThis.runUnlock = unlock;'), sandbox);
  assert.equal(await sandbox.runUnlock(), true);
  assert.deepEqual(calls, ['unlock']);
  assert.equal(values.setUnlocked, true);
  assert.equal(values.setMasterPassword, '');
  assert.equal(values.setBusy, false);
});

function statusHarness() {
  const pending = {}, values = {};
  const events = new Map(), timers = new Map();
  let cleanup;
  const sandbox = vm.createContext({ unlocked: true, online: true,
    document: { hidden: false },
    window: { setInterval: (callback, delay) => { assert.equal(delay, 30000); timers.set(1, callback); return 1; },
      clearInterval: id => timers.delete(id), addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    invoke: command => new Promise(resolve => { pending[command] = resolve; }),
    useEffect: callback => { cleanup = callback(); },
    setRemovalPlan: value => { values.removal = value; },
    setLicenseStatus: value => { values.license = value; },
  });
  vm.runInContext(compile(statusSource), sandbox);
  return { pending, values, timers, events, dispose: () => cleanup() };
}

test('ancillary status updates are applied after the vault is presented', async () => {
  const harness = statusHarness();
  const plan = { pending: false }, license = { mode: 'active' };
  harness.pending.vault_removal_status(plan);
  harness.pending.license_status(license);
  await new Promise(setImmediate);
  assert.deepEqual(harness.values, { removal: plan, license });
});

test('locking or switching sessions discards stale ancillary status responses', async () => {
  const harness = statusHarness();
  harness.dispose();
  harness.pending.vault_removal_status({ pending: true });
  harness.pending.license_status({ mode: 'revoked' });
  await new Promise(setImmediate);
  assert.deepEqual(harness.values, {});
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.events.size, 0);
});

test('unlocked online desktop refreshes expiry and renewal without overlapping requests', async () => {
  const harness = statusHarness();
  const originalRequest = harness.pending.license_status;
  await harness.events.get('focus')();
  assert.equal(harness.pending.license_status, originalRequest);
  originalRequest({ mode: 'active' }); await new Promise(setImmediate);
  harness.timers.get(1)(); harness.pending.license_status({ mode: 'read-only' }); await new Promise(setImmediate);
  assert.equal(harness.values.license.mode, 'read-only');
  const focused = harness.events.get('focus')(); harness.pending.license_status({ mode: 'active' }); await focused;
  assert.equal(harness.values.license.mode, 'active');
  harness.dispose();
});

test('connector startup failure leaves desktop usable and reports the diagnostic', { timeout: 1000 }, async () => {
  const calls = [], values = {}, notices = [];
  const context = { sessionRevocation: { current: createSessionRevocation() }, busy: false, unlocked: false, username: 'fixture', rememberedSecret: true,
    showSecretEntry: false, accountSecret: '', masterPassword: 'synthetic-password-long-enough',
    Date, requestAnimationFrame: callback => callback(),
    dragSession: { unlock() {} }, friendlyError: String, notify(...args) { notices.push(args); }, openItem: async () => {},
    invoke: async command => {
      calls.push(command);
      if (command !== 'unlock') return new Promise(() => {});
      return { extensionConnectorActive: false, extensionConnectorError: "offline unlock is not provisioned", sessionEpoch: 1, online: true, vaultId: 'fixture', vaults: [], items: [], settings: { collections: [] }, viewKind: 'all', secretRemembered: true };
    },
  };
  for (const setter of new Set(unlockSource.match(/set[A-Z]\w+/g))) context[setter] = value => { values[setter] = value; };
  const sandbox = vm.createContext(context);
  vm.runInContext(compile(unlockSource + '\nglobalThis.runUnlock = unlock;'), sandbox);
  assert.equal(await sandbox.runUnlock(), true);
  assert.deepEqual(calls, ['unlock']);
  assert.equal(values.setUnlocked, true);
  assert.equal(values.setMasterPassword, '');
  assert.equal(values.setBusy, false);
  assert.ok(notices.some(args => args[1] === 'Browser extension is disconnected' && args[2].includes('offline unlock is not provisioned')));
});
