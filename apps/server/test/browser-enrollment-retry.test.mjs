import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';

test('completed browser enrollment is idempotent after a lost reply without reactivating revoked devices',async()=>{
  const keys=generateKeyPairSync('ed25519'),raw=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const id='10000000-0000-4000-8000-000000000001',device='20000000-0000-4000-8000-000000000001',account='30000000-0000-4000-8000-000000000001';
  const enrollment={id,tenant_id:id,account_id:account,proposed_device_id:device,proposed_signing_public_key:raw,approved_at:new Date(0),consumed_at:new Date(1),expires_at:new Date(2)};
  const binding={accountId:account,enrollmentId:id,newDeviceId:device,newDevicePublicKey:raw.toString('base64url'),expiresAt:enrollment.expires_at.toISOString()};
  const body={...binding,purpose:'device-possession'},signature=sign(null,Buffer.from(JSON.stringify(body,Object.keys(body).sort())),keys.privateKey).toString('base64url');
  let status='active';const queries=[];
  const client={async query(sql){queries.push(sql);if(sql.includes('FROM vaults.device_enrollment_requests'))return{rows:[enrollment]};if(sql.includes('FROM vaults.devices'))return{rows:[{lifecycle_status:status,signing_public_key:raw,credential_epoch_seen:1}]};return{rows:[]}},release(){}};
  const store=new PgDeviceLifecycleStore({connect:async()=>client},{now:()=>new Date(600000)});
  assert.deepEqual(await store.completeEnrollmentRequest({enrollmentId:id,pollToken:'p'.repeat(43),possessionSignature:signature}),{version:1,deviceId:device,credentialEpoch:1});
  assert.ok(!queries.some(sql=>sql.startsWith('INSERT')));
  status='revoked';await assert.rejects(store.completeEnrollmentRequest({enrollmentId:id,pollToken:'p'.repeat(43),possessionSignature:signature}),/ENROLLMENT_INVALID/);
  status='active';await assert.rejects(store.completeEnrollmentRequest({enrollmentId:id,pollToken:'p'.repeat(43),possessionSignature:Buffer.alloc(64).toString('base64url')}),/ENROLLMENT_INVALID/);
});
