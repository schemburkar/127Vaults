// New packaged CLI identity, real browser approval, possession proof and reads.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from './release/verify-release.mjs';
import {ownershipClient} from './internal-ownership-client.mjs';

assert.equal(process.platform,'win32');
const [work]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
const repo=resolve(import.meta.dirname,'..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8')),member=JSON.parse(await readFile(join(work,'ownership-member.json'),'utf8'));
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(member.username,'ownership_member');
const exe='C:/Projects/127Vaults-settings-review-20261015-a/cli-package/127vaults-cli-0.0.0-windows-x64/127vaults.exe',profile=join(work,'member-cli-windows-a');
const release=await verifyRelease('C:/Projects/127Vaults-Releases/cli/internal-20261015-a/windows');assert.equal(release.sourceRevision,'600f206ce300e643a0b3d2dfd8259bdde597cb1a');
const previous=JSON.parse(await readFile(join(work,'candidate-cli-windows.json'),'utf8'));
assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),previous.cliBinarySha256);
await assert.rejects(access(join(profile,'device.conf')),error=>error.code==='ENOENT');
async function run(program,args,cwd=repo){return new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill(),120000);child.stdout.on('data',bytes=>out+=bytes);child.stderr.on('data',bytes=>err+=bytes);child.on('error',reject);child.on('close',async code=>{clearTimeout(timer);if(code){await writeFile(join(work,'member-cli-command-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Owned member CLI operation failed; private diagnostic retained'));}else resolve(out.trim());});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
const command=args=>run(exe,[...args,'--config-dir',profile]);
let enrolling,agent,ready=false,enrollmentTimer;
try {
  await operator('start');
  assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const client=await ownershipClient(work);
  for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  await command(['server','trust','--url',fixture.origin,'--ca',join(fixture.identity,'ca/ca.crt'),'--server-id',fixture.serverId]);
  enrolling=spawn(exe,['device','enroll','--username',member.username,'--config-dir',profile],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr='',enrollmentRequest;
  const completed=new Promise((resolve,reject)=>{enrolling.on('error',reject);enrolling.on('close',code=>code?reject(Error('Packaged enrollment failed')):resolve());});
  completed.catch(()=>{});
  enrollmentTimer=setTimeout(()=>enrolling.kill(),180000);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Enrollment request not shown')),60000);enrolling.stdout.resume();enrolling.stderr.on('data',bytes=>{stderr+=bytes;const code=/Enrollment code: ([A-HJ-NP-Z2-9]{8})/.exec(stderr)?.[1],device=/Device ID: ([a-f0-9-]{36})/.exec(stderr)?.[1],fingerprint=/fingerprint \(SHA-256\): ([a-f0-9]{64})/.exec(stderr)?.[1];if(code&&device&&fingerprint&&!enrollmentRequest){enrollmentRequest={serverId:fixture.serverId,accountId:member.accountId,code,device,fingerprint};clearTimeout(timer);resolve();}});enrolling.on('close',()=>{clearTimeout(timer);if(!enrollmentRequest)reject(Error('Enrollment ended before showing request'));});});
  await writeFile(join(work,'member-cli-enrollment-request.json'),JSON.stringify(enrollmentRequest,null,2)+'\n',{flag:'wx',mode:0o600});
  await run('podman',['run','--rm','--name','vaults-member-cli-approval-20261015-a','--network','host','--volume',repo+':/repo:ro','--volume',work+':/evidence','--volume',fixture.identity+':/identity:ro','--env','VAULTS_PLAYWRIGHT_MODULE=/fixture/modules/playwright','localhost/127vaults-sync-web:20261014-a','node','/repo/scripts/internal-member-cli-approve.mjs','/evidence']);
  await completed;clearTimeout(enrollmentTimer);
  const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+enrollmentRequest.device+'\n')&&conf.includes('username='+member.username+'\n'));
  agent=spawn(exe,['agent-serve','--username',member.username,'--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Member agent not ready')),60000);agent.stdout.on('data',bytes=>{if(String(bytes).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Member agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
  await command(['device','list']);await command(['sync']);
  const normal=JSON.parse(await readFile(join(work,'web-move-candidate-normal-fixture.json'),'utf8')),edited=JSON.parse(await readFile(join(work,'web-move-destination-loss-fixture.json'),'utf8'));
  const item=JSON.parse(await command(['item','get',normal.destinationItem,'--vault',normal.destination]));assert.equal(item.title,normal.title);assert.equal(item.username,normal.username);assert.equal(item.website,normal.website);assert.equal(item.password,'[redacted]');
  assert.equal(await command(['item','get',normal.destinationItem,'--vault',normal.destination,'--password','password']),normal.password);
  const peerEdit=JSON.parse(await command(['item','get',edited.destinationItem,'--vault',edited.destination]));assert.equal(peerEdit.title,edited.changedTitle);assert.equal(peerEdit.password,'[redacted]');
  assert.equal(JSON.parse(await command(['item','list','--vault',normal.destination])).length,6);
  assert.equal(JSON.parse(await command(['vault','list'])).find(row=>row.vaultId===normal.source).retired,true);
  assert.equal(JSON.parse(await command(['sync-review'])).items.length,0);
  await writeFile(join(work,'member-cli-windows.json'),JSON.stringify({status:'passed',serverId:fixture.serverId,serverRevision:fixture.serverRevision,accountId:member.accountId,device:enrollmentRequest.device,fingerprint:enrollmentRequest.fingerprint,cliSourceRevision:release.sourceRevision,profile,itemId:normal.destinationItem,preservedPeerEdit:edited.destinationItem,checks:['Packaged CLI establishes pinned trust and generates a fresh device key','Actual member browser approves exact UUID/fingerprint; CLI completes possession proof and OS-keyring storage','Real packaged member login/sync reads web-created moved item fields and masked/explicit password','Historical destination peer edit and six-item catalogue remain; source retired and review empty'],limits:['Windows retained test installation; clean-host/physical acceptance separate','Approval uses actual UI plus automated binding comparison; human comparison UX separate']},null,2)+'\n');
  console.log('New packaged member CLI enrollment and independent web-move reads passed.');
}finally{clearTimeout(enrollmentTimer);if(enrolling&&enrolling.exitCode===null)enrolling.kill();if(ready)await command(['lock']).catch(()=>{});if(agent&&agent.exitCode===null)agent.kill();await operator('stop');}
