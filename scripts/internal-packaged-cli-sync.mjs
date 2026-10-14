// Actual packaged CLI/agent commands on explicit fictitious profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const [phase,executable,profile,evidencePath]=process.argv.slice(2);
assert.ok(['write','peer','verify','queue','replay','ui-peer'].includes(phase));
for(const path of [executable,profile,evidencePath])assert.ok(path&&isAbsolute(path),'Explicit absolute fixture paths required');
assert.match(basename(executable),/^127vaults(?:\.exe)?$/);
const server='14725fef-f5b4-4cb8-afe0-77aa3d80b268';
const device=await readFile(profile+'/device.conf','utf8');
assert.ok(device.includes('username=owner_127\n')&&device.includes(`server_id=${server}\n`),'Only enrolled fictitious profiles are accepted');
const deviceId=/^device_id=(.+)$/m.exec(device)?.[1];assert.ok(deviceId);
async function command(args,input=''){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[...args,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('Fixture CLI command timed out'));},60000);
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(`Fixture CLI ${args[0]} failed: ${error.trim()}`));else resolve(output.trim());});child.stdin.end(input);
 });
}
let evidence=['write','queue'].includes(phase)?{fixtureServer:server,title:'Packaged CLI cross-OS '+randomUUID(),writerOS:process.platform,writerDevice:deviceId}:JSON.parse(await readFile(evidencePath,'utf8'));
assert.equal(evidence.fixtureServer,server);assert.ok(evidence.title.startsWith('Packaged CLI cross-OS ')||phase==='ui-peer'&&evidence.title.startsWith('Linux packaged queue '));
if(['peer','ui-peer'].includes(phase))assert.notEqual(deviceId,evidence.writerDevice,'Distinct fixture peer required');
const agent=spawn(executable,['agent-serve','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let agentReady=false,agentError='';
try{
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture agent startup timed out')),60000);
  agent.stdout.on('data',data=>{if(String(data).includes('ready')){agentReady=true;clearTimeout(timer);resolve();}});
  agent.stderr.on('data',data=>agentError+=data);
  agent.on('error',error=>{clearTimeout(timer);reject(error);});agent.on('close',()=>{clearTimeout(timer);if(!agentReady)reject(Error('Fixture agent failed: '+agentError.trim()));});
  agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');
 });
 if(phase==='replay'){
  const synced=JSON.parse(await command(['sync']));assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
 }
 if(phase==='ui-peer'){
  assert.equal(evidence.items.length,2);
  const listed=JSON.parse(await command(['item','list','--all']));
  for(const row of evidence.items){
   assert.ok(row.title.startsWith('Linux packaged queue '));
   assert.equal(listed.filter(item=>item.title===row.title).length,1);
   const value=JSON.parse(await command(['item','get',row.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,row.title);assert.equal(value.username,'');assert.equal(value.website,'');assert.equal(value.password,'[redacted]');
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),'synthetic-ui-queue-password');
  }
  evidence.peerOS=process.platform;evidence.peerDevice=deviceId;
 }else if(['write','queue'].includes(phase)){
  const vaults=JSON.parse(await command(['vault','list']));
  evidence.vaultId=vaults.find(row=>row.retired!==true).vaultId;
  const made=JSON.parse(await command(['item','create','--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.title,website:'https://packaged-cli.invalid',username:'fixture-writer',password:'fixture-packaged-password'})+'\n'));
  evidence.itemId=made.itemId;assert.ok(evidence.itemId);
  if(phase==='queue'){
   assert.equal(made.queued,true,'The fixture must really be offline');
   evidence.title+=' edited offline';
   const edited=JSON.parse(await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.title,website:'https://packaged-cli.invalid',username:'fixture-writer',password:'fixture-packaged-password'})+'\n'));
   assert.equal(edited.queued,true);
   evidence.secondTitle=evidence.title+' second';
   const second=JSON.parse(await command(['item','create','--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.secondTitle,website:'https://packaged-cli.invalid',username:'fixture-writer',password:'fixture-packaged-password'})+'\n'));
   assert.equal(second.queued,true);evidence.secondItemId=second.itemId;
   assert.match(evidence.vaultId,/^[a-f0-9-]{36}$/);
   const replica=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));
   assert.equal(replica.pending.length,3,'Two creations and the chained edit must remain durable');
   evidence.durableQueuedOperations=3;
  }
 }else{
  const value=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
  assert.equal(value.title,evidence.title);assert.equal(value.password,'[redacted]');
  assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fixture-packaged-password');
  if(phase==='peer'){
   await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.title,website:'https://packaged-cli.invalid',username:'fixture-peer',password:'fixture-packaged-password'})+'\n');
   evidence.peerOS=process.platform;evidence.peerDevice=deviceId;
  }else if(phase==='verify')assert.equal(value.username,'fixture-peer');
  if(evidence.secondItemId){
   const second=JSON.parse(await command(['item','get',evidence.secondItemId,'--vault',evidence.vaultId]));
   assert.equal(second.title,evidence.secondTitle);
  }
 }
 if(phase!=='queue'){
  const synced=JSON.parse(await command(['sync']));
  assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
  evidence[phase+'ItemQueueEmpty']=true;
 }
 evidence[phase+'Passed']=true;evidence.lastRunAt=new Date().toISOString();
 await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
 console.log(`Packaged CLI ${phase} passed on ${process.platform}; fixture evidence retained.`);
}finally{
 if(agentReady)await command(['lock']).catch(()=>{});
 if(agent.exitCode===null)agent.kill();
}
