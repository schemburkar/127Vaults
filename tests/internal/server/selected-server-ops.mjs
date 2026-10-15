// Fresh selected-package operational rehearsal; never restore over retained data.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';
const [work,mode]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));assert.ok(mode===undefined||mode==='--verify-existing');
if(mode===undefined)await assert.rejects(access(work),error=>error.code==='ENOENT');
const repo=resolve(import.meta.dirname,'../../..'),release='C:/Projects/127Vaults-Releases/server/internal-20261015-a/linux-amd64';
const manifest=await verifyRelease(release);assert.equal(manifest.sourceRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
const archive=manifest.files.find(row=>row.name.endsWith('.tar'));assert.ok(archive);
async function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:repo,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code?reject(Error('Selected package operational rehearsal failed; fixture retained')):resolve());});}
if(mode===undefined)await run([join(repo,'tests/internal/server/server-release-smoke.mjs'),'--bundle',join(release,archive.name),'--work',work,'--compose-provider',join(repo,'.tools/compose/Scripts/podman-compose.exe'),'--port','12899']);
const evidence=JSON.parse(await readFile(join(work,'evidence.json'),'utf8'));assert.equal(evidence.status,'passed');assert.equal(evidence.checks.length,7);assert.ok(evidence.checks.every(row=>row.status==='passed'));
assert.equal(evidence.archiveSha256,archive.sha256);assert.notEqual(evidence.sourceProject,evidence.restoreProject);
assert.notEqual(evidence.installation,'98027ac4-9882-42d5-812a-a18c972c299f');assert.notEqual(evidence.installation,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');
const names=execFileSync('podman',['ps','--format','{{.Names}}'],{encoding:'utf8',windowsHide:true});
for(const project of [evidence.sourceProject,evidence.restoreProject]){
  assert.match(project,/^vaults-test-[a-f0-9]{12}$/);assert.ok(!['vaults-test-632a4442dfd2','vaults-test-a0540f7d9c99'].includes(project));
  assert.ok(!names.includes(project));assert.equal(execFileSync('podman',['volume','inspect',project+'_postgres-data','--format','{{.Name}}'],{encoding:'utf8',windowsHide:true}).trim(),project+'_postgres-data');
}
const capture=(args,options={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],...options});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',async code=>{if(code){await writeFile(join(work,'selected-ops-reader-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Operational read check failed; private diagnostic retained'));}else resolve(out.trim());});});
const reads=[];
for(const [directory,project] of [[join(work,'extracted/127vaults-server-0.0.0-linux-amd64'),evidence.sourceProject],[join(work,'restore-bundle'),evidence.restoreProject]]){
  const operator=action=>capture([join(directory,'server.mjs'),'install',action,'--compose-provider',join(repo,'.tools/compose/Scripts/podman-compose.exe')],{cwd:directory});
  try{
    await operator('start');assert.equal(execFileSync('podman',['inspect',project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),'4bfc4bf6344f20efcb574501aca5c6f212d3ffdc752892867b504b74a8939a27');
    for(let attempt=0;;attempt++){
      try{const result=JSON.parse(await capture([join(repo,'scripts/ops/restored-owner-smoke.mjs'),'https://127.0.0.1:12899'],{env:{...process.env,NODE_EXTRA_CA_CERTS:join(work,'identity/ca/ca.crt')}}));assert.equal(result.ok,true);assert.equal(result.installation,evidence.installation);assert.equal(result.decryptedIndexBody,true);assert.match(result.encryptedItemSha256,/^[a-f0-9]{64}$/);reads.push(result);break;}
      catch(error){if(attempt>=19)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
    }
  }finally{await operator('stop');}
}
assert.deepEqual(reads[0],reads[1]);
const after=execFileSync('podman',['ps','--format','{{.Names}}'],{encoding:'utf8',windowsHide:true});for(const project of [evidence.sourceProject,evidence.restoreProject])assert.ok(!after.includes(project));
await run([join(repo,'tests/internal/audit/member-acceptance-verify.mjs'),'C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a','--extension']);
await writeFile(join(work,'selected-operational-evidence.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),sourceRevision:manifest.sourceRevision,release,archiveSha256:archive.sha256,serverImageId:'4bfc4bf6344f20efcb574501aca5c6f212d3ffdc752892867b504b74a8939a27',evidence,sourceAndRestoreReads:reads,cleanup:['Both fresh source/restore projects stopped with selected image; volumes retained','Retained candidate stopped; original healthy and revoked draft unchanged'],limits:['Existing Windows Podman host; unrelated-host/Docker/physical/intended-host operations remain separate','Fictitious data and local trust; no external SMTP/production credentials or public deployment']},null,2)+'\n');
console.log('Selected server fresh backup/restore, hostile paths, admin and cleanup verified.');
