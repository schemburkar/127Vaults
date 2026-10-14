import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/app.tsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  const refreshSyncStatus ='),source.indexOf('  const reviewQueuedItem ='));
function harness(response){
 const values={},context=vm.createContext({syncReviewGeneration:{current:1},Date,invoke:async command=>command==='replica_status'?await response:{items:[]}});
 for(const setter of new Set(handler.match(/set[A-Z]\w+/g)))context[setter]=value=>{values[setter]=value;};
 vm.runInContext(ts.transpileModule(handler+'\nglobalThis.refresh=refreshSyncStatus;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return{context,values};
}
test('live replica status makes denied session offline with preserved pending count',async()=>{
 const h=harness({pending:2,conflicts:0,lastVerifiedSyncAt:10,online:false,offlineReason:'The server no longer authorizes this session.'});await h.context.refresh();assert.equal(h.values.setOnline,false);assert.match(h.values.setOfflineReason,/no longer authorizes/);assert.equal(h.values.setPendingChanges,2);
});
test('stale status cannot change a newer session connection state',async()=>{
 let finish;const h=harness(new Promise(resolve=>{finish=resolve;}));const request=h.context.refresh();h.context.syncReviewGeneration.current++;finish({pending:2,online:false});await request;assert.deepEqual(h.values,{});
});
test('legacy status without connection fields does not invent offline state',async()=>{
 const h=harness({pending:1,conflicts:0,lastVerifiedSyncAt:null});await h.context.refresh();assert.equal(h.values.setOnline,undefined);assert.equal(h.values.setPendingChanges,1);
});
