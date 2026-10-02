import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { AuthService } from '../src/auth-service.mjs';
import { deviceProofBytes } from '../src/auth-policy.mjs';

test('service uses fake record path, authenticates root response, and requires device proof',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const raw=publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const proofFields={contextHash:Buffer.alloc(64,1),transcriptHash:Buffer.alloc(64,2),installation:Buffer.alloc(16,3),account:Buffer.alloc(16,4),device:Buffer.alloc(16,5),epoch:1,rootHash:Buffer.alloc(64,6)};
  let receivedRecord='unset',rootTagged=false,sessionCreated=false;
  const pending={state:Buffer.alloc(8),binding:{},request:Buffer.alloc(96),response:Buffer.alloc(320),descriptor:Buffer.alloc(1),envelope:Buffer.alloc(2),publicKey:raw,proofFields};
  const store={
    loginMaterial:async()=>({setup:Buffer.alloc(96),record:null,binding:{},bindingBytes:Buffer.alloc(138)}),
    saveAttempt:async()=>{},consumePasswordAttempt:async()=>pending,recordFailure:async()=>{},
    passwordSucceeded:async x=>{assert.equal(x.rootTag.length,64);},
    consumeRoot:async()=>({descriptor:Buffer.alloc(1),envelope:Buffer.alloc(2),tag:Buffer.alloc(64)}),
    deviceAttempt:async()=>pending,createSession:async()=>{sessionCreated=true;return {expiresAt:new Date(1)};},
    authenticate:async()=>({csrf:'c'}),logout:async()=>{},
  };
  const opaque={serverLoginStart:async x=>{receivedRecord=x.record;return {state:Buffer.alloc(2),message:Buffer.alloc(320)};},serverLoginFinish:async()=>Buffer.alloc(64),rootResponseTag:async()=>{rootTagged=true;return Buffer.alloc(64);}};
  const service=new AuthService({store,opaque,now:()=>new Date(0)});
  const started=await service.start({username:'missing',deviceId:'123e4567-e89b-42d3-a456-426614174000',request:Buffer.alloc(96).toString('base64url'),origin:'https://127.0.0.1',source:'127.0.0.1'});
  assert.equal(receivedRecord,null);assert.equal(Buffer.from(started.challenge,'base64url').length,320);
  await service.finishPassword({attemptId:started.attemptId,finalization:Buffer.alloc(64).toString('base64url')});assert.equal(rootTagged,true);
  await assert.rejects(service.finishDevice({attemptId:started.attemptId,signature:Buffer.alloc(64).toString('base64url')}));
  const signature=sign(null,deviceProofBytes(proofFields),privateKey);
  await service.finishDevice({attemptId:started.attemptId,signature:signature.toString('base64url')});assert.equal(sessionCreated,true);
});
