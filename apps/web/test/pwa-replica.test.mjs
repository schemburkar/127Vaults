import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PwaReplica, collapseQueue, networkUnavailable, replicaRead, recordRevision } from '../src/pwa-replica.mjs';

class MemoryStore {
  values = new Map(); fail = false;
  async read(key) { return structuredClone(this.values.get(key)); }
  async write(key, value, expectedRevision) { if (this.fail) throw Error('LOCAL_STORAGE_FAILED'); if(expectedRevision!==undefined&&(this.values.get(key)?.storageRevision||0)!==expectedRevision)throw Error('LOCAL_QUEUE_CHANGED'); this.values.set(key, structuredClone(value)); }
}
const b64 = value => Buffer.from(value).toString('base64url');
const uuid = value => { const h = Buffer.from(value).toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
let wasm;
async function fixture() {
  if (!wasm) {
    wasm = await import('../wasm/vaults_browser_fixture.js');
    await wasm.default({ module_or_path: await readFile(new URL('../wasm/vaults_browser_fixture_bg.wasm', import.meta.url)) });
  }
  const core = new wasm.ExperimentalEcf1Core(), encoder = new TextEncoder();
  const template = new Uint8Array(77); template[0] = 1;
  template.set(new Uint8Array(16).fill(1),1); template.set(new Uint8Array(16).fill(2),17);
  template[7] = template[23] = 0x40; template[9] = template[25] = 0x80;
  template.set([0,0,0,1],65); template[76] = 1;
  const password = encoder.encode('disposable-pwa-master-password'), secret = new Uint8Array(32).fill(3);
  const root = core.create_root(template,password,secret);
  const created = core.create_private_vault(root,core.create_empty_directory(root)), vault = created.vault();
  const vaultId = uuid(vault.context().slice(33,49)), listPath = `/api/v1/vaults/${vaultId}/items`;
  const records = {
    '/api/v1/vaults': { directory: b64(created.directory()), vaultEnvelopes: [{ vaultId, envelope: b64(vault.envelope()), retired: false }] },
    '/api/v1/vault-settings': { revision: null, envelope: null },
    [listPath]: { catalogue: b64(created.catalogue()), indices: [] },
    [`/api/v1/vaults/${vaultId}/operations`]: { cursor: 0, operations: [] },
  };
  const store = new MemoryStore(), replica = await new PwaReplica({ scope: 'synthetic-device', store }).load();
  await replica.snapshot(records);
  await replica.saveUnlock({ descriptor: b64(root.context()), envelope: b64(root.envelope()), authContext: { tenantId: 'synthetic', epoch: 1 } });
  function mutation(catalogue = replica.read(listPath).catalogue, itemId, title = 'Synthetic offline item') {
    const made = core.upsert_private_item(vault, Buffer.from(catalogue,'base64url'), itemId ? Buffer.from(itemId.replaceAll('-',''),'hex') : undefined, encoder.encode(JSON.stringify({ title })), encoder.encode(JSON.stringify({ username: 'sample', password: 'synthetic-secret-value', customFields: [] })));
    const id = uuid(made.item());
    return { itemId: id, path: `${listPath}${itemId ? `/${itemId}` : ''}`, method: itemId ? 'PUT' : 'POST', body: {
      requestId: crypto.randomUUID(), baseCatalogueRevision: recordRevision(catalogue,44), catalogue: b64(made.catalogue()), index: b64(made.index()), body: b64(made.body()), ...(itemId ? {} : { itemId: id }),
      signedOperation: { opId: crypto.randomUUID(), vaultId, itemId: id, deviceId: 'synthetic-device' },
    } };
  }
  return { core,root,vault,created,replica,store,records,vaultId,listPath,password,secret,mutation };
}

test('offline queue survives restart, updates encrypted catalogue/body, and contains no plaintext', async () => {
  const f = await fixture(), change = f.mutation();
  assert.deepEqual(await f.replica.enqueue(change.path,change.method,change.body),{ queued: true });
  const reopened = await new PwaReplica({ scope: 'synthetic-device', store: f.store }).load();
  assert.equal(reopened.pending,1);
  const listed = reopened.read(f.listPath), body = reopened.read(`${f.listPath}/${change.itemId}?catalogueRevision=unused`);
  const decoded = new TextDecoder().decode(f.core.decrypt_private_part(f.vault,Buffer.from(listed.catalogue,'base64url'),Buffer.from(change.itemId.replaceAll('-',''),'hex'),Buffer.from(body.envelope,'base64url'),3));
  assert.equal(JSON.parse(decoded).password,'synthetic-secret-value');
  const disk = JSON.stringify([...f.store.values.values()]);
  for (const plain of ['synthetic-secret-value','Synthetic offline item','disposable-pwa-master-password']) assert.ok(!disk.includes(plain));
  f.core.lock(); f.core.free();
});

test('offline deletion survives restart, removes its encrypted parts, preserves siblings and retries exactly', async () => {
  const f=await fixture(),first=f.mutation();
  await f.replica.enqueue(first.path,first.method,first.body);
  const sibling=f.mutation(undefined,undefined,'Sibling');await f.replica.enqueue(sibling.path,sibling.method,sibling.body);
  const before=structuredClone(f.replica.state.queue),catalogue=f.replica.read(f.listPath).catalogue;
  const deleted=f.core.delete_private_item(f.vault,Buffer.from(catalogue,'base64url'),Buffer.from(first.itemId.replaceAll('-',''),'hex'));
  const body={requestId:crypto.randomUUID(),baseCatalogueRevision:recordRevision(catalogue,44),catalogue:b64(deleted),signedOperation:{kind:'item.delete',opId:crypto.randomUUID(),vaultId:f.vaultId,itemId:first.itemId,deviceId:'synthetic-device'}};
  await f.replica.enqueue(`${f.listPath}/${first.itemId}`,'DELETE',body);
  const reopened=await new PwaReplica({scope:'synthetic-device',store:f.store}).load();
  assert.deepEqual(reopened.state.queue.slice(0,2),before);
  assert.deepEqual(reopened.read(f.listPath).indices.map(row=>row.itemId),[sibling.itemId]);
  assert.throws(()=>reopened.read(`${f.listPath}/${first.itemId}`),/OFFLINE_DATA_UNAVAILABLE/);
  const ids=f.core.verify_private_catalogue(f.vault,deleted);assert.equal(ids.length,16);
  const requests=[];const send=async(path,options)=>{requests.push({path,...structuredClone(options)});if(options.method==='DELETE')throw Error('SERVER_TIMEOUT');return{}};
  await assert.rejects(reopened.flush(send),/SERVER_TIMEOUT/);
  const remaining=structuredClone(reopened.state.queue);assert.equal(remaining.length,1);
  await assert.rejects(reopened.flush(send),/SERVER_TIMEOUT/);
  assert.deepEqual(requests.at(-1),requests.at(-2));assert.deepEqual(reopened.state.queue,remaining);
  const collapsed=collapseQueue([...before,{...remaining[0]}]);
  const target=collapsed.find(entry=>entry.body.signedOperation.itemId===first.itemId);
  assert.equal(target.method,'DELETE');assert.equal(target.path,`${f.listPath}/${first.itemId}`);
  assert.equal(target.baseline.index,null);assert.equal(target.body.index,undefined);
  f.core.lock();f.core.free();
});

test('queued deletion rebases unchanged items and preserves peer edits until an explicit choice', async () => {
 const source=await readFile(new URL('../mvp-client.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function rebasePendingChanges('),source.indexOf('async function syncInstalled('));
 for(const choice of ['unchanged','background','cancel','server','mine']){
  const f=await fixture(),first=f.mutation();await f.replica.enqueue(first.path,first.method,first.body);await f.replica.flush(async()=>({}));
  const remote=structuredClone(f.replica.state.records),catalogue=remote[f.listPath].catalogue;
  const deleted=f.core.delete_private_item(f.vault,Buffer.from(catalogue,'base64url'),Buffer.from(first.itemId.replaceAll('-',''),'hex'));
  await f.replica.enqueue(`${f.listPath}/${first.itemId}`,'DELETE',{requestId:crypto.randomUUID(),baseCatalogueRevision:recordRevision(catalogue,44),catalogue:b64(deleted),signedOperation:{kind:'item.delete',opId:crypto.randomUUID(),vaultId:f.vaultId,itemId:first.itemId,deviceId:'synthetic-device'}});
  if(choice!=='unchanged'){const peer=f.mutation(catalogue,first.itemId,'Peer updated title');f.replica.project(remote,{...peer});}
  const before=structuredClone(f.replica.state);
  const context=vm.createContext({replica:f.replica,root:f.root,core:f.core,sessionGeneration:1,
   structuredClone,collapseQueue,downloadReplica:async()=>structuredClone(remote),recordRevision,b64,uuid,
   id:value=>Buffer.from(value.replaceAll('-',''),'hex'),un:value=>Buffer.from(value,'base64url'),crypto,
   te:new TextEncoder(),td:new TextDecoder(),stable:JSON.stringify,
   chooseSyncVersion:async()=>choice,signedMutation:async(kind,itemId,_catalogue,_index,_body,{targetVault})=>({kind,itemId,vaultId:targetVault,opId:crypto.randomUUID()}),
  });
  vm.runInContext(code+'\nglobalThis.runRebase=rebasePendingChanges;',context);
  if(['background','cancel'].includes(choice)){
   await assert.rejects(context.runRebase(choice!=='background'),/SYNC_REVIEW_PENDING/);assert.deepEqual(f.replica.state,before);
  }else{
   await context.runRebase(true);
   assert.equal(f.replica.pending,choice==='server'?0:1);
   assert.equal(f.replica.read(f.listPath).indices.length,choice==='server'?1:0);
   if(choice!=='server'){assert.equal(f.replica.state.queue[0].method,'DELETE');assert.equal(f.replica.state.queue[0].body.index,undefined);}
  }
  f.core.lock();f.core.free();
 }
});

test('offline unlock validates the real wrapped root and rejects a wrong password', async () => {
  const f = await fixture(), record = f.replica.state.unlock;
  f.core.lock();
  assert.throws(() => f.core.unwrap_root(Buffer.from(record.envelope,'base64url'),Buffer.from(record.descriptor,'base64url'),new TextEncoder().encode('incorrect-password'),f.secret));
  const root = f.core.unwrap_root(Buffer.from(record.envelope,'base64url'),Buffer.from(record.descriptor,'base64url'),f.password,f.secret);
  assert.ok(root); f.core.lock(); f.core.free();
});

test('storage failure never acknowledges an offline save or advances the replica', async () => {
  const f = await fixture(), change = f.mutation(), before = structuredClone(f.replica.state);
  f.store.fail = true;
  await assert.rejects(f.replica.enqueue(change.path,change.method,change.body),/LOCAL_STORAGE_FAILED/);
  assert.deepEqual(f.replica.state,before); f.core.lock(); f.core.free();
});

test('lost responses replay exactly the same request and signature in order', async () => {
  const f = await fixture(), first = f.mutation();
  await f.replica.enqueue(first.path,first.method,first.body);
  const second = f.mutation(undefined,first.itemId,'Updated offline');
  await f.replica.enqueue(second.path,second.method,second.body);
  const requests = [];
  await assert.rejects(f.replica.flush(async (path, options) => { requests.push({path,...options}); throw Error('SERVER_UNREACHABLE'); }),/SERVER_UNREACHABLE/);
  assert.equal(f.replica.pending,2);
  await f.replica.flush(async (path, options) => requests.push({path,...options}));
  assert.deepEqual(requests[0],requests[1]); assert.equal(requests[2].body.requestId,second.body.requestId);
  assert.equal(f.replica.pending,0); assert.equal(f.replica.local,false); f.core.lock(); f.core.free();
});

test('conflicts and auth rejection preserve all queued writes', async () => {
  const f = await fixture(), change = f.mutation();
  await f.replica.enqueue(change.path,change.method,change.body);
  for (const message of ['BASE_CHANGED','authentication_required','forbidden']) {
    await assert.rejects(f.replica.flush(async () => { throw Error(message); }),error => error.message === message && error.pendingEntry.body.requestId === change.body.requestId);
    assert.equal(f.replica.pending,1);
  }
  await assert.rejects(f.replica.snapshot(f.records),/PENDING_LOCAL_CHANGES/);
  f.core.lock(); f.core.free();
});

test('rebase consolidates edits while preserving original create and baseline', async () => {
  const f = await fixture(), first = f.mutation();
  await f.replica.enqueue(first.path,first.method,first.body);
  const second = f.mutation(undefined,first.itemId,'Latest intent');
  await f.replica.enqueue(second.path,second.method,second.body);
  const collapsed = collapseQueue(f.replica.state.queue);
  assert.equal(collapsed.length,1); assert.equal(collapsed[0].method,'POST');
  assert.equal(collapsed[0].body.itemId,first.itemId); assert.equal(collapsed[0].body.body,second.body.body);
  assert.equal(collapsed[0].baseline.index,null); assert.equal(f.replica.pending,2);
  f.core.lock(); f.core.free();
});

test('stale catalogue saves and stale rebase plans cannot overwrite newer local changes', async () => {
  const f = await fixture(), change = f.mutation();
  const expected = structuredClone(f.replica.state.queue);
  await f.replica.enqueue(change.path,change.method,change.body);
  await assert.rejects(f.replica.enqueue(change.path,change.method,change.body),/BASE_CHANGED/);
  await assert.rejects(f.replica.replaceQueue(f.records,[],expected),/LOCAL_QUEUE_CHANGED/);
  assert.equal(f.replica.pending,1); f.core.lock(); f.core.free();
});

test('scopes isolate device replicas and reread committed local state', async () => {
  const f = await fixture(), second = await new PwaReplica({ scope: 'synthetic-device', store: f.store }).load();
  const other = await new PwaReplica({ scope: 'different-device', store: f.store }).load();
  await f.replica.enqueue('/api/v1/vault-settings','PUT',{baseRevision:null,revision:'one',envelope:'encrypted-settings'});
  await second.enqueue('/api/v1/vault-settings','PUT',{baseRevision:'one',revision:'two',envelope:'next-encrypted-settings'});
  assert.equal(second.pending,2); assert.equal(other.pending,0);
  assert.throws(() => other.read('/api/v1/vaults'),/OFFLINE_DATA_UNAVAILABLE/);
  f.core.lock(); f.core.free();
});

test('offline vault creation and concurrent directory rebase preserve the wrapped key and item ciphertext', async () => {
  const f = await fixture(), offline = f.core.create_private_vault(f.root,f.created.directory());
  const newVault = offline.vault(), newId = uuid(newVault.context().slice(33,49));
  const change = { requestId: crypto.randomUUID(), baseDirectoryRevision: recordRevision(b64(f.created.directory()),36), directory:b64(offline.directory()),vaultEnvelope:b64(newVault.envelope()),catalogue:b64(offline.catalogue()) };
  await f.replica.enqueue('/api/v1/vaults','POST',change);
  assert.ok(f.replica.read('/api/v1/vaults').vaultEnvelopes.some(row => row.vaultId === newId));
  assert.equal(f.replica.read(`/api/v1/vaults/${newId}/items`).indices.length,0);
  const concurrent = f.core.create_private_vault(f.root,f.created.directory());
  const merged = f.core.rebase_private_vault(f.root,concurrent.directory(),newVault.envelope());
  const reopened = f.core.open_private_vault(f.root,merged,newVault.context().slice(33,49),newVault.envelope());
  assert.ok(reopened); assert.throws(() => f.core.rebase_private_vault(f.root,merged,newVault.envelope()));
  const tampered = newVault.envelope(); tampered[tampered.length-1] ^= 1;
  assert.throws(() => f.core.rebase_private_vault(f.root,concurrent.directory(),tampered));
  f.core.lock(); f.core.free();
});

test('releasing temporary WASM handles permits repeated sync and invalidates released handles', async () => {
  const f = await fixture();
  for (let i=0;i<70;i++) {
    const temporary = f.core.open_private_vault(f.root,f.created.directory(),f.vault.context().slice(33,49),f.vault.envelope());
    f.core.release_vault(temporary);
    assert.throws(() => f.core.upsert_private_item(temporary,f.created.catalogue(),undefined,new Uint8Array([1]),new Uint8Array([1])));
    temporary.free();
  }
  f.core.lock(); f.core.free();
});

test('offline reads exclude auth, devices, admin, setup and license endpoints', () => {
  for (const path of ['/api/v1/auth/','/api/v1/session','/api/v1/devices','/api/v1/setup','/api/v1/license','/admin/']) assert.equal(replicaRead(path),false,path);
  assert.equal(networkUnavailable(Error('authentication_failed')),false);
  assert.equal(networkUnavailable(Error('SERVER_UNREACHABLE')),true);
});
test('a server rollback or missing accepted operation cannot replace the last verified snapshot',async()=>{
  const f=await fixture(),path=`/api/v1/vaults/${f.vaultId}/operations`;
  const first=structuredClone(f.records);first[path]={cursor:2,operations:[{operation:{opId:'accepted',signature:'signature'}}]};await f.replica.snapshot(first);
  const older=structuredClone(first);older[path].cursor=1;await assert.rejects(f.replica.snapshot(older),/SYNC_ROLLBACK/);
  const fork=structuredClone(first);fork[path].operations=[];await assert.rejects(f.replica.snapshot(fork),/SYNC_FORK/);
  assert.equal(f.replica.state.records[path].operations[0].operation.opId,'accepted');f.core.lock();f.core.free();
});
test('rebasing cannot lose an accepted operation or replace a known signing key',async()=>{
  const f=await fixture(),path=`/api/v1/vaults/${f.vaultId}/operations`;
  const accepted=f.mutation();await f.replica.enqueue(accepted.path,accepted.method,accepted.body);await f.replica.flush(async()=>({}));
  const pending=f.mutation(undefined,accepted.itemId);await f.replica.enqueue(pending.path,pending.method,pending.body);
  const remote=structuredClone(f.records);await assert.rejects(f.replica.replaceQueue(remote,[],f.replica.state.queue),/SYNC_ROLLBACK/);
  assert.equal(f.replica.pending,1);
  remote[path]={cursor:1,operations:[{operation:accepted.body.signedOperation}],devicePublicKeys:{device:'new-key'}};
  f.replica.state.records[path].devicePublicKeys={device:'pinned-key'};
  assert.throws(()=>f.replica.validateRemote(remote),/SYNC_DEVICE_KEY_CHANGED/);
  f.core.lock();f.core.free();
});
test('storage compare-and-swap rejects overlapping writers even without navigator locks',async()=>{
  const f=await fixture(),other=await new PwaReplica({scope:'synthetic-device',store:f.store}).load();
  const first=structuredClone(f.replica.state),second=structuredClone(other.state);
  first.unlock={descriptor:'first'};second.unlock={descriptor:'second'};
  await f.replica.commit(first);await assert.rejects(other.commit(second),/LOCAL_QUEUE_CHANGED/);
  assert.equal((await f.store.read('synthetic-device')).unlock.descriptor,'first');f.core.lock();f.core.free();
});
test('persisted queues cannot redirect writes into auth, admin or unrelated API routes',async()=>{
  const f=await fixture(),mutation=f.mutation();await f.replica.enqueue(mutation.path,mutation.method,mutation.body);
  const saved=await f.store.read('synthetic-device');saved.queue[0].path='/admin/delete';await f.store.write('synthetic-device',saved);
  await assert.rejects(new PwaReplica({scope:'synthetic-device',store:f.store}).load(),/LOCAL_REPLICA_INVALID/);
  await assert.rejects(f.replica.flush(()=>assert.fail('sent redirected request')),/LOCAL_REPLICA_INVALID/);
  assert.equal(f.replica.pending,1);f.core.lock();f.core.free();
});
test('signature validation failures stop replay without acknowledging or deleting local edits',async()=>{
  const f=await fixture(),mutation=f.mutation();await f.replica.enqueue(mutation.path,mutation.method,mutation.body);
  f.replica.validateEntry=async()=>{throw Error('INVALID_SYNC_HISTORY')};
  await assert.rejects(f.replica.flush(()=>assert.fail('sent unverified request')),/INVALID_SYNC_HISTORY/);
  assert.equal(f.replica.pending,1);f.core.lock();f.core.free();
});
test('catalogue verification authenticates empty vaults and returns the complete committed item set',async()=>{
  const f=await fixture();assert.deepEqual([...f.core.verify_private_catalogue(f.vault,f.created.catalogue())],[]);
  const changed=f.mutation(),catalogue=Buffer.from(changed.body.catalogue,'base64url');
  assert.equal(uuid(f.core.verify_private_catalogue(f.vault,catalogue)),changed.itemId);
  const corrupted=f.created.catalogue();corrupted[corrupted.length-1]^=1;assert.throws(()=>f.core.verify_private_catalogue(f.vault,corrupted));
  const other=f.core.create_private_vault(f.root,f.created.directory()),handle=other.vault();
  assert.throws(()=>f.core.verify_private_catalogue(handle,catalogue));f.core.lock();f.core.free();
});
