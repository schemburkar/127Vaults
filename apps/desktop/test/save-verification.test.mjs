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

const deletion=source.slice(source.indexOf('  const deleteItem = async'),source.indexOf('  const synchronize = async'));
function deletionHarness(confirm=true){
 const values={},calls=[],events=[],generation={current:1};let release;
 const item={itemId:'fixture-item',title:'Delete me'},tabs=[{itemId:item.itemId,vaultId:'fixture-vault'},{itemId:item.itemId,vaultId:'other-vault'}];
 const context=vm.createContext({selected:item,itemVaultId:'fixture-vault',saving:false,busy:false,viewMode:'single',window:{confirm:()=>confirm},syncReviewGeneration:generation,
  invoke:(command,args)=>{calls.push({command,args});return new Promise(resolve=>{release=resolve})},
  emit:async(name,args)=>events.push({name,args}),refreshSyncStatus:async()=>{},dirtyRef:{current:false},Date,notify:()=>{},friendlyError:String,
 });
 for(const setter of new Set(deletion.match(/set[A-Z]\w+/g)))context[setter]=value=>{values[setter]=typeof value==='function'?value(tabs):value};
 vm.runInContext(ts.transpileModule(deletion+'\nglobalThis.runDelete=deleteItem;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return{run:()=>context.runDelete(),values,calls,events,generation,complete:()=>release({result:{queued:true},items:[]})};
}
test('declining item deletion sends nothing',async()=>{const h=deletionHarness(false);await h.run();assert.equal(h.calls.length,0)});
test('confirmed item deletion uses its owning vault and only clears matching tabs',async()=>{
 const h=deletionHarness(),done=h.run();h.complete();await done;
 assert.equal(h.calls[0].command,'item_delete');assert.equal(h.calls[0].args.vaultId,'fixture-vault');
 assert.deepEqual(h.values.setItemTabs,[{itemId:'fixture-item',vaultId:'other-vault'}]);
 assert.equal(h.values.setSelected,null);assert.equal(h.values.setSaving,false);assert.equal(h.events[0].name,'vaults-item-deleted');
});
test('a deletion response after lock cannot change the new session',async()=>{
 const h=deletionHarness(),done=h.run();h.generation.current++;h.complete();await done;
 assert.equal(h.values.setItems,undefined);assert.equal(h.values.setSelected,undefined);assert.equal(h.events.length,0);
});
