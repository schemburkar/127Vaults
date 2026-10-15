// Candidate acceptance and cleanup; no fixture start or mutation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyRelease } from './release/verify-release.mjs';
import { verify } from '../deploy/install.mjs';

const [work]=process.argv.slice(2);assert.ok(work&&isAbsolute(work));
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),pkg=await json('package-evidence.json');
assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
const manifest=await verifyRelease(pkg.release);assert.equal(manifest.sourceRevision,fixture.serverRevision);
await verify(fixture.bundle);
for(const name of ['compose.test.yaml','manifest.json','.env'])assert.deepEqual(await readFile(join(fixture.bundle,name)),await readFile(join(work,'candidate-before-'+name.replaceAll('.','_'))));
const record=await json('web-move-destination-loss-fixture.json'),loss=await json('web-move-destination-loss.json'),guard=await json('web-move-destination-guard.json'),abort=await json('web-move-destination-abort.json'),edit=await json('web-move-destination-peer-edit.json'),normal=await json('web-move-candidate-normal.json'),normalFixture=await json('web-move-candidate-normal-fixture.json'),peer=await json('web-move-candidate-peer.json');
for(const result of [loss,guard,abort,normal,peer]){assert.equal(result.status,'passed');assert.equal(result.serverId,fixture.serverId);assert.equal(result.serverRevision,fixture.serverRevision);}
assert.equal(edit.editedVault,record.destination);assert.equal(edit.editedItem,record.destinationItem);assert.equal(edit.status,'passed');
assert.ok(record.guardPassed&&record.abortPassed&&record.peerEditPassed);
assert.ok(guard.checks[0].includes('destination copy'));
for(const result of [guard,abort])assert.equal(result.mutations.filter(row=>row.path.endsWith('/removal')||row.path==='/api/v1/vaults/'+record.destination+'/items').length,0);
assert.equal(normalFixture.movePassed,true);assert.equal(normalFixture.source,record.source);
assert.notEqual(normalFixture.destinationItem,record.destinationItem);
assert.equal(normal.mutations.filter(row=>row.path.endsWith('/removal')&&row.status===200).length,1);
assert.equal(normal.mutations.filter(row=>row.path==='/api/v1/vaults/'+record.destination+'/items'&&row.status===200).length,1);
assert.equal(peer.preservedDestinationPeerEdit,true);
assert.notEqual(peer.peerDevice,peer.browserDevice);
assert.equal(peer.verified.find(row=>row.kind==='source').retired,true);
const destination=peer.verified.find(row=>row.kind==='destination');assert.equal(destination.itemCount,6);assert.equal(destination.preservedDestinationEditItemId,record.destinationItem);
const run=promisify(execFile),ps=await run('podman',['ps','--format','{{.Names}} {{.Status}}'],{windowsHide:true});
assert.ok(!ps.stdout.includes(fixture.project)&&!ps.stdout.includes('vaults-web-move-'));
for(const service of ['server','database'])assert.match(ps.stdout,new RegExp('vaults-test-a0540f7d9c99_'+service+'_1 Up[^\\n]*healthy'));
const original=join(work,'..'),revoked=JSON.parse(await readFile(join(original,'revocation-evidence.json'),'utf8'));
assert.equal((await readFile(join(original,'clients-revocation/device-b/vault-removal.json'))).toString('base64'),revoked.journalBytes);
assert.deepEqual(JSON.parse(await readFile(join(original,'clients-revocation/device-b/replicas/'+revoked.destination+'.json'),'utf8')).pending,revoked.pending);
await writeFile(join(work,'candidate-combined-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),serverId:fixture.serverId,sourceRevision:fixture.serverRevision,release:pkg.release,files:manifest.files,loss,edit,guard,abort,normal,peer,cleanup:['New fixture/bundle unchanged and project stopped','Original installation healthy and revoked draft/journal unchanged'],limits:['Targeted packaged P1 refusal/cancel and valid move; broader release matrix remains open','Ordinary headless Linux web with strict-CA relay and service-worker bypass; independent reader is source crypto helper']},null,2)+'\n');
console.log('Immutable server candidate destination-edit protection, valid move, independent reader and cleanup verified.');
