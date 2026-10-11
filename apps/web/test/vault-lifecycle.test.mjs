import test from 'node:test';
import assert from 'node:assert/strict';
import { VaultLifecycleClient, settingsAfterRemoval } from '../src/vault-lifecycle.mjs';

test('archive and move settings preserve labels and unrelated collections, using the desktop settings format',()=>{
  const original={version:1,names:{source:'Source',target:'Target'},collections:[{id:'one',name:'One',vault_ids:['source']},{id:'two',name:'Two',vault_ids:['source','target']},{id:'other',name:'Other',vault_ids:['unrelated']}],default_view:{kind:'collection',id:'one'},removal_preference:'move'};
  const archived=settingsAfterRemoval(original,'source');assert.equal(archived.default_view,null);assert.deepEqual(archived.collections.map(row=>row.id),['two','other']);assert.equal(archived.names.source,'Source');
  const moved=settingsAfterRemoval(original,'source','target');assert.deepEqual(moved.collections[0].vault_ids,['target']);assert.deepEqual(moved.collections[1].vault_ids,['target']);assert.deepEqual(moved.default_view,original.default_view);assert.equal(original.collections[0].vault_ids[0],'source');
});
test('lost final removal response retries its exact durable request even after server retirement',async()=>{
  let journal={source:'source',choice:'archive',destination:null,request:{requestId:'durable-request',encrypted:'synthetic-envelope'}};const requests=[];
  const client=new VaultLifecycleClient({readJournal:async()=>structuredClone(journal),writeJournal:async value=>{journal=value},send:async(path,options)=>{requests.push({path,options});if(path==='/api/v1/vaults')return{vaultEnvelopes:[{vaultId:'source',retired:true}]};assert.equal(options.body.requestId,'durable-request');return{recoverable:true}}});
  assert.deepEqual(await client.remove('source','archive'),{recoverable:true});assert.equal(journal,null);assert.equal(requests.length,2);assert.equal(requests[1].path,'/api/v1/vaults/source/removal');
});
test('pending removal survives network failure and rejects a different source or action',async()=>{
  const journal={source:'source',choice:'archive',destination:null,request:{requestId:'durable-request'}};
  const client=new VaultLifecycleClient({readJournal:async()=>journal,writeJournal:async()=>assert.fail('discarded journal'),send:async()=>{throw Error('SERVER_UNREACHABLE')}});
  await assert.rejects(client.remove('source','archive'),/SERVER_UNREACHABLE/);await assert.rejects(client.remove('other','archive'),/PENDING_REMOVAL/);await assert.rejects(client.remove('source','move','target'),/PENDING_REMOVAL/);
});
test('lost restore replies replay the same request without regenerating a revision or request ID',async()=>{
  let journal={choice:'restore',source:'source',request:{requestId:'original',sourceCatalogueRevision:'revision'}};
  const client=new VaultLifecycleClient({readJournal:async()=>journal,writeJournal:async value=>{journal=value},send:async(path,options)=>{assert.equal(path,'/api/v1/vaults/source/restore');assert.deepEqual(options.body,journal.request);return{restored:true}}});
  assert.deepEqual(await client.restore('source'),{restored:true});assert.equal(journal,null);
});
test('an interrupted move verifies its saved copy before sending and preserves a rejected journal',async()=>{
  const source='10000000-0000-4000-8000-000000000001',destination='20000000-0000-4000-8000-000000000001',item='30000000-0000-4000-8000-000000000001';
  const catalogue=Buffer.alloc(80).toString('base64url'),journal={source,choice:'move',destination,sourceRevision:'00000000-0000-0000-0000-000000000000',mappings:[],pendingCopy:{sourceItemId:item,payload:{tampered:true}}};
  const handle={free(){}},core={open_private_vault:()=>handle,release_vault(){}};
  const client=new VaultLifecycleClient({core,root:{},readJournal:async()=>journal,writeJournal:async()=>assert.fail('discarded journal'),verifyCopy:async payload=>{assert.equal(payload.tampered,true);throw Error('INVALID_SYNC_HISTORY')},send:async(path,options)=>{assert.equal(options,undefined);return path==='/api/v1/vaults'?{directory:catalogue,vaultEnvelopes:[{vaultId:source,envelope:catalogue},{vaultId:destination,envelope:catalogue}]}:{catalogue,indices:[{itemId:item}]}}});
  await assert.rejects(client.remove(source,'move',destination),/INVALID_SYNC_HISTORY/);assert.ok(journal.pendingCopy);
});
