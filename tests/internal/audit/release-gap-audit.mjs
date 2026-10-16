// Reconcile named requirements and selected evidence; never accepts the release.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';
const repo=resolve(import.meta.dirname,'../../..'),ledgerPath=join(repo,'docs/release/internal-release-remaining-gates-2026-10-15.json');
const bytes=await readFile(ledgerPath),ledger=JSON.parse(bytes),run=promisify(execFile);
assert.equal(process.platform,'win32');assert.equal(ledger.decision,'internal release not accepted');
assert.deepEqual(ledger.requirements.map(row=>row.id),Array.from({length:12},(_,i)=>'SYNC-'+String(i+1).padStart(2,'0')));
for(const row of ledger.requirements){assert.equal(row.assessment,'partial');for(const key of ['name','source','covered','remaining'])assert.ok(row[key]?.trim());}
assert.equal(new Set(ledger.additionalNamedGates.map(row=>row.id)).size,10);
for(const file of [...ledger.requirementsSources,...ledger.evidence.notes,ledger.selectedInventory])await access(join(repo,file));
const inventory=JSON.parse(await readFile(join(repo,ledger.selectedInventory),'utf8'));assert.equal(inventory.artifacts.length,6);
const selected=[];
for(const artifact of inventory.artifacts){const release=await verifyRelease(join('C:/Projects/127Vaults-Releases',artifact.path));assert.equal(release.sourceRevision,artifact.sourceRevision);assert.deepEqual(release.files,artifact.files);selected.push({product:artifact.product,platform:artifact.platform,path:artifact.path,sourceRevision:release.sourceRevision});}
for(const artifact of inventory.candidateArtifacts??[]){const release=await verifyRelease(join('C:/Projects/127Vaults-Releases',artifact.path));assert.equal(release.sourceRevision,artifact.sourceRevision);assert.deepEqual(release.files,artifact.files);}
const historical=[...inventory.artifacts,...(inventory.supersededArtifacts??[])];
const evidenceArtifact=(product,revision,platform)=>{const artifact=historical.find(row=>row.product===product&&row.sourceRevision===revision&&(!platform||row.platform===platform));assert.ok(artifact,'Evidence has no retained artifact provenance');return artifact;};
if(process.argv.includes('--basic')){
 const sanity=JSON.parse(await readFile(ledger.functionalAssessment.sanityRecord,'utf8'));assert.equal(sanity.status,'passed');assert.equal(sanity.sourceRevision,selected.find(row=>row.product==='server').sourceRevision);assert.equal(sanity.checks.length,5);
 for(const artifact of selected.filter(row=>row.product==='desktop'))assert.equal(artifact.sourceRevision,sanity.sourceRevision);
 assert.ok(ledger.functionalAssessment.source);await access(join(repo,ledger.functionalAssessment.source));
 console.log('Six selected package manifests and basic server/web/CLI/admin sanity record verify. Detailed matrix is coverage backlog; individual item deletion remains a disclosed follow-up.');process.exit(0);
}
await run(process.execPath,[join(repo,'tests/internal/audit/member-acceptance-verify.mjs'),ledger.evidence.candidateWork,'--budget'],{windowsHide:true});
const current=JSON.parse(await readFile(join(ledger.evidence.candidateWork,ledger.evidence.latestCombined),'utf8'));assert.equal(current.status,'passed');
evidenceArtifact('desktop',current.budget.desktopSourceRevision,'linux');
assert.equal(current.budget.cliSourceRevision,selected.find(row=>row.product==='cli'&&row.platform==='windows').sourceRevision);
const rebuiltLinux=JSON.parse(await readFile(join(ledger.evidence.candidateWork,'member-rebuilt-cli-linux-read.json'),'utf8'));assert.equal(rebuiltLinux.status,'passed');assert.equal(rebuiltLinux.sourceRevision,selected.find(row=>row.product==='cli'&&row.platform==='linux').sourceRevision);
const operations=JSON.parse(await readFile(join(ledger.evidence.operationsWork,ledger.evidence.operationsCombined),'utf8'));assert.equal(operations.status,'passed');const operationsArtifact=evidenceArtifact('server',operations.sourceRevision);assert.equal(operations.evidence.checks.length,7);assert.ok(operations.evidence.checks.every(row=>row.status==='passed'));
assert.equal(operations.sourceAndRestoreReads.length,2);assert.deepEqual(operations.sourceAndRestoreReads[0],operations.sourceAndRestoreReads[1]);assert.equal(operations.sourceAndRestoreReads[0].decryptedIndexBody,true);
assert.equal(operations.sourceAndRestoreReads[0].installation,operations.evidence.installation);assert.equal(operations.archiveSha256,operationsArtifact.files.find(row=>row.name.endsWith('.tar')).sha256);
const ps=await run('podman',['ps','--format','{{.Names}}'],{windowsHide:true});
const license=JSON.parse(await readFile(join(ledger.evidence.licenseWork,ledger.evidence.licenseCombined),'utf8'));
const licenseBase=JSON.parse(await readFile(join(ledger.evidence.licenseWork,'evidence.json'),'utf8'));
assert.equal(license.status,'passed');assert.equal(license.installation,licenseBase.installation);assert.equal(license.project,licenseBase.sourceProject);const licenseArtifact=evidenceArtifact('server',license.sourceRevision);assert.equal(license.sequenceRollbackRefused,true);
assert.equal(licenseBase.archiveSha256,inventory.artifacts.find(row=>row.product==='server').files.find(row=>row.name.endsWith('.tar')).sha256);
assert.deepEqual(license.phases.map(row=>row.phase),['prepare-grace','check-grace','replay-grace','prepare-revoked','check-revoked','replay-revoked']);
for(const phase of license.phases){assert.equal(phase.status,'passed');assert.equal(phase.installation,license.installation);assert.deepEqual(JSON.parse(await readFile(join(ledger.evidence.licenseWork,'license-'+phase.phase+'.json'),'utf8')),phase);}
for(const saved of license.pendingFilesPreserved){const bytes=await readFile(join(ledger.evidence.licenseWork,'license-'+saved.kind+'-pending.json'));assert.equal(createHash('sha256').update(bytes).digest('hex'),saved.fileSha256);const packet=JSON.parse(bytes);assert.equal(packet.installation,license.installation);assert.equal(createHash('sha256').update(JSON.stringify(packet.request)).digest('hex'),packet.requestHash);}
for(const project of [licenseBase.sourceProject,licenseBase.restoreProject]){assert.match(project,/^vaults-test-[a-f0-9]{12}$/);assert.ok(!ps.stdout.includes(project));const volume=await run('podman',['volume','inspect',project+'_postgres-data','--format','{{.Name}}'],{windowsHide:true});assert.equal(volume.stdout.trim(),project+'_postgres-data');}
const nativeLicense=JSON.parse(await readFile(join(ledger.evidence.licenseWork,ledger.evidence.nativeLicenseCombined),'utf8'));assert.equal(nativeLicense.status,'passed');assert.equal(nativeLicense.installation,license.installation);assert.equal(nativeLicense.sourceRevision,selected.find(row=>row.product==='cli'&&row.platform==='windows').sourceRevision);
const upgrade=JSON.parse(await readFile(join(ledger.evidence.licenseWork,'server-b-upgrade-evidence.json'),'utf8'));assert.equal(upgrade.status,'passed');assert.equal(upgrade.installation,license.installation);assert.equal(upgrade.project,license.project);assert.deepEqual(upgrade.before,upgrade.after);assert.equal(upgrade.configurationPreserved,true);assert.equal(upgrade.sourceRevision,selected.find(row=>row.product==='server').sourceRevision);assert.equal(upgrade.databaseRestoreRehearsal.status,'passed');assert.equal(upgrade.databaseRestoreRehearsal.installation,license.installation);
for(const saved of upgrade.backupRecords){const bytes=await readFile(join(ledger.evidence.licenseWork,saved.name));assert.equal(bytes.length,saved.sizeBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),saved.sha256);}
assert.deepEqual(nativeLicense.phases.map(row=>row.phase),['enroll','queue-grace','retry-grace','finish-grace','queue-revoked','retry-revoked','finish-revoked']);
for(const phase of nativeLicense.phases){assert.equal(phase.status,'passed');assert.equal(phase.installation,license.installation);assert.deepEqual(JSON.parse(await readFile(join(ledger.evidence.licenseWork,'native-license-'+phase.phase+'.json'),'utf8')),phase);}
for(const saved of nativeLicense.pending){const bytes=await readFile(join(ledger.evidence.licenseWork,'native-license-'+saved.kind+'-original.json'));assert.equal(createHash('sha256').update(bytes).digest('hex'),saved.sha256);assert.equal(JSON.parse(bytes).length,1);}
assert.equal(nativeLicense.peer.status,'passed');assert.notEqual(nativeLicense.peer.device,nativeLicense.peer.clientDevice);assert.equal(nativeLicense.peer.clientDevice,nativeLicense.phases[0].device);
const nativeBaseline=JSON.parse(await readFile(join(ledger.evidence.licenseWork,'native-license-baseline.json'),'utf8')),nativeReplica=JSON.parse(await readFile(join(nativeLicense.profile,'replicas',nativeBaseline.vaultId+'.json'),'utf8'));assert.deepEqual(nativeReplica.pending,[]);assert.deepEqual(nativeReplica.conflicts,[]);
await run('powershell.exe',['-NoProfile','-Command',"$taskProcesses = @(Get-CimInstance Win32_Process -Filter \"Name='127vaults.exe'\" | Where-Object { $_.CommandLine -like '*127Vaults-license-isolated-20261015-a*native-cli-windows-b*' }); if ($taskProcesses.Count -ne 0) { throw 'Native license fixture process remains live' }"],{windowsHide:true});
for(const project of [operations.evidence.sourceProject,operations.evidence.restoreProject]){assert.match(project,/^vaults-test-[a-f0-9]{12}$/);assert.ok(!ps.stdout.includes(project));const volume=await run('podman',['volume','inspect',project+'_postgres-data','--format','{{.Name}}'],{windowsHide:true});assert.equal(volume.stdout.trim(),project+'_postgres-data');}
const git=await run('git',['rev-parse','HEAD'],{cwd:repo,windowsHide:true});
const report={status:'extended requirement/evidence reconciliation passed',auditedAt:new Date().toISOString(),gitHead:git.stdout.trim(),ledgerSha256:createHash('sha256').update(bytes).digest('hex'),selected,scenarioFamilies:ledger.requirements.map(row=>({id:row.id,assessment:row.assessment,remaining:row.remaining})),additionalNamedGates:ledger.additionalNamedGates.map(row=>({id:row.id,state:row.state})),checks:['All twelve original scenario families remain explicit; no all-pair completion inferred','All six selected artifact file sets/hashes/revisions verified','Latest concrete member/native/web/Desktop/P1 and exact cleanup evidence checked','Selected operational seven checks and paired decrypted data/digest records match; retained volumes stopped','Selected-server signed-license refusal/renewal records, exact retained request hashes and stopped isolated volumes verified; client/locked-mode gaps remain','No test server started, restore repeated, permission granted or goal scope waived'],decision:ledger.decision,functionalDecision:ledger.functionalAssessment.status};
await writeFile(join(ledger.evidence.candidateWork,'release-gap-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log('Extended coverage remains partial; selected artifacts and historical evidence reconcile. Functional readiness: '+ledger.functionalAssessment.status+'.');
