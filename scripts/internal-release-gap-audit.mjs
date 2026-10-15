// Reconcile named requirements and selected evidence; never accepts the release.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {verifyRelease} from './release/verify-release.mjs';
const repo=resolve(import.meta.dirname,'..'),ledgerPath=join(repo,'docs/release/internal-release-remaining-gates-2026-10-15.json');
const bytes=await readFile(ledgerPath),ledger=JSON.parse(bytes),run=promisify(execFile);
assert.equal(process.platform,'win32');assert.equal(ledger.decision,'internal release not accepted');
assert.deepEqual(ledger.requirements.map(row=>row.id),Array.from({length:12},(_,i)=>'SYNC-'+String(i+1).padStart(2,'0')));
for(const row of ledger.requirements){assert.equal(row.assessment,'partial');for(const key of ['name','source','covered','remaining'])assert.ok(row[key]?.trim());}
assert.equal(new Set(ledger.additionalNamedGates.map(row=>row.id)).size,10);
for(const file of [...ledger.requirementsSources,...ledger.evidence.notes,ledger.selectedInventory])await access(join(repo,file));
const inventory=JSON.parse(await readFile(join(repo,ledger.selectedInventory),'utf8'));assert.equal(inventory.artifacts.length,6);
const selected=[];
for(const artifact of inventory.artifacts){const release=await verifyRelease(join('C:/Projects/127Vaults-Releases',artifact.path));assert.equal(release.sourceRevision,artifact.sourceRevision);assert.deepEqual(release.files,artifact.files);selected.push({product:artifact.product,platform:artifact.platform,path:artifact.path,sourceRevision:release.sourceRevision});}
await run(process.execPath,[join(repo,'scripts/internal-member-acceptance-verify.mjs'),ledger.evidence.candidateWork,'--desktop-multi'],{windowsHide:true});
const current=JSON.parse(await readFile(join(ledger.evidence.candidateWork,ledger.evidence.latestCombined),'utf8'));assert.equal(current.status,'passed');
const operations=JSON.parse(await readFile(join(ledger.evidence.operationsWork,ledger.evidence.operationsCombined),'utf8'));assert.equal(operations.status,'passed');assert.equal(operations.sourceRevision,selected.find(row=>row.product==='server').sourceRevision);assert.equal(operations.evidence.checks.length,7);assert.ok(operations.evidence.checks.every(row=>row.status==='passed'));
assert.equal(operations.sourceAndRestoreReads.length,2);assert.deepEqual(operations.sourceAndRestoreReads[0],operations.sourceAndRestoreReads[1]);assert.equal(operations.sourceAndRestoreReads[0].decryptedIndexBody,true);
assert.equal(operations.sourceAndRestoreReads[0].installation,operations.evidence.installation);assert.equal(operations.archiveSha256,inventory.artifacts.find(row=>row.product==='server').files.find(row=>row.name.endsWith('.tar')).sha256);
const ps=await run('podman',['ps','--format','{{.Names}}'],{windowsHide:true});
for(const project of [operations.evidence.sourceProject,operations.evidence.restoreProject]){assert.match(project,/^vaults-test-[a-f0-9]{12}$/);assert.ok(!ps.stdout.includes(project));const volume=await run('podman',['volume','inspect',project+'_postgres-data','--format','{{.Name}}'],{windowsHide:true});assert.equal(volume.stdout.trim(),project+'_postgres-data');}
const git=await run('git',['rev-parse','HEAD'],{cwd:repo,windowsHide:true});
const report={status:'requirement/evidence reconciliation passed; release unaccepted',auditedAt:new Date().toISOString(),gitHead:git.stdout.trim(),ledgerSha256:createHash('sha256').update(bytes).digest('hex'),selected,scenarioFamilies:ledger.requirements.map(row=>({id:row.id,assessment:row.assessment,remaining:row.remaining})),additionalNamedGates:ledger.additionalNamedGates.map(row=>({id:row.id,state:row.state})),checks:['All twelve original scenario families remain explicit; no all-pair completion inferred','All six selected artifact file sets/hashes/revisions verified','Latest concrete member/native/web/Desktop/P1 and exact cleanup evidence checked','Selected operational seven checks and paired decrypted data/digest records match; retained volumes stopped','No test server started, restore repeated, permission granted or goal scope waived'],decision:ledger.decision};
await writeFile(join(ledger.evidence.candidateWork,'release-gap-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log('Reconciled 12 original scenario families and 10 named additional gates; all six selected artifacts and scoped evidence verify. Internal release remains unaccepted.');
