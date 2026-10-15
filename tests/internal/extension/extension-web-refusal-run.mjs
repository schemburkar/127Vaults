import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';
import {ownershipClient} from '../ownership/ownership-client.mjs';
const [work]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));
const repo=resolve(import.meta.dirname,'../../..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
async function run(p,args,cwd=repo){return new Promise((resolve,reject)=>{const c=spawn(p,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(join(work,'member-writes-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Member writer check failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
const releaseRoot='C:/Projects/127Vaults-Releases/extension/internal-20261014-a/chromium';
const release=await verifyRelease(releaseRoot);assert.equal(release.sourceRevision,'07fdca56a281f786b18c639347d86c631bc64585');
const archive=release.files.find(row=>row.name.endsWith('.zip')),archivePath=join(releaseRoot,archive.name),extracted=join(work,'extension-selected');
const names=execFileSync('tar',['-tf',archivePath],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(name=>!name.endsWith('/'));
assert.ok(names.every(name=>name.startsWith('127vaults-extension/')&&!name.includes('..')));
try{await mkdir(extracted);execFileSync('tar',['-xf',archivePath,'-C',extracted],{windowsHide:true});}catch(error){if(error.code!=='EEXIST')throw error;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const actual=[];for(const path of await readdir(extracted,{recursive:true}))if((await stat(join(extracted,path))).isFile())actual.push(path.replaceAll('\\','/'));
assert.deepEqual(actual.sort(),names.slice().sort());for(const name of names)assert.equal(hash(await readFile(join(extracted,name))),hash(execFileSync('tar',['-xOf',archivePath,name],{windowsHide:true})));
await writeFile(join(work,'extension-selected-package.json'),JSON.stringify({status:'passed',sourceRevision:release.sourceRevision,archiveSha256:archive.sha256,files:names.length,verifiedAt:new Date().toISOString()},null,2)+'\n');
try{
  await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const client=await ownershipClient(work);for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  await run('podman',['run','--rm','--name','vaults-extension-web-refusal-20261015-a','--network','host','--volume',repo+':/repo:ro','--volume',work+':/evidence','--volume',fixture.identity+':/identity:ro','--env','VAULTS_PLAYWRIGHT_MODULE=/fixture/modules/playwright','localhost/127vaults-sync-web:20261014-a','node','/repo/tests/internal/extension/extension-web-refusal.mjs','/evidence']);
  console.log('Selected extension actual-web missing-permission acceptance passed.');
}finally{await operator('stop');}
