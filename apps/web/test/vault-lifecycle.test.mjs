import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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

test('a peer edit to an accepted destination copy refuses replay before changing the journal', async () => {
  const source='10000000-0000-4000-8000-000000000001', destination='20000000-0000-4000-8000-000000000001', item='30000000-0000-4000-8000-000000000001', copied='40000000-0000-4000-8000-000000000001';
  const catalogue=Buffer.alloc(80).toString('base64url'), encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const change of ['title', 'password', 'customFields']) {
    const journal={source,choice:'move',destination,sourceRevision:'00000000-0000-0000-0000-000000000000',mappings:[],pendingCopy:{sourceItemId:item,destinationItemId:copied,payload:{requestId:'accepted-copy'}},request:null};
    const before=structuredClone(journal), writes=[];
    const sourceIndex={title:'Original',website:'https://fixture.invalid/'}, sourceBody={username:'user',password:'original',customFields:[{id:'secret',type:'password',value:'original'}]};
    const targetIndex={...sourceIndex,...(change==='title'?{title:'Peer title'}:{})}, targetBody={...sourceBody,...(change==='password'?{password:'peer password'}:{}),...(change==='customFields'?{customFields:[{id:'secret',type:'password',value:'peer secret'}]}:{})};
    const handle={free(){}}, core={open_private_vault:()=>handle,release_vault(){},decrypt_private_part:(_vault,_catalogue,_item,envelope)=>new Uint8Array(envelope)};
    const client=new VaultLifecycleClient({core,root:{},readJournal:async()=>structuredClone(journal),writeJournal:async value=>{writes.push(value)},send:async(path,options)=>{
      if(options)throw Error('UNEXPECTED_WRITE');
      if(path==='/api/v1/vaults')return{directory:catalogue,vaultEnvelopes:[{vaultId:source,envelope:catalogue},{vaultId:destination,envelope:catalogue}]};
      if(path===`/api/v1/vaults/${source}/items`)return{catalogue,indices:[{itemId:item,envelope:encoded(sourceIndex)}]};
      if(path===`/api/v1/vaults/${destination}/items`)return{catalogue,indices:[{itemId:copied,envelope:encoded(targetIndex)}]};
      if(path.startsWith(`/api/v1/vaults/${source}/items/${item}?`))return{envelope:encoded(sourceBody)};
      if(path.startsWith(`/api/v1/vaults/${destination}/items/${copied}?`))return{envelope:encoded(targetBody)};
      throw Error('Unexpected read');
    }});
    await assert.rejects(client.remove(source,'move',destination), /REMOVAL_DESTINATION_CHANGED/, change);
    assert.deepEqual(journal,before);
    assert.deepEqual(writes,[]);
  }
});

