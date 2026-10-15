// Fictitious owner from the fresh, explicitly guarded license installation.
// Real crypto/protocol requests; this is not a native/GUI queue acceptance test.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createSignedOperation} from '../packages/sync/src/index.mjs';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import wasm from '../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import { authenticationContextHash } from '../apps/server/src/opaque-adapter.mjs';
import { deviceProofBytes } from '../apps/server/src/auth-policy.mjs';

const [work,phase]=process.argv.slice(2);assert.equal(work,'C:/Projects/127Vaults-license-isolated-20261015-a');assert.ok(['prepare-grace','check-grace','replay-grace','prepare-revoked','check-revoked','replay-revoked'].includes(phase));const evidence=JSON.parse(await readFile(work+'/evidence.json','utf8'));assert.equal(evidence.status,'passed');const origin='https://127.0.0.1:12900';
if (!origin?.startsWith('https://')) throw Error('Supply the HTTPS origin.');
const deviceId = '22222222-2222-4222-8222-222222222222';
const secret = new Uint8Array(32).fill(7);
const password = new TextEncoder().encode('fictitious password 127vaults');
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 9)]), format: 'der', type: 'pkcs8' });
const b64 = value => Buffer.from(value).toString('base64url');
const un = value => Buffer.from(value, 'base64url');
const id = value => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuid = value => [value.subarray(0, 4), value.subarray(4, 6), value.subarray(6, 8), value.subarray(8, 10), value.subarray(10)].map(x => x.toString('hex')).join('-');
let cookie, csrf;
async function call(path, { method = 'GET', body } = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin, 'x-127v-csrf': csrf } : {}) };
  const response = await fetch(origin + path, { method, headers, body: body && JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`);
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
  return value;
}
const ceremony = await call('/api/v1/ceremony');
csrf = ceremony.csrf;
const step = wasm.ExperimentalOpaqueBridge.client_login_start(secret, password);
const begun = await call('/api/v1/auth/', { method: 'POST', body: { username: 'owner_127', deviceId, request: b64(step.message()) } });
csrf = begun.csrf;
const finished = wasm.ExperimentalOpaqueBridge.client_login_finish(step.state(), secret, password, un(begun.challenge), un(begun.binding));
const root = await call(`/api/v1/auth/${begun.attemptId}/password`, { method: 'POST', body: { finalization: b64(finished.message()) } });
const binding = un(begun.binding), n = binding.readUInt16BE();
let p = 2 + n;
const installation = uuid(binding.subarray(p, p += 16)), account = uuid(binding.subarray(p, p += 16));
p += 16;
const epoch = Number(binding.readBigUInt64BE(p));
const proof = deviceProofBytes({
  contextHash: authenticationContextHash({ origin, installation, account, device: deviceId, epoch, attempt: un(begun.attemptId), serverPublicKey: binding.subarray(-32) }),
  transcriptHash: createHash('sha512').update(step.message()).update(un(begun.challenge)).digest(),
  installation: id(installation), account: id(account), device: id(deviceId), epoch,
  rootHash: createHash('sha512').update(un(root.descriptor)).update(un(root.envelope)).digest()
});
const session = await call(`/api/v1/auth/${begun.attemptId}/device-proof`, { method: 'POST', body: { signature: b64(sign(null, proof, key)) } });
csrf = session.csrf;

assert.equal(installation,evidence.installation);assert.ok(!['98027ac4-9882-42d5-812a-a18c972c299f','14725fef-f5b4-4cb8-afe0-77aa3d80b268'].includes(installation));
const kind=phase.split('-')[1],packetPath=work+'/license-'+kind+'-pending.json';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const vaults=await call('/api/v1/vaults'),vaultId=vaults.vaultEnvelopes[0].vaultId;
const items=await call('/api/v1/vaults/'+vaultId+'/items');assert.ok(items.indices.length>0);
const core=new wasm.ExperimentalEcf1Core();let openedVault;
try{
 const openedRoot=core.unwrap_root(un(root.envelope),un(root.descriptor),password,secret);
 openedVault=core.open_private_vault(openedRoot,un(vaults.directory),id(vaultId),un(vaults.vaultEnvelopes[0].envelope));
 const item=items.indices[0],cat=un(items.catalogue),body=await call('/api/v1/vaults/'+vaultId+'/items/'+item.itemId+'?catalogueRevision='+uuid(cat.subarray(44,60)));
 const plainIndex=JSON.parse(new TextDecoder().decode(core.decrypt_private_part(openedVault,cat,id(item.itemId),un(item.envelope),4)));
 const plainBody=JSON.parse(new TextDecoder().decode(core.decrypt_private_part(openedVault,cat,id(item.itemId),un(body.envelope),3)));
 if(phase.startsWith('prepare')){
  const made=core.upsert_private_item(openedVault,cat,id(item.itemId),new TextEncoder().encode(JSON.stringify({...plainIndex,title:'License retained '+kind})),new TextEncoder().encode(JSON.stringify(plainBody)));
  const sync=await call('/api/v1/vaults/'+vaultId+'/operations?cursor=0&limit=500');
  const frame=Buffer.concat([made.catalogue(),made.index(),made.body()].flatMap(part=>{const size=Buffer.alloc(4);size.writeUInt32BE(part.length);return[size,Buffer.from(part)];}));
  const signedOperation=await createSignedOperation({tenantId:installation,vaultId,deviceId,epoch:1,causalBase:sync.cursor??0,previousDeviceOpId:[...(sync.operations??[])].reverse().find(x=>x.operation.deviceId===deviceId)?.operation.opId??null,kind:'item.update',itemId:item.itemId,payloadHash:createHash('sha256').update(frame).digest('hex')},key);
  const request={requestId:randomUUID(),baseCatalogueRevision:uuid(cat.subarray(44,60)),catalogue:b64(made.catalogue()),index:b64(made.index()),body:b64(made.body()),signedOperation};
  await writeFile(packetPath,JSON.stringify({installation,vaultId,itemId:item.itemId,path:'/api/v1/vaults/'+vaultId+'/items/'+item.itemId,request,before:items,beforeBody:body,requestHash:hash(request)},null,2)+'\n',{flag:'wx',mode:0o600});
 }else{
  const packet=JSON.parse(await readFile(packetPath,'utf8'));assert.equal(packet.installation,installation);assert.equal(packet.vaultId,vaultId);assert.equal(hash(packet.request),packet.requestHash);
  const send=async()=>{const response=await fetch(origin+packet.path,{method:'PUT',headers:{cookie,origin,'content-type':'application/json','x-127v-csrf':csrf},body:JSON.stringify(packet.request)});return{status:response.status,value:await response.json()};};
  const license=await call('/api/v1/license');
  if(phase.startsWith('check')){
   assert.equal(license.mode,kind==='grace'?'read-only':'revoked');const denied=await send();assert.equal(denied.status,423);assert.equal(denied.value.error,kind==='grace'?'license_read_only':'license_revoked');
   assert.deepEqual(await call('/api/v1/vaults/'+vaultId+'/items'),packet.before);assert.deepEqual(body,packet.beforeBody);
  }else{
   assert.equal(license.mode,'active');const first=await send();assert.equal(first.status,200);assert.deepEqual(await send(),first);
   const after=await call('/api/v1/vaults/'+vaultId+'/items'),catalogue=un(after.catalogue),row=after.indices.find(x=>x.itemId===packet.itemId);
   const restored=JSON.parse(new TextDecoder().decode(core.decrypt_private_part(openedVault,catalogue,id(packet.itemId),un(row.envelope),4)));assert.equal(restored.title,'License retained '+kind);
   const currentBody=await call(packet.path+'?catalogueRevision='+uuid(catalogue.subarray(44,60)));assert.deepEqual(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(openedVault,catalogue,id(packet.itemId),un(currentBody.envelope),3))),plainBody);
   const history=await call('/api/v1/vaults/'+vaultId+'/operations?cursor=0&limit=500');assert.equal(history.operations.filter(x=>x.operation.opId===packet.request.signedOperation.opId).length,1);
  }
  assert.equal(hash(JSON.parse(await readFile(packetPath,'utf8')).request),packet.requestHash);
 }
 await writeFile(work+'/license-'+phase+'.json',JSON.stringify({status:'passed',installation,phase,scope:'Actual selected server HTTPS/PostgreSQL and production crypto/protocol fixture owner; GUI/native UI not covered',at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log('Selected server license phase passed: '+phase);
}finally{if(openedVault){core.release_vault(openedVault);openedVault.free();}core.lock();}
