import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAuthHandler } from '../src/auth-handler.mjs';

const origin='https://127.0.0.1:12780';
function exchange({url,method='POST',body={},headers={}}, service) {
  const req=new EventEmitter(); req.url=url;req.method=method;req.headers={'content-type':'application/json',origin,...headers};req.socket={remoteAddress:'127.0.0.1'};
  req[Symbol.asyncIterator]=async function*(){if(method==='POST')yield Buffer.from(JSON.stringify(body));};
  let status,out,responseHeaders;
  const res={writeHead(s,h){status=s;responseHeaders=h;},end(v){out=JSON.parse(v);}};
  return createAuthHandler(service,origin)(req,res).then(()=>({status,out,headers:responseHeaders}));
}
const service={
  start:async()=>({attemptId:'a',challenge:'b'}),finishPassword:async()=>({capability:'c'}),consumeRoot:async()=>({tag:'t'}),
  finishDevice:async()=>({token:'x'.repeat(43),csrf:'y'.repeat(43),expiresAt:'later'}),
  authenticate:async()=>({csrf:'y'.repeat(43)}),logout:async()=>{},
};
test('ceremony issues host-only cookie and unsafe login enforces Origin/CSRF',async()=>{
  const ceremony=await exchange({url:'/api/v1/ceremony',method:'GET'},service);
  assert.equal(ceremony.status,200);assert.match(ceremony.headers['Set-Cookie'],/^__Host-127v-ceremony=/);
  const csrf=ceremony.out.csrf,cookie=`__Host-127v-ceremony=${csrf}`;
  const ok=await exchange({url:'/api/v1/auth/',body:{username:'person_1',deviceId:'d',request:'r'},headers:{cookie,'x-127v-csrf':csrf}},service);
  assert.equal(ok.status,200);
  const bad=await exchange({url:'/api/v1/auth/',body:{},headers:{cookie,'x-127v-csrf':'wrong'}},service);
  assert.equal(bad.status,400);assert.deepEqual(bad.out,{error:'authentication_failed'});
});
test('v1 ceremony rejects unsafe methods',async()=>{
  const response=await exchange({url:'/api/v1/ceremony'},service);
  assert.equal(response.status,405);assert.deepEqual(response.out,{error:'method_not_allowed'});
});
test('device finish sets secure session cookie and logout clears it',async()=>{
  const ceremony=await exchange({url:'/api/v1/ceremony',method:'GET'},service), ceremonyCsrf=ceremony.out.csrf;
  const made=await exchange({url:`/api/v1/auth/${'a'.repeat(43)}/device-proof`,body:{signature:'s'},headers:{cookie:`__Host-127v-ceremony=${ceremonyCsrf}`,'x-127v-csrf':ceremonyCsrf}},service);
  assert.equal(made.status,200);assert.match(made.headers['Set-Cookie'],/^__Host-127v-session=.*Secure; HttpOnly; SameSite=Strict/);
  const token='x'.repeat(43),csrf='y'.repeat(43);
  const ended=await exchange({url:'/api/v1/session',method:'DELETE',headers:{cookie:`__Host-127v-session=${token}`,'x-127v-csrf':csrf}},service);
  assert.equal(ended.status,200);assert.match(ended.headers['Set-Cookie'],/Max-Age=0/);
});

test('v1 authentication binds the attempt to paths and collapses password/root retrieval',async()=>{
  const calls=[];const id='a'.repeat(43);const v1={...service,
    start:async value=>{calls.push(['start',value]);return{attemptId:id,challenge:'challenge',binding:'binding'}},
    finishPassword:async value=>{calls.push(['password',value]);return{capability:'capability'}},
    consumeRoot:async value=>{calls.push(['root',value]);return{descriptor:'descriptor',envelope:'envelope',tag:'tag'}},
    finishDevice:async value=>{calls.push(['device',value]);return service.finishDevice(value)},
  };
  const begun=await exchange({url:'/api/v1/auth/',body:{username:'person_1',deviceId:'device',request:'request'}},v1);
  assert.equal(begun.status,200);assert.equal(begun.out.csrf.length,43);assert.match(begun.headers['Set-Cookie'],/^__Host-127v-ceremony=/);
  const headers={cookie:`__Host-127v-ceremony=${begun.out.csrf}`,'x-127v-csrf':begun.out.csrf};
  const password=await exchange({url:`/api/v1/auth/${id}/password`,body:{finalization:'final'},headers},v1);
  assert.equal(password.status,200);assert.deepEqual(password.out,{descriptor:'descriptor',envelope:'envelope',tag:'tag'});
  const device=await exchange({url:`/api/v1/auth/${id}/device-proof`,body:{signature:'signature'},headers},v1);
  assert.equal(device.status,200);assert.match(device.headers['Set-Cookie'],/^__Host-127v-session=/);
  assert.deepEqual(calls.map(([name])=>name),['start','password','root','device']);
  assert.equal(calls[1][1].attemptId,id);assert.deepEqual(calls[2][1],{attemptId:id,capability:'capability'});assert.equal(calls[3][1].attemptId,id);
});

test('v1 session deletion requires the authenticated CSRF context',async()=>{
  const denied=await exchange({url:'/api/v1/session',method:'DELETE'},service);assert.equal(denied.status,401);
  const token='x'.repeat(43),csrf='y'.repeat(43);
  const ended=await exchange({url:'/api/v1/session',method:'DELETE',headers:{cookie:`__Host-127v-session=${token}`,'x-127v-csrf':csrf}},service);
  assert.equal(ended.status,200);assert.deepEqual(ended.out,{loggedOut:true});assert.match(ended.headers['Set-Cookie'],/Max-Age=0/);
});
