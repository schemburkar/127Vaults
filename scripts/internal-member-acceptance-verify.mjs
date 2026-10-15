import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const [work,mode]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));assert.ok(mode===undefined||mode==='--linux');
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),admin=await json('ownership-admin-browser.json'),approval=await json('member-cli-web-approval.json'),cli=await json('member-cli-windows.json'),member=await json('ownership-member.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
for(const result of [admin,approval,cli]){assert.equal(result.status,'passed');assert.equal(result.serverId,fixture.serverId);assert.equal(result.serverRevision,fixture.serverRevision);}
assert.equal(admin.checks.length,5);assert.equal(admin.mutations.length,4);
assert.equal(admin.mutations[0].action,'ownership.request');assert.equal(admin.mutations[0].status,200);
assert.equal(admin.mutations[1].action,'ownership.cancel');assert.equal(admin.mutations[1].targetId,admin.mutations[0].requestId);
assert.ok(admin.mutations.slice(2).every(row=>row.action==='account.suspend'&&row.status===409));
assert.equal(admin.mutations[2].requestId,admin.mutations[3].requestId);
assert.equal(cli.accountId,member.accountId);assert.equal(approval.accountId,member.accountId);
assert.equal(cli.device,approval.device);assert.equal(cli.fingerprint,approval.fingerprint);assert.match(cli.fingerprint,/^[a-f0-9]{64}$/);
assert.notEqual(cli.device,member.deviceId);assert.notEqual(cli.device,(await json('ownership-customer-device.json')).deviceId);
assert.equal(cli.cliSourceRevision,'600f206ce300e643a0b3d2dfd8259bdde597cb1a');
const conf=await readFile(join(cli.profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+cli.device+'\n')&&conf.includes('username='+member.username+'\n'));
assert.equal(cli.itemId,(await json('web-move-candidate-normal-fixture.json')).destinationItem);
assert.equal(cli.preservedPeerEdit,(await json('web-move-destination-loss-fixture.json')).destinationItem);
assert.equal(cli.checks.length,4);assert.equal(approval.checks.length,3);
const run=promisify(execFile);
let linux;
if(mode==='--linux'){
  linux=await json('member-cli-linux.json');const approved=await json('member-cli-linux-web-approval.json');
  for(const record of [linux,approved]){assert.equal(record.status,'passed');assert.equal(record.serverId,fixture.serverId);assert.equal(record.serverRevision,fixture.serverRevision);assert.equal(record.accountId,member.accountId);}
  assert.equal(linux.device,approved.device);assert.equal(linux.fingerprint,approved.fingerprint);assert.match(linux.fingerprint,/^[a-f0-9]{64}$/);
  assert.ok(![cli.device,member.deviceId,(await json('ownership-customer-device.json')).deviceId].includes(linux.device));
  assert.equal(linux.cliSourceRevision,cli.cliSourceRevision);assert.equal(linux.cliBinarySha256,(await json('candidate-cli-linux.json')).cliBinarySha256);
  assert.equal(linux.keyringRestartVerified,true);assert.equal(linux.checks.length,5);assert.equal(approved.checks.length,3);
  assert.equal(linux.itemId,cli.itemId);assert.equal(linux.preservedPeerEdit,cli.preservedPeerEdit);
  assert.equal(linux.profile,'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a');
  const code=`const fs=require('node:fs'),assert=require('node:assert/strict');const profile=${JSON.stringify(linux.profile)},device=${JSON.stringify(linux.device)};const conf=fs.readFileSync(profile+'/device.conf','utf8');assert.ok(conf.includes('device_id='+device+'\\n')&&conf.includes('username=ownership_member\\n'));for(const pid of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){let args;try{args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0');}catch{continue;}assert.ok(!(args[0]?.endsWith('/127vaults')&&args.includes(profile)),'Member CLI process remains live');}console.log('Linux profile and process cleanup verified');`;
  await run('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','/opt/vaults-node24/bin/node','-e',code],{windowsHide:true});
  linux={...linux,approval:approved};
}
await run(process.execPath,[fileURLToPath(new URL('./internal-candidate-native-verify.mjs',import.meta.url)),work],{windowsHide:true});
const ps=await run('podman',['ps','--format','{{.Names}}'],{windowsHide:true});assert.ok(!ps.stdout.includes('vaults-member-cli-approval-20261015-a'));
assert.ok(!ps.stdout.includes('vaults-member-cli-linux-approval-20261015-a'));
await writeFile(join(work,'member-acceptance-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,admin,approval,cli,cleanup:'Selected native/P1 acceptance and exact bundle/wiring/stopped-project/original-health/revoked-draft checks pass; approval container absent',limits:['New Windows member CLI enrollment/read and selected admin web controls only; broader writer/physical/other-platform enrollment gates remain','CLI approval binding compared automatically; human fingerprint-comparison UX separate']},null,2)+'\n');
console.log('Selected admin browser and genuinely enrolled packaged member CLI acceptance verified.');
if(linux){await writeFile(join(work,'member-linux-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,linux,windowsDevice:cli.device,checks:['Distinct Linux/member/browser/Windows devices and exact selected binary hash','Real web approval plus Linux keyring persistence across agent restart','Exact independent member move/peer-edit reads','Linux profile binding and stopped native processes; native/P1/bundle/original/revoked-data cleanup verified'],limits:['WSL/private test keyring; physical clean-host and wider writer combinations remain']},null,2)+'\n');console.log('Linux member enrollment, retained profile and cleanup evidence verified.');}
