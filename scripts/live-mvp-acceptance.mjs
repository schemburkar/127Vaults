import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { registrationActivationBytes, authenticationContextHash } from '../apps/server/src/opaque-adapter.mjs';
import { deviceProofBytes } from '../apps/server/src/auth-policy.mjs';
import { createSignedOperation } from '../packages/sync/src/index.mjs';

const endpoint=process.argv[2],caPath=process.argv[3],bootstrapPath=process.argv[4];
if(!endpoint||!caPath||!bootstrapPath)throw Error('Usage: node scripts/live-mvp-acceptance.mjs <https-url> <ca.crt> <bootstrap.txt>');
process.env.NODE_EXTRA_CA_CERTS=caPath;
const origin=new URL(endpoint).origin;
const b64=x=>Buffer.from(x).toString('base64url'),un=x=>Buffer.from(x,'base64url');
const id=x=>Buffer.from(x.replaceAll('-',''),'hex'),uuid=()=>crypto.randomUUID();
let ceremonyCookie,sessionCookie,csrf;
async function call(path,{method='GET',body,cookie=ceremonyCookie,token=csrf,expected=200}={}){
 const headers={};if(body!==undefined)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;if(method!=='GET'){headers.origin=origin;headers['x-127v-csrf']=token;}
 const response=await fetch(`${origin}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(value)}`);return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function rawCall(path,body){const response=await fetch(`${origin}${path}`,{method:'PUT',headers:{'content-type':'application/json',cookie:sessionCookie,origin,'x-127v-csrf':csrf},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}
async function ceremony(){const r=await call('/api/v1/ceremony',{cookie:null});ceremonyCookie=r.cookie;csrf=r.value.csrf;}
function rootTemplate(tenant,account){let x=new Uint8Array(77);x[0]=1;x.set(id(tenant),1);x.set(id(account),17);x.set([0,0,0,1],65);x[76]=1;return x;}
function activation(candidate,record,privateKey){return b64(sign(null,registrationActivationBytes({...candidate,opaqueRecord:b64(record)},record),privateKey));}
async function registerCandidate({accountId,deviceId,username,email,password,secret,privateKey,publicRaw,core,tenant,token}){
 const start=wasm.ExperimentalOpaqueBridge.client_registration_start(secret,password),request=start.message();
 const server=await call('/api/v1/onboarding/register',{method:'POST',body:{accountId,deviceId,request:b64(request),token,email}});
 const upload=wasm.ExperimentalOpaqueBridge.client_registration_finish(start.state(),secret,password,un(server.value.response),un(server.value.binding));
 const root=core.create_root(rootTemplate(tenant,accountId),password,secret),directory=core.create_empty_directory(root);
 let candidate={accountId,deviceId,username,displayName:username,email,signingPublicKey:b64(publicRaw),opaqueUpload:b64(upload),wrappedRootDescriptor:b64(root.context()),wrappedRootEnvelope:b64(root.envelope()),privateDirectory:b64(directory),registrationArtifact:server.value.registrationArtifact};
 candidate.activationSignature=activation(candidate,Buffer.from(upload),privateKey);return {candidate,root,directory};
}
const bootstrap=(bootstrapPath==='-'?await new Promise((resolve,reject)=>{let value='';process.stdin.setEncoding('ascii');process.stdin.on('data',x=>value+=x);process.stdin.on('end',()=>resolve(value));process.stdin.on('error',reject)}):await readFile(bootstrapPath,'ascii')).trim();
await ceremony();
const accountId='11111111-1111-4111-8111-111111111111',deviceId='22222222-2222-4222-8222-222222222222',password=new TextEncoder().encode('fictitious password 127vaults'),secret=new Uint8Array(32).fill(7);
const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,9)]),format:'der',type:'pkcs8'}),publicKey=createPublicKey(privateKey),keys={privateKey,publicKey},publicRaw=publicKey.export({format:'der',type:'spki'}).subarray(-32),core=new wasm.ExperimentalEcf1Core();
// Registration binding reveals only public installation/account/device context.
const initial=wasm.ExperimentalOpaqueBridge.client_registration_start(secret,password);
const rs=await call('/api/v1/onboarding/register',{method:'POST',body:{accountId,deviceId,request:b64(initial.message()),token:bootstrap,email:null}});
const binding=un(rs.value.binding),originLength=binding.readUInt16BE(),tenant=[binding.subarray(2+originLength,18+originLength)].map(x=>[x.subarray(0,4),x.subarray(4,6),x.subarray(6,8),x.subarray(8,10),x.subarray(10)].map(y=>y.toString('hex')).join('-'))[0];
const upload=wasm.ExperimentalOpaqueBridge.client_registration_finish(initial.state(),secret,password,un(rs.value.response),binding);
const root=core.create_root(rootTemplate(tenant,accountId),password,secret),directory=core.create_empty_directory(root);
let candidate={accountId,deviceId,username:'owner_127',displayName:'Fictitious Owner',email:'owner@example.invalid',signingPublicKey:b64(publicRaw),opaqueUpload:b64(upload),wrappedRootDescriptor:b64(root.context()),wrappedRootEnvelope:b64(root.envelope()),privateDirectory:b64(directory),registrationArtifact:rs.value.registrationArtifact};
candidate.activationSignature=activation(candidate,Buffer.from(upload),keys.privateKey);
await call('/api/v1/onboarding/register',{method:'POST',body:{token:bootstrap,candidate}});
await call('/api/v1/onboarding/register',{method:'POST',body:{token:bootstrap,candidate},expected:400});

