import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {ownershipClient} from './internal-ownership-client.mjs';
const [work]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));
const repo=resolve(import.meta.dirname,'..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
async function run(p,args,cwd=repo){return new Promise((resolve,reject)=>{const c=spawn(p,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(join(work,'member-writes-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Member writer check failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
try{
  await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const client=await ownershipClient(work);for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  for(const phase of ['windows-write','linux-read-write','windows-read-restore','linux-final']){
    if(phase.startsWith('windows'))await run(process.execPath,[join(repo,'scripts/internal-member-cli-writes.mjs'),work,phase]);
    else{
      const shell=`set -euo pipefail
export XDG_DATA_HOME=/home/vaults-dev/vaults-internal-keyring-20261012-a
printf '%s\\n' synthetic-keyring-password | gnome-keyring-daemon --unlock --components=secrets >/dev/null
cd /mnt/c/Projects/127Vaults
/opt/vaults-node24/bin/node scripts/internal-member-cli-writes.mjs '/mnt/c${work.slice(2).replaceAll('\\','/')}' '${phase}'
`;
      const file=join(work,'member-'+phase+'.sh');await writeFile(file,shell);
      await run('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','dbus-run-session','--','bash','-l','/mnt/c'+file.slice(2).replaceAll('\\','/')]);
    }
    console.log('Completed '+phase);
  }
}finally{await operator('stop');}
