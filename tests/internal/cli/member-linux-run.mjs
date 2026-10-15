// Own only the selected candidate project and a new Linux member profile.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join,isAbsolute} from 'node:path';
const [work]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));
const repo=resolve(import.meta.dirname,'../../..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));
assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
await assert.rejects(access(join(work,'member-cli-linux-enrollment-request.json')),error=>error.code==='ENOENT');
const linuxPath=path=>'/mnt/'+path[0].toLowerCase()+path.slice(2).replaceAll('\\','/');
async function run(program,args,cwd=repo){return new Promise((resolve,reject)=>{const c=spawn(program,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(join(work,'member-linux-run-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Owned Linux member command failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
let worker,finished=false;
try{
  await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const shell=`set -euo pipefail
export XDG_DATA_HOME=/home/vaults-dev/vaults-internal-keyring-20261012-a
printf '%s\n' synthetic-keyring-password | gnome-keyring-daemon --unlock --components=secrets >/dev/null
cd /mnt/c/Projects/127Vaults
/opt/vaults-node24/bin/node tests/internal/cli/member-cli-linux-enrollment.mjs '${linuxPath(work)}'
`;
  await writeFile(join(work,'member-cli-linux-enroll.sh'),shell);
  worker=spawn('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','dbus-run-session','--','bash','-l',linuxPath(join(work,'member-cli-linux-enroll.sh'))],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let err='';worker.stdout.resume();worker.stderr.on('data',b=>err+=b);
  const completion=new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('close',async code=>{finished=true;if(code){await writeFile(join(work,'member-linux-worker-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Linux enrollment worker failed; private diagnostic retained'));}else resolve();});});completion.catch(()=>{});
  for(let attempt=0;;attempt++){try{await access(join(work,'member-cli-linux-enrollment-request.json'));break;}catch(error){if(finished)await completion;if(error.code!=='ENOENT'||attempt>=89)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  await run('podman',['run','--rm','--name','vaults-member-cli-linux-approval-20261015-a','--network','host','--volume',repo+':/repo:ro','--volume',work+':/evidence','--volume',fixture.identity+':/identity:ro','--env','VAULTS_PLAYWRIGHT_MODULE=/fixture/modules/playwright','localhost/127vaults-sync-web:20261014-a','node','/repo/tests/internal/cli/member-cli-approve.mjs','/evidence','--linux']);
  await completion;console.log('Fresh Linux member enrollment, web approval, native reads and keyring restart passed.');
}finally{if(worker&&!finished)worker.kill();await operator('stop');}
