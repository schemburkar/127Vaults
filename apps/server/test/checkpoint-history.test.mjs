import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PgSignedSyncStore } from '../src/sync-pg.mjs';
import { createSignedSyncHandler } from '../src/sync-handler.mjs';

const vaultId='10000000-0000-4000-8000-000000000001',auth={tenantId:'tenant',accountId:'account',deviceId:'device',credentialEpoch:1};
const server=generateKeyPairSync('ed25519');
const row=sequence=>({checkpoint_sequence:sequence,protocol_version:1,tenant_id:auth.tenantId,vault_id:vaultId,epoch:1,cursor:sequence,previous_checkpoint_hash:Buffer.alloc(32),operation_head_hash:Buffer.alloc(32),server_signature:Buffer.alloc(64)});
test('checkpoint pagination is authorized, anchored by hash, ordered and bounded',async()=>{
  const calls=[],pool={async query(sql,args){calls.push({sql,args});if(sql.includes('sync_vault_state'))return{rows:[{epoch:1,state:'healthy',credential_epoch:1}]};if(sql.startsWith('SELECT checkpoint_sequence'))return{rows:[{checkpoint_sequence:5}]};return{rows:[row(6),row(7)]}}};
  const store=new PgSignedSyncStore(pool,server.privateKey),page=await store.checkpointHistory(auth,vaultId,{after:'a'.repeat(64),limit:1});
  assert.equal(page.hasMore,true);assert.equal(page.checkpoints.length,1);assert.equal(page.checkpoints[0].cursor,6);
  assert.match(calls[0].sql,/lifecycle_status='active'/);assert.match(calls[2].sql,/ORDER BY checkpoint_sequence LIMIT/);assert.deepEqual(calls[2].args,[auth.tenantId,vaultId,5,2]);
});
test('invalid anchors, limits and missing history cannot silently restart a checkpoint chain',async()=>{
  const pool={async query(sql){return{rows:sql.includes('sync_vault_state')?[{state:'healthy',credential_epoch:1}]:[]}}},store=new PgSignedSyncStore(pool,server.privateKey);
  await assert.rejects(store.checkpointHistory(auth,vaultId,{after:'not-a-hash'}),{code:'invalid_request'});
  await assert.rejects(store.checkpointHistory(auth,vaultId,{limit:501}),{code:'invalid_limit'});
  await assert.rejects(store.checkpointHistory(auth,vaultId,{after:'a'.repeat(64)}),{code:'checkpoint_fork'});
});
test('checkpoint history HTTP route forwards the authenticated anchor and keeps legacy GET behavior',async()=>{
  const seen=[],store={async checkpointHistory(user,id,options){seen.push({user,id,options});return{checkpoints:[],hasMore:false}},async latestCheckpoint(){return null}};
  const invoke=async suffix=>{
    const request=new EventEmitter();request.url=`/api/v1/vaults/${vaultId}/checkpoint${suffix}`;request.method='GET';request.headers={cookie:`__Host-127v-session=${'x'.repeat(43)}`};
    const response={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};
    await createSignedSyncHandler(store,async()=>auth,'https://vault.example',{checkpointPublicKey:'pinned-key'})(request,response);return response;
  };
  const result=await invoke(`?history=1&after=${'a'.repeat(64)}&limit=20`);assert.equal(result.status,200);assert.equal(result.body.checkpointPublicKey,'pinned-key');
  assert.deepEqual(seen,[{user:auth,id:vaultId,options:{after:'a'.repeat(64),limit:20}}]);
  assert.deepEqual((await invoke('')).body,{checkpoint:null,checkpointPublicKey:'pinned-key'});
  assert.equal((await invoke('?history=2')).status,400);assert.equal((await invoke('?history=1&surprise=1')).status,400);
});
