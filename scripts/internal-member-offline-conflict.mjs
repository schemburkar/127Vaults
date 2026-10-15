// Real selected native writers, explicit retained fictitious member profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const [work,phase]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
const phases=['windows-baseline','linux-baseline','windows-queue','linux-peer','windows-review-merge','linux-verify-restore','windows-final'];assert.ok(phases.includes(phase));
const windows=process.platform==='win32';assert.equal(windows,phase.startsWith('windows'));
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),enrolled=await json(windows?'member-cli-windows.json':'member-cli-linux.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(enrolled.status,'passed');assert.equal(enrolled.serverId,fixture.serverId);
const exe=windows?'C:/Projects/127Vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-windows-x64/127vaults.exe':'/home/vaults-dev/vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-linux-x64/127vaults';
const profile=windows?join(work,'member-cli-windows-a'):'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a';
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+enrolled.device+'\n')&&conf.includes('username=ownership_member\n')&&conf.includes('server_id='+fixture.serverId+'\n'));
assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),(await json(windows?'candidate-cli-windows.json':'candidate-cli-linux.json')).cliBinarySha256);
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');
const recordName='member-offline-conflict.json';let record;
if(phase==='windows-baseline'){
  await assert.rejects(access(join(work,recordName)),error=>error.code==='ENOENT');
  record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,itemId:normal.destinationItem,vaultId:normal.destination,windowsDevice:enrolled.device,localTitle:normal.title+' offline Windows overlap',serverTitle:normal.title+' online Linux overlap',localUsername:'offline-member-local-20261015-a',serverUsername:'online-member-peer-20261015-a',phases:[]};
}else{record=await json(recordName);assert.equal(record.status,'in-progress');assert.equal(record.serverId,fixture.serverId);assert.equal(record.phases.length,phases.indexOf(phase));}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replica=async()=>JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json'),'utf8'));
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json')){
  const pending=JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending;
  if(phase==='windows-review-merge'&&name===normal.destination+'.json'){assert.equal(pending.length,1);assert.equal(fingerprint(pending),record.pendingSha256);}else assert.equal(pending.length,0,'Preserve unrelated queued writes');
}
async function command(args,input=''){return new Promise((resolve,reject)=>{const c=spawn(exe,[...args,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{c.kill();reject(Error('Member write check timed out'));},60000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(timer);code?reject(Error('Member CLI failed: '+err.trim())):resolve(out.trim());});c.stdin.end(input);});}
const result=async (args,input='')=>JSON.parse(await command(args,input));
const agent=spawn(exe,['agent-serve','--username','ownership_member','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Member agent readiness timeout')),60000);agent.stdout.on('data',b=>{if(String(b).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Member agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
  const offline=phase==='windows-queue';
  if(offline)await assert.rejects(command(['device','list']),/unavailable while offline/);else await command(['device','list']);
  const get=()=>result(['item','get',normal.destinationItem,'--vault',normal.destination]);
  const edit=async(title,username)=>result(['item','edit',normal.destinationItem,'--vault',normal.destination,'--json','-'],JSON.stringify({title,username,website:normal.website,password:normal.password,customFields:[]})+'\n');
  const check=async(title,username)=>{const item=await get();assert.equal(item.title,title);assert.equal(item.username,username);assert.equal(item.website,normal.website);assert.equal(item.password,'[redacted]');assert.deepEqual(item.customFields,[]);assert.equal(await command(['item','get',normal.destinationItem,'--vault',normal.destination,'--password','password']),normal.password);};
  if(['windows-baseline','linux-baseline'].includes(phase)){
    await command(['sync']);await check(normal.title,normal.username);
    if(phase==='linux-baseline'){assert.notEqual(enrolled.device,record.windowsDevice);record.linuxDevice=enrolled.device;}
  }else if(offline){
    await check(normal.title,normal.username);assert.equal((await edit(record.localTitle,record.localUsername)).queued,true);
    const pending=(await replica()).pending;assert.equal(pending.length,1);assert.equal(pending[0].operation.itemId,normal.destinationItem);
    record.operationId=pending[0].operation.opId;record.pendingSha256=fingerprint(pending);
    await writeFile(join(work,'member-offline-conflict-original-request.json'),JSON.stringify(pending,null,2)+'\n',{flag:'wx',mode:0o600});
    await check(record.localTitle,record.localUsername);
  }else if(phase==='linux-peer'){
    assert.equal(enrolled.device,record.linuxDevice);await command(['sync']);await check(normal.title,normal.username);
    assert.notEqual((await edit(record.serverTitle,record.serverUsername)).queued,true);await check(record.serverTitle,record.serverUsername);
  }else if(phase==='windows-review-merge'){
    assert.equal(enrolled.device,record.windowsDevice);const synced=await result(['sync']);assert.equal(synced.pending,1);assert.equal(synced.conflicts.length,1);
    assert.equal(fingerprint((await replica()).pending),record.pendingSha256);
    const compared=await result(['conflict','compare',record.operationId,'--vault',normal.destination]);assert.equal(compared.operationId,record.operationId);assert.equal(compared.itemId,normal.destinationItem);
    assert.equal(compared.draft.title,record.localTitle);assert.equal(compared.draft.username,record.localUsername);assert.equal(compared.server.title,record.serverTitle);assert.equal(compared.server.username,record.serverUsername);
    assert.equal(compared.draft.password,'[redacted]');assert.equal(compared.server.password,'[redacted]');assert.ok(!JSON.stringify(compared).includes(normal.password));
    assert.equal(fingerprint((await replica()).pending),record.pendingSha256);record.comparisonPreservedExactRequest=true;
    await command(['conflict','merge',record.operationId,'--vault',normal.destination,'--base','local','--field-source','title=server']);
    await check(record.serverTitle,record.localUsername);record.explicitSelectedFieldMerge=true;
  }else if(phase==='linux-verify-restore'){
    await command(['sync']);await check(record.serverTitle,record.localUsername);await edit(normal.title,normal.username);await check(normal.title,normal.username);record.nativeRestored=true;
  }else{await command(['sync']);await check(normal.title,normal.username);assert.equal(record.nativeRestored,true);record.baselineRestored=true;record.status='passed';}
  if(!offline){const settled=await result(['sync']);assert.equal(settled.pending,0);assert.deepEqual(settled.conflicts,[]);assert.equal((await result(['sync-review'])).items.length,0);}
  assert.equal((await result(['item','list','--vault',normal.destination])).length,6);
  const prior=await json('web-move-destination-loss-fixture.json');assert.equal((await result(['item','get',prior.destinationItem,'--vault',prior.destination])).title,prior.changedTitle);
  assert.equal((await result(['vault','list'])).find(row=>row.vaultId===normal.source).retired,true);
  record.phases.push({phase,status:'passed',device:enrolled.device,completedAt:new Date().toISOString(),pending:offline?1:0});
  await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Member offline conflict phase passed: '+phase);
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
