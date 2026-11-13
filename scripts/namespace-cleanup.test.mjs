import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeNamespace, prepareNamespace } from './runtime-namespace.mjs';
import { cleanupInventory, cleanupNamespace } from './namespace-cleanup.mjs';
async function fixture(t) {
 const base=await mkdtemp(join(tmpdir(),'127v-cleanup-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const n=runtimeNamespace({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:'cleanup'},{configRoot:base});
 await prepareNamespace(n);await mkdir(n.cliProfile);await writeFile(join(n.cliProfile,'encrypted-replica'),'preserve');
 const production=join(base,'127Vaults');await mkdir(production);await writeFile(join(production,'real-data'),'unchanged');
 return {n,production};
}
const adapters={resources:async()=>({containers:[],volumes:[],networks:[]}),connector:async()=>[]};
test('cleanup understands Docker JSON-lines and refuses running labelled resources',async t=>{
 const {n}=await fixture(t);let running=false;
 const run=async(program,args)=>args[0]==='ps'?JSON.stringify({ID:'abc123',State:running?'running':'exited'}):'';
 const preview=await cleanupNamespace(n,{engine:'docker',run,connector:adapters.connector});
 assert.deepEqual(preview.resources.containers,['abc123']);
 running=true;await assert.rejects(cleanupNamespace(n,{engine:'docker',run,connector:adapters.connector}),/Stop/);
});
test('cleanup previews by default and removes only an owned stopped namespace',async t=>{
 const {n,production}=await fixture(t);
 const plan=await cleanupNamespace(n,adapters);assert.equal(plan.confirmed,false);
 assert.equal(await readFile(join(n.cliProfile,'encrypted-replica'),'utf8'),'preserve');
 const result=await cleanupNamespace(n,{...adapters,confirm:true});assert.equal(result.removed,true);
 await assert.rejects(readFile(join(n.root,'namespace-owner')),{code:'ENOENT'});
 assert.equal(await readFile(join(production,'real-data'),'utf8'),'unchanged');
});
test('cleanup refuses production, live process leases and foreign ownership',async t=>{
 const {n}=await fixture(t);
 await assert.rejects(cleanupNamespace({...n,production:true},adapters),/Production/);
 await mkdir(join(n.root,'processes'));await writeFile(join(n.root,'processes','123.json'),JSON.stringify({namespace:n.id,pid:123}));
 await assert.rejects(cleanupNamespace(n,{...adapters,confirm:true,alive:()=>true}),/Stop/);
 await writeFile(join(n.root,'namespace-owner'),'development');await assert.rejects(cleanupInventory(n),/ownership/);
});
test('cleanup rejects redirected files and requires successful credential removal before deleting a profile',async t=>{
 const {n,production}=await fixture(t);
 try {await symlink(production,join(n.root,'redirect'),process.platform==='win32'?'junction':'dir');}
 catch(error){if(error.code==='EPERM')return;throw error;}
 await assert.rejects(cleanupNamespace(n,{...adapters,confirm:true}),/links|junctions/);
 await rm(join(n.root,'redirect'));
 await writeFile(join(n.cliProfile,'device.conf'),'synthetic');
 await assert.rejects(cleanupNamespace(n,{...adapters,confirm:true}),/--cli/);
 await assert.rejects(cleanupNamespace(n,{...adapters,confirm:true,cli:'fixture-cli',run:async()=>{throw Error('store unavailable');}}),/store unavailable/);
 assert.equal(await readFile(join(n.cliProfile,'encrypted-replica'),'utf8'),'preserve');
});
