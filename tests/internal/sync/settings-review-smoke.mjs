// Packaged Windows/Linux clients, pinned TLS and the owned fictitious server.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
const [work,winExe,winProfile,linuxExe,linuxProfile]=process.argv.slice(2);
for(const path of [work,winExe,winProfile,linuxExe,linuxProfile])assert.ok(path&&isAbsolute(path));
assert.equal(process.platform,'win32');
const fixture='14725fef-f5b4-4cb8-afe0-77aa3d80b268',keyring='/home/vaults-dev/vaults-internal-keyring-20261012-a';
function run(program,args,input='') {return new Promise((resolve,reject)=>{
 const child=spawn(program,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>{child.kill();reject(Error('Owned settings command timed out'));},60000);
 child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);
 child.on('close',code=>{clearTimeout(timer);code?reject(Error(err.trim())):resolve(out.trim());});child.stdin.end(input);
});}
const clients=[{os:'windows',exe:winExe,profile:winProfile},{os:'linux',exe:linuxExe,profile:linuxProfile}];
const linuxArgs=args=>['-d','Ubuntu-24.04','-u','vaults-dev','--exec','bash','-lc','export XDG_DATA_HOME='+keyring+'; export DBUS_SESSION_BUS_ADDRESS="$(cat "$1/../dbus-address")"; shift; exec "$@"','vaults-settings-fixture',linuxProfile,...args];
const bytes=async(client,path)=>client.os==='windows'?readFile(path):Buffer.from(await run('wsl.exe',linuxArgs(['base64','-w0',path])),'base64');
for(const client of clients){const conf=(await bytes(client,client.profile+'/device.conf')).toString();assert.ok(conf.includes('username=owner_127\n')&&conf.includes('server_id='+fixture+'\n'));client.device=/^device_id=(.+)$/m.exec(conf)[1];}
assert.notEqual(clients[0].device,clients[1].device);
async function start(client){
 const args=[client.exe,'agent-serve','--username','owner_127','--config-dir',client.profile];
 const child=client.os==='windows'?spawn(client.exe,args.slice(1),{windowsHide:true,stdio:['pipe','pipe','pipe']}):spawn('wsl.exe',linuxArgs(args),{windowsHide:true,stdio:['pipe','pipe','pipe']});client.agent=child;
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned agent readiness timed out')),60000);let ready=false;
 let agentError='';child.stdout.on('data',chunk=>{if(String(chunk).includes('ready')){ready=true;clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>agentError+=chunk);child.on('error',reject);child.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Owned '+client.os+' agent failed: '+agentError.slice(-1500)));});
 child.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
 await command(client,['device','list']);
}
async function command(client,args){const full=[client.exe,...args,'--config-dir',client.profile];return client.os==='windows'?run(full[0],full.slice(1)):run('wsl.exe',linuxArgs(full));}
const json=async(client,args)=>JSON.parse(await command(client,args));
async function stop(client){if(!client.agent)return;await command(client,['lock']).catch(()=>{});if(client.agent.exitCode===null)client.agent.kill();client.agent=null;}
const arm=async(deny=false,status=503,denyMethods=['PUT'])=>writeFile(join(work,'arm.json'),JSON.stringify({fixtureServer:fixture,deny,status,denyMethods})+'\n');
const state=value=>({names:value.names,collections:value.collections,defaultView:value.defaultView??{kind:'all'},removalPreference:value.removalPreference});
async function accept(client){await command(client,['vault','settings-sync']);const s=await json(client,['vault','settings']);assert.equal(s.pending,false,'Never discard an existing settings draft');if(s.conflict)await command(client,['vault','settings-resolve','--keep','server']);return json(client,['vault','settings']);}
const setView=(client,view)=>command(client,['vault','default-view',view.kind,...(view.id?[view.id]:[])]);
async function itemQueues(client){const dir=client.profile+'/replicas';const names=client.os==='windows'?await readdir(dir):(await run('wsl.exe',linuxArgs(['ls','-1',dir]))).split('\n');const result={};for(const name of names.filter(name=>name.endsWith('.json')).sort())result[name]=JSON.parse((await bytes(client,dir+'/'+name)).toString()).pending;return result;}
const cases=[];
try{
 await arm();for(const client of clients)await start(client);
 const baseline=state(await accept(clients[0]));assert.deepEqual(state(await accept(clients[1])),baseline);
 await writeFile(join(work,'baseline.json'),JSON.stringify({fixtureServer:fixture,settings:baseline},null,2)+'\n',{flag:'wx'});
 for(const local of clients){const peer=clients.find(client=>client!==local);
  for(const keep of ['server','local']){
   await accept(local);await accept(peer);const originalQueues=await itemQueues(local);
   const localView=baseline.defaultView.kind==='all'?{kind:'vault',id:'ba855503-c52c-435c-8c0f-d46b6254ae51'}:{kind:'all'};
   await arm(true,503,['PUT']);await setView(local,localView);const pending=await bytes(local,local.profile+'/vault-settings.json');assert.equal((await json(local,['vault','settings'])).pending,true);
   await arm();await setView(peer,baseline.defaultView);await command(local,['vault','settings-sync']);let review=await json(local,['vault','settings-review']);assert.equal(review.localPending,true);assert.deepEqual(review.local.default_view,localView);
   for(const status of [401,403]){
    await arm(true,status,['GET']);await assert.rejects(command(local,['vault','settings-resolve','--keep',keep]),new RegExp(String(status)));
    const statusValue=await json(local,['status','--json']);assert.equal(statusValue.online,false);assert.equal(statusValue.authenticated,false);assert.equal(statusValue.unlocked,true);
    assert.deepEqual(await bytes(local,local.profile+'/vault-settings.json'),pending);assert.deepEqual(await itemQueues(local),originalQueues);
    await arm();await stop(local);await start(local);await command(local,['vault','settings-sync']);review=await json(local,['vault','settings-review']);assert.equal(review.localPending,true);
   }
   await setView(peer,baseline.defaultView);await assert.rejects(command(local,['vault','settings-resolve','--keep',keep]),/server vault settings changed; review the conflict again/);
   assert.deepEqual(await bytes(local,local.profile+'/vault-settings.json'),pending);assert.deepEqual(await itemQueues(local),originalQueues);
   const updated=await json(local,['vault','settings-review']);assert.notEqual(updated.serverRevision,review.serverRevision);assert.equal(updated.localPending,true);
   const result=await json(local,['vault','settings-resolve','--keep',keep]);assert.equal(result.pending,false);assert.equal(result.conflict,false);assert.deepEqual(state(result),{...baseline,defaultView:keep==='local'?localView:baseline.defaultView});assert.deepEqual(await itemQueues(local),originalQueues);
   assert.deepEqual(state(await accept(peer)),state(result));await setView(peer,baseline.defaultView);assert.deepEqual(state(await accept(local)),baseline);assert.deepEqual(state(await accept(peer)),baseline);
   cases.push({writer:local.os,keep,passed:true,checks:['401 and 403 at explicit resolution preserve encrypted pending bytes and item queues','Healthy restart retains the draft','Newer authenticated server revision requires renewed review','Updated explicit choice succeeds and distinct OS peer converges','Original settings restored and item queues unchanged']});
   await writeFile(join(work,'native-evidence.json'),JSON.stringify({status:cases.length===4?'passed':'in-progress',fixtureServer:fixture,cases,scope:'Actual packaged agents with pinned TLS/PostgreSQL; refusals injected only after upstream authentication; no device revoked'},null,2)+'\n');console.log(local.os+' settings '+keep+' review revalidation passed.');
  }
 }
}finally{await arm();for(const client of clients)await stop(client);}
