import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OpaqueAdapter, RegistrationAdapter, createRegistrationCompletion, registrationActivationBytes } from '../src/opaque-adapter.mjs';

test('registration artifact binds IDs, expiry, OPAQUE validation and first device proof',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),raw=publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const bridge={server_registration_start:()=>Buffer.alloc(64),server_registration_finish:x=>x};
  const opaque=new OpaqueAdapter(bridge),registration=new RegistrationAdapter({opaque,setup:Buffer.alloc(96),installation:'323e4567-e89b-42d3-a456-426614174000',serverPublicKey:Buffer.alloc(32),tokenKey:Buffer.alloc(32,7),origin:'https://127.0.0.1',now:()=>100});
  const ids={accountId:'223e4567-e89b-42d3-a456-426614174000',deviceId:'123e4567-e89b-42d3-a456-426614174000'};
  const started=await registration.start({...ids,request:Buffer.alloc(32).toString('base64url')});
  const candidate={...ids,username:'person_1',displayName:'Person',email:'person@example.test',signingPublicKey:raw.toString('base64url'),opaqueUpload:Buffer.alloc(192,2).toString('base64url'),wrappedRootDescriptor:Buffer.alloc(8,3).toString('base64url'),wrappedRootEnvelope:Buffer.alloc(16,4).toString('base64url'),registrationArtifact:started.registrationArtifact};
  const record=Buffer.from(candidate.opaqueUpload,'base64url');candidate.activationSignature=sign(null,registrationActivationBytes({...candidate,opaqueRecord:candidate.opaqueUpload},record),privateKey).toString('base64url');
  const completed=await createRegistrationCompletion(opaque,registration)(candidate);assert.equal(completed.opaqueRecord,candidate.opaqueUpload);assert.equal(completed.accountId,ids.accountId);
  await assert.rejects(createRegistrationCompletion(opaque,registration)({...candidate,deviceId:'423e4567-e89b-42d3-a456-426614174000'}));
  const anotherTenant=new RegistrationAdapter({opaque,setup:Buffer.alloc(96),installation:'423e4567-e89b-42d3-a456-426614174000',serverPublicKey:Buffer.alloc(32),tokenKey:Buffer.alloc(32,7),origin:'https://another.example.com',now:()=>100});
  await assert.rejects(createRegistrationCompletion(opaque,anotherTenant)(candidate));
});
