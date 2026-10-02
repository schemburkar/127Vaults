import test from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingError, OnboardingService, decodeToken, newBootstrapToken, normalizeEmail, normalizeUsername } from '../src/onboarding.mjs';

const candidate=(email='person@example.test')=>({accountId:'223e4567-e89b-42d3-a456-426614174000',username:'person_1',displayName:'Test Person',email,deviceId:'123e4567-e89b-42d3-a456-426614174000',signingPublicKey:Buffer.alloc(32,1).toString('base64url'),opaqueRecord:Buffer.alloc(192,2).toString('base64url'),wrappedRootDescriptor:Buffer.alloc(8,3).toString('base64url'),wrappedRootEnvelope:Buffer.alloc(16,4).toString('base64url')});
class Store {
  constructor(){this.bootstrap=false;this.invites=[];this.attempts=new Map();}
  async bootstrapOwner(){if(this.bootstrap)throw new OnboardingError();this.bootstrap=true;return {accountId:'owner',emailVerified:false};}
  async createInvitation(x){this.invites.push(x);return {invitationId:x.invitationId,seatCount:x.emails.length};}
  async beginInvitation(x){const id=x.attemptId;this.attempts.set(id,{...x,generation:0});return {attemptId:id};}
  async stageEmail(x){const a=this.attempts.get(x.attemptId);a.generation++;a.digest=x.codeDigestForGeneration(a.generation);return {email:a.email,generation:a.generation};}
  async finalizeInvitation(x){const a=this.attempts.get(x.attemptId);if(a.used||!a.digest.equals(x.codeDigestForGeneration(a.generation)))throw new OnboardingError();a.used=true;return {accountId:'user',deviceId:a.candidate.deviceId};}
}
test('canonical tokens, usernames and exact email normalization',()=>{
  const token=newBootstrapToken();assert.equal(decodeToken(token,'127V-B1-').length,32);assert.throws(()=>decodeToken(`${token}=`, '127V-B1-'));
  assert.equal(normalizeUsername('Person_1').key,'person_1');assert.throws(()=>normalizeUsername('tiny'));
  assert.equal(normalizeEmail(' User.Name@EXAMPLE.TEST '),'User.Name@example.test');assert.throws(()=>normalizeEmail('bad@example'));
});
test('bootstrap is single-use and owner email remains unverified',async()=>{
  const store=new Store(), service=new OnboardingService({store,mailer:{},tokenKey:Buffer.alloc(32,7)}), token=newBootstrapToken();
  assert.deepEqual(await service.bootstrapOwner({token,candidate:candidate()}),{accountId:'owner',emailVerified:false});
  await assert.rejects(service.bootstrapOwner({token,candidate:candidate()}),OnboardingError);
});
test('invite is email-bound, ordinary flow needs current emailed code and consumes once',async()=>{
  const store=new Store();let delivered;const service=new OnboardingService({store,mailer:{sendCode:async x=>{delivered=x.code}},tokenKey:Buffer.alloc(32,8)});
  const made=await service.createInvitation({ownerAccountId:'owner',emails:['person@example.test'],expiresInHours:24});assert.equal(made.seatCount,1);
  const begun=await service.beginInvitation({token:made.token,email:'person@example.test',candidate:candidate(),source:'127.0.0.1'});
  await service.sendEmail(begun);assert.match(delivered,/^\d{8}$/);assert.deepEqual((await service.finalizeInvitation({...begun,code:delivered})).accountId,'user');
  await assert.rejects(service.finalizeInvitation({...begun,code:delivered}),OnboardingError);
  await assert.rejects(service.beginInvitation({token:made.token,email:'other@example.test',candidate:candidate(),source:'127.0.0.1'}),OnboardingError);
});
test('invitation policy accepts only 24/48h and 1..10 unique normalized emails',async()=>{
  const service=new OnboardingService({store:new Store(),mailer:{},tokenKey:Buffer.alloc(32,9)});
  await assert.rejects(service.createInvitation({ownerAccountId:'owner',emails:['a@example.test'],expiresInHours:25}),OnboardingError);
  await assert.rejects(service.createInvitation({ownerAccountId:'owner',emails:['A@example.test','A@example.test'],expiresInHours:48}),OnboardingError);
});
