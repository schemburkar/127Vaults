import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {ownershipClient} from './internal-ownership-client.mjs';
const [work]=process.argv.slice(2);assert.equal(process.platform,'win32');assert.ok(work&&isAbsolute(work));
const repo=resolve(import.meta.dirname,'..'),fixture=JSON.parse(await readFile(join(work,'fixture.json'),'utf8'));assert.equal(fixture.project,'vaults-test-632a4442dfd2');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
await assert.rejects(access(join(work,'member-desktop-budget.json')),error=>error.code==='ENOENT');
async function run(p,args,cwd=repo){return new Promise((resolve,reject)=>{const c=spawn(p,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(join(work,'member-desktop-run-failure-'+Date.now()+'.log'),err,{flag:'wx',mode:0o600});reject(Error('Member Desktop check failed; private diagnostic retained'));}else resolve(out);});});}
const operator=action=>run(process.execPath,['server.mjs','install',action,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe'],fixture.bundle);
try{
  await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
  const client=await ownershipClient(work);for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  for(const phase of ['desktop-budget-burn','desktop-budget-retry','desktop-budget-replay','windows-budget-restore','desktop-budget-final']){
    if(phase==='desktop-budget-burn')await operator('stop');
    if(phase==='desktop-budget-replay'){
      await operator('start');assert.equal(execFileSync('podman',['inspect',fixture.project+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),fixture.serverImageId);
      for(let attempt=0;;attempt++){try{assert.equal((await client.http('/api/v1/setup')).status,200);break;}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code)||attempt>=44)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
    }
    if(phase.startsWith('windows'))await run(process.execPath,[join(repo,'scripts/internal-member-cli-writes.mjs'),work,phase]);
    else{
      const shell=`set -euo pipefail
export XDG_DATA_HOME=/home/vaults-dev/vaults-internal-keyring-20261012-a
printf '%s\n' synthetic-keyring-password | gnome-keyring-daemon --unlock --components=secrets >/dev/null
task_source_profile=/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a
task_target_profile=/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a
${phase==='desktop-write'?'test ! -e "$task_target_profile"\ncp -a "$task_source_profile" "$task_target_profile"':'test -d "$task_target_profile"'}
task_binary=/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-app-budget-d/usr/bin/vaults-desktop-poc
task_binary_hash=$(sha256sum "$task_binary" | cut -d ' ' -f1)
task_package_hash=$(dpkg-deb --fsys-tarfile /mnt/c/Projects/127Vaults-Releases/desktop/internal-20261015-d/linux/127vaults-desktop-0.0.0-linux-x64.deb | tar -xOf - usr/bin/vaults-desktop-poc | sha256sum | cut -d ' ' -f1)
test "$task_binary_hash" = "$task_package_hash"
export VAULTS_CONFIG_DIR="$task_target_profile"
export VAULTS_FIXTURE_DESKTOP_SHA="$task_binary_hash"
export WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:12926
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
"$task_binary" >'${'/mnt/c'+work.slice(2).replaceAll('\\','/')}/member-${phase}-app.log' 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true' EXIT
cd /mnt/c/Projects/127Vaults
/opt/vaults-node24/bin/node scripts/internal-member-desktop-budget-ui.mjs '${'/mnt/c'+work.slice(2).replaceAll('\\','/')}' '${phase}'
`;
      const file=join(work,'member-budget-d-'+phase+'-'+Date.now()+'.sh');await writeFile(file,shell,{flag:'wx'});
      await run('wsl.exe',['-d','Ubuntu-24.04','-u','vaults-dev','--exec','dbus-run-session','--','bash','-l','/mnt/c'+file.slice(2).replaceAll('\\','/')]);
    }
    console.log('Completed '+phase);
  }
}finally{await operator('stop');}
