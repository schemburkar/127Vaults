// Actual packaged CLI/agent commands on explicit fictitious profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const [phase,executable,profile,evidencePath]=process.argv.slice(2);
assert.ok(['write','peer','verify','queue','replay','ui-peer','ui-online-peer','ui-consecutive-peer','web-peer','web-verify','types-write','types-verify','types-check','lifecycle-create','lifecycle-archive','lifecycle-retired-peer','lifecycle-restore','lifecycle-restored-peer','lifecycle-settings-accept','native-queue','native-peer','native-review','native-resolve','native-verify','lost-write','lost-peer','lost-replay','lost-verify','capacity-check','ack-write','ack-refused','ack-recovered','ack-peer','ack-restore','ack-restored-peer','gui-archive-peer','gui-restore-peer','gui-nonoverlap-peer','gui-nonoverlap-verify','gui-nonoverlap-restore','gui-nonoverlap-restored','gui-checkpoint-advance','gui-types-peer','gui-types-restore','gui-lost-restore','gui-lost-restored'].includes(phase));
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
assert.equal(evidence.fixtureServer,server);assert.ok(evidence.title.startsWith('Packaged CLI cross-OS ')||phase==='ui-peer'&&evidence.title.startsWith('Linux packaged queue ')||['ui-online-peer','ui-consecutive-peer'].includes(phase)&&evidence.title.startsWith('Linux packaged online ')||['gui-types-peer','gui-types-restore'].includes(phase)&&evidence.title.startsWith('Linux packaged typed ')||['web-peer','web-verify'].includes(phase)&&evidence.title.startsWith('Web-native fixture '));
if(['peer','ui-peer','ui-online-peer','ui-consecutive-peer'].includes(phase))assert.notEqual(deviceId,evidence.writerDevice,'Distinct fixture peer required');
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
 if(['gui-lost-restore','gui-lost-restored'].includes(phase)){
  assert.equal(evidence.guiLostReplayPassed,true);await command(['device','list']);const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));assert.equal(item.password,'[redacted]');assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
  if(phase==='gui-lost-restore'){assert.equal(deviceId,evidence.writerDevice);assert.equal(item.title,evidence.newerPeerTitle);assert.equal(item.username,'newer-peer-fixture');await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({...evidence.ackBaseline,password:'fictitious-lifecycle-password'})+'\n');}
  else{assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['gui-lost-restorePassed'],true);for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);}
 }else if(['gui-types-peer','gui-types-restore'].includes(phase)){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence.vaultId,'66031b92-58ad-4114-b967-dcbf0541be24');assert.deepEqual(evidence.items.map(row=>row.type),['login','password','bank','card','wifi','router','ssh']);
  if(phase==='gui-types-restore')assert.equal(evidence.guiTypedPeerReadPassed,true);
  const listed=JSON.parse(await command(['item','list','--vault',evidence.vaultId]));
  for(const row of evidence.items){
   const expected=phase==='gui-types-peer'?row.title:row.expectedTitle;const matches=listed.filter(item=>item.title===expected);assert.equal(matches.length,1);if(row.itemId)assert.equal(matches[0].itemId,row.itemId);row.itemId=matches[0].itemId;
   const item=JSON.parse(await command(['item','get',row.itemId,'--vault',evidence.vaultId]));assert.equal(item.title,expected);assert.equal(item.username,row.username);assert.equal(item.website,row.website);assert.equal(item.password,'[redacted]');assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),row.password);
   assert.equal(item.customFields.find(field=>field.id==='__127vaults_item_type')?.value,row.type);assert.equal(item.customFields.length,row.fields.length+1);
   for(const expectedField of row.fields){const field=item.customFields.find(field=>field.id===expectedField.id);assert.ok(field);assert.equal(field.type,expectedField.type);assert.equal(field.value,field.type==='password'?'[redacted]':expectedField.value);if(field.type==='password')assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password',field.id]),expectedField.value);}
   const customFields=item.customFields.map(field=>({...field,value:row.fields.find(expectedField=>expectedField.id===field.id)?.value??field.value}));
   await command(['item','edit',row.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:phase==='gui-types-peer'?row.expectedTitle:row.title,username:row.username,website:row.website,password:row.password,customFields})+'\n');
  }
 }else if(phase==='gui-checkpoint-advance'){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');
  await command(['vault','settings-sync']);const settings=JSON.parse(await command(['vault','settings']));assert.equal(settings.pending,false);
  if(settings.conflict){const review=JSON.parse(await command(['vault','settings-review']));assert.equal(review.localPending,false);assert.equal(review.server.names[evidence.vaultId],evidence.vaultName);await command(['vault','settings-resolve','--keep','server']);}
  const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);
  const replicaPath=profile+'/replicas/'+evidence.vaultId+'.json';evidence.checkpointBefore=JSON.parse(await readFile(replicaPath,'utf8')).checkpoint;
  await command(['vault','archive',evidence.vaultId]);evidence.checkpointArchived=JSON.parse(await readFile(replicaPath,'utf8')).checkpoint;
  await command(['vault','restore',evidence.vaultId]);
  await command(['vault','archive',evidence.vaultId]);evidence.checkpointSecondArchive=JSON.parse(await readFile(replicaPath,'utf8')).checkpoint;
  await command(['vault','restore',evidence.vaultId]);evidence.checkpointRestored=JSON.parse(await readFile(replicaPath,'utf8')).checkpoint;
  assert.notDeepEqual(evidence.checkpointArchived,evidence.checkpointBefore);assert.notDeepEqual(evidence.checkpointRestored,evidence.checkpointArchived);assert.ok(evidence.checkpointRestored.cursor>=evidence.checkpointBefore.cursor);
 }else if(phase.startsWith('gui-nonoverlap-')){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.equal(evidence.itemId,'09313354-3b85-4d56-97b1-2f1cb16ba0a7');
  const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));assert.equal(item.password,'[redacted]');assert.deepEqual(item.customFields,[]);assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
  if(phase==='gui-nonoverlap-peer'){for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({...evidence.ackBaseline,username:evidence.nonoverlapUsername,password:'fictitious-lifecycle-password'})+'\n');}
  else if(phase==='gui-nonoverlap-restored'){for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);}
  else{assert.equal(item.title,evidence.nonoverlapTitle);assert.equal(item.username,evidence.nonoverlapUsername);assert.equal(item.website,evidence.ackBaseline.website);if(phase==='gui-nonoverlap-restore')await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({...evidence.ackBaseline,password:'fictitious-lifecycle-password'})+'\n');}
 }else if(['gui-archive-peer','gui-restore-peer'].includes(phase)){
  assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');await command(['sync']);
  const vault=JSON.parse(await command(['vault','list'])).find(row=>row.vaultId===evidence.vaultId);assert.ok(vault);assert.equal(vault.retired,phase==='gui-archive-peer');
  if(phase==='gui-archive-peer')await assert.rejects(command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:'must not mutate archived fixture'})+'\n'),/retired vault is read-only/);
  else{const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);assert.equal(item.password,'[redacted]');assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');}
 }else if(phase.startsWith('ack-')){
  assert.equal(evidence['lifecycle-restored-peerPassed'],true);
  const replicaPath=profile+'/replicas/'+evidence.vaultId+'.json';
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  if(phase==='ack-write'){
   assert.equal(deviceId,evidence.writerDevice);await command(['device','list']);
   const original=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));assert.deepEqual(original.customFields,[]);
   assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
   evidence.ackBaseline={title:original.title,website:original.website,username:original.username};evidence.ackTitle='Packaged acknowledgement '+randomUUID();
   await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({...evidence.ackBaseline,title:evidence.ackTitle,password:'fictitious-lifecycle-password'})+'\n');
   const bytes=await readFile(replicaPath),r=JSON.parse(bytes);assert.equal(r.pending.length,0);assert.equal(r.acknowledged_operations.length,1);
   evidence.ackOperationId=r.acknowledged_operations[0];evidence.ackReplicaHash=hash(bytes);
   const review=JSON.parse(await command(['sync-review']));assert.equal(review.unverifiedAcknowledgements,1);assert.equal(review.items.length,0);
  }else if(phase==='ack-refused'){
   assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['ack-writePassed'],true);
   const status=JSON.parse(await command(['status','--json']));assert.equal(status.online,false);assert.equal(status.authenticated,false);assert.equal(status.unlocked,true);
   assert.match(status.offlineReason,/acknowledged operation missing from server history/);assert.equal(hash(await readFile(replicaPath)),evidence.ackReplicaHash);
   const review=JSON.parse(await command(['sync-review']));assert.equal(review.unverifiedAcknowledgements,1);assert.equal(review.items.length,0);
   assert.equal(JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId])).title,evidence.ackTitle);
   evidence.ackRollbackRefusalPreservedCiphertext=true;
  }else if(phase==='ack-recovered'){
   assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['ack-refusedPassed'],true);await command(['device','list']);
   const r=JSON.parse(await readFile(replicaPath,'utf8'));assert.equal((r.acknowledged_operations||[]).length,0);assert.ok(r.operations.some(row=>row.operation.opId===evidence.ackOperationId));
   assert.equal(JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId])).title,evidence.ackTitle);
  }else if(phase==='ack-peer'){
   assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['ack-recoveredPassed'],true);
   const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));assert.equal(item.title,evidence.ackTitle);assert.equal(item.password,'[redacted]');
   assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
  }else if(phase==='ack-restore'){
   assert.equal(deviceId,evidence.writerDevice);assert.equal(evidence['ack-peerPassed'],true);
   await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({...evidence.ackBaseline,password:'fictitious-lifecycle-password'})+'\n');
  }else{
   assert.notEqual(deviceId,evidence.writerDevice);assert.equal(evidence['ack-restorePassed'],true);
   const item=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));for(const [field,value]of Object.entries(evidence.ackBaseline))assert.equal(item[field],value);
   evidence.ackFixtureRestored=true;
  }
 }else if(phase==='ui-consecutive-peer'){
  const listed=JSON.parse(await command(['item','list','--all']));
  evidence.items=[];
  for(const title of [evidence.guiFirstTitle,evidence.guiSecondTitle]){
   assert.ok(title.startsWith('Linux packaged online '));const rows=listed.filter(item=>item.title===title);assert.equal(rows.length,1);
   const row=rows[0],value=JSON.parse(await command(['item','get',row.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,title);assert.equal(value.username,'');assert.equal(value.password,'[redacted]');
   assert.equal(await command(['item','get',row.itemId,'--vault',evidence.vaultId,'--password','password']),'synthetic-ui-queue-password');
   evidence.items.push({itemId:row.itemId,title});
  }
  evidence.guiConsecutivePeerOS=process.platform;
 }else if(phase==='capacity-check'){
  await command(['device','list']);
  const before=JSON.parse(await command(['vault','list']));assert.equal(before.length,10,'Only the retained full fixture directory is accepted');
  const queued=JSON.parse(await command(['sync-review']));
  await assert.rejects(command(['vault','create','Capacity refusal fixture']),/private vault limit reached \(maximum 10\)/);
  assert.deepEqual(JSON.parse(await command(['vault','list'])),before);
  assert.deepEqual(JSON.parse(await command(['sync-review'])),queued);
  evidence.capacityRefusalPreservedDirectoryAndQueues=true;
 }else if(phase.startsWith('lost-')){
  assert.equal(evidence['lifecycle-restored-peerPassed'],true,'Use only the restored synthetic lifecycle item');
  if(phase==='lost-write'){
   assert.equal(deviceId,evidence.writerDevice);
   await command(['device','list']); // Refuse an offline-fallback unlock before creating any draft.
   const before=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));assert.equal(before.pending.length,0);
   evidence.lostReplyTitle=evidence.title+' lost reply '+randomUUID();
   evidence.newerPeerTitle=evidence.lostReplyTitle+' newer peer';
   await assert.rejects(command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.lostReplyTitle,username:'lost-reply-fixture',password:'fictitious-lifecycle-password'})+'\n'),/failed:/);
   const replica=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));assert.equal(replica.pending.length,1);
   evidence.lostRequest=replica.pending[0].request;
   const review=JSON.parse(await command(['sync-review']));assert.equal(review.items.length,1);assert.equal(review.items[0].title,evidence.lostReplyTitle);
   assert.ok(!JSON.stringify(review).includes('lost-reply-fixture'));assert.ok(!JSON.stringify(review).includes('fictitious-lifecycle-password'));
   assert.deepEqual(JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8')).pending,replica.pending);
   evidence.packagedPendingReviewPassed=true;
  }else if(phase==='lost-peer'){
   assert.notEqual(deviceId,evidence.writerDevice);assert.ok(evidence['lost-writePassed']===true||evidence.guiLostWritePassed===true);
   assert.equal(JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId])).title,evidence.lostReplyTitle);
   await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],JSON.stringify({title:evidence.newerPeerTitle,username:'newer-peer-fixture',password:'fictitious-lifecycle-password'})+'\n');
  }else{
   assert.equal(evidence['lost-peerPassed'],true);
   if(phase==='lost-replay'){
    assert.equal(deviceId,evidence.writerDevice);
    const replica=JSON.parse(await readFile(profile+'/replicas/'+evidence.vaultId+'.json','utf8'));
    assert.equal(replica.pending.length,1);assert.deepEqual(replica.pending[0].request,evidence.lostRequest);
    const synced=JSON.parse(await command(['sync']));assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
   }else{assert.notEqual(deviceId,evidence.writerDevice);assert.ok(evidence['lost-replayPassed']===true||evidence.guiLostReplayPassed===true);}
   const value=JSON.parse(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId]));
   assert.equal(value.title,evidence.newerPeerTitle);assert.equal(value.username,'newer-peer-fixture');assert.equal(value.password,'[redacted]');
   assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']),'fictitious-lifecycle-password');
   delete evidence.lostRequest; // Do not duplicate encrypted queue bodies in final evidence.
  }
 }else if(phase.startsWith('native-')){
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
  if(phase==='lifecycle-settings-accept'){
   await command(['vault','settings-sync']);
   const review=JSON.parse(await command(['vault','settings-review']));
   assert.equal(review.localPending,false,'Never discard an unreviewed fixture settings draft');
   assert.equal(review.server.names[evidence.vaultId],evidence.vaultName);
   await command(['vault','settings-resolve','--keep','server']);
   const settings=JSON.parse(await command(['vault','settings']));assert.equal(settings.conflict,false);assert.equal(settings.pending,false);
  }else if(phase==='lifecycle-create'){
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
 if(!['queue','native-queue','native-review','lost-write','capacity-check','ack-write','ack-refused'].includes(phase)){
  const synced=JSON.parse(await command(['sync']));
  assert.equal(synced.pending,0);assert.equal(synced.conflicts.length,0);
  evidence[phase+'ItemQueueEmpty']=true;
  evidence[phase+'SettingsState']={pending:synced.vaultSettings?.pending,conflict:synced.vaultSettings?.conflict};
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
