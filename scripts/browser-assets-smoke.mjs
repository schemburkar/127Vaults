import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'node:https';

const origin=process.argv[2]??'https://127.0.0.1:12780';
const ca=await readFile(process.argv[3]??'.tools/acceptance-ca.crt');
function request(path){return new Promise((resolve,reject)=>{get(origin+path,{ca},res=>{let chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))}).on('error',reject)})}
for(const [path,type,minimum]of[['/','text/html',300],['/legacy','text/html',500],['/app/react-client.js','text/javascript',1000],['/app/react-style.css','text/css',1000],['/app/mvp-client.mjs','text/javascript',1000],['/app/passkeys.mjs','text/javascript',1000],['/app/private-vault-client.mjs','text/javascript',500],['/wasm/vaults_browser_fixture.js','text/javascript',1000],['/wasm/vaults_browser_fixture_bg.wasm','application/wasm',10000]]){let r=await request(path);assert.equal(r.status,200,path);assert.match(r.headers['content-type'],new RegExp(type));assert.ok(r.body.length>minimum,path);assert.equal(r.headers['cache-control'],'no-store')}
let page=await request('/');assert.match(page.body.toString(),/id="root"/);assert.match(page.headers['content-security-policy'],/default-src 'none'/);
let client=await request('/app/mvp-client.mjs');assert.doesNotMatch(client.body.toString(),/\.then\(Uint8Array\.from\)/);
let vaultClient=await request('/app/private-vault-client.mjs');assert.match(vaultClient.body.toString(),/fetcher\.bind\(globalThis\)/);
console.log(JSON.stringify({ok:true,httpsAssets:true,noStore:true,csp:true}));
