import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBrowserEnrollment, finishBrowserEnrollment } from '../src/browser-enrollment.mjs';

const canonical = value => JSON.stringify(value,Object.keys(value).sort());
const encode = value => new TextEncoder().encode(canonical(value));
const b64 = value => Buffer.from(value).toString('base64url');

async function requested() {
  const expiresAt = new Date(Date.now()+600000).toISOString();
  const pending = await requestBrowserEnrollment('synthetic_user',async (path,options) => {
    assert.equal(path,'/api/v1/device-enrollment'); assert.equal(options.method,'POST');
    const value = options.body, key = await crypto.subtle.importKey('raw',Buffer.from(value.newDevicePublicKey,'base64url'),'Ed25519',false,['verify']);
    assert.equal(await crypto.subtle.verify('Ed25519',key,Buffer.from(value.requestSignature,'base64url'),encode({deviceId:value.newDeviceId,publicKey:value.newDevicePublicKey,purpose:'enrollment-request',username:value.username})),true);
    return {enrollmentId:crypto.randomUUID(),code:'ABCDEFGH',pollToken:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt};
  });
  const approver = await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
  const binding = { accountId:crypto.randomUUID(),enrollmentId:pending.enrollmentId,newDeviceId:pending.deviceId,newDevicePublicKey:pending.publicKey,expiresAt };
  const approved = {status:'approved',binding,approverPublicKey:b64(await crypto.subtle.exportKey('raw',approver.publicKey)),approvalSignature:b64(await crypto.subtle.sign('Ed25519',approver.privateKey,encode(binding)))};
  return {pending:structuredClone(pending),approved};
}

test('browser/Home Screen registration uses nonextractable device key and verified possession proof',async()=>{
  const {pending,approved}=await requested();
  assert.equal(pending.privateKey.extractable,false);
  const identity=await finishBrowserEnrollment(pending,async(path,options)=>{
    if(path.endsWith('/poll'))return approved;
    assert.equal(path,`/api/v1/device-enrollment/${pending.enrollmentId}/complete`);
    const key=await crypto.subtle.importKey('raw',Buffer.from(pending.publicKey,'base64url'),'Ed25519',false,['verify']);
    assert.equal(await crypto.subtle.verify('Ed25519',key,Buffer.from(options.body.possessionSignature,'base64url'),encode({...approved.binding,purpose:'device-possession'})),true);
    return {deviceId:pending.deviceId};
  });
  assert.equal(identity.deviceId,pending.deviceId);assert.equal(identity.accountId,approved.binding.accountId);assert.equal(identity.username,pending.username);
  assert.equal(identity.accountSecret,undefined);assert.equal(identity.secretEnvelope,undefined);
});
test('pending approval does not activate a browser identity',async()=>{
  const {pending}=await requested();let calls=0;
  assert.equal(await finishBrowserEnrollment(pending,async()=>{calls++;return{status:'pending'}}),null);assert.equal(calls,1);
});
test('tampered approval bindings and signatures never complete registration',async()=>{
  const {pending,approved}=await requested();
  for(const field of ['enrollmentId','newDeviceId','newDevicePublicKey','expiresAt']) {
    const altered=structuredClone(approved);altered.binding[field]='different';
    await assert.rejects(finishBrowserEnrollment(pending,async path=>{assert.ok(path.endsWith('/poll'));return altered}),/ENROLLMENT_INVALID/);
  }
  const altered=structuredClone(approved);altered.approvalSignature=b64(new Uint8Array(64));
  await assert.rejects(finishBrowserEnrollment(pending,async()=>altered),/ENROLLMENT_INVALID/);
});
test('expired enrollment and invalid username fail before network requests',async()=>{
  await assert.rejects(requestBrowserEnrollment('no',()=>assert.fail('sent invalid request')),/INVALID_USERNAME/);
  await assert.rejects(finishBrowserEnrollment({expiresAt:new Date(0).toISOString()},()=>assert.fail('sent expired request')),/ENROLLMENT_EXPIRED/);
});
test('verified approval survives a lost completion response and retries after expiry',async()=>{
  const {pending,approved}=await requested();let durable;
  await assert.rejects(finishBrowserEnrollment(pending,async path=>{if(path.endsWith('/poll'))return approved;throw Error('SERVER_UNREACHABLE')},async value=>{durable=structuredClone(value)}),/SERVER_UNREACHABLE/);
  assert.ok(durable.approval);
  const result=await finishBrowserEnrollment(durable,async path=>{assert.ok(path.endsWith('/complete'));return{deviceId:pending.deviceId}});
  assert.equal(result.deviceId,pending.deviceId);
});
