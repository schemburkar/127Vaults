// Repeatable offline security checks. Dedicated PostgreSQL, isolated loopback,
// read-only source/toolchain, allowlisted environments and bounded scratch.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const name=`127v-security-${randomUUID()}`;
const engine=process.env.VAULTS_CONTAINER_ENGINE??'podman';
if(!['podman','docker'].includes(engine))throw Error('Unsupported container engine.');
const run=(args,timeout=60000)=>new Promise((resolve,reject)=>{
  const child=spawn(engine,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',b=>{output=(output+b).slice(-512000);});
  child.stderr.on('data',b=>{output=(output+b).slice(-512000);});
  const timer=setTimeout(()=>{child.kill();reject(Error('Container command timed out.'));},timeout);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(output||`Container command failed: ${code}`));});
});
const bounds=['--pull=never','--read-only','--cap-drop=all','--security-opt=no-new-privileges','--pids-limit=128','--cpus=2','--memory=1g',
  '--ulimit=nofile=1024:1024','--ulimit=fsize=134217728:134217728','--ulimit=cpu=600:600','--tmpfs=/scratch:rw,size=256m,mode=1777'];
const safeEnv=['PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin','HOME=/scratch','TMPDIR=/scratch','LANG=C.UTF-8'];
async function sourceDigest() {
  const files=[];
  async function walk(path) {
    for(const entry of await readdir(resolve(root,path),{withFileTypes:true})) {
      if(['node_modules','dist','wasm-auth','wasm'].includes(entry.name))continue;
      const name=`${path}/${entry.name}`;
      if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);
    }
  }
  for(const directory of ['apps/server','apps/web','packages/sync','scripts/ops','deploy'])await walk(directory);
  files.push('scripts/security-regression.mjs','scripts/live-mvp-acceptance.mjs','scripts/live-invite-acceptance.mjs');
  const hash=createHash('sha256');
  for(const path of files.sort())hash.update(path).update('\0').update(await readFile(resolve(root,path)));
  return hash.digest('hex');
}
const before=await sourceDigest();
try {
  await run(['run','-d','--name',name,'--network=none',...bounds,'--user=postgres','--entrypoint=/usr/bin/timeout',
    'docker.io/library/postgres:17-bookworm','900','env','-i',...safeEnv,'PGDATA=/scratch/pgdata',
    'sh','-c','initdb -D /scratch/pgdata --auth=trust --no-locale && exec postgres -D /scratch/pgdata -c unix_socket_directories=/scratch -c listen_addresses=127.0.0.1']);
  let ready=false;
  for(let i=0;i<30;i++){
    try { await run(['exec',name,'env','-i',...safeEnv,'pg_isready','-h','127.0.0.1','-U','postgres','-d','vaults_security']);ready=true;break; }
    catch { await new Promise(done=>setTimeout(done,500)); }
  }
  if(!ready)throw Error(`Disposable PostgreSQL did not become ready.\n${await run(['logs',name])}`);
  await run(['exec',name,'env','-i',...safeEnv,'createdb','-h','127.0.0.1','-U','postgres','vaults_security']);
  for(const database of ['vaults_devices','vaults_removal','vaults_deletion'])await run(['exec',name,'env','-i',...safeEnv,'createdb','-h','127.0.0.1','-U','postgres',database]);
  const mounts=['apps/server','apps/web','packages','scripts','deploy','docs'].flatMap(path=>['--volume',`${resolve(root,path)}:/app/${path}:ro`]);
  const args=['run','--rm','--name',`${name}-tests`,'--network',`container:${name}`,...bounds,...mounts,'--workdir=/app','--entrypoint=/usr/bin/timeout',
    'localhost/127vaults-server:test','600','env','-i',...safeEnv,
    'VAULTS_SECURITY_DATABASE_URL=postgres://postgres:security-test-only@127.0.0.1:5432/vaults_security',
    'VAULTS_DEVICE_TEST_DATABASE_URL=postgres://postgres:security-test-only@127.0.0.1:5432/vaults_devices',
    'VAULTS_TEST_DATABASE_URL=postgres://postgres:security-test-only@127.0.0.1:5432/vaults_removal',
    'VAULTS_ITEM_DELETION_DATABASE_URL=postgres://postgres:security-test-only@127.0.0.1:5432/vaults_deletion',
    'sh','-c',"node --test apps/server/test/*.test.mjs apps/web/test/mvp-client.test.mjs apps/web/test/http-client.test.mjs packages/sync/test/*.test.mjs deploy/upgrade.test.mjs scripts/ops/server-data.test.mjs && node --check apps/server/src/main.mjs && node --check apps/web/mvp-client.mjs && node --check scripts/live-mvp-acceptance.mjs && node --check scripts/live-invite-acceptance.mjs"];
  const output=await run(args,660000);
  if(await sourceDigest()!==before)throw Error('Source changed during verification; repeat the check.');
  process.stdout.write(output);
  const number=label=>Number(new RegExp(`ℹ ${label} (\\d+)`).exec(output)?.[1]);
  const receipt={checkedAt:new Date().toISOString(),sourceDigest:before,tests:number('tests'),passed:number('pass'),failed:number('fail'),skipped:number('skipped'),
    checks:['server suite','real OPAQUE and disposable PostgreSQL security regressions','browser registration and HTTP tests','signed sync protocol tests','upgrade and backup tests','server, browser and acceptance-client syntax'],
    isolation:{externalNetwork:false,sourceReadOnly:true,emptyEnvironment:true,cpu:2,memory:'1g',processes:128,scratch:'256m',wallSeconds:600}};
  if(!receipt.tests||receipt.failed!==0)throw Error('Verification summary was not successful.');
  await writeFile(resolve(root,'docs/security/server-hardening-verification.json'),JSON.stringify(receipt,null,2)+'\n');
} finally {
  await run(['rm','-f',`${name}-tests`]).catch(()=>{});
  await run(['rm','-f',name]).catch(()=>{});
}
