// Two existing fictitious items, two overlapping conflicts, explicit independent
// decisions. No direct native invocation or fabricated server conflict markers.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const [phase,executable,profile,path] = process.argv.slice(2);
assert.ok(['baseline','peer-ready','queue','peer','recover-peer','review','offline-server-copy','server-copy','local-copy','verify','restore','restored-peer'].includes(phase));
for(const value of [executable,profile,path])assert.ok(value&&isAbsolute(value));
assert.match(basename(executable),/^127vaults(?:\.exe)?$/);
const fixtureServer='14725fef-f5b4-4cb8-afe0-77aa3d80b268';
const device=await readFile(profile+'/device.conf','utf8');
assert.ok(device.includes('username=owner_127\n')&&device.includes(`server_id=${fixtureServer}\n`));
const deviceId=/^device_id=(.+)$/m.exec(device)?.[1];assert.ok(deviceId);
const evidence=JSON.parse(await readFile(path,'utf8'));assert.equal(evidence.fixtureServer,fixtureServer);
assert.ok(evidence.title.startsWith('Packaged CLI cross-OS '));assert.equal(evidence['lifecycle-restored-peerPassed'],true);
assert.equal(evidence.itemIds.length,2);assert.equal(new Set(evidence.itemIds).size,2);assert.ok(evidence.itemIds.includes(evidence.itemId));
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replica=async()=>JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));
async function command(args,input=''){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[...args,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',error='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Multi-conflict fixture command timed out'));},60000);
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>error+=bytes);child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);code?reject(Error(`Multi-conflict fixture ${args[0]} failed: ${error.trim()}`)):resolve(output.trim());});child.stdin.end(input);
 });
}
const json=async args=>JSON.parse(await command(args));
async function acceptUndraftedSettings(){
 const settings=await json(['vault','settings']);assert.equal(settings.pending,false);
 if(settings.conflict){const review=await json(['vault','settings-review']);assert.equal(review.localPending,false);assert.equal(review.server.names[evidence.vaultId],evidence.vaultName);await command(['vault','settings-resolve','--keep','server']);}
}
async function edit(row,title,username=row.username){return JSON.parse(await command(['item','edit',row.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title,website:row.website,username,password:'fictitious-lifecycle-password'})+'\n'));}
const agent=spawn(executable,['agent-serve','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Multi-conflict fixture agent timed out')),60000);agent.stdout.on('data',bytes=>{if(String(bytes).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Multi-conflict fixture agent failed'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
 if(['queue','offline-server-copy'].includes(phase))await assert.rejects(command(['device','list']),/unavailable while offline/);else await command(['device','list']);
 if(phase==='baseline'){
  assert.equal(deviceId,evidence.writerDevice);await acceptUndraftedSettings();assert.equal((await replica()).pending.length,0);
  evidence.multiItems=[];const run=randomUUID();
  for(const itemId of evidence.itemIds){
   const item=await json(['item','get',itemId,'--vault',evidence.vaultId]);assert.ok(item.title.startsWith('Packaged CLI cross-OS '));assert.deepEqual(item.customFields,[]);
   assert.equal(await command(['item','get',itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
   evidence.multiItems.push({itemId,title:item.title,website:item.website,username:item.username,localTitle:'Multi-conflict local '+run+' '+itemId,serverTitle:'Multi-conflict server '+run+' '+itemId,...(evidence.multiFieldMerge?{localUsername:'field-local-'+run,serverUsername:'field-server-'+run}:{})});
  }
 }else if(phase==='peer-ready'){
  assert.notEqual(deviceId,evidence.writerDevice);await acceptUndraftedSettings();assert.equal((await replica()).pending.length,0);
  for(const row of evidence.multiItems)assert.equal((await json(['item','get',row.itemId,'--vault',evidence.vaultId])).title,row.title);
 }else if(phase==='queue'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-peer-readyPassed'],true);
  for(const row of evidence.multiItems)assert.equal((await edit(row,row.localTitle,row.localUsername??row.username)).queued,true);
  const pending=(await replica()).pending;assert.equal(pending.length,2);
  evidence.multiPending=pending.map(entry=>({itemId:entry.operation.itemId,operationId:entry.operation.opId,hash:fingerprint(entry)}));
  evidence.multiQueueHash=fingerprint(pending);
 }else if(phase==='peer'){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['multi-queuePassed'],true);await acceptUndraftedSettings();
  for(const row of evidence.multiItems)await edit(row,row.serverTitle,row.serverUsername??row.username);
 }else if(phase==='recover-peer'){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['multi-queuePassed'],true);
  const pending=(await replica()).pending;assert.equal(pending.length,1);assert.equal(pending[0].operation.itemId,evidence.multiItems[1].itemId);
  await writeFile(path+'.peer-pending-before-recovery.json',JSON.stringify(pending,null,2)+'\n',{flag:'wx'});
  const synced=await json(['sync']);assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
  for(const row of evidence.multiItems)assert.equal((await json(['item','get',row.itemId,'--vault',evidence.vaultId])).title,row.serverTitle);
  evidence['multi-peerPassed']=true;
 }else if(phase==='review'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-peerPassed'],true);
  const synced=await json(['sync']);assert.equal(synced.pending,2);assert.equal(synced.conflicts.length,2);
  assert.equal(fingerprint((await replica()).pending),evidence.multiQueueHash);
  for(const entry of evidence.multiPending){
   const compared=await json(['conflict','compare',entry.operationId,'--vault',evidence.vaultId]);const row=evidence.multiItems.find(row=>row.itemId===entry.itemId);
   assert.equal(compared.draft.title,row.localTitle);assert.equal(compared.server.title,row.serverTitle);assert.equal(compared.draft.password,'[redacted]');assert.equal(compared.server.password,'[redacted]');
   assert.equal(fingerprint((await replica()).pending),evidence.multiQueueHash);
  }
 }else if(phase==='offline-server-copy'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-reviewPassed'],true);
  const pending=(await replica()).pending;assert.equal(fingerprint(pending),evidence.multiQueueHash);
  await assert.rejects(command(['conflict','resolve',evidence.multiPending[0].operationId,'--vault',evidence.vaultId,'--keep','server']),/Reconnect/);
  assert.equal(fingerprint((await replica()).pending),evidence.multiQueueHash);
 }else if(phase==='server-copy'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-offline-server-copyPassed'],true);
  await command(['conflict','resolve',evidence.multiPending[0].operationId,'--vault',evidence.vaultId,'--keep','server']);
  const current=await replica();assert.equal(current.pending.length,1);assert.equal(current.conflicts.length,1);
  assert.equal(current.pending[0].operation.opId,evidence.multiPending[1].operationId);assert.equal(fingerprint(current.pending[0]),evidence.multiPending[1].hash);
  assert.equal(current.conflicts[0].operationId,evidence.multiPending[1].operationId);evidence.selectedServerCopyPreservedOtherConflict=true;
 }else if(phase==='local-copy'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-server-copyPassed'],true);
  await command(['conflict','resolve',evidence.multiPending[1].operationId,'--vault',evidence.vaultId,'--keep','local']);
  const synced=await json(['sync']);assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
 }else if(phase==='verify'){
  assert.notEqual(deviceId,evidence.writerDevice);assert.ok(evidence['multi-local-copyPassed']===true||evidence['gui-multi-localPassed']===true);
  for(let i=0;i<2;i++){const row=evidence.multiItems[i],item=await json(['item','get',row.itemId,'--vault',evidence.vaultId]);assert.equal(item.title,i===0?row.serverTitle:row.localTitle);assert.equal(item.username,row.localUsername??row.username);assert.equal(item.website,row.website);assert.equal(item.password,'[redacted]');assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');}
 }else if(phase==='restore'){
  assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['multi-verifyPassed'],true);
  for(const row of evidence.multiItems)await edit(row,row.title);
  const synced=await json(['sync']);assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
 }else{
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['multi-restorePassed'],true);
  for(const row of evidence.multiItems){const item=await json(['item','get',row.itemId,'--vault',evidence.vaultId]);for(const field of ['title','website','username'])assert.equal(item[field],row[field]);}
  evidence.multiFixtureRestored=true;
 }
 evidence['multi-'+phase+'Passed']=true;evidence.multiLastRunAt=new Date().toISOString();await writeFile(path,JSON.stringify(evidence,null,2)+'\n');
 console.log(`Packaged multi-conflict ${phase} passed on ${process.platform}.`);
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
