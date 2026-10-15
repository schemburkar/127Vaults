// Real selected native writers, explicit retained fictitious member profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const [work,phase]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
assert.ok(['windows-write','linux-read-write','windows-read-restore','linux-final','windows-web-restore','windows-desktop-restore','windows-desktop-conflict-peer','windows-desktop-conflict-restore','windows-budget-restore'].includes(phase));
const webRestore=phase==='windows-web-restore';
const conflictPeer=phase==='windows-desktop-conflict-peer',conflictRestore=phase==='windows-desktop-conflict-restore';
const budgetRestore=phase==='windows-budget-restore';
const desktopRestore=phase==='windows-desktop-restore',peerRestore=webRestore||desktopRestore||conflictRestore||budgetRestore;
const windows=process.platform==='win32';assert.equal(windows,phase.startsWith('windows'));
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),enrolled=await json(windows?'member-cli-windows.json':'member-cli-linux.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(enrolled.status,'passed');assert.equal(enrolled.serverId,fixture.serverId);
const budgetPackage=budgetRestore?await json('member-budget-cli-package.json'):null;
if(budgetRestore)assert.equal(budgetPackage.sourceRevision,'cd67ab2c224df758f173fd393590c4586386f8b8');
const exe=budgetRestore?budgetPackage.exe:windows?'C:/Projects/127Vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-windows-x64/127vaults.exe':'/home/vaults-dev/vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-linux-x64/127vaults';
const profile=windows?join(work,'member-cli-windows-a'):'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a';
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+enrolled.device+'\n')&&conf.includes('username=ownership_member\n')&&conf.includes('server_id='+fixture.serverId+'\n'));
assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),budgetRestore?budgetPackage.binarySha256:(await json(windows?'candidate-cli-windows.json':'candidate-cli-linux.json')).cliBinarySha256);
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json'))assert.equal(JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending.length,0,'Preserve existing queued writes');
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');
const recordName=budgetRestore?'member-desktop-budget.json':conflictPeer||conflictRestore?'member-desktop-conflict.json':desktopRestore?'member-desktop-native-writes.json':webRestore?'member-web-native-writes.json':'member-cross-os-writes.json';let record;
if(phase==='windows-write'){
  await assert.rejects(access(join(work,recordName)),error=>error.code==='ENOENT');
  record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,itemId:normal.destinationItem,vaultId:normal.destination,windowsDevice:enrolled.device,windowsTitle:normal.title+' Windows member edit',linuxUsername:'linux-member-peer-20261015-a',phases:[]};
}else{record=await json(recordName);assert.equal(record.serverId,fixture.serverId);assert.equal(record.status,'in-progress');assert.equal(record.phases.length,{'linux-read-write':1,'windows-read-restore':2,'linux-final':3,'windows-web-restore':1,'windows-desktop-restore':1,'windows-desktop-conflict-peer':1,'windows-desktop-conflict-restore':4,'windows-budget-restore':3}[phase]);}
async function command(args,input=''){return new Promise((resolve,reject)=>{const c=spawn(exe,[...args,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{c.kill();reject(Error('Member write check timed out'));},60000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(timer);code?reject(Error('Member CLI failed: '+err.trim())):resolve(out.trim());});c.stdin.end(input);});}
const result=async (args,input='')=>JSON.parse(await command(args,input));
const agent=spawn(exe,['agent-serve','--username','ownership_member','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Member agent readiness timeout')),60000);agent.stdout.on('data',b=>{if(String(b).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Member agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
  await command(['device','list']);await command(['sync']);assert.equal((await result(['sync-review'])).items.length,0);
  const get=()=>result(['item','get',normal.destinationItem,'--vault',normal.destination]);
  const before=await get();assert.equal(before.password,'[redacted]');assert.deepEqual(before.customFields??[],[]);
  assert.equal(before.title,budgetRestore?record.retryTitle:conflictPeer?normal.title:conflictRestore?record.serverTitle:desktopRestore?record.desktopTitle:webRestore?record.webTitle:phase==='windows-write'||phase==='linux-final'?normal.title:record.windowsTitle);
  assert.equal(before.username,conflictRestore?record.localUsername:phase==='windows-read-restore'?record.linuxUsername:normal.username);assert.equal(before.website,normal.website);
  assert.equal(await command(['item','get',normal.destinationItem,'--vault',normal.destination,'--password','password']),normal.password);
  const payload={title:before.title,website:normal.website,username:before.username,password:normal.password,customFields:[]};
  if(phase!=='linux-final'){
    if(phase==='windows-write')payload.title=record.windowsTitle;
    if(conflictPeer){assert.equal(enrolled.device,record.windowsDevice);payload.title=record.serverTitle;payload.username=record.serverUsername;}
    if(phase==='linux-read-write'){assert.notEqual(enrolled.device,record.windowsDevice);record.linuxDevice=enrolled.device;payload.username=record.linuxUsername;}
    if(phase==='windows-read-restore'||peerRestore){assert.equal(enrolled.device,record.windowsDevice);payload.title=normal.title;payload.username=normal.username;}
    const changed=await result(['item','edit',normal.destinationItem,'--vault',normal.destination,'--json','-'],JSON.stringify(payload)+'\n');assert.notEqual(changed.queued,true);
    const after=await get();assert.equal(after.title,payload.title);assert.equal(after.username,payload.username);assert.equal(after.website,payload.website);
  }
  assert.equal((await result(['vault','list'])).find(row=>row.vaultId===normal.source).retired,true);
  await assert.rejects(command(['item','edit',normal.sourceItem,'--vault',normal.source,'--json','-'],JSON.stringify({title:'must not change retired member source'})+'\n'),/retired vault is read-only/);
  const synced=await result(['sync']);assert.equal(synced.pending,0);assert.deepEqual(synced.conflicts,[]);assert.equal((await result(['sync-review'])).items.length,0);
  assert.equal((await result(['item','list','--vault',normal.destination])).length,6);
  const peer=await json('web-move-destination-loss-fixture.json');assert.equal((await result(['item','get',peer.destinationItem,'--vault',peer.destination])).title,peer.changedTitle);
  record.phases.push({phase,device:enrolled.device,platform:process.platform,status:'passed',completedAt:new Date().toISOString(),queueEmpty:true,retiredWriteRefused:true});
  if(phase==='linux-final'){record.status='passed';record.baselineRestored=true;}
  if(peerRestore)record.nativeRestored=true;
  if(budgetRestore){record.cliSourceRevision=budgetPackage.sourceRevision;record.cliBinarySha256=budgetPackage.binarySha256;record.nativeVerifiedCursor=JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json'),'utf8')).cursor;assert.ok(record.nativeVerifiedCursor>500);}
  await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Member native phase passed: '+phase);
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