function completedCopy({missing=false,changed=false,reordered=false,extra=false,afterCopy=false,lateRevision=false,pending=false,finalRequest=false}={}) {
  const source='10000000-0000-4000-8000-000000000001',destination='20000000-0000-4000-8000-000000000001',item='30000000-0000-4000-8000-000000000001',copied='40000000-0000-4000-8000-000000000001';
  const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const cat=value=>{const bytes=Buffer.alloc(80);bytes[59]=value;return bytes.toString('base64url')};
  const sourceIndex={title:'Original',website:'https://fixture.invalid/'},sourceBody={username:'user',password:'secret',customFields:[]};
  let destinationBody=changed?{...sourceBody,password:'peer secret'}:reordered?{customFields:[],password:'secret',username:'user'}:sourceBody, targetRevision=1, visible=!missing;
  let journal={source,choice:'move',destination,sourceRevision:'00000000-0000-0000-0000-000000000000',mappings:pending?[]:[{sourceItemId:item,destinationItemId:copied}],pendingCopy:pending?{sourceItemId:item,destinationItemId:copied,payload:{requestId:'original-copy'}}:null,request:null};
  if(finalRequest)journal.request={requestId:'saved-final',choice:'move',sourceCatalogueRevision:journal.sourceRevision,destinationCatalogueRevision:'00000000-0000-0000-0000-000000000001',itemMappings:journal.mappings};
  const original=structuredClone(journal),requests=[],handle={free(){}};
  const core={open_private_vault:()=>handle,release_vault(){},decrypt_private_part:(_vault,_catalogue,_item,envelope)=>new Uint8Array(envelope),encrypt_account_settings:()=>new Uint8Array(100)};
  const client=new VaultLifecycleClient({core,root:{},readJournal:async()=>structuredClone(journal),writeJournal:async value=>{journal=structuredClone(value)},send:async(path,options)=>{
    if(options){requests.push({path,body:structuredClone(options.body)});if(path.endsWith('/items')){visible=true;if(afterCopy)destinationBody={...sourceBody,password:'peer secret'};}if(path.endsWith('/removal')&&lateRevision&&options.body.destinationCatalogueRevision!=='00000000-0000-0000-0000-000000000002')throw Error('BASE_CHANGED');return{accepted:true};}
    if(path==='/api/v1/vaults')return{directory:cat(0),vaultEnvelopes:[{vaultId:source,envelope:cat(0)},{vaultId:destination,envelope:cat(0)}]};
    if(path==='/api/v1/vault-settings'){if(lateRevision)targetRevision=2;return{revision:'settings',envelope:null};}
    if(path===`/api/v1/vaults/${source}/items`)return{catalogue:cat(0),indices:[{itemId:item,envelope:encoded(sourceIndex)}]};
    if(path===`/api/v1/vaults/${destination}/items`)return{catalogue:cat(targetRevision),indices:[...visible?[{itemId:copied,envelope:encoded(sourceIndex)}]:[],...extra?[{itemId:'50000000-0000-4000-8000-000000000001',envelope:encoded({title:'Unrelated'})}]:[]]};
    if(path.startsWith(`/api/v1/vaults/${source}/items/${item}?`))return{envelope:encoded(sourceBody)};
    if(path.startsWith(`/api/v1/vaults/${destination}/items/${copied}?`))return{envelope:encoded(destinationBody)};
    throw Error('Unexpected read '+path);
  }});
  return{source,destination,client,original,requests,journal:()=>journal};
}

test('mapped copies are revalidated and deleted or edited copies keep the exact plan',async()=>{
  for(const options of [{missing:true},{changed:true}]) {
    const f=completedCopy(options);
    await assert.rejects(f.client.remove(f.source,'move',f.destination),/REMOVAL_DESTINATION_CHANGED/);
    assert.deepEqual(f.journal(),f.original);
    assert.deepEqual(f.requests,[]);
  }
});

test('semantic JSON equality and unrelated destination additions do not block valid finalization',async()=>{
  const f=completedCopy({reordered:true,extra:true});
  assert.deepEqual(await f.client.remove(f.source,'move',f.destination),{accepted:true});
  assert.equal(f.journal(),null);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/items')).length,0);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/removal')).length,1);
});

test('a copy changed after its receipt is checked again before a final request is created',async()=>{
  const f=completedCopy({pending:true,afterCopy:true});
  await assert.rejects(f.client.remove(f.source,'move',f.destination),/REMOVAL_DESTINATION_CHANGED/);
  assert.equal(f.journal().request,null);
  assert.equal(f.journal().mappings.length,1);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/removal')).length,0);
});

test('a destination write after comparison cannot be silently adopted into finalization',async()=>{
  const f=completedCopy({lateRevision:true});
  await assert.rejects(f.client.remove(f.source,'move',f.destination),/BASE_CHANGED/);
  assert.equal(f.journal().request.destinationCatalogueRevision,'00000000-0000-0000-0000-000000000001');
  assert.equal(f.requests.filter(row=>row.path.endsWith('/removal')).length,1);
});

