import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {ownershipClient} from '../ownership/ownership-client.mjs';
const [work,mode]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));assert.ok(mode===undefined||mode==='--recover');
const repo=resolve(import.meta.dirname,'../../..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
async function run(p,args,cwd=repo){return new Promise((resolve,reject)=>{const c=spawn(p,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(join(work,'member-writes-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Member writer check failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
try{
  await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const client=await ownershipClient(work);for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  for(const phase of [mode==='--recover'?'web-recover':'web-write','windows-web-restore','web-final']){
    if(phase.startsWith('windows'))await run(process.execPath,[join(repo,'tests/internal/cli/member-cli-writes.mjs'),work,phase]);
    else await run('podman',['run','--rm','--name','vaults-member-web-writer-20261015-a','--network','host','--volume',repo+':/repo:ro','--volume',work+':/evidence','--volume',fixture.identity+':/identity:ro','--env','VAULTS_PLAYWRIGHT_MODULE=/fixture/modules/playwright','localhost/127vaults-sync-web:20261014-a','node','/repo/tests/internal/web/member-web-writes.mjs','/evidence',phase]);
    console.log('Completed '+phase);
  }
}finally{await operator('stop');}
