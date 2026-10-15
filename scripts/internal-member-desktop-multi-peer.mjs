// Real selected native writers, explicit retained fictitious member profiles only.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const [work,phase]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
assert.ok(['windows-multi-peer','windows-multi-restore'].includes(phase));assert.equal(process.platform,'win32');
const webRestore=phase==='windows-web-restore';
const conflictPeer=phase==='windows-desktop-conflict-peer',conflictRestore=phase==='windows-desktop-conflict-restore';
const desktopRestore=phase==='windows-desktop-restore',peerRestore=webRestore||desktopRestore||conflictRestore;
const windows=process.platform==='win32';assert.equal(windows,phase.startsWith('windows'));
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),enrolled=await json(windows?'member-cli-windows.json':'member-cli-linux.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(enrolled.status,'passed');assert.equal(enrolled.serverId,fixture.serverId);
const exe=windows?'C:/Projects/127Vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-windows-x64/127vaults.exe':'/home/vaults-dev/vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-linux-x64/127vaults';
const profile=windows?join(work,'member-cli-windows-a'):'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a';
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+enrolled.device+'\n')&&conf.includes('username=ownership_member\n')&&conf.includes('server_id='+fixture.serverId+'\n'));
assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),(await json(windows?'candidate-cli-windows.json':'candidate-cli-linux.json')).cliBinarySha256);
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json'))assert.equal(JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending.length,0,'Preserve existing queued writes');
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');
const recordName='member-desktop-multi.json',record=await json(recordName);assert.equal(record.status,'in-progress');assert.equal(record.serverId,fixture.serverId);assert.equal(record.windowsDevice,enrolled.device);assert.equal(record.phases.length,phase==='windows-multi-peer'?2:6);assert.equal(record.rows.length,2);
async function command(args,input=''){return new Promise((resolve,reject)=>{const c=spawn(exe,[...args,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{c.kill();reject(Error('Member write check timed out'));},60000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(timer);code?reject(Error('Member CLI failed: '+err.trim())):resolve(out.trim());});c.stdin.end(input);});}
const result=async (args,input='')=>JSON.parse(await command(args,input));
const agent=spawn(exe,['agent-serve','--username','ownership_member','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Member agent readiness timeout')),60000);agent.stdout.on('data',b=>{if(String(b).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Member agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
  await command(['device','list']);await command(['sync']);assert.equal((await result(['sync-review'])).items.length,0);
  for(const [index,row] of record.rows.entries()){
    const item=await result(['item','get',row.itemId,'--vault',record.vaultId]);
    const restore=phase==='windows-multi-restore',expectedTitle=restore?(index===0?row.serverTitle:row.localTitle):row.title,expectedUsername=restore?(index===0?row.serverUsername:row.localUsername):row.username;
    assert.equal(item.title,expectedTitle);assert.equal(item.username,expectedUsername);assert.equal(item.website,row.website);assert.equal(item.password,'[redacted]');assert.deepEqual(item.customFields,[]);
    assert.equal(await command(['item','get',row.itemId,'--vault',record.vaultId,'--password','password']),normal.password);
    const payload={title:restore?row.title:row.serverTitle,username:restore?row.username:row.serverUsername,website:row.website,password:normal.password,customFields:[]};
    const changed=await result(['item','edit',row.itemId,'--vault',record.vaultId,'--json','-'],JSON.stringify(payload)+'\n');assert.notEqual(changed.queued,true);
    const after=await result(['item','get',row.itemId,'--vault',record.vaultId]);assert.equal(after.title,payload.title);assert.equal(after.username,payload.username);
  }
  const settled=await result(['sync']);assert.equal(settled.pending,0);assert.deepEqual(settled.conflicts,[]);assert.equal((await result(['sync-review'])).items.length,0);
  assert.equal((await result(['item','list','--vault',record.vaultId])).length,6);assert.equal((await result(['vault','list'])).find(row=>row.vaultId===normal.source).retired,true);
  if(phase==='windows-multi-restore'){record.peerVerifiedIndependentChoices=true;record.nativeRestored=true;}
  record.phases.push({phase,status:'passed',device:enrolled.device,queueEmpty:true,completedAt:new Date().toISOString()});await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Windows multi peer phase passed: '+phase);
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
