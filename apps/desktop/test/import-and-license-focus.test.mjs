import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('import preview uses the chosen destination rather than the currently displayed vault', async () => {
  const calls = [], values = {};
  const code = source.slice(source.indexOf('  const runImport ='), source.indexOf('  const lock ='));
  const context = vm.createContext({ importFile: { size: 3, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer },
    vaultId: 'current-vault', importVaultId: 'chosen-vault', importBusy: false, importFormat: 'bitwarden', importGeneration: { current: 0 },
    invoke: async (command, args) => { calls.push({ command, args }); return { records: 2, sourceVaults: [{ name: 'Personal', records: 2 }] }; },
  });
  for (const setter of new Set(code.match(/set[A-Z]\w+/g))) context[setter] = value => { values[setter] = value; };
  vm.runInContext(compile(code + '\nglobalThis.run=runImport;'), context);
  await context.run(false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.vaultId, 'chosen-vault');
  assert.equal(calls[0].args.confirm, false);
  assert.equal(values.setImportCount, 2);
  context.importVaultId = '__source_vaults__';
  await context.run(false);
  assert.equal(calls[1].args.vaultId, '__source_vaults__');
  assert.equal(values.setImportSourceVaults[0].name, 'Personal');
  context.importVaultId = '';
  await context.run(false);
  assert.equal(calls.length, 2, 'no destination must prevent import');
});

function licenseHarness(cacheError = false) {
  const start = source.indexOf('    const refreshLicenseStatus =');
  const code = source.slice(start, source.indexOf('    void refreshLicenseStatus();', start));
  const calls = [], locks = [], values = [];
  const context = vm.createContext({ disposed: false, licenseBusy: false,
    invoke: async command => {
      calls.push(command);
      if (command === 'license_status') throw Error('status service unavailable');
      if (cacheError) throw Error('License grace ended');
      return { mode: 'read-only' };
    }, setLicenseStatus: value => values.push(value), lock: async reason => locks.push(reason),
  });
  vm.runInContext(compile(code + '\nglobalThis.refresh=refreshLicenseStatus;'), context);
  return { context, calls, locks, values };
}

test('focus refresh failure retains an unlocked session only when cached license access is authorized', async () => {
  const valid = licenseHarness(); await valid.context.refresh();
  assert.deepEqual(valid.calls, ['license_status', 'license_access_status']);
  assert.equal(valid.locks.length, 0);
  assert.equal(valid.values[0].mode, 'read-only');
  const expired = licenseHarness(true); await expired.context.refresh();
  assert.equal(expired.locks.length, 1, 'missing, revoked or expired cache must still lock');
});
