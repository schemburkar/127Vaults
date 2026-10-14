import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/app.tsx',import.meta.url),'utf8');
const review=source.slice(source.indexOf('  const reviewQueuedItem ='),source.indexOf('  useEffect(() => { if (unlocked)'));
const sync=source.slice(source.indexOf('  const synchronize = async'),source.indexOf('  const useServerVersion ='));
function harness(handler){
 const shown={itemId:'shown-item',title:'Shown item',customFields:[]},row={vaultId:'conflict-owner',itemId:'queued-item',operationId:'queued-op',title:'Queued item',fields:['title'],conflict:{kind:'field-overlap'}};
 const context=vm.createContext({selected:shown,vaultId:'shown-owner',itemVaultId:'shown-owner',viewMode:'all',online:true,conflict:null,syncInFlight:{current:false},syncReviewGeneration:{current:1},confirmDiscard:()=>true,friendlyError:String,
  invoke:async command=>command==='sync'?{vaults:[{vaultId:'shown-owner'},{vaultId:'conflict-owner'}],items:[],conflicts:[{...row,kind:'field-overlap'}],pending:1,accepted:0}:{itemId:row.itemId,title:row.title,customFields:[]},
  refreshSyncStatus:async()=>{},listVisibleItems:async()=>[],notify:()=>{},
 });
 for(const setter of new Set(handler.match(/set[A-Z]\w+/g)))context[setter]=value=>{context[setter.slice(3,4).toLowerCase()+setter.slice(4)]=value;};
 vm.runInContext(ts.transpileModule(handler+'\nglobalThis.run='+ (handler===review?'reviewQueuedItem':'synchronize')+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return{context,row,shown};
}
for(const [name,handler]of [['queued review',review],['sync review',sync]])test(`${name} captures conflict owner without rebinding the displayed item's next save`,async()=>{
 const h=harness(handler);await h.context.run(h.row);
 assert.equal(h.context.selected,h.shown);assert.equal(h.context.itemVaultId,'shown-owner');assert.equal(h.context.vaultId,'shown-owner');assert.equal(h.context.conflict.vaultId,'conflict-owner');assert.equal(h.context.conflict.operationId,'queued-op');
});
test('accepting the server copy opens it with its captured owner while browsing another vault',async()=>{
 const handler=source.slice(source.indexOf('  const useServerVersion ='),source.indexOf('  const copyValue ='));
 const summary={itemId:'queued-item',title:'Verified server copy'};let opened;
 const context=vm.createContext({conflictBusy:false,vaultId:'shown-owner',viewMode:'all',invoke:async()=>({items:[summary]}),listVisibleItems:async()=>[],refreshSyncStatus:async()=>{},openItem:async(item,owner)=>{opened={item,owner};},notify:()=>{},friendlyError:String});
 for(const setter of new Set(handler.match(/set[A-Z]\w+/g)))context[setter]=()=>{};
 vm.runInContext(ts.transpileModule(handler+'\nglobalThis.run=useServerVersion;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 await context.run(summary.itemId,'queued-op','conflict-owner');assert.equal(opened.item,summary);assert.equal(opened.owner,'conflict-owner');
});
