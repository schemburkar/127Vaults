import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const unlock = async () => {');
const unlockSource = source.slice(start, source.indexOf('  const selectVault =', start));
const statusStart = source.indexOf('  // Ancillary status must not delay');
const statusSource = source.slice(statusStart, source.indexOf('  // Connector saves', statusStart));
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('verified desktop unlock presents the vault without awaiting ancillary status', { timeout: 1000 }, async () => {
  const calls = [], values = {};
  const context = { busy: false, unlocked: false, username: 'fixture', rememberedSecret: true,
    showSecretEntry: false, accountSecret: '', masterPassword: 'synthetic-password-long-enough',
    Date, requestAnimationFrame: callback => callback(),
    dragSession: { unlock() {} }, friendlyError: String, notify() {}, openItem: async () => {},
    invoke: async command => {
      calls.push(command);
      if (command !== 'unlock') return new Promise(() => {});
      return { online: true, vaultId: 'fixture', vaults: [], items: [], settings: { collections: [] }, viewKind: 'all', secretRemembered: true };
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
  let cleanup;
  const sandbox = vm.createContext({ unlocked: true, online: true,
    invoke: command => new Promise(resolve => { pending[command] = resolve; }),
    useEffect: callback => { cleanup = callback(); },
    setRemovalPlan: value => { values.removal = value; },
    setLicenseStatus: value => { values.license = value; },
  });
  vm.runInContext(compile(statusSource), sandbox);
  return { pending, values, dispose: () => cleanup() };
}

test('ancillary status updates are applied after the vault is presented', async () => {
  const harness = statusHarness();
  const plan = { pending: false }, license = { mode: 'active' };
  harness.pending.vault_removal_status(plan);
  harness.pending.license_status(license);
  await Promise.resolve();
  assert.deepEqual(harness.values, { removal: plan, license });
});

test('locking or switching sessions discards stale ancillary status responses', async () => {
  const harness = statusHarness();
  harness.dispose();
  harness.pending.vault_removal_status({ pending: true });
  harness.pending.license_status({ mode: 'revoked' });
  await Promise.resolve();
  assert.deepEqual(harness.values, {});
});
