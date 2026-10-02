import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';

const endpoint=process.argv[2],caPath=process.argv[3];
if(!endpoint||!caPath)throw Error('Usage: node scripts/live-transport-acceptance.mjs <https-url> <ca.crt>');
const url=new URL(endpoint),ca=await readFile(caPath);
function probe({host=url.hostname,servername=''}={}){return new Promise(resolve=>{const req=request({hostname:url.hostname,port:url.port,path:'/health/live',method:'GET',ca,servername,headers:{host:`${host}:${url.port}`},timeout:5000},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}))});req.on('error',error=>resolve({error}));req.on('timeout',()=>req.destroy(new Error('timeout')));req.end()})}
assert.equal((await probe()).status,200);
assert.equal((await probe({host:'localhost'})).status,403);
assert.ok((await probe({servername:'localhost'})).error);
console.log(JSON.stringify({ok:true,verifiedTls:true,exactHost:true,wrongSniRejected:true}));
