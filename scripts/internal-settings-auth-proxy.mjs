// Authorized fixture response injection; no real device is revoked or mutated.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer,request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
const fixture='14725fef-f5b4-4cb8-afe0-77aa3d80b268';assert.equal((await readFile('/identity/installation-id','utf8')).trim(),fixture);
const [cert,key,ca]=await Promise.all(['live/server.crt','live/server.key','ca/ca.crt'].map(path=>readFile('/identity/'+path)));const refusals=[];
function upstream(method,path,headers,body){return new Promise((resolve,reject)=>{const req=request({hostname:'server',port:12892,method,path,headers,ca,servername:'',timeout:30000,checkServerIdentity:(_name,peer)=>checkServerIdentity('127.0.0.1',peer)},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024)res.destroy();else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.on('timeout',()=>req.destroy());req.end(body);});}
const server=createServer({cert,key,minVersion:'TLSv1.2'},async(incoming,outgoing)=>{try{
 assert.equal(incoming.headers.host,'127.0.0.1:12892');let size=0;const chunks=[];for await(const chunk of incoming){size+=chunk.length;assert.ok(size<=16*1024*1024);chunks.push(chunk);}const arm=JSON.parse(await readFile('/evidence/arm.json','utf8'));assert.equal(arm.fixtureServer,fixture);
 if(arm.denyMethods!==undefined)assert.ok(Array.isArray(arm.denyMethods)&&arm.denyMethods.every(method=>['GET','PUT'].includes(method)));
 const deny=arm.deny===true&&incoming.url==='/api/v1/vault-settings'&&(!arm.denyMethods||arm.denyMethods.includes(incoming.method));const headers={...incoming.headers};if(deny){delete headers['content-length'];delete headers['transfer-encoding'];}
 const response=await upstream(deny?'GET':incoming.method,incoming.url,headers,deny?Buffer.alloc(0):Buffer.concat(chunks));
 if(deny&&response.status===200){assert.ok([401,403,503].includes(arm.status));refusals.push({method:incoming.method,path:incoming.url,status:arm.status,upstreamAuthorized:true});await writeFile('/evidence/refusals.json',JSON.stringify({fixtureServer:fixture,refusals},null,2)+'\n');outgoing.writeHead(arm.status,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:arm.status===503?'unavailable':'unauthorized'}));return;}
 outgoing.writeHead(response.status,response.headers);outgoing.end(response.body);
}catch{outgoing.destroy();}});server.listen(12892,'0.0.0.0',()=>console.log('Owned settings authorization proxy ready.'));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
