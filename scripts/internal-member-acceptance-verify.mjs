import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const [work,mode]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));assert.ok(mode===undefined||['--linux','--writes','--web','--extension','--conflict','--conflict-both'].includes(mode));
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
if(['--linux','--writes','--web','--extension','--conflict','--conflict-both'].includes(mode)){
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
if(['--writes','--web','--extension','--conflict','--conflict-both'].includes(mode)){
  const writes=await json('member-cross-os-writes.json');assert.equal(writes.status,'passed');assert.equal(writes.serverId,fixture.serverId);assert.equal(writes.serverRevision,fixture.serverRevision);assert.equal(writes.baselineRestored,true);
  assert.equal(writes.itemId,cli.itemId);assert.equal(writes.windowsDevice,cli.device);assert.equal(writes.linuxDevice,linux.device);
  assert.deepEqual(writes.phases.map(row=>row.phase),['windows-write','linux-read-write','windows-read-restore','linux-final']);
  for(const [index,row] of writes.phases.entries()){assert.equal(row.status,'passed');assert.equal(row.queueEmpty,true);assert.equal(row.retiredWriteRefused,true);assert.equal(row.device,index%2===0?cli.device:linux.device);}
  const processes=await run('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"Name='127vaults.exe'\" | Select-Object -ExpandProperty CommandLine"],{windowsHide:true});
  assert.ok(!processes.stdout.includes('member-cli-windows-a'),'Windows member CLI remains live');
  await writeFile(join(work,'member-writes-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,writes,checks:['Selected packaged Windows edit reaches distinct Linux member device','Linux edit reaches Windows; Windows restores original fields and Linux independently verifies restoration','Both devices refuse retired-source edits; six-item catalogue, historical peer edit and empty queues preserved','Native/member/P1 checks and stopped processes/owned project/original server/revoked draft verified'],limits:['Online sequential ordinary-field writes on retained test hosts; interruption/concurrent-write/UI/physical combinations remain']},null,2)+'\n');console.log('Selected cross-OS member writer evidence and cleanup verified.');
}
if(['--web','--extension','--conflict','--conflict-both'].includes(mode)){
  const web=await json('member-web-native-writes.json');assert.equal(web.status,'passed');assert.equal(web.serverId,fixture.serverId);assert.equal(web.serverRevision,fixture.serverRevision);assert.equal(web.baselineRestored,true);assert.equal(web.nativeRestored,true);
  assert.equal(web.itemId,cli.itemId);assert.equal(web.windowsDevice,cli.device);assert.equal(web.browserDevice,(await json('ownership-customer-device.json')).deviceId);assert.notEqual(web.browserDevice,web.windowsDevice);
  assert.deepEqual(web.phases.map(row=>row.phase),['web-write','windows-web-restore','web-final']);
  for(const [index,row] of web.phases.entries()){assert.equal(row.status,'passed');assert.equal(row.device,index===1?cli.device:web.browserDevice);}
  assert.equal(web.webWrite.status,200);assert.equal(web.webWrite.path,'/api/v1/vaults/'+(await json('web-move-candidate-normal-fixture.json')).destination+'/operations');
  assert.equal(web.phases[1].queueEmpty,true);assert.equal(web.phases[1].retiredWriteRefused,true);assert.deepEqual(web.phases[2].mutations,[]);
  if(web.phases[0].recoveredByRead){assert.ok(web.webWrite.recoveredFrom);assert.deepEqual(web.phases[0].mutations,[]);}else assert.match(web.webWrite.sha256,/^[a-f0-9]{64}$/);
  assert.ok(!ps.stdout.includes('vaults-member-web-writer-20261015-a'));
  await writeFile(join(work,'member-web-native-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,web,checks:['Actual selected web UI edit read by independent packaged Windows member CLI','Native original-field restoration independently verified after browser restart/unlock','Real UI password masking/reveal, six-item catalogue, retired-source and lock checks','No duplicate edit during helper-observation recovery; all native/member/P1 and cleanup checks pass'],limits:['Sequential online ordinary-field pairing with headless strict-CA transport; installed-PWA/physical/interruption/other pairings separate','Initial accepted operation response retained without request ID/hash; recovery uses read-only app restart plus independent native read']},null,2)+'\n');console.log('Selected web/native member writer evidence and cleanup verified.');
}
if(['--extension','--conflict','--conflict-both'].includes(mode)){
  const extension=await json('extension-web-permission-refusal.json'),archive=await json('extension-selected-package.json');
  assert.equal(extension.status,'passed');assert.equal(extension.serverId,fixture.serverId);assert.equal(extension.serverRevision,fixture.serverRevision);assert.equal(extension.checks.length,5);
  assert.equal(archive.status,'passed');assert.equal(archive.sourceRevision,'07fdca56a281f786b18c639347d86c631bc64585');assert.equal(extension.extensionSourceRevision,archive.sourceRevision);assert.equal(extension.archiveSha256,archive.archiveSha256);
  const inventory=JSON.parse(await readFile(fileURLToPath(new URL('../docs/release/internal-release-artifacts-2026-10-13.json',import.meta.url)),'utf8'));
  assert.equal(archive.archiveSha256,inventory.artifacts.find(row=>row.product==='extension').files.find(row=>row.name.endsWith('.zip')).sha256);
  assert.deepEqual(extension.permissionsBefore,extension.permissionsAfter);assert.deepEqual(extension.permissionsAfter.origins??[],[]);
  assert.ok(!ps.stdout.includes('vaults-extension-web-refusal-20261015-a'));
  await writeFile(join(work,'extension-web-refusal-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,extension,archive,checks:['Actual selected extension/archive and real selected unlocked web app','Absent host permission refuses results and fill; permissions remain empty','Member/native/web/P1 and owned-project/container/original/revoked-data checks pass'],limits:['Negative missing-permission evidence; affirmative web-source access pending user answer','No physical/Windows/idle/passkey acceptance or native registration change']},null,2)+'\n');console.log('Selected extension actual-web permission refusal and cleanup evidence verified.');
}
if(['--conflict','--conflict-both'].includes(mode)){
 for(const suffix of mode==='--conflict-both'?['','-linux']:['']){
  const reverse=suffix==='-linux';
  const conflict=await json('member-offline-conflict'+suffix+'.json'),original=await json('member-offline-conflict'+suffix+'-original-request.json');
  assert.equal(conflict.status,'passed');assert.equal(conflict.serverId,fixture.serverId);assert.equal(conflict.serverRevision,fixture.serverRevision);assert.equal(conflict.windowsDevice,cli.device);assert.equal(conflict.linuxDevice,linux.device);assert.equal(conflict.itemId,cli.itemId);
  for(const flag of ['comparisonPreservedExactRequest','explicitSelectedFieldMerge','nativeRestored','baselineRestored'])assert.equal(conflict[flag],true);
  assert.equal(original.length,1);assert.equal(original[0].operation.opId,conflict.operationId);assert.equal(original[0].operation.itemId,conflict.itemId);assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),conflict.pendingSha256);
  const expected=['windows-baseline','linux-baseline','windows-queue','linux-peer','windows-review-merge','linux-verify-restore','windows-final'];
  assert.deepEqual(conflict.phases.map(row=>row.phase),reverse?expected.map(value=>value.startsWith('windows')?value.replace('windows','linux'):value.replace('linux','windows')):expected);
  if(reverse)assert.equal(conflict.direction,'linux-writer');
  for(const row of conflict.phases){assert.equal(row.status,'passed');assert.equal(row.device,row.phase.startsWith('windows')?cli.device:linux.device);assert.equal(row.pending,row.phase.endsWith('-queue')?1:0);}
  const settled=JSON.parse(await readFile(join(cli.profile,'replicas',conflict.vaultId+'.json'),'utf8'));assert.deepEqual(settled.pending,[]);assert.deepEqual(settled.conflicts,[]);
  if(reverse){
    const code=`const fs=require('node:fs'),assert=require('node:assert/strict'),profile=${JSON.stringify(linux.profile)};for(const name of fs.readdirSync(profile+'/replicas').filter(name=>name.endsWith('.json'))){const row=JSON.parse(fs.readFileSync(profile+'/replicas/'+name,'utf8'));assert.deepEqual(row.pending,[]);assert.deepEqual(row.conflicts,[]);}console.log('Linux member replicas settled');`;
    await run('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','/opt/vaults-node24/bin/node','-e',code],{windowsHide:true});
  }
  await writeFile(join(work,'member-offline-conflict'+suffix+'-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,conflict,checks:[reverse?'Real offline Linux edit persists across process restart and newer Windows peer write':'Real offline Windows edit persists across process restart and newer Linux peer write','Overlapping conflict verified/redacted; original encrypted request hash preserved through sync and comparison','Explicit server-title/local-username merge reaches independent opposite-OS member','Baseline restored and independently verified; queues empty, catalogue/peer edit/retirement preserved','Selected member/native/web/P1/extension-negative and cleanup chain passed'],limits:['Ordinary-field conflict on retained test hosts; GUI/multiple pending and loss scenarios separate; each OS writer has its own record','Private original encrypted request snapshot retained outside Git; no queue/profile reset']},null,2)+'\n');console.log('Selected member '+(reverse?'Linux':'Windows')+' offline conflict, exact review preservation and merge verified.');
 }
}
