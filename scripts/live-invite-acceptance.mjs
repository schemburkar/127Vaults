import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { authenticationContextHash, registrationActivationBytes } from '../apps/server/src/opaque-adapter.mjs';
import { deviceProofBytes } from '../apps/server/src/auth-policy.mjs';

const origin=process.argv[2],b64=x=>Buffer.from(x).toString('base64url'),un=x=>Buffer.from(x,'base64url'),id=x=>Buffer.from(x.replaceAll('-',''),'hex');
const toUuid=x=>[x.subarray(0,4),x.subarray(4,6),x.subarray(6,8),x.subarray(8,10),x.subarray(10)].map(y=>y.toString('hex')).join('-');
const password=new TextEncoder().encode('fictitious password 127vaults'),ownerSecret=new Uint8Array(32).fill(7),ownerDeviceId='22222222-2222-4222-8222-222222222222',run=crypto.randomUUID().replaceAll('-','').slice(0,12);
let cookie,csrf;
async function call(path,{method='GET',body,expected=200}={}){const headers={};if(body){headers['content-type']='application/json';headers.origin=origin;headers['x-127v-csrf']=csrf}if(cookie)headers.cookie=cookie;const response=await fetch(origin+path,{method,headers,body:body&&JSON.stringify(body)}),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));const nextCookie=response.headers.get('set-cookie');if(nextCookie)cookie=nextCookie.split(';')[0];return value}
async function ceremony(){cookie=undefined;const value=await call('/api/v1/ceremony');csrf=value.csrf}
async function login(username,deviceId,secret,privateKey){const step=wasm.ExperimentalOpaqueBridge.client_login_start(secret,password),started=await call('/api/v1/auth/',{method:'POST',body:{username,deviceId,request:b64(step.message())}});csrf=started.csrf;const finish=wasm.ExperimentalOpaqueBridge.client_login_finish(step.state(),secret,password,un(started.challenge),un(started.binding)),root=await call(`/api/v1/auth/${started.attemptId}/password`,{method:'POST',body:{finalization:b64(finish.message())}}),binding=un(started.binding),n=binding.readUInt16BE();let p=2+n;const installation=toUuid(binding.subarray(p,p+=16)),account=toUuid(binding.subarray(p,p+=16));p+=16;const epoch=Number(binding.readBigUInt64BE(p)),attempt=un(started.attemptId),proof=deviceProofBytes({contextHash:authenticationContextHash({origin,installation,account,device:deviceId,epoch,attempt,serverPublicKey:binding.subarray(-32)}),transcriptHash:createHash('sha512').update(step.message()).update(un(started.challenge)).digest(),installation:id(installation),account:id(account),device:id(deviceId),epoch,rootHash:createHash('sha512').update(un(root.descriptor)).update(un(root.envelope)).digest()});const logged=await call(`/api/v1/auth/${started.attemptId}/device-proof`,{method:'POST',body:{signature:b64(sign(null,proof,privateKey))}});csrf=logged.csrf}

const ownerKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,9)]),format:'der',type:'pkcs8'});
await ceremony();await login('owner_127',ownerDeviceId,ownerSecret,ownerKey);
const ownerVaults=await call('/api/v1/vaults'),ownerVaultId=ownerVaults.vaultEnvelopes[0]?.vaultId;assert.ok(ownerVaultId);
const guestEmail=`guest-${run}@example.invalid`,invitation=await call('/api/v1/invitations',{method:'POST',body:{emails:[guestEmail],expiresInHours:24}});assert.match(invitation.token,/^127V-I1-/);

await ceremony();
const accountId=crypto.randomUUID(),deviceId=crypto.randomUUID(),secret=new Uint8Array(32).fill(8),guestKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,10)]),format:'der',type:'pkcs8'}),publicKey=createPublicKey(guestKey).export({format:'der',type:'spki'}).subarray(-32),registration=wasm.ExperimentalOpaqueBridge.client_registration_start(secret,password);
const prepared=await call('/api/v1/onboarding/register',{method:'POST',body:{accountId,deviceId,request:b64(registration.message()),token:invitation.token,email:guestEmail}}),upload=wasm.ExperimentalOpaqueBridge.client_registration_finish(registration.state(),secret,password,un(prepared.response),un(prepared.binding));
const candidate={accountId,deviceId,username:`guest_${run}`,displayName:'Fictitious Guest',email:guestEmail,signingPublicKey:b64(publicKey),opaqueUpload:b64(upload),wrappedRootDescriptor:b64(Buffer.alloc(93,1)),wrappedRootEnvelope:b64(Buffer.alloc(173,2)),registrationArtifact:prepared.registrationArtifact};
candidate.activationSignature=b64(sign(null,registrationActivationBytes({...candidate,opaqueRecord:b64(upload)},Buffer.from(upload)),guestKey));
const begun=await call('/api/v1/onboarding/invitation',{method:'POST',body:{token:invitation.token,email:candidate.email,candidate}});
await call(`/api/v1/onboarding/invitation/${begun.attemptId}/email`,{method:'POST',body:{capability:begun.capability}});
const captured=await fetch(`http://127.0.0.1:1465/latest?to=${encodeURIComponent(candidate.email)}`).then(response=>{assert.equal(response.status,200);return response.json()});
await call(`/api/v1/onboarding/invitation/${begun.attemptId}/complete`,{method:'POST',body:{capability:begun.capability,code:captured.code}});

await ceremony();await login(candidate.username,deviceId,secret,guestKey);
const guestVaults=await call('/api/v1/vaults');assert.equal(guestVaults.vaultEnvelopes.length,0);await call(`/api/v1/vaults/${ownerVaultId}/items`,{expected:404});
console.log(JSON.stringify({ok:true,smtpProtocol:true,invitedActivation:true,invitedLogin:true,twoAccountIsolation:true}));
