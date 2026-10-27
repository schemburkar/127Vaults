import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { once } from 'node:events';
import { createRelayIngress, requestSource, parseRelayPreface } from '../src/relay-ingress.mjs';
import { createPrivateRelay } from '../src/private-relay.mjs';

test('relay metadata retains distinct sources and ignores caller forwarding headers',async t=>{
  const backend=createServer((req,res)=>res.end(requestSource(req)));
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const ingress=createRelayIngress({targetPort:backend.address().port,trustedRelayPeer:'127.0.0.2'});
  ingress.listen(0,'127.0.0.1');await once(ingress,'listening');
  const relay=createPrivateRelay({bind:'127.0.0.1',backendBind:'127.0.0.2',target:'127.0.0.1',targetPort:ingress.address().port,port:0,sourceMetadata:true});
  await relay.start();
  t.after(async()=>{await relay.stop();await ingress.stop();backend.closeAllConnections();await new Promise(done=>backend.close(done));});
  const read=(port,localAddress)=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,localAddress,headers:{'x-forwarded-for':'198.51.100.5',forwarded:'for=198.51.100.5'},agent:false},res=>{
      let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve(body));
    });req.on('error',reject);req.end();
  });
  assert.equal(await read(relay.address().port,'127.0.0.3'),'127.0.0.3');
  assert.equal(await read(relay.address().port,'127.0.0.4'),'127.0.0.4');
  assert.equal(await read(ingress.address().port,'127.0.0.5'),'127.0.0.5');
});

test('relay preface validates address family, destination and port',()=>{
  const socket={localAddress:'172.28.42.2',localPort:12780};
  assert.equal(parseRelayPreface('PROXY TCP4 192.0.2.5 172.28.42.2 12345 12780\r\n',socket),'192.0.2.5');
  for(const line of [
    'PROXY TCP4 192.0.2.5 172.28.42.3 12345 12780\r\n',
    'PROXY TCP4 192.0.2.5 172.28.42.2 12345 12781\r\n',
    'PROXY TCP4 ::1 172.28.42.2 12345 12780\r\n',
    'PROXY TCP4 192.0.2.5 172.28.42.2 65536 12780\r\n',
    'PROXY UNKNOWN\r\n'
  ])assert.throws(()=>parseRelayPreface(line,socket));
});