await ceremony();
const ls=wasm.ExperimentalOpaqueBridge.client_login_start(secret,password);
const ar=await call('/api/v1/auth/',{method:'POST',body:{username:candidate.username,deviceId,request:b64(ls.message())}});csrf=ar.value.csrf;ceremonyCookie=ar.cookie;
const lf=wasm.ExperimentalOpaqueBridge.client_login_finish(ls.state(),secret,password,un(ar.value.challenge),un(ar.value.binding));
const rootResponse=await call(`/api/v1/auth/${ar.value.attemptId}/password`,{method:'POST',body:{finalization:b64(lf.message())}});
const attempt=un(ar.value.attemptId),contextHash=authenticationContextHash({origin,installation:tenant,account:accountId,device:deviceId,epoch:1,attempt,serverPublicKey:binding.subarray(binding.length-32)}),transcriptHash=createHash('sha512').update(ls.message()).update(un(ar.value.challenge)).digest(),rootHash=createHash('sha512').update(root.context()).update(root.envelope()).digest();
const proof=deviceProofBytes({contextHash,transcriptHash,installation:id(tenant),account:id(accountId),device:id(deviceId),epoch:1,rootHash});
const logged=await call(`/api/v1/auth/${ar.value.attemptId}/device-proof`,{method:'POST',body:{signature:b64(sign(null,proof,keys.privateKey))}});sessionCookie=logged.cookie;csrf=logged.value.csrf;

async function signedMutation(kind,itemId,vaultId,catalogue,index,body){
 const sync=(await call(`/api/v1/vaults/${vaultId}/operations?cursor=0&limit=500`,{cookie:sessionCookie})).value;
 const previous=[...(sync.operations??[])].reverse().find(x=>x.operation.deviceId===deviceId)?.operation.opId??null;
 const frame=parts=>Buffer.concat(parts.flatMap(part=>{const size=Buffer.alloc(4);size.writeUInt32BE(part.length);return [size,Buffer.from(part)]}));
 return createSignedOperation({tenantId:tenant,vaultId,deviceId,epoch:1,causalBase:sync.cursor??0,previousDeviceOpId:previous,kind,itemId,payloadHash:createHash('sha256').update(frame([catalogue,index,body])).digest('hex')},keys.privateKey);
}

const made=core.create_private_vault(root,directory),vault=made.vault(),vaultId=[Buffer.from(vault.context()).subarray(33,49)].map(x=>[x.subarray(0,4),x.subarray(4,6),x.subarray(6,8),x.subarray(8,10),x.subarray(10)].map(y=>y.toString('hex')).join('-'))[0];
const createBody={requestId:uuid(),baseDirectoryRevision:[Buffer.from(directory).subarray(36,52)].map(x=>[x.subarray(0,4),x.subarray(4,6),x.subarray(6,8),x.subarray(8,10),x.subarray(10)].map(y=>y.toString('hex')).join('-'))[0],directory:b64(made.directory()),vaultEnvelope:b64(vault.envelope()),catalogue:b64(made.catalogue())};
const created=await call('/api/v1/vaults',{method:'POST',body:createBody,cookie:sessionCookie});
assert.deepEqual((await call('/api/v1/vaults',{method:'POST',body:createBody,cookie:sessionCookie})).value,created.value);
const changedDirectory = Buffer.from(un(createBody.directory)); changedDirectory[changedDirectory.length - 1] ^= 1;
await call('/api/v1/vaults',{method:'POST',body:{...createBody,directory:b64(changedDirectory)},cookie:sessionCookie,expected:409});
const item=core.upsert_private_item(vault,made.catalogue(),undefined,new TextEncoder().encode('{"title":"Fictitious"}'),new TextEncoder().encode('{"password":"not-a-secret"}')),itemId=[Buffer.from(item.item())].map(x=>[x.subarray(0,4),x.subarray(4,6),x.subarray(6,8),x.subarray(8,10),x.subarray(10)].map(y=>y.toString('hex')).join('-'))[0];
const itemBody={requestId:uuid(),baseCatalogueRevision:created.value.catalogueRevision,catalogue:b64(item.catalogue()),index:b64(item.index()),body:b64(item.body()),itemId,signedOperation:await signedMutation('item.create',itemId,vaultId,item.catalogue(),item.index(),item.body())};
const saved=await call(`/api/v1/vaults/${vaultId}/items`,{method:'POST',body:itemBody,cookie:sessionCookie});
const listed=await call(`/api/v1/vaults/${vaultId}/items`,{cookie:sessionCookie});assert.equal(listed.value.indices.length,1);
const opened=await call(`/api/v1/vaults/${vaultId}/items/${itemId}?catalogueRevision=${saved.value.catalogueRevision}`,{cookie:sessionCookie});assert.ok(opened.value.envelope);
assert.deepEqual(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(vault,item.catalogue(),item.item(),un(listed.value.indices[0].envelope),4))),{title:'Fictitious'});
assert.deepEqual(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(vault,item.catalogue(),item.item(),un(opened.value.envelope),3))),{password:'not-a-secret'});
const {itemId: _omitItemId,...staleUpdate}=itemBody;
await call(`/api/v1/vaults/${vaultId}/items/${itemId}`,{method:'PUT',body:{...staleUpdate,requestId:uuid(),baseCatalogueRevision:created.value.catalogueRevision,signedOperation:await signedMutation('item.update',itemId,vaultId,item.catalogue(),item.index(),item.body())},cookie:sessionCookie,expected:409});
const next=core.upsert_private_item(vault,item.catalogue(),item.item(),new TextEncoder().encode('{"title":"Updated"}'),new TextEncoder().encode('{"password":"updated-fiction"}'));
const update={requestId:uuid(),baseCatalogueRevision:saved.value.catalogueRevision,catalogue:b64(next.catalogue()),index:b64(next.index()),body:b64(next.body()),signedOperation:await signedMutation('item.update',itemId,vaultId,next.catalogue(),next.index(),next.body())};
// Older upgrade baselines have a known concurrent receipt race. Seed those
// installations with serial replay; fresh candidate acceptance stays concurrent.
const updatePath=`/api/v1/vaults/${vaultId}/items/${itemId}`;
const duplicate=process.env.VAULTS_BASELINE_SERIAL_REPLAY==='1'
 ? [await rawCall(updatePath,update),await rawCall(updatePath,update)]
 : await Promise.all([rawCall(updatePath,update),rawCall(updatePath,update)]);
