// Only the owned new lifecycle project's accepted copy/removal responses can drop.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer,request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(await readFile('/evidence/fixture.json','utf8'));
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.origin,'https://127.0.0.1:12898');
const [cert,key,ca]=await Promise.all(['live/server.crt','live/server.key','ca/ca.crt'].map(path=>readFile('/identity/'+path)));
const dropped=new Set(),attempts=[];
const recordName=process.env.VAULTS_MOVE_PROXY_RECORD??'proxy-evidence.json';assert.ok(['proxy-evidence.json','guard-proxy-evidence.json','early-abort-proxy-evidence.json','revocation-proxy-evidence.json','linux-final-proxy-evidence.json'].includes(recordName));
const server=createServer({cert,key,minVersion:'TLSv1.2'},async(incoming,outgoing)=>{try{
 assert.equal(incoming.headers.host,'127.0.0.1:12898');const chunks=[];let size=0;for await(const chunk of incoming){size+=chunk.length;assert.ok(size<=16*1024*1024);chunks.push(chunk);}const bytes=Buffer.concat(chunks),arm=JSON.parse(await readFile('/evidence/arm.json','utf8'));assert.equal(arm.serverId,fixture.serverId);
 if(arm.tag!==undefined)assert.match(arm.tag,/^[a-z-]{1,40}$/);
 const selected=incoming.method==='POST'&&(arm.mode==='drop-copy'&&incoming.url===`/api/v1/vaults/${arm.destination}/items`||arm.mode==='drop-final'&&incoming.url===`/api/v1/vaults/${arm.source}/removal`);
 if(selected){assert.match(arm.source,/^[a-f0-9-]{36}$/);assert.match(arm.destination,/^[a-f0-9-]{36}$/);}
 const upstream=request({hostname:'server',port:12898,path:incoming.url,method:incoming.method,headers:incoming.headers,ca,servername:'',timeout:30000,checkServerIdentity:(_name,peer)=>checkServerIdentity('127.0.0.1',peer)},response=>{const parts=[];let responseSize=0;response.on('data',chunk=>{responseSize+=chunk.length;if(responseSize>16*1024*1024)response.destroy();else parts.push(chunk);});response.on('end',async()=>{try{
  if(selected){const body=JSON.parse(bytes),group=arm.mode+':'+arm.source+':'+(arm.tag??'');const drop=response.statusCode===200&&!dropped.has(group);attempts.push({mode:arm.mode,tag:arm.tag,source:arm.source,path:incoming.url,status:response.statusCode,requestId:body.requestId,operationId:body.signedOperation?.opId,sha256:createHash('sha256').update(bytes).digest('hex'),replyDropped:drop});if(drop)dropped.add(group);await writeFile('/evidence/'+recordName,JSON.stringify({serverId:fixture.serverId,attempts},null,2)+'\n');if(drop){outgoing.destroy();return;}}
  outgoing.writeHead(response.statusCode,response.headers);outgoing.end(Buffer.concat(parts));
 }catch{outgoing.destroy();}});response.on('error',()=>outgoing.destroy());});upstream.on('error',()=>outgoing.destroy());upstream.on('timeout',()=>upstream.destroy());upstream.end(bytes);
}catch{outgoing.destroy();}});
server.listen(12898,'0.0.0.0',()=>console.log('Owned isolated move proxy ready.'));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
