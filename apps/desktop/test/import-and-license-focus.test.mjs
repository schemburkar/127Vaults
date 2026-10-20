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
    importSelectedVaults: null, importAvailableVaults: [], vaultId: 'current-vault', importVaultId: 'chosen-vault', importBusy: false, importFormat: 'bitwarden', importGeneration: { current: 0 },
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

function licenseHarness(cacheError = false, transientCacheError = false) {
  const start = source.indexOf('    const refreshLicenseStatus =');
  const code = source.slice(start, source.indexOf('    void refreshLicenseStatus();', start));
  const calls = [], locks = [], values = [];
  let cacheAttempts = 0;
  const context = vm.createContext({ disposed: false, licenseBusy: false,
    window: { setTimeout: callback => { callback(); return 1; } },
    invoke: async command => {
      calls.push(command);
      if (command === 'license_status') throw Error('status service unavailable');
      cacheAttempts++;
      if (cacheError || (transientCacheError && cacheAttempts === 1)) throw Error('License cache temporarily unavailable');
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


test('an open import dialog survives transient license cache reads without selecting a file', async () => {
  const transient = licenseHarness(false, true);
  transient.context.importOpen = true;
  transient.context.importFile = null;
  for (let i = 0; i < 4; i++) await transient.context.refresh();
  assert.equal(transient.locks.length, 0);
  assert.equal(transient.values.length, 4);
  assert.equal(transient.context.importOpen, true);
  assert.equal(transient.context.importFile, null);
  assert.deepEqual(transient.calls.slice(0, 3), ['license_status', 'license_access_status', 'license_access_status']);
});

test('import is opened from Settings vaults and closes Settings before showing its dialog', () => {
  assert.doesNotMatch(source, /Actions for All items/);
  const panel = source.slice(source.indexOf('{settingsTab === "vaults" &&'), source.indexOf('{settingsTab === "preferences" &&'));
  const handler = panel.slice(panel.indexOf('onClick={() => {'), panel.indexOf('}}>Import passwords'));
  const calls = [];
  const context = vm.createContext({ viewMode: 'all', activeVaults: [{ vaultId: 'target' }], vaultId: 'other',
    setSettingsOpen: value => calls.push(['settings', value]), setImportOpen: value => calls.push(['import', value]),
    setImportVaultId: value => calls.push(['destination', value]),
    setImportCount() {}, setImportSourceVaults() {}, setImportFile() {}, setImportError() {},
    setImportAvailableVaults() {}, setImportSelectedVaults() {}, setImportSkipped() {},
  });
  vm.runInContext(compile(handler.replace('onClick={() => {', '')), context);
  assert.deepEqual(calls, [['settings', false], ['destination', 'target'], ['import', true]]);
});


test('1Password inspection discovers vaults before preview and forwards the selected subset', async () => {
  const code = source.slice(source.indexOf('  const runImport ='), source.indexOf('  const lock ='));
  const calls = [];
  const context = vm.createContext({ importFile: { size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer },
    importVaultId: '__source_vaults__', importBusy: false, importFormat: '1password', importGeneration: { current: 0 },
    importSelectedVaults: null, importAvailableVaults: [],
    invoke: async (command, args) => { calls.push({command, args}); return args.inspect
      ? { availableVaults: [{id:'large',name:'Large',records:101},{id:'small',name:'Small',records:1}], skippedItems: 3, skippedAttachments: 2 }
      : { records: 1, sourceVaults: [{name:'Small',records:1}], skippedItems:3, skippedAttachments:2 }; },
  });
  const values = {};
  for (const setter of new Set(code.match(/set[A-Z]\w+/g))) context[setter] = value => { values[setter] = value; };
  vm.runInContext(compile(code + '\nglobalThis.run=runImport;'), context);
  await context.run(false);
  assert.equal(calls[0].args.inspect, true);
  assert.equal(values.setImportSelectedVaults.length, 2);
  assert.equal(values.setImportCount, undefined, 'inspection does not authorize confirmation');
  assert.equal(values.setImportSkipped.items, 3);
  context.importSelectedVaults = ['small'];
  await context.run(false);
  assert.equal(calls[1].args.inspect, false);
  assert.deepEqual(Array.from(calls[1].args.selectedVaults), ['small']);
  assert.equal(calls[1].args.confirm, false);
  assert.equal(values.setImportCount, 1);
});
