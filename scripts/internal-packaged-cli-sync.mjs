// Actual packaged CLI/agent commands on explicit fictitious profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const [phase,executable,profile,evidencePath]=process.argv.slice(2);
assert.ok(['write','peer','verify','queue','replay','ui-peer','ui-online-peer','web-peer','web-verify','types-write','types-verify','types-check','lifecycle-create','lifecycle-archive','lifecycle-retired-peer','lifecycle-restore','lifecycle-restored-peer','native-queue','native-peer','native-review','native-resolve','native-verify'].includes(phase));
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
let evidence=['write','queue','types-write','lifecycle-create'].includes(phase)?{fixtureServer:server,title:'Packaged CLI cross-OS '+randomUUID(),writerOS:process.platform,writerDevice:deviceId}:JSON.parse(await readFile(evidencePath,'utf8'));
assert.equal(evidence.fixtureServer,server);assert.ok(evidence.title.startsWith('Packaged CLI cross-OS ')||phase==='ui-peer'&&evidence.title.startsWith('Linux packaged queue ')||phase==='ui-online-peer'&&evidence.title.startsWith('Linux packaged online ')||['web-peer','web-verify'].includes(phase)&&evidence.title.startsWith('Web-native fixture '));
if(['peer','ui-peer','ui-online-peer'].includes(phase))assert.notEqual(deviceId,evidence.writerDevice,'Distinct fixture peer required');
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
 if(phase.startsWith('native-')){
  assert.equal(evidence['lifecycle-restored-peerPassed'],true,'Use only the restored synthetic lifecycle item');
  if(phase==='native-queue'){
   assert.equal(deviceId,evidence.writerDevice);
   evidence.conflictRound=(evidence.conflictRound||0)+1;
   evidence.conflictMode=process.env.VAULTS_FIXTURE_CONFLICT_MODE||'overlap';
   assert.ok(['overlap','nonoverlap'].includes(evidence.conflictMode));
   const baseline=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
   evidence.baselineTitle=baseline.title;evidence.baselineUsername=baseline.username;evidence.localConflictUsername='local-conflict-user-'+evidence.conflictRound;
   evidence.localConflictTitle=evidence.title+' local conflict '+evidence.conflictRound;
   if(evidence.conflictMode==='nonoverlap')evidence.localConflictTitle=baseline.title;
   evidence.serverConflictTitle=evidence.title+' server conflict '+evidence.conflictRound;
   for(const step of ['native-peer','native-review','native-resolve','native-verify'])delete evidence[step+'Passed'];
   delete evidence.cliVerifiedComparisonPassed;
   const result=JSON.parse(await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.localConflictTitle,username:evidence.localConflictUsername,password:'fictitious-lifecycle-password'})+'\n'));
   assert.equal(result.queued,true,'The edit must genuinely be offline');
   const replica=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));
   assert.equal(replica.pending.length,1);evidence.conflictOperationId=replica.pending[0].operation.opId;
   assert.equal(replica.pending[0].operation.itemId,evidence.itemId);
  }else if(phase==='native-peer'){
   assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['native-queuePassed'],true);
   await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.serverConflictTitle,username:evidence.conflictMode==='nonoverlap'?evidence.baselineUsername:'server-conflict-user',password:'fictitious-lifecycle-password'})+'\n');
  }else if(phase==='native-review'){
   assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['native-peerPassed'],true);
   const synced=JSON.parse(await command(['sync']));
   if(evidence.conflictMode==='nonoverlap'){
    assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);assert.ok(synced.rebased>=1);
    const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
    assert.equal(item.title,evidence.serverConflictTitle);assert.equal(item.username,evidence.localConflictUsername);
    evidence.conflictChoice='automatic-nonoverlap';evidence['native-resolvePassed']=true;
   }else{
   assert.equal(synced.pending,1);
   const conflicts=JSON.parse(await command(['conflict','list','--vault',evidence.vaultId]));
   assert.ok(JSON.stringify(conflicts).includes(evidence.conflictOperationId));
   const shown=await command(['conflict','show',evidence.conflictOperationId,'--vault',evidence.vaultId]);
   assert.ok(shown.includes('local conflict'));assert.ok(!shown.includes('fictitious-lifecycle-password'),'Conflict review must redact the password');
   if(process.env.VAULTS_FIXTURE_COMPARE==='1'){
    const before=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8')).pending;
    const compared=JSON.parse(await command(['conflict','compare',evidence.conflictOperationId,'--vault',evidence.vaultId]));
    assert.equal(compared.operationId,evidence.conflictOperationId);assert.equal(compared.itemId,evidence.itemId);assert.equal(compared.vaultId,evidence.vaultId);
    assert.equal(compared.draft.title,evidence.localConflictTitle);assert.equal(compared.server.title,evidence.serverConflictTitle);
    assert.equal(compared.draft.password,'[redacted]');assert.equal(compared.server.password,'[redacted]');
    assert.ok(!JSON.stringify(compared).includes('fictitious-lifecycle-password'));
    const after=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8')).pending;
    assert.deepEqual(after,before,'Comparison must preserve the exact pending request');
    evidence.cliVerifiedComparisonPassed=true;
   }
   const replica=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));
   assert.equal(replica.pending.length,1);assert.equal(replica.pending[0].operation.opId,evidence.conflictOperationId);
   }
  }else if(phase==='native-resolve'){
   assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['native-reviewPassed'],true);
   evidence.conflictChoice=process.env.VAULTS_FIXTURE_CONFLICT_KEEP||'server';
   assert.ok(['server','local','fields'].includes(evidence.conflictChoice));
   if(evidence.conflictChoice==='fields')await command(['conflict','merge',evidence.conflictOperationId,'--vault',evidence.vaultId,'--base','local','--field-source','title=server']);
   else await command(['conflict','resolve',evidence.conflictOperationId,'--vault',evidence.vaultId,'--keep',evidence.conflictChoice]);
  }else{
   assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['native-resolvePassed'],true);
   const value=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,evidence.conflictChoice==='local'?evidence.localConflictTitle:evidence.serverConflictTitle);assert.equal(value.username,['local','fields','automatic-nonoverlap'].includes(evidence.conflictChoice)?evidence.localConflictUsername:'server-conflict-user');assert.equal(value.password,'[redacted]');
   assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
  }
 }else if(phase.startsWith('lifecycle-')){
  if(phase==='lifecycle-create'){
   const available=JSON.parse(await command(['vault','list']));
   console.log('Fixture vault capacity:',available.length);
   const existing=process.env.VAULTS_FIXTURE_LIFECYCLE_VAULT;
   assert.ok(existing||available.length<5,'Fixture directory is full; explicitly select a disposable Fixture Work vault: '+JSON.stringify(available.map(({vaultId,name,retired})=>({vaultId,name,retired}))));
   const selected=existing?available.find(row=>row.vaultId===existing&&row.retired!==true&&row.name.startsWith('Fixture Work ')):null;
   assert.ok(!existing||selected,'Only an explicitly selected disposable Fixture Work vault may be reused');
   const vault=selected||JSON.parse(await command(['vault','create',evidence.title]));
   evidence.vaultName=selected?.name||evidence.title;
   evidence.vaultId=vault.vaultId;assert.match(evidence.vaultId,/^[a-f0-9-]{36}$/);
   await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
   const item=JSON.parse(await command(['item','create','--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.title,username:'lifecycle-fixture',password:'fictitious-lifecycle-password'})+'\n'));
   evidence.itemId=item.itemId;assert.ok(evidence.itemId);
  }else if(phase==='lifecycle-archive'||phase==='lifecycle-restore'){
   assert.equal(deviceId,evidence.writerDevice,'Only the owning fixture writer may change this test vault');
   assert.equal(evidence['lifecycle-createPassed'],true);
   if(phase==='lifecycle-restore')assert.equal(evidence['lifecycle-retired-peerPassed'],true);
   await command(['vault',phase==='lifecycle-archive'?'archive':'restore',evidence.vaultId]);
  }else{
   assert.notEqual(deviceId,evidence.writerDevice,'Distinct fixture peer required');
   assert.equal(evidence[phase==='lifecycle-retired-peer'?'lifecycle-archivePassed':'lifecycle-restorePassed'],true);
   await command(['sync']);
   const vaults=JSON.parse(await command(['vault','list']));
   const vault=vaults.find(row=>row.vaultId===evidence.vaultId);assert.ok(vault);
   assert.equal(vault.retired,phase==='lifecycle-retired-peer');
   assert.equal(vault.name,evidence.vaultName);
   if(phase==='lifecycle-retired-peer'){
    await assert.rejects(command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:'must not mutate archived fixture'})+'\n'),/retired vault is read-only/);
   }else{
    const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
    assert.equal(item.title,evidence.title);assert.equal(item.username,'lifecycle-fixture');assert.equal(item.password,'[redacted]');
    assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
   }
   evidence.lifecyclePeerOS=process.platform;
  }
 }else if(phase==='types-write'){
  const before=JSON.parse(await command(['sync']));assert.equal(before.pending,0);assert.equal(before.conflicts.length,0);
  evidence.vaultId='66031b92-58ad-4114-b967-dcbf0541be24';evidence.items=[];
  await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  for(const type of ['login','password','bank','card','wifi','router','ssh']){
   const title=evidence.title+' '+type;
   const customFields=[{id:'fixture_note',label:'Fixture note',type:'text',value:'fixture ordinary field'},{id:'fixture_secret',label:'Fixture secret',type:'password',value:'fictitious-typed-secret'},{id:'__127vaults_section:fixture',label:'Section',type:'metadata',value:'security|Fixture recovery'},{id:'__127vaults_field:fixture:answer',label:'Answer',type:'password',value:'fictitious-related-secret'}];
   const made=JSON.parse(await command(['item','create','--vault',evidence.vaultId,'--json','-'],JSON.stringify({title,type,website:'https://typed-web-native.invalid/',username:'typed-fixture-user',password:'fictitious-typed-password',customFields})+'\n'));
   evidence.items.push({type,title,itemId:made.itemId,expectedTitle:title+' web edit'});
   await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  }
 }else if(['types-verify','types-check'].includes(phase)){
  if(phase==='types-verify')assert.equal(evidence.webTypesReadAndEditPassed,true);assert.equal(evidence.items.length,7);
  for(const row of evidence.items){
   const value=JSON.parse(await command(['item','get',row.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,phase==='types-verify'?row.expectedTitle:row.title);assert.equal(value.password,'[redacted]');
   assert.equal(value.username,'typed-fixture-user');assert.equal(value.website,'https://typed-web-native.invalid/');
   assert.ok(value.customFields.some(field=>field.id==='__127vaults_item_type'&&field.value===row.type)||row.type==='login');
   assert.ok(value.customFields.some(field=>field.id==='fixture_note'&&field.value==='fixture ordinary field'));
   assert.ok(value.customFields.some(field=>field.id==='fixture_secret'&&field.value==='[redacted]'));
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-typed-password');
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','fixture_secret']),'fictitious-typed-secret');
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','__127vaults_field:fixture:answer']),'fictitious-related-secret');
  }
  evidence.typesPeerOS=process.platform;
 }else if(phase==='web-verify'){
  assert.equal(evidence.webReverseReadPassed,true);
  const value=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
  assert.equal(value.title,evidence.expectedPeerTitle);assert.equal(value.username,evidence.expectedUsername||'native-fixture-user');assert.equal(value.password,'[redacted]');
  assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-web-native-password');
 }else if(phase==='web-peer'){
  assert.equal(evidence.verifiedHTTPS,true);
  assert.equal(evidence.webCreatePassed,true);
  assert.equal(evidence.expectedPeerTitle,evidence.title+' native edit');
  const value=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
  assert.equal(value.title,evidence.title);assert.equal(value.username,'web-fixture-user');assert.equal(value.password,'[redacted]');
  assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-web-native-password');
  await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.expectedPeerTitle,website:'https://web-native.invalid/',username:'native-fixture-user',password:'fictitious-web-native-password'})+'\n');
  evidence.nativeReadAndEditPassed=true;
 }else if(['ui-peer','ui-online-peer'].includes(phase)){
  assert.equal(evidence.items.length,2);
  const listed=JSON.parse(await command(['item','list','--all']));
  for(const row of evidence.items){
   assert.ok(row.title.startsWith(phase==='ui-peer'?'Linux packaged queue ':'Linux packaged online '));
   assert.equal(listed.filter(item=>item.title===row.title).length,1);
   if(phase==='ui-online-peer')row.itemId=listed.find(item=>item.title===row.title).itemId;
   const value=JSON.parse(await command(['item','get',row.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,row.title);assert.equal(value.username,'');assert.equal(value.website,'');assert.equal(value.password,'[redacted]');
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),'synthetic-ui-queue-password');
  }
  evidence.peerOS=process.platform;evidence.peerDevice=deviceId;
 }else if(['write','queue'].includes(phase)){
  const vaults=JSON.parse(await command(['vault','list']));
  evidence.vaultId=process.env.VAULTS_FIXTURE_WRITE_VAULT||vaults.find(row=>row.retired!==true).vaultId;
  assert.ok(vaults.some(row=>row.vaultId===evidence.vaultId&&row.retired!==true),'Selected fixture vault must be available');
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
 if(!['queue','native-queue','native-review'].includes(phase)){
  const synced=JSON.parse(await command(['sync']));
  assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
  evidence[phase+'ItemQueueEmpty']=true;
 }
 evidence[phase+'Passed']=true;evidence.lastRunAt=new Date().toISOString();
 if(phase==='native-verify'){
  evidence.conflictRounds||=[];
  evidence.conflictRounds.push({round:evidence.conflictRound,choice:evidence.conflictChoice,operationId:evidence.conflictOperationId,verifiedAt:evidence.lastRunAt});
 }
 await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
 if(phase==='web-peer'){
  assert.ok(evidencePath.endsWith('web-native.json'));
  await writeFile(evidencePath.slice(0,-'web-native.json'.length)+'native-peer-edited.json',JSON.stringify({itemId:evidence.itemId})+'\n');
 }
 console.log(`Packaged CLI ${phase} passed on ${process.platform}; fixture evidence retained.`);
}finally{
 if(agentReady)await command(['lock']).catch(()=>{});
 if(agent.exitCode===null)agent.kill();
}