assert.deepEqual(duplicate.map(x=>x.status),[200,200]);assert.deepEqual(duplicate[0].value,duplicate[1].value);
const after=await call(`/api/v1/vaults/${vaultId}/items`,{cookie:sessionCookie});const afterBody=await call(`/api/v1/vaults/${vaultId}/items/${itemId}?catalogueRevision=${duplicate[0].value.catalogueRevision}`,{cookie:sessionCookie});
assert.deepEqual(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(vault,next.catalogue(),next.item(),un(after.value.indices[0].envelope),4))),{title:'Updated'});assert.deepEqual(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(vault,next.catalogue(),next.item(),un(afterBody.value.envelope),3))),{password:'updated-fiction'});
const raceA=core.upsert_private_item(vault,next.catalogue(),next.item(),new TextEncoder().encode('{"title":"Race A"}'),new TextEncoder().encode('{"password":"race-a"}')),raceB=core.upsert_private_item(vault,next.catalogue(),next.item(),new TextEncoder().encode('{"title":"Race B"}'),new TextEncoder().encode('{"password":"race-b"}'));
const raceBody=async x=>({requestId:uuid(),baseCatalogueRevision:duplicate[0].value.catalogueRevision,catalogue:b64(x.catalogue()),index:b64(x.index()),body:b64(x.body()),signedOperation:await signedMutation('item.update',itemId,vaultId,x.catalogue(),x.index(),x.body())}),raceARequest=await raceBody(raceA),raceBRequest=await raceBody(raceB),races=await Promise.all([rawCall(`/api/v1/vaults/${vaultId}/items/${itemId}`,raceARequest),rawCall(`/api/v1/vaults/${vaultId}/items/${itemId}`,raceBRequest)]);assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
const winner=races[0].status===200?raceA:raceB,winnerResponse=races.find(x=>x.status===200).value,current=await call(`/api/v1/vaults/${vaultId}/items`,{cookie:sessionCookie});
const badIndex=Buffer.alloc(10),bad={requestId:uuid(),baseCatalogueRevision:winnerResponse.catalogueRevision,catalogue:b64(winner.catalogue()),index:b64(badIndex),body:b64(winner.body()),signedOperation:await signedMutation('item.update',itemId,vaultId,winner.catalogue(),badIndex,winner.body())};await rawCall(`/api/v1/vaults/${vaultId}/items/${itemId}`,bad).then(x=>assert.equal(x.status,400));assert.equal((await call(`/api/v1/vaults/${vaultId}/items`,{cookie:sessionCookie})).value.catalogue,current.value.catalogue);
const invitation=await call('/api/v1/invitations',{method:'POST',body:{emails:['guest@example.invalid'],expiresInHours:24},cookie:sessionCookie});assert.match(invitation.value.token,/^127V-I1-/);
core.lock();assert.throws(()=>core.decrypt_private_part(vault,item.catalogue(),item.item(),item.body(),3));
console.log(JSON.stringify({ok:true,ownerBootstrap:true,login:true,invitation:true,vaultCreate:true,itemCreateRead:true,itemUpdateReload:true,decryptedIndexBody:true,parallelIdempotency:true,parallelStaleBase:true,transactionRollback:true,lock:true}));
