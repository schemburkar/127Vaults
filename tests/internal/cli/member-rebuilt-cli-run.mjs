import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
const work='C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a';
assert.equal(process.platform,'win32');const fixture=JSON.parse(await readFile(work+'/fixture.json','utf8'));
assert.equal(fixture.project,'vaults-test-632a4442dfd2');
async function run(exe,args,cwd){return new Promise((resolve,reject)=>{const c=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(work+'/rebuilt-cli-read-failure-'+Date.now()+'.log',err,{flag:'wx',mode:0o600});reject(Error('Read fixture failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider','C:/Projects/127Vaults/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
const shell=`set -euo pipefail
export XDG_DATA_HOME=/home/vaults-dev/vaults-internal-keyring-20261012-a
printf '%s\\n' synthetic-keyring-password | gnome-keyring-daemon --unlock --components=secrets >/dev/null
task_extract=/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/cli-budget-b
test ! -e "$task_extract"
mkdir "$task_extract"
tar -xf /mnt/c/Projects/127Vaults-Releases/cli/internal-20261015-b/linux/127vaults-cli-0.0.0-linux-x64.tar.gz -C "$task_extract"
cd /mnt/c/Projects/127Vaults
/opt/vaults-node24/bin/node tests/internal/cli/member-rebuilt-cli-read.mjs /mnt/c/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a
`;
await writeFile(work+'/member-rebuilt-cli-read.sh',shell,{flag:'wx'});
try{
 await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
 const {ownershipClient}=await import('../ownership/ownership-client.mjs');const client=await ownershipClient(work);
 for(let i=0;;i++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(i>=44||!['ECONNREFUSED','ECONNRESET'].includes(error.code))throw error;await new Promise(r=>setTimeout(r,1000));}}
 console.log((await run('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','dbus-run-session','--','bash','-l','/mnt/c/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a/member-rebuilt-cli-read.sh'],'C:/Projects/127Vaults')).trim());
}finally{await operator('stop');}
