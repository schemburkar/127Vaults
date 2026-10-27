import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { containRequestErrors } from '../src/http-boundary.mjs';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { RegistrationAdapter } from '../src/opaque-adapter.mjs';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createCredentialRotationHandler } from '../src/credential-rotation.mjs';

test('request boundary contains sync and async failures and serves the next request',async()=>{
  for(const failure of [()=>{throw Error('private detail')},async()=>{throw Error('private detail')}]){
    let body,status;
    const done=new Promise(resolve=>{
      containRequestErrors(failure)({}, {writeHead(s){status=s},end(value){body=value;resolve()},destroy(){resolve()}});
    });await done;assert.equal(status,503);assert.deepEqual(JSON.parse(body),{error:'unavailable'});
  }
  let delivered=false;containRequestErrors(async()=>{delivered=true})({},{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(delivered,true);
});

test('aborted unauthenticated admin request is caught inside the handler',async()=>{
  const handler=createAdminHandler({pool:{},operators:[{username:'owner'}],origin:'https://localhost'});
  const req=new Readable({read(){this.destroy(Error('aborted'));}});
  Object.assign(req,{method:'POST',url:'/api/admin/session',headers:{origin:'https://localhost','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
  assert.equal(await handler(req,{writeHead(){},end(){}}),true);
});

test('interrupted admin HTTP body leaves the listener alive for another request',{timeout:5000},async()=>{
  let origin,accepted;
  const received=new Promise(resolve=>{accepted=resolve});
  const admin=createAdminHandler({pool:{},operators:[{username:'owner'}],origin:'http://127.0.0.1'});
  const server=createServer(containRequestErrors(async(req,res)=>{
    if(req.url==='/api/admin/session') { req.headers.origin='http://127.0.0.1';accepted();await admin(req,res); }
    else {res.writeHead(200);res.end('alive');}
  }));
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
    const client=request(`${origin}/api/admin/session`,{method:'POST',headers:{origin:'http://127.0.0.1','content-type':'application/json','content-length':'1024'}});
    client.on('error',()=>{});client.write('{');await received;client.destroy();
    const next=await fetch(`${origin}/health/live`);assert.equal(await next.text(),'alive');
  } finally {server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('registration rejects missing or denied authorization before OPAQUE evaluation',async()=>{
  let calls=0;
  const config={opaque:{serverRegistrationStart(){calls++;return Buffer.alloc(64)}},setup:Buffer.alloc(96),installation:'11111111-1111-4111-8111-111111111111',serverPublicKey:Buffer.alloc(32),tokenKey:Buffer.alloc(32),origin:'https://localhost'};
  const input={accountId:'22222222-2222-4222-8222-222222222222',deviceId:'33333333-3333-4333-8333-333333333333',request:Buffer.alloc(32).toString('base64url')};
  await assert.rejects(new RegistrationAdapter(config).start(input));
  await assert.rejects(new RegistrationAdapter({...config,authorizeStart:async()=>{throw Error('denied')}}).start(input));
  assert.equal(calls,0);
  const registration=new RegistrationAdapter({...config,authorizeStart:async()=>{}});
  const result=await registration.start(input);
  const candidate={...input,registrationArtifact:result.registrationArtifact};
  assert.equal(registration.verifyArtifact(candidate).purpose,'enrollment');
  assert.throws(()=>registration.verifyArtifact(candidate,'password-rotation'));
});

test('rotation HTTP requires current CSRF and uses the authenticated account, not a body identity',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111',deviceId='22222222-2222-4222-8222-222222222222';
  const auth={accountId,deviceId,sessionId:'session',csrf:'csrf'},calls=[];
  const handler=createCredentialRotationHandler({origin:'https://localhost',authenticate:async()=>auth,
    store:{async prepare(principal){assert.equal(principal,auth);return 2}},
    registration:{async startRotation(input,scope){calls.push({input,scope});return {registrationArtifact:'artifact'}}}});
  async function exchange(value,csrf='csrf'){
    const req=Readable.from([Buffer.from(JSON.stringify(value))]);
    Object.assign(req,{method:'POST',url:'/api/v1/devices/rotate-password/start',headers:{origin:'https://localhost','content-type':'application/json',cookie:'__Host-127v-session=token','x-127v-csrf':csrf}});
    const response={writeHead(status){this.status=status},end(value){this.body=JSON.parse(value)}};
    assert.equal(await handler(req,response),true);return response;
  }
  assert.equal((await exchange({request:'opaque',deviceId},'wrong')).status,403);
  assert.equal((await exchange({request:'opaque',deviceId,accountId:'victim'})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await exchange({request:'opaque',deviceId})).status,200);
  assert.equal(calls[0].input.accountId,accountId);assert.equal(calls[0].scope.purpose,'password-rotation');
  assert.equal(calls[0].scope.credentialEpoch,2);
});
