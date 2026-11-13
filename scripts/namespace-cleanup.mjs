import { lstat, readdir, readFile, mkdir, rmdir, rm, unlink } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertNamespacePath } from './runtime-namespace.mjs';
const exec=promisify(execFile);
const command=async(program,args,env)=>{const {stdout}=await exec(program,args,{env,windowsHide:true,maxBuffer:4*1024*1024});return stdout.trim();};
const exists=async path=>lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});

export async function cleanupInventory(namespace, { alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}} }={}) {
  await assertNamespacePath(namespace,namespace.root,{owned:true});
  const files=[],profiles=[],active=[];
  async function walk(path) {
    await assertNamespacePath(namespace,path,{owned:true});
    const info=await lstat(path);
    if(!info.isDirectory()) {files.push(path);return;}
    const names=await readdir(path);
    if(names.includes('device.conf'))profiles.push(path);
    for(const name of names)await walk(join(path,name));
  }
  await walk(namespace.root);
  for(const file of files.filter(path=>dirname(path)===join(namespace.root,'processes')&&basename(path).endsWith('.json'))) {
    const record=JSON.parse(await readFile(file,'utf8'));
    if(record.namespace!==namespace.id||!Number.isSafeInteger(record.pid)||record.pid<1)throw Error('Invalid namespace process record');
    if(alive(record.pid))active.push(record.pid);
  }
  return {namespace:namespace.id,root:namespace.root,profiles,files:files.length,activeProcesses:active,project:namespace.project,nativeHost:namespace.nativeHost};
}

async function containerResources(namespace,engine,run=command) {
  const result={containers:[],volumes:[],networks:[]};
  for(const label of ['com.docker.compose.project','io.podman.compose.project']) {
    for(const [kind,args] of [['containers',['ps','-a']],['volumes',['volume','ls']],['networks',['network','ls']]]) {
      const output=await run(engine,[...args,'--filter',`label=${label}=${namespace.project}`,'--format','json']);
      const rows=output.trim().startsWith('[')?JSON.parse(output):output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
      for(const row of rows) {
        const id=kind==='volumes'?row.Name??row.name:row.Id??row.ID??row.id;
        if(typeof id!=='string'||!/^[a-zA-Z0-9_.-]+$/.test(id))throw Error('Unexpected container resource identity');
        if(kind==='containers'&&!['exited','stopped','created','configured'].includes(String(row.State??row.state).toLowerCase()))throw Error('Stop the selected namespace containers before cleanup');
        if(!result[kind].includes(id))result[kind].push(id);
      }
    }
  }
  return result;
}

async function registrations(namespace,remove,run=command) {
  if(process.platform==='win32') {
    const output=await run('pwsh',['-NoProfile','-File',resolve(import.meta.dirname,'namespace-registrations.ps1'),'-HostName',namespace.nativeHost,...(remove?['-Remove']:[])]);
    return output?JSON.parse(output):[];
  }
  const config=dirname(dirname(namespace.root)),result=[];
  for(const browser of ['google-chrome','chromium','microsoft-edge']) {
    const file=join(config,browser,'NativeMessagingHosts',namespace.nativeHost+'.json');
    if(!await exists(file))continue;
    for(let path=file;;path=dirname(path)) {
      const info=await lstat(path);if(info.isSymbolicLink())throw Error('Connector registration uses a redirected path');
      if(path===dirname(path))break;
    }
    const value=JSON.parse(await readFile(file,'utf8'));
    if(value.name!==namespace.nativeHost)throw Error('Connector registration ownership mismatch');
    result.push(file);if(remove)await unlink(file);
  }
  return result;
}

export async function cleanupNamespace(namespace,{confirm=false,engine='podman',cli,env=process.env,run=command,resources=containerResources,connector=registrations,alive}={}) {
  if(namespace.production)throw Error('Production cleanup is refused');
  if(!['podman','docker'].includes(engine))throw Error('Choose podman or docker');
  const inventory=await cleanupInventory(namespace,{alive});
  const owned=await resources(namespace,engine,run);
  const connectors=await connector(namespace,false,run);
  const plan={...inventory,resources:owned,registrations:connectors,confirmed:confirm};
  if(!confirm)return plan;
  if(inventory.activeProcesses.length)throw Error('Stop the selected namespace apps and agents before cleanup');
  if(!cli&&inventory.profiles.length)throw Error('Supply --cli with the namespace-aware CLI to remove protected credentials');
  const lock=join(namespace.root,'cleanup.lock');await mkdir(lock);
  try {
    const checked=await cleanupInventory(namespace,{alive});
    if(checked.activeProcesses.length)throw Error('Namespace process started; cleanup cancelled');
    for(const profile of checked.profiles) {
      const result=JSON.parse(await run(cli,['namespace-credentials','--config-dir',profile,'--confirm'],{...env,...namespace.environment}));
      if(result.namespace!==namespace.id||result.removed!==true)throw Error('Protected credential cleanup not confirmed');
    }
    await connector(namespace,true,run);
    // Resolve and inspect every target again before removing only labelled resources.
    const latest=await resources(namespace,engine,run);
    if(JSON.stringify(latest)!==JSON.stringify(owned))throw Error('Container resources changed; retry cleanup preview');
    for(const id of owned.containers)await run(engine,['rm',id]);
    for(const id of owned.volumes)await run(engine,['volume','rm',id]);
    for(const id of owned.networks)await run(engine,['network','rm',id]);
    await cleanupInventory(namespace,{alive});
    // Walked paths have no symlinks/junctions and the namespace marker matches.
    await rm(namespace.root,{recursive:true});
    return {...plan,removed:true};
  } finally {if(await exists(lock))await rmdir(lock);}
}
