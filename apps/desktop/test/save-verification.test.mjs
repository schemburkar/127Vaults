import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/app.tsx',import.meta.url),'utf8');
const save=source.slice(source.indexOf('  const save = async'),source.indexOf('  const synchronize = async'));
function harness(failure){
 const values={},notices=[];const item={itemId:'fixture-item',title:'Fixture edit',username:'',website:'',password:'synthetic',customFields:[]};
 const context=vm.createContext({selected:item,saving:false,dirtyRef:{current:true},resolvingOperationId:null,itemVaultId:'fixture-vault',vaultId:'fixture-vault',viewMode:'single',Date,visibleFields:()=>[],parseTotp:()=>{},friendlyError:String,structuredClone,
  invoke:async()=>{if(failure)throw Error(failure);return{result:{itemId:item.itemId},items:[item]};},
  refreshSyncStatus:async()=>{},openItem:async()=>{},listVisibleItems:async()=>[item],notify:(...notice)=>notices.push(notice),
 });
 for(const setter of new Set(save.match(/set[A-Z]\w+/g)))context[setter]=value=>{values[setter]=value;};
 vm.runInContext(ts.transpileModule(save+'\nglobalThis.runSave=save;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return{run:()=>context.runSave(),values,notices};
}
test('failed server verification keeps sync error visible instead of claiming the item was not saved',async()=>{
 const h=harness('acknowledged operation missing from server history; local replica was preserved');await h.run();
 assert.equal(h.values.setSyncState,'error');assert.match(h.values.setSyncFailure,/local replica was preserved/);
 assert.equal(h.notices[0][1],'Server verification failed');assert.equal(h.values.setEditing,undefined);
});
test('a fully verified online save clears previous verification failure',async()=>{
 const h=harness();await h.run();assert.equal(h.values.setSyncState,'idle');assert.equal(h.values.setSyncFailure,null);assert.equal(h.values.setEditing,false);
});
