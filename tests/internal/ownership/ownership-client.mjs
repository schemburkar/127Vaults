// Guarded production authentication helper for the owned ownership fixture.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {request} from 'node:https';
import {createHash,createPrivateKey,sign,randomUUID} from 'node:crypto';
import wasm from '../../../apps/server/wasm-auth/vaults_browser_fixture.cjs';
import {authenticationContextHash} from '../../../apps/server/src/opaque-adapter.mjs';
import {deviceProofBytes} from '../../../apps/server/src/auth-policy.mjs';
export async function ownershipClient(work, identityDirectory) {
assert.ok(work&&isAbsolute(work));const fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(fixture.origin,'https://127.0.0.1:12898');assert.equal(fixture.project,'vaults-test-632a4442dfd2');
if (identityDirectory !== undefined) { assert.equal(process.platform, 'linux'); assert.equal(identityDirectory, '/identity'); }
const ca=await readFile(join(identityDirectory ?? fixture.identity,'ca/ca.crt')),origin=fixture.origin,b64=x=>Buffer.from(x).toString('base64url'),un=x=>Buffer.from(x,'base64url'),id=x=>Buffer.from(x.replaceAll('-',''),'hex');
async function http(path,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const req=request(origin+path,{method,ca,timeout:15000,headers:{...(body?{'content-type':'application/json',origin}:{}),...headers}},res=>{let text='';res.setEncoding('utf8');res.on('data',b=>text+=b);res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(text),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});}catch{reject(Error('Expected fixture JSON response'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy());req.end(body&&JSON.stringify(body));});}
class Account{
 constructor(accountId,deviceId,username,seed){Object.assign(this,{accountId,deviceId,username});this.secret=new Uint8Array(32).fill(7);this.password=new TextEncoder().encode('fictitious password 127vaults');this.key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,seed)]),format:'der',type:'pkcs8'});}
 async ceremony(){const r=await http('/api/v1/ceremony');assert.equal(r.status,200);this.ceremonyCookie=r.cookie;this.anti=r.value.csrf;}
 async call(path,{body,session=true,expected=200}={}){const r=await http(path,{method:body?'POST':'GET',body,headers:{cookie:session?this.cookie:this.ceremonyCookie,...(body?{'x-127v-csrf':session?this.csrf:this.anti}:{})}});assert.equal(r.status,expected,'Owned customer request '+path+' expected '+expected+', received '+r.status);return r;}
 async login(){await this.ceremony();const step=wasm.ExperimentalOpaqueBridge.client_login_start(this.secret,this.password);const begun=await this.call('/api/v1/auth/',{session:false,body:{username:this.username,deviceId:this.deviceId,request:b64(step.message())}});this.anti=begun.value.csrf;this.ceremonyCookie=begun.cookie;const finish=wasm.ExperimentalOpaqueBridge.client_login_finish(step.state(),this.secret,this.password,un(begun.value.challenge),un(begun.value.binding));const root=await this.call('/api/v1/auth/'+begun.value.attemptId+'/password',{session:false,body:{finalization:b64(finish.message())}});const proof=deviceProofBytes({contextHash:authenticationContextHash({origin,installation:fixture.serverId,account:this.accountId,device:this.deviceId,epoch:1,attempt:un(begun.value.attemptId),serverPublicKey:un(begun.value.binding).subarray(-32)}),transcriptHash:createHash('sha512').update(step.message()).update(un(begun.value.challenge)).digest(),installation:id(fixture.serverId),account:id(this.accountId),device:id(this.deviceId),epoch:1,rootHash:createHash('sha512').update(un(root.value.descriptor)).update(un(root.value.envelope)).digest()});const done=await this.call('/api/v1/auth/'+begun.value.attemptId+'/device-proof',{session:false,body:{signature:b64(sign(null,proof,this.key))}});this.cookie=done.cookie;this.csrf=done.value.csrf;}

}
async function operator(username,password){const r=await http('/api/admin/session',{method:'POST',body:{username,password}});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.value.csrf,password};}
async function action(actor,action,fields={},expected=200,requestId=randomUUID()){const body={action,requestId,...fields,password:actor.password},r=await http('/api/admin/actions',{method:'POST',body,headers:{cookie:actor.cookie,'x-127v-admin-csrf':actor.csrf}});assert.equal(r.status,expected,'Owned operator action '+action+' expected '+expected+', received '+r.status);return r.value;}

return {fixture,Account,http,operator,action};
}
