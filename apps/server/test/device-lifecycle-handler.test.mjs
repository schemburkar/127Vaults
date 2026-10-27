import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDeviceLifecycleHandler } from '../src/device-lifecycle-handler.mjs';

const origin='https://127.0.0.1:12780',cookie='x'.repeat(43);
function request(path,{method='GET',value,csrf=true}={}){const raw=value===undefined?'':JSON.stringify(value);const req=Readable.from(raw?[Buffer.from(raw)]:[]);Object.assign(req,{url:path,method,headers:{cookie:`__Host-127v-session=${cookie}`,...(raw?{'content-type':'application/json'}:{}),...(csrf?{origin,'x-127v-csrf':'csrf'}:{})}});return req}
function response(){return {status:0,value:null,writeHead(s){this.status=s},end(v){this.value=JSON.parse(v)}}}
const auth=async()=>({tenantId:'t',accountId:'a',deviceId:'d',sessionId:'s',csrf:'csrf'});

test('lists only after session authentication',async()=>{let called=0;const h=createDeviceLifecycleHandler({async list(a){called++;assert.equal(a.deviceId,'d');return {devices:[]}}},auth,origin),res=response();assert.equal(await h(request('/api/v1/devices'),res),true);assert.equal(res.status,200);assert.equal(called,1)});

test('mount ignores unrelated paths',async()=>{const h=createDeviceLifecycleHandler({},auth,origin);assert.equal(await h(request('/health'),response()),false)});

test('enrollment requires same-origin CSRF and passes authenticated identity separately',async()=>{let seen;const store={async beginEnrollment(a,v){seen={a,v};return {enrollmentId:'ok'}}};const h=createDeviceLifecycleHandler(store,auth,origin),bad=response();await h(request('/api/v1/devices/enrollments',{method:'POST',value:{newDeviceId:'id',newDevicePublicKey:'key',protectionClass:'software',protectionVerified:false},csrf:false}),bad);assert.equal(bad.status,401);assert.equal(seen,undefined);const good=response();await h(request('/api/v1/devices/enrollments',{method:'POST',value:{newDeviceId:'id',newDevicePublicKey:'key',protectionClass:'software',protectionVerified:false}}),good);assert.equal(good.status,200);assert.equal(seen.a.accountId,'a')});

test('rejects body identity injection and returns generic auth/unavailable errors',async()=>{const h=createDeviceLifecycleHandler({async revoke(){throw new Error('database details')}},auth,origin),injected=response();await h(request('/api/v1/devices/revoke',{method:'POST',value:{deviceId:'d',accountId:'victim'}}),injected);assert.equal(injected.status,401);assert.deepEqual(injected.value,{error:'authentication_required'});const unavailable=response();await h(request('/api/v1/devices/revoke',{method:'POST',value:{deviceId:'d'}}),unavailable);assert.equal(unavailable.status,503);assert.deepEqual(unavailable.value,{error:'unavailable'})});

test('mutating route map covers enrollment approval and revocation',async()=>{const calls=[];const store=new Proxy({}, {get:(_,name)=>async(a,v)=>{calls.push([name,a.deviceId,v]);return {ok:true}}});const h=createDeviceLifecycleHandler(store,auth,origin);for(const [path,value] of [['/api/v1/devices/enrollments/approve',{enrollmentId:'e',code:'c',approvalSignature:'a',possessionSignature:'p'}],['/api/v1/devices/revoke',{deviceId:'d'}]]){const res=response();await h(request(path,{method:'POST',value}),res);assert.equal(res.status,200)}assert.deepEqual(calls.map(x=>x[0]),['approveEnrollment','revoke'])});
