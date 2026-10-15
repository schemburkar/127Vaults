import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';

const [work]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),windows=await json('candidate-cli-windows.json'),linux=await json('candidate-cli-linux.json'),desktop=await json('candidate-desktop-linux.json');
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
for(const [platform,result]of [['windows',windows],['linux',linux]]) {
  assert.equal(result.status,'passed');assert.equal(result.platform,platform);
  assert.equal(result.serverId,fixture.serverId);assert.equal(result.serverRevision,fixture.serverRevision);
  assert.equal(result.cliSourceRevision,'600f206ce300e643a0b3d2dfd8259bdde597cb1a');
  assert.match(result.cliBinarySha256,/^[a-f0-9]{64}$/);assert.equal(result.checks.length,4);
  const m=await verifyRelease('C:/Projects/127Vaults-Releases/cli/internal-20261015-a/'+platform);assert.equal(m.sourceRevision,result.cliSourceRevision);
}
assert.notEqual(windows.device,linux.device);assert.equal(windows.itemId,linux.itemId);assert.equal(windows.vaultId,linux.vaultId);
assert.equal(desktop.status,'passed');assert.equal(desktop.platform,'linux');
assert.ok(desktop.checks.some(text=>text==='real GUI Online unlock'));
assert.ok(desktop.checks.some(text=>text.includes('reveals and remasks built-in and custom')));
const desktopManifest=await verifyRelease('C:/Projects/127Vaults-Releases/desktop/internal-20261015-c/linux');
assert.equal(desktopManifest.sourceRevision,'4e1e1461666a1b6c50e43eda58719996ae05aba5');
const finalized=JSON.parse(await readFile(join(work,'..','linux-final-evidence.json'),'utf8'));
assert.notEqual(finalized.writer,windows.device);assert.notEqual(finalized.writer,linux.device);
await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./server-candidate-verify.mjs',import.meta.url)),work],{windowsHide:true});
await writeFile(join(work,'candidate-native-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,serverRevision:fixture.serverRevision,windowsCli:windows,linuxCli:linux,linuxDesktop:{...desktop,sourceRevision:desktopManifest.sourceRevision,device:finalized.writer,provenance:'Candidate runner asserts server image; shell compares executable bytes to selected Debian archive before launch'},checks:['Both selected CLI OS packages sync/read unchanged owner data on selected server-a with distinct devices','Actual selected Linux Desktop GUI fresh launch reads retained peer edit, masks/reveals/remasks both secret kinds and locks','Base candidate P1/normal-move evidence and current bundle/wiring/health/revoked-draft cleanup pass'],limits:['Retained fictitious profiles and private keyrings; clean physical installation and OS-lock separate','Reader/sync interoperability only; broader writer/pairing and new-package interruption matrix remains open','Desktop GUI profile copied and originals retained; Windows GUI policy boundary unchanged']},null,2)+'\n');
console.log('Selected Windows/Linux CLI and actual Linux Desktop reads against selected server-a verified.');
