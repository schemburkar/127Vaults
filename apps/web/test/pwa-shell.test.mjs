import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pwaBuild, PWA_FILES } from '../pwa-build.mjs';

const origin='https://vaults.example';
async function worker() {
  const events={},network=[],cached=[],deleted=[];
  const cache={addAll:async requests=>cached.push(...requests.map(request=>new URL(request.url).pathname)),match:async path=>({cached:path})};
  const self={location:{origin},clients:{get:async()=>({url:`${origin}/?pwa=1`}),claim:async()=>{}},addEventListener:(name,handler)=>events[name]=handler};
  const source=(await readFile(new URL('../service-worker.template.js',import.meta.url),'utf8')).replace('__SHELL_VERSION__','"test"').replace('__SHELL_ASSETS__',JSON.stringify(['/','/app/react-client.js','/wasm/core.wasm']));
  class OriginRequest extends Request {constructor(path,options){super(new URL(path,origin),options)}}
  vm.runInNewContext(source,{self,caches:{open:async()=>cache,keys:async()=>['127vaults-shell-old','unrelated-cache'],delete:async key=>deleted.push(key)},Request:OriginRequest,URL,Set,fetch:async request=>{network.push(request.url);return{network:true}}});
  return{events,network,cached,deleted,self,cache};
}
test('install caches the complete shell and activation only retires this app caches',async()=>{
  const w=await worker();let work;
  w.events.install({waitUntil:promise=>work=promise});await work;
  assert.deepEqual(w.cached,['/','/app/react-client.js','/wasm/core.wasm']);
  w.events.activate({waitUntil:promise=>work=promise});await work;
  assert.deepEqual(w.deleted,['127vaults-shell-old']);
});
test('installed clients get cached shell; ordinary browser navigation uses the network',async()=>{
  const w=await worker();let response;
  w.events.fetch({request:{method:'GET',url:`${origin}/?pwa=1`,mode:'navigate'},clientId:'installed',respondWith:promise=>response=promise});
  assert.equal((await response).cached,'/');
  w.self.clients.get=async()=>({url:`${origin}/`});
  w.events.fetch({request:{method:'GET',url:`${origin}/`,mode:'navigate'},clientId:'browser',respondWith:promise=>response=promise});
  assert.equal((await response).network,true);
});
test('worker never intercepts API, session, writes, admin, external or unlisted paths',async()=>{
  const w=await worker();
  for(const [url,method] of [[`${origin}/api/v1/vaults`,'GET'],[`${origin}/api/v1/auth/`,'POST'],[`${origin}/api/v1/session`,'DELETE'],[`${origin}/admin/`,'GET'],['https://other.example/app/react-client.js','GET'],[`${origin}/unexpected`,'GET'],[`${origin}/`,'POST']])w.events.fetch({request:{url,method},respondWith:()=>assert.fail(`intercepted ${url}`)});
});
test('release shell includes crypto and every external client module; versions change with application code',()=>{
  const plugin=pwaBuild(),emitted=[];
  const build=code=>{emitted.length=0;plugin.generateBundle.call({emitFile:value=>emitted.push(value)},{},{'app/react-client.js':{type:'chunk',code},'index.html':{type:'asset',source:'<html></html>'}});return emitted.find(asset=>asset.fileName==='sw.js').source};
  const first=build('first'),second=build('second');assert.notEqual(first,second);
  for(const [path]of PWA_FILES)assert.ok(second.includes(`/${path}`),path);
  assert.doesNotMatch(second,/__SHELL_/);assert.match(second,/manifest.webmanifest/);assert.match(second,/icon-512.png/);
});
test('offline readiness checks actual cached assets and repairs a partially removed shell',async()=>{
  const w=await worker();let repaired=false,reply,work;
  w.cache.match=async path=>path==='/wasm/core.wasm'&&!repaired?undefined:{cached:path};
  w.cache.addAll=async requests=>{w.cached.push(...requests.map(request=>new URL(request.url).pathname));repaired=true};
  w.events.message({data:{type:'127vaults-check-shell'},ports:[{postMessage:value=>reply=value}],waitUntil:promise=>work=promise});await work;
  assert.equal(reply.ready,true);assert.deepEqual(w.cached,['/wasm/core.wasm']);
});
test('a worker registration cannot claim offline readiness when shell repair fails',async()=>{
  const w=await worker();let reply,work;w.cache.match=async()=>undefined;w.cache.addAll=async()=>{throw Error('offline')};
  w.events.message({data:{type:'127vaults-check-shell'},ports:[{postMessage:value=>reply=value}],waitUntil:promise=>work=promise});await work;
  assert.equal(reply.ready,false);
});

test('shared metadata is emitted transitively and changing it invalidates the offline shell', () => {
  const build = changed => {
    const emitted = [];
    const plugin = pwaBuild({ read: (url, ...args) => {
      const bytes = readFileSync(url, ...args);
      return changed && url.pathname.endsWith('/passkey-metadata.mjs') ? Buffer.concat([Buffer.from(bytes), Buffer.from('\n// synthetic new revision\n')]) : bytes;
    } });
    plugin.generateBundle.call({ emitFile: asset => emitted.push(asset) }, {}, {});
    return new Map(emitted.map(asset => [asset.fileName, asset.source]));
  };
  const initial = build(false), changed = build(true);
  assert.match(String(initial.get('app/passkeys.mjs')), /\.\/shared\/passkey-metadata\.mjs/);
  assert.ok(initial.has('app/shared/passkey-metadata.mjs'));
  assert.match(String(initial.get('sw.js')), /app\/shared\/passkey-metadata\.mjs/);
  assert.notEqual(initial.get('sw.js'), changed.get('sw.js'));
});