test('legacy final requests are checked while source is active and valid requests replay exactly',async()=>{
  const changed=completedCopy({finalRequest:true,changed:true});
  await assert.rejects(changed.client.remove(changed.source,'move',changed.destination),/REMOVAL_DESTINATION_CHANGED/);
  assert.deepEqual(changed.requests,[]);
  assert.deepEqual(changed.journal(),changed.original);
  const valid=completedCopy({finalRequest:true,reordered:true});
  assert.deepEqual(await valid.client.remove(valid.source,'move',valid.destination),{accepted:true});
  assert.deepEqual(valid.requests.find(row=>row.path.endsWith('/removal')).body,valid.original.request);
  assert.equal(valid.journal(),null);
});

test('copy validation decrypts real Rust envelopes and leaves caller handles usable',async()=>{
  const wasm=await import('../wasm/vaults_browser_fixture.js');
  await wasm.default({module_or_path:await readFile(new URL('../wasm/vaults_browser_fixture_bg.wasm',import.meta.url))});
  const core=new wasm.ExperimentalEcf1Core(),encoder=new TextEncoder(),template=new Uint8Array(77);
  template[0]=1;template.set(new Uint8Array(16).fill(1),1);template.set(new Uint8Array(16).fill(2),17);template[7]=template[23]=0x40;template[9]=template[25]=0x80;template.set([0,0,0,1],65);template[76]=1;
  const root=core.create_root(template,encoder.encode('disposable-move-master-password'),new Uint8Array(32).fill(3));
  const sourceCreated=core.create_private_vault(root,core.create_empty_directory(root)),sourceVault=sourceCreated.vault();
  const destinationCreated=core.create_private_vault(root,sourceCreated.directory()),destinationVault=destinationCreated.vault();
  const uuid=bytes=>{const h=Buffer.from(bytes).toString('hex');return[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')},b64=bytes=>Buffer.from(bytes).toString('base64url');
  const source=uuid(sourceVault.context().slice(33,49)),destination=uuid(destinationVault.context().slice(33,49));
  const index=encoder.encode(JSON.stringify({title:'Synthetic',website:'https://fixture.invalid/'})),body={username:'sample',password:'synthetic',customFields:[{id:'custom',type:'password',value:'original'}]};
  const original=core.upsert_private_item(sourceVault,sourceCreated.catalogue(),undefined,index,encoder.encode(JSON.stringify(body)));
  const copied=core.upsert_private_item(destinationVault,destinationCreated.catalogue(),undefined,index,encoder.encode(JSON.stringify(body)));
  let current=copied;
  const data={directory:b64(destinationCreated.directory()),vaultEnvelopes:[{vaultId:source,envelope:b64(sourceVault.envelope())},{vaultId:destination,envelope:b64(destinationVault.envelope())}]};
  const sourceItem=uuid(original.item()),destinationItemId=uuid(copied.item());
  const listed={catalogue:b64(original.catalogue()),indices:[{itemId:sourceItem,envelope:b64(original.index())}]};
  const target=()=>({catalogue:b64(current.catalogue()),indices:[{itemId:destinationItemId,envelope:b64(current.index())}]});
  const client=new VaultLifecycleClient({core,root,send:async path=>({envelope:b64(path.includes(source)?original.body():current.body())})});
  const options={data,source,destination,listed,sourceRevision:uuid(original.catalogue().slice(44,60)),mappings:[{sourceItemId:sourceItem,destinationItemId}]};
  try {
    await client.verifyDestinationCopies({...options,target:target()});
    current=core.upsert_private_item(destinationVault,copied.catalogue(),copied.item(),index,encoder.encode(JSON.stringify({...body,customFields:[{id:'custom',type:'password',value:'peer secret'}]})));
    await assert.rejects(client.verifyDestinationCopies({...options,target:target()}),/REMOVAL_DESTINATION_CHANGED/);
    assert.equal(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(destinationVault,current.catalogue(),current.item(),current.body(),3))).customFields[0].value,'peer secret');
  } finally {core.lock();core.free();}
});
