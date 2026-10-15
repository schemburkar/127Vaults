// Packaged CLI interoperability with the newly selected immutable server.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from './release/verify-release.mjs';

const [exe,profile,base,work]=process.argv.slice(2);
for(const value of [exe,profile,base,work])assert.ok(value&&isAbsolute(value));
assert.ok(!profile.includes('clients-revocation'));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const fixture=await json(join(work,'fixture.json')),original=await json(join(base,'fixture.json')),guard=await json(join(base,'guard-evidence.json')),record=await json(join(base,'linux-final-evidence.json'));
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');assert.equal(original.serverId,fixture.serverId);
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
const conf=await readFile(join(profile,'device.conf'),'utf8'),device=/^device_id=(.+)$/m.exec(conf)?.[1];
assert.ok(device&&conf.includes('username=owner_127\n')&&conf.includes('server_id='+fixture.serverId+'\n'));
assert.notEqual(device,record.writer);
const platform=process.platform==='win32'?'windows':'linux';assert.ok(['win32','linux'].includes(process.platform));
const root=process.platform==='win32'?'C:/Projects/127Vaults-Releases':'/mnt/c/Projects/127Vaults-Releases';
const release=join(root,'cli/internal-20261015-a',platform),manifest=await verifyRelease(release);
assert.equal(manifest.sourceRevision,'600f206ce300e643a0b3d2dfd8259bdde597cb1a');
const archive=manifest.files.find(row=>/\.(zip|tar\.gz)$/.test(row.name));assert.ok(archive);
const names=execFileSync('tar',['-tf',join(release,archive.name)],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
const binary=names.filter(name=>name.split('/').at(-1)===(platform==='windows'?'127vaults.exe':'127vaults'));assert.equal(binary.length,1);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(exe)),hash(execFileSync('tar',['-xOf',join(release,archive.name),binary[0]],{windowsHide:true,maxBuffer:64*1024*1024})));
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json'))assert.equal((await json(join(profile,'replicas',name))).pending.length,0,'Never sync unrelated queued writes');
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');
async function command(args){return new Promise((resolve,reject)=>{const child=spawn(exe,[...args,'--config-dir',profile],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';const timer=setTimeout(()=>{child.kill();reject(Error('Packaged CLI check timed out'));},60000);child.stdout.on('data',b=>out+=b);child.stderr.resume();child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code?reject(Error('Packaged CLI command failed: '+args.slice(0,2).join(' '))):resolve(out.trim());});});}
const result=async args=>JSON.parse(await command(args));
const agent=spawn(exe,['agent-serve','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI agent did not become ready')),60000);agent.stdout.on('data',bytes=>{if(String(bytes).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('CLI agent exited before readiness'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
  await command(['device','list']);
  assert.equal((await result(['sync-review'])).items.length,0);
  await command(['sync']);
  assert.equal((await result(['sync-review'])).items.length,0);
  assert.equal((await result(['vault','list'])).find(row=>row.vaultId===record.source).retired,true);
  const item=await result(['item','get',record.copied,'--vault',record.destination]);
  assert.equal(item.title,guard.sourceChangedTitle);assert.equal(item.username,'guard-fixture');assert.equal(item.website,'https://guard.invalid/');assert.equal(item.password,'[redacted]');
  assert.equal(await command(['item','get',record.copied,'--vault',record.destination,'--password','password']),'fictitious-guard-password');
  assert.equal(await command(['item','get',record.copied,'--vault',record.destination,'--password','guard-secret']),'fictitious-guard-secret');
  assert.equal((await result(['item','list','--vault',record.destination])).length,9);
  await writeFile(join(work,'candidate-cli-'+platform+'.json'),JSON.stringify({status:'passed',serverId:fixture.serverId,serverRevision:fixture.serverRevision,platform,device,cliSourceRevision:manifest.sourceRevision,cliBinarySha256:hash(await readFile(exe)),itemId:record.copied,vaultId:record.destination,checks:['Extracted binary exactly matches the verified selected CLI archive','Actual packaged agent unlock, online device request and sync against new server','Retired source and exact nine-item catalogue preserved; reserved copy fields verified','Default password redaction and explicit built-in/custom secret reads; no conflict review pending'],limits:['Retained enrolled fixture and private keyring; clean physical installation separate','Read/sync compatibility, not a new move-writer or new-server member CLI enrollment claim']},null,2)+'\n');
  console.log('Selected '+platform+' CLI read/sync against selected server-a passed.');
} finally {if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
