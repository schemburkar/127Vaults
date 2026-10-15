import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/app.tsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  const resolveVaultSettings ='),source.indexOf('  const addVault ='));
for(const error of ['server vault settings changed; review the conflict again','server rejected request (403)']){
 test('failed settings choice retires displayed comparison and refreshes status: '+error,async()=>{
  const calls=[],values={};const context=vm.createContext({confirmDiscard:()=>true,invoke:async command=>{calls.push(command);throw Error(error);},refreshSyncStatus:async()=>{calls.push('refresh');},friendlyError:String,notify:(...args)=>{values.notification=args;}});
  for(const setter of new Set(handler.match(/set[A-Z]\w+/g)))context[setter]=value=>{values[setter]=value;};
  vm.runInContext(ts.transpileModule(handler+'\nglobalThis.resolve=resolveVaultSettings;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  await context.resolve('server');assert.deepEqual(calls,['vault_settings_resolve','refresh']);assert.equal(values.setSettingsReview,null);assert.equal(values.setSettingsConflict,undefined);assert.equal(values.notification[1],'Could not resolve settings');assert.match(values.notification[2],new RegExp(error.replace(/[()]/g,'\\$&')));
 });
}
