// Read/sync only on the retained enrolled Linux member, after GUI shutdown.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from './release/verify-release.mjs';
assert.equal(process.platform,'linux');
const work=process.argv[2],profile='/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a';
assert.equal(work,'/mnt/c/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a');
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),member=await json('member-cli-linux.json'),normal=await json('web-move-candidate-normal-fixture.json'),budget=await json('member-desktop-budget.json');
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(budget.status,'passed');
assert.ok((await readFile(join(profile,'device.conf'),'utf8')).includes('device_id='+member.device+'\n'));
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json'))assert.equal(JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending.length,0);
assert.equal(JSON.parse(await readFile(join(profile,'vault-settings.json'),'utf8')).pending,null);
const release='/mnt/c/Projects/127Vaults-Releases/cli/internal-20261015-b/linux',manifest=await verifyRelease(release);
assert.equal(manifest.sourceRevision,'cd67ab2c224df758f173fd393590c4586386f8b8');
const archive=join(release,'127vaults-cli-0.0.0-linux-x64.tar.gz'),exe='/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/cli-budget-b/127vaults-cli-0.0.0-linux-x64/127vaults';
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(await readFile(exe)),hash(execFileSync('tar',['-xOf',archive,'127vaults-cli-0.0.0-linux-x64/127vaults'],{maxBuffer:64*1024*1024})));
async function command(args){return new Promise((resolve,reject)=>{const c=spawn(exe,[...args,'--config-dir',profile],{stdio:['ignore','pipe','pipe']});let out='';c.stdout.on('data',b=>out+=b);c.stderr.resume();const timer=setTimeout(()=>{c.kill();reject(Error('Rebuilt CLI read timed out'));},60000);c.on('error',reject);c.on('close',code=>{clearTimeout(timer);code?reject(Error('Rebuilt CLI read failed')):resolve(out.trim());});});}
const agent=spawn(exe,['agent-serve','--username','ownership_member','--config-dir',profile],{stdio:['pipe','pipe','pipe']});let ready=false;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Agent readiness timeout')),60000);agent.stdout.on('data',b=>{if(String(b).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
 await command(['device','list']);const synced=JSON.parse(await command(['sync']));assert.equal(synced.pending,0);assert.deepEqual(synced.conflicts,[]);
 assert.equal(JSON.parse(await command(['sync-review'])).items.length,0);
 const item=JSON.parse(await command(['item','get',normal.destinationItem,'--vault',normal.destination]));
 for(const key of ['title','username','website'])assert.equal(item[key],normal[key]);assert.equal(item.password,'[redacted]');assert.deepEqual(item.customFields,[]);
 assert.equal(await command(['item','get',normal.destinationItem,'--vault',normal.destination,'--password','password']),normal.password);
 assert.equal(JSON.parse(await command(['item','list','--vault',normal.destination])).length,6);
 const peer=await json('web-move-destination-loss-fixture.json');assert.equal(JSON.parse(await command(['item','get',peer.destinationItem,'--vault',peer.destination])).title,peer.changedTitle);
 assert.equal(JSON.parse(await command(['vault','list'])).find(v=>v.vaultId===normal.source).retired,true);
 await writeFile(join(work,'member-rebuilt-cli-linux-read.json'),JSON.stringify({status:'passed',serverId:fixture.serverId,sourceRevision:manifest.sourceRevision,binarySha256:hash(await readFile(exe)),device:member.device,checks:['Verified archive binary; persisted enrolled device/keyring online after GUI shutdown','Full queue history sync, zero pending/conflicts and redacted review','Restored baseline and explicit synthetic secret, six-item catalogue, peer edit and retirement preserved'],at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 console.log('Rebuilt Linux CLI baseline, history and invariants verified.');
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
