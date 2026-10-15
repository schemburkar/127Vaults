// Real Windows CLI-b, independent new key/profile; no fixture key import.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';
const [phase]=process.argv.slice(2),work='C:/Projects/127Vaults-license-isolated-20261015-a',profile=work+'/native-cli-windows-b';
assert.equal(process.platform,'win32');assert.ok(['enroll','queue-grace','retry-grace','finish-grace','queue-revoked','retry-revoked','finish-revoked'].includes(phase));
const base=JSON.parse(await readFile(work+'/evidence.json','utf8'));assert.equal(base.installation,'9865ecb1-2e46-475f-bc91-5f7b8e71b7cf');
const exe='C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a/cli-budget-b/127vaults-cli-0.0.0-windows-x64/127vaults.exe';
const release='C:/Projects/127Vaults-Releases/cli/internal-20261015-b/windows',manifest=await verifyRelease(release);assert.equal(manifest.sourceRevision,'cd67ab2c224df758f173fd393590c4586386f8b8');
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(await readFile(exe)),hash(execFileSync('tar',['-xOf',release+'/127vaults-cli-0.0.0-windows-x64.zip','127vaults-cli-0.0.0-windows-x64/127vaults.exe'],{windowsHide:true,maxBuffer:64*1024*1024})));
async function run(program,args,env=process.env,input=''){return new Promise((resolve,reject)=>{const c=spawn(program,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{c.kill();reject(Error('Native license command timeout'));},60000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(timer);code?reject(Error(err.trim())):resolve(out.trim());});c.stdin.end(input);});}
const command=(args,input='')=>run(exe,[...args,'--config-dir',profile],process.env,input),json=async(args,input)=>JSON.parse(await command(args,input));
if(phase==='enroll'){
 await assert.rejects(access(profile+'/device.conf'),e=>e.code==='ENOENT');await command(['server','trust','--url','https://127.0.0.1:12900','--ca',work+'/identity/ca/ca.crt','--server-id',base.installation]);
 const c=spawn(exe,['device','enroll','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='',request;
 const done=new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',code=>code?reject(Error('Native enrollment failed')):resolve());});done.catch(()=>{});const timer=setTimeout(()=>c.kill(),120000);
 try{
  await new Promise((resolve,reject)=>{c.stdout.resume();c.stderr.on('data',b=>{stderr+=b;const code=/Enrollment code: ([A-HJ-NP-Z2-9]{8})/.exec(stderr)?.[1],device=/Device ID: ([a-f0-9-]{36})/.exec(stderr)?.[1],fingerprint=/fingerprint \(SHA-256\): ([a-f0-9]{64})/.exec(stderr)?.[1];if(code&&device&&fingerprint&&!request){request={serverId:base.installation,code,device,fingerprint};resolve();}});c.on('close',()=>{if(!request)reject(Error('Enrollment ended early'));});});
  await writeFile(work+'/native-license-enrollment-request.json',JSON.stringify(request,null,2)+'\n',{flag:'wx',mode:0o600});await run(process.execPath,['C:/Projects/127Vaults/tests/internal/licensing/license-server-probe.mjs',work,'approve-cli'],{...process.env,NODE_EXTRA_CA_CERTS:work+'/identity/ca/ca.crt'});await done;
 }finally{clearTimeout(timer);if(c.exitCode===null)c.kill();}
}
const conf=await readFile(profile+'/device.conf','utf8'),enrolled=JSON.parse(await readFile(work+'/native-license-enrollment-request.json','utf8'));assert.ok(conf.includes('device_id='+enrolled.device+'\n')&&conf.includes('server_id='+base.installation+'\n'));
const agent=spawn(exe,['agent-serve','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Agent readiness timeout')),60000);agent.stdout.on('data',b=>{if(String(b).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Agent exited'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
 await command(['device','list']);
 if(phase==='enroll'){
  await command(['sync']);const vaults=await json(['vault','list']);assert.equal(vaults.length,1);const vaultId=vaults[0].vaultId,items=await json(['item','list','--vault',vaultId]);assert.equal(items.length,1);const item=await json(['item','get',items[0].itemId,'--vault',vaultId]);assert.equal(item.password,'[redacted]');
  await writeFile(work+'/native-license-baseline.json',JSON.stringify({vaultId,itemId:item.itemId,title:item.title,website:item.website??'',username:item.username??'',customFields:item.customFields??[],device:enrolled.device,sourceRevision:manifest.sourceRevision,binarySha256:hash(await readFile(exe))},null,2)+'\n',{flag:'wx'});
 }else{
  const baseline=JSON.parse(await readFile(work+'/native-license-baseline.json','utf8')),kind=phase.split('-')[1],path=profile+'/replicas/'+baseline.vaultId+'.json',replica=async()=>JSON.parse(await readFile(path,'utf8'));
  const license=await json(['license','status']);assert.equal(license.mode,phase.startsWith('finish')?'active':kind==='grace'?'read-only':'revoked');assert.match(license.guidance,phase.startsWith('finish')?/License active/:/writes are blocked/);
  const title=baseline.title+' native retained '+kind;
  if(phase.startsWith('queue')){
   assert.equal((await replica()).pending.length,0);const password=await command(['item','get',baseline.itemId,'--vault',baseline.vaultId,'--password','password']);assert.match(password,/^race-[ab]$/);
   await assert.rejects(command(['item','edit',baseline.itemId,'--vault',baseline.vaultId,'--json','-'],JSON.stringify({title,website:baseline.website,username:baseline.username,password,customFields:baseline.customFields})+'\n'),/423/);
   const pending=(await replica()).pending;assert.equal(pending.length,1);await writeFile(work+'/native-license-'+kind+'-original.json',JSON.stringify(pending)+'\n',{flag:'wx',mode:0o600});
  }
  const original=JSON.parse(await readFile(work+'/native-license-'+kind+'-original.json','utf8'));assert.deepEqual((await replica()).pending,original);
  const sync=await json(['sync']);assert.deepEqual(sync.conflicts,[]);
  if(!phase.startsWith('finish')){
   assert.equal(sync.pending,1);assert.deepEqual((await replica()).pending,original);const review=await json(['sync-review']);assert.equal(review.items.length,1);assert.equal(review.items[0].title,title);assert.match(review.items[0].error,/423/);assert.ok(!JSON.stringify(review).includes('race-a')&&!JSON.stringify(review).includes('race-b'));
  }else{
   assert.equal(sync.pending,0);assert.equal((await json(['item','get',baseline.itemId,'--vault',baseline.vaultId])).title,title);
   const password=await command(['item','get',baseline.itemId,'--vault',baseline.vaultId,'--password','password']);assert.match(password,/^race-[ab]$/);await json(['item','edit',baseline.itemId,'--vault',baseline.vaultId,'--json','-'],JSON.stringify({title:baseline.title,website:baseline.website,username:baseline.username,password,customFields:baseline.customFields})+'\n');await command(['sync']);assert.equal((await replica()).pending.length,0);assert.equal((await json(['item','get',baseline.itemId,'--vault',baseline.vaultId])).title,baseline.title);
  }
 }
 await writeFile(work+'/native-license-'+phase+'.json',JSON.stringify({status:'passed',phase,installation:base.installation,device:enrolled.device,sourceRevision:manifest.sourceRevision,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log('Actual packaged Windows native license phase passed: '+phase);
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
