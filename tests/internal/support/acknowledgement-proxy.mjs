// Replays a genuine pre-write encrypted/signed snapshot after a real TLS write
// acknowledgement. Only the retained fictitious installation is accepted.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer,request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
const fixture='14725fef-f5b4-4cb8-afe0-77aa3d80b268',work='/evidence',identity='/identity';
assert.equal((await readFile(identity+'/installation-id','utf8')).trim(),fixture);
const [cert,key,ca]=await Promise.all(['live/server.crt','live/server.key','ca/ca.crt'].map(path=>readFile(identity+'/'+path)));
const arm=JSON.parse(await readFile(work+'/arm.json','utf8'));assert.equal(arm.fixtureServer,fixture);
for(const id of [arm.vaultId,arm.itemId])assert.match(id,/^[a-f0-9-]{36}$/);
const prefix='/api/v1/vaults/'+arm.vaultId,writePath=prefix+'/items/'+arm.itemId;
const snapshots=new Map();let frozen=false,acknowledgedOperation=null;const replayed=[];
function upstream(method,path,headers,body){return new Promise((resolve,reject)=>{
 const req=request({hostname:'server',port:12892,method,path,headers,ca,servername:'',timeout:30000,checkServerIdentity:(_name,peer)=>checkServerIdentity('127.0.0.1',peer)},res=>{
  let size=0;const parts=[];res.on('data',part=>{size+=part.length;if(size>16*1024*1024)res.destroy();else parts.push(part);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));
 });req.on('error',reject);req.on('timeout',()=>req.destroy());req.end(body);
});}
const server=createServer({cert,key,minVersion:'TLSv1.2'},async(incoming,outgoing)=>{
 try{
  assert.equal(incoming.headers.host,'127.0.0.1:12892');let size=0;const chunks=[];
  for await(const chunk of incoming){size+=chunk.length;assert.ok(size<=16*1024*1024);chunks.push(chunk);}
  const body=Buffer.concat(chunks),path=incoming.url;
  const baselineReady=()=>snapshots.has('/api/v1/vaults')&&(snapshots.has(prefix+'/checkpoint')||[...snapshots.keys()].some(path=>path.startsWith(prefix+'/checkpoint?')))&&[...snapshots.keys()].some(path=>path.startsWith(prefix+'/operations?'));
  if(incoming.method==='PUT'&&path===writePath&&!frozen&&!baselineReady()){
   await writeFile(work+'/proxy-precondition-failure.json',JSON.stringify({fixtureServer:fixture,capturedPaths:[...snapshots.keys()]},null,2)+'\n');outgoing.writeHead(503,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:'FIXTURE_SNAPSHOT_INCOMPLETE'}));return;
  }
  // Authenticate and authorize through the actual upstream for every request.
  // Only its successful GET responses can be replaced by retained snapshots.
  const result=await upstream(incoming.method,path,incoming.headers,body);
  const selected=incoming.method==='GET'&&(path==='/api/v1/vaults'||path.startsWith(prefix+'/'));
  if(selected&&result.status===200&&!frozen){
   snapshots.set(path,{status:result.status,body:result.body});
   if(path===prefix+'/items'){
    const listed=JSON.parse(result.body),hex=Buffer.from(listed.catalogue,'base64url').subarray(44,60).toString('hex');assert.equal(hex.length,32);
    const revision=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    const oldBodyPath=writePath+'?catalogueRevision='+revision;
    const old=await upstream('GET',oldBodyPath,incoming.headers,Buffer.alloc(0));assert.equal(old.status,200);
    snapshots.set(oldBodyPath,{status:200,body:old.body});
   }
  }
  if(incoming.method==='PUT'&&path===writePath&&result.status===200&&!frozen){
   assert.ok(baselineReady());
   assert.ok([...snapshots.keys()].some(path=>path.startsWith(prefix+'/operations?')));
   const mutation=JSON.parse(body);frozen=true;acknowledgedOperation=mutation.signedOperation.opId;
   await writeFile(work+'/snapshot.json',JSON.stringify(Object.fromEntries([...snapshots].map(([path,value])=>[path,{status:value.status,value:JSON.parse(value.body)}])),null,2)+'\n',{flag:'wx'});
   await writeFile(work+'/proxy-evidence.json',JSON.stringify({fixtureServer:fixture,realWriteAcknowledged:true,operationId:acknowledgedOperation,replayed},null,2)+'\n');
  }
  const control=JSON.parse(await readFile(work+'/arm.json','utf8'));
  // The current server refuses an old catalogue body URL after the write. The
  // retained body was authorized and captured before that write. Other auth
  // refusal statuses must never be replaced by snapshot data.
  if(frozen&&control.replay!==false&&selected&&snapshots.has(path)&&(result.status===200||result.status===409&&path.startsWith(writePath+'?catalogueRevision='))){
   const old=snapshots.get(path);replayed.push(path);
   await writeFile(work+'/proxy-evidence.json',JSON.stringify({fixtureServer:fixture,realWriteAcknowledged:true,operationId:acknowledgedOperation,replayed},null,2)+'\n');
   outgoing.writeHead(old.status,{'content-type':'application/json','cache-control':'no-store'});outgoing.end(old.body);return;
  }
  outgoing.writeHead(result.status,result.headers);outgoing.end(result.body);
 }catch{outgoing.destroy();}
});
server.listen(12892,'0.0.0.0',()=>console.log('Owned fictitious acknowledgement proxy ready.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
