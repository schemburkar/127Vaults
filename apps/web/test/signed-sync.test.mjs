import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createSignedOperation, createSignedCheckpoint, checkpointHash, nextOperationHead } from '../../../packages/sync/src/index.mjs';
import { verifySyncHistory, verifyLatestPayload, verifyCheckpoints, verifyQueuedOperation } from '../src/signed-sync.mjs';

const tenantId = randomUUID(), vaultId = randomUUID(), deviceId = randomUUID();
const key = generateKeyPairSync('ed25519');
const raw = key.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
const signed = fields => createSignedOperation({tenantId,vaultId,deviceId,epoch:1,causalBase:0,previousDeviceOpId:null,kind:'item.create',itemId:randomUUID(),payloadHash:'a'.repeat(64),...fields},key.privateKey);
const history = operations => ({cursor:operations.length,hasMore:false,devicePublicKeys:{[deviceId]:raw},operations:operations.map((operation,index)=>({cursor:index+1,operation}))});
const verify = value => verifySyncHistory(value,{tenantId,vaultId});

test('verified history accepts chained operations and pins remembered device keys',async()=>{
  const first=signed(),second=signed({kind:'item.update',itemId:first.itemId,causalBase:1,previousDeviceOpId:first.opId});
  const records=history([first,second]);assert.equal(await verify(records),records);
  await assert.rejects(verifySyncHistory(records,{tenantId,vaultId,knownKeys:{[deviceId]:'different'}}),/SYNC_DEVICE_KEY_CHANGED/);
});
test('signatures, stable operation IDs, scope, cursors, causal bases and device chains are checked',async()=>{
  const first=signed(),second=signed({causalBase:1,previousDeviceOpId:first.opId});
  for(const change of [v=>v.operations[0].operation.signature='AA',v=>v.operations[0].operation.payloadHash='b'.repeat(64),v=>v.operations[0].operation.tenantId=randomUUID(),v=>v.operations[0].cursor=2,v=>v.cursor=3,v=>v.hasMore=true,v=>v.operations[1].operation=signed({causalBase:1,previousDeviceOpId:null}),v=>v.operations[0].operation=signed({causalBase:1})]) {
    const records=history([first,second]);change(records);await assert.rejects(verify(records),/INVALID_SYNC_HISTORY/);
  }
});
test('the stored nonextractable private key authenticates an offline-created vault without a public-key export',async()=>{
  const privateKey=await crypto.subtle.importKey('pkcs8',key.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
  const records=history([signed()]);records.devicePublicKeys={};
  await verifySyncHistory(records,{tenantId,vaultId,ownDeviceId:deviceId,ownPrivateKey:privateKey});
  await assert.rejects(verify(records),/SYNC_DEVICE_KEY_CHANGED/);
  const wrong=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
  await assert.rejects(verifySyncHistory(records,{tenantId,vaultId,ownDeviceId:deviceId,ownPrivateKey:wrong.privateKey}),/INVALID_SYNC_HISTORY/);
});
test('a replacement public key cannot impersonate this registered device',async()=>{
  const other=generateKeyPairSync('ed25519'),operation=createSignedOperation({...signed(),previousDeviceOpId:null},other.privateKey);
  const records=history([operation]);records.devicePublicKeys[deviceId]=other.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
  const privateKey=await crypto.subtle.importKey('pkcs8',key.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
  await assert.rejects(verifySyncHistory(records,{tenantId,vaultId,ownDeviceId:deviceId,ownPrivateKey:privateKey}),/SYNC_DEVICE_KEY_CHANGED/);
});
test('the newest signed payload binds the downloaded catalogue, index and body',async()=>{
  const parts=[Buffer.from('catalogue'),Buffer.from('index'),Buffer.from('encrypted-body')];
  const framed=Buffer.concat(parts.flatMap(part=>{const length=Buffer.alloc(4);length.writeUInt32BE(part.length);return[length,part]}));
  const records=history([signed({payloadHash:createHash('sha256').update(framed).digest('hex')})]);
  await verifyLatestPayload(records,...parts.map(part=>part.toString('base64url')));
  const operation=records.operations[0].operation,privateKey=await crypto.subtle.importKey('pkcs8',key.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
  const entry={path:`/api/v1/vaults/${vaultId}/items`,method:'POST',body:{itemId:operation.itemId,signedOperation:operation,catalogue:parts[0].toString('base64url'),index:parts[1].toString('base64url'),body:parts[2].toString('base64url')}};
  const options={tenantId,deviceId,privateKey};await verifyQueuedOperation(entry,options);
  await assert.rejects(verifyQueuedOperation({...entry,path:'/admin/'},options),/INVALID_SYNC_HISTORY/);
  await assert.rejects(verifyQueuedOperation({...entry,body:{...entry.body,body:Buffer.from('modified').toString('base64url')}},options),/SYNC_PAYLOAD_MISMATCH/);
  await assert.rejects(verifyLatestPayload(records,parts[0].toString('base64url'),parts[1].toString('base64url'),Buffer.from('different').toString('base64url')),/SYNC_PAYLOAD_MISMATCH/);
});
test('checkpoint verification handles multiple missed checkpoints and authenticates their operation heads',async()=>{
  const operation=signed(),records=history([operation]);
  const first=createSignedCheckpoint({tenantId,vaultId,epoch:1,cursor:0,previousCheckpointHash:'0'.repeat(64),operationHeadHash:'0'.repeat(64)},key.privateKey);
  const second=createSignedCheckpoint({tenantId,vaultId,epoch:1,cursor:1,previousCheckpointHash:checkpointHash(first),operationHeadHash:nextOperationHead('0'.repeat(64),operation)},key.privateKey);
  const options={tenantId,vaultId,publicKey:raw};
  assert.deepEqual(await verifyCheckpoints([first,second],records,options),second);
  assert.deepEqual(await verifyCheckpoints([second],records,{...options,previous:first}),second);
  await assert.rejects(verifyCheckpoints([second],records,options),/INVALID_SYNC_CHECKPOINT/);
  await assert.rejects(verifyCheckpoints([first,second],records,{...options,pinnedKey:'changed'}),/SYNC_CHECKPOINT_KEY_CHANGED/);
  const bad=createSignedCheckpoint({...second,operationHeadHash:'b'.repeat(64)},key.privateKey);
  await assert.rejects(verifyCheckpoints([first,bad],records,options),/INVALID_SYNC_CHECKPOINT/);
  const altered={...second,signature:'AA'};
  await assert.rejects(verifyCheckpoints([first,altered],records,options),/INVALID_SYNC_CHECKPOINT/);
});
