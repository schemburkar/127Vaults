import { ensureTlsReady } from './mvp-startup.mjs';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url))),action=process.argv[2];
if(!['start','dev','migrate','exercise','view','browser','reset','stop'].includes(action))throw Error('Usage: node scripts/mvp-acceptance.mjs start|dev|migrate|exercise|view|browser|reset|stop');
const values={};for(const line of (await readFile(join(root,'.env'),'utf8')).split(/\r?\n/)){const match=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(match)values[match[1]]=match[2]}
const project='vaults-acceptance';
const localCompose=join(root,'.tools','compose',process.platform==='win32'?'Scripts/podman-compose.exe':'bin/podman-compose');
const podman=process.platform==='win32'?join(process.env.ProgramFiles??'C:\\Program Files','RedHat','Podman','podman.exe'):'podman';
const composeProvider=await (async()=>await access(localCompose).then(()=>true).catch(()=>false)?localCompose:'docker-compose')();
const compose=[...(composeProvider===localCompose?['--podman-path',podman]:[]),'-p',project,'-f','compose.yaml','-f','compose.acceptance.yaml'];
const environment={...process.env,...values,VAULTS_ENDPOINT_HOST:'127.0.0.1',VAULTS_PUBLISH_ADDRESS:'127.0.0.1',VAULTS_PUBLISH_PORT:action==='dev'?'12781':'12780',...(process.platform==='win32'?{DOCKER_HOST:'npipe:////./pipe/podman-machine-default',VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS:'1'}:{})};
function run(command,args,{capture=false,env=environment,input}={}){const result=spawnSync(command,args,{cwd:root,env,input,encoding:'utf8',stdio:input!==undefined?['pipe','inherit','inherit']:capture?'pipe':'inherit',windowsHide:true});if(result.status!==0)throw Error((result.stderr||result.stdout||`${command} failed`).trim());return result.stdout?.trim()??''}
const composeRun=(args,options)=>run(composeProvider,[...compose,...args],options);
const serverContainer=`${project}_server_1`;
const copyCa=destination=>run(podman,['cp',`${serverContainer}:/run/secrets/ca.crt`,destination]);
const exists=async path=>{try{await access(path);return true}catch{return false}};

const portOpen=port=>new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.on('connect',()=>{socket.destroy();resolve(true)});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false)})});
async function waitForServerReady(){
 for(let attempt=0;attempt<30;attempt++){
  let state='';
  try { state=run(podman,['inspect',serverContainer,'--format','{{.State.Status}} {{.State.Health.Status}}'],{capture:true}); } catch {}
  if(state.trim()==='running healthy')return;
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw Error('The acceptance server did not become healthy. Inspect its logs; if the schema is behind, run pnpm mvp:migrate, then pnpm mvp:dev. Do not reset the database.');
}
async function ensureRuntimeSecrets(){const directory=resolve(values.VAULTS_TLS_DIR),fromTemp=relative(resolve(tmpdir()),directory);if(!fromTemp||(fromTemp!=='..'&&!fromTemp.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&!isAbsolute(fromTemp)))throw Error('VAULTS_TLS_DIR must be outside the OS temporary directory. Move the complete existing server identity to a persistent private directory and update .env.');const runtime=join(directory,'runtime');await mkdir(runtime,{recursive:true});for(const name of ['token.key','checkpoint.key']){const path=join(runtime,name);if(!await exists(path)){if(name==='checkpoint.key'&&await exists(join(runtime,'token.key')))throw Error('Existing server identity is missing runtime/checkpoint.key. Restore the matching identity backup instead of rotating it.');await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600})}if((await readFile(path)).length!==32)throw Error(`${name} must contain exactly 32 bytes.`);if(process.platform!=='win32')await chmod(path,0o600)}for(const [name,key] of [['postgres-password','POSTGRES_PASSWORD'],['readiness-token','VAULTS_READINESS_TOKEN']]){if(!/^[a-f0-9]{64}$/.test(values[key]??''))throw Error(`Missing ${key} in .env`);await writeFile(join(runtime,name),values[key],{mode:0o600});if(process.platform!=='win32')await chmod(join(runtime,name),0o600)}const smtp=join(runtime,'smtp-password');if(!await exists(smtp))await writeFile(smtp,'fixture-password',{flag:'wx',mode:0o600});if(process.platform!=='win32')await chmod(smtp,0o600)}
const readBootstrap=()=>composeRun(['exec','-T','server','sh','-c','if test -s /run/runtime/bootstrap.txt; then cat /run/runtime/bootstrap.txt; fi'],{capture:true});
const ensureBootstrap=()=>{
 let token=readBootstrap();
 if(!token){composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','create-bootstrap-token']);token=readBootstrap();}
 if(!token)throw Error('Bootstrap token generation did not produce the expected restricted output file.');
 return token;
};
if(action==='dev' && await portOpen(12780) && await portOpen(12781)){
 await waitForServerReady();
 run(process.execPath,['scripts/build-fixture.mjs']);
 console.log('The hot-reload UI and API are already running at https://127.0.0.1:12780.');
}else if(action==='start'||action==='dev'){
 await ensureTlsReady(values, action);
 await ensureRuntimeSecrets();
 run(process.execPath,['scripts/build-fixture.mjs']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 composeRun(['down','--remove-orphans']);
 composeRun(['up','-d','--no-build','--force-recreate','database','server']);
 await waitForServerReady();
 if(action==='start')console.log('Acceptance stack ready at https://127.0.0.1:12780 (disposable fictitious data only).');
 else {
  console.log('Containerized API ready behind the local hot-reload UI at https://127.0.0.1:12780.');
  console.log('Server admin: https://127.0.0.1:12780/admin/ (12781 is the internal backend, not an admin port).');
  if(await portOpen(12780))console.log('Using the existing hot-reload UI on port 12780.');
  else run(process.execPath,[join(root,'apps','web','node_modules','vite','bin','vite.js'),'apps/web','--host','127.0.0.1']);
 }
}else if(action==='migrate'){
 // Keep the backend on its existing published port when the hot-reload UI is running.
 let mappedPort;
 try { mappedPort=run(podman,['port',serverContainer,'12780/tcp'],{capture:true}).match(/:(12780|12781)\s*$/)?.[1]; } catch {}
 if(mappedPort)environment.VAULTS_PUBLISH_PORT=mappedPort;
 await ensureRuntimeSecrets();
 composeRun(['up','-d','database']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 // A compose `run server` inherits the server service's fixed backend address.
 // Remove the long-running app containers first so the one-shot migration job
 // can claim that address while PostgreSQL and its evidence volume stay up.
 composeRun(['stop','server','smtp-capture']);
 run(podman,['rm','-f','--ignore',serverContainer,`${project}_smtp-capture_1`]);
 for(let step=0;step<5;step++){
  const output=composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','status'],{capture:true});
  const state=JSON.parse(output.split('\n').at(-1));
  if(state.state==='current')break;
  if(state.state!=='migration-required')throw Error('Unknown schema state; no migration was applied.');
  composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','dry-run']);
  composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','apply']);
  if(step===4)throw Error('Schema remains behind after five migration steps.');
 }
 composeRun(['up','-d','--no-build','--force-recreate','server']);
 await waitForServerReady();
 console.log('Schema migration applied transactionally and the server restarted.');
}else if(action==='exercise'){
 if(!composeRun(['ps'],{capture:true}).includes('server'))throw Error('Run pnpm mvp:start first.');
 const ca=join(root,'.tools','acceptance-ca.crt');await mkdir(dirname(ca),{recursive:true});copyCa(ca);
 const state=JSON.parse(composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','status'],{capture:true}));
 const bootstrap=state.bootstrapRequired?ensureBootstrap():'';
 const nodeEnv={...environment,NODE_EXTRA_CA_CERTS:ca};
 if(bootstrap)run(process.execPath,['scripts/live-mvp-acceptance.mjs','https://127.0.0.1:12780',ca,'-'],{env:nodeEnv,input:bootstrap});
 else console.log('Owner already exists; preserving it and exercising the repeatable invited-user path.');
 run(process.execPath,['scripts/live-invite-acceptance.mjs','https://127.0.0.1:12780'],{env:nodeEnv});
 run(process.execPath,['scripts/live-transport-acceptance.mjs','https://127.0.0.1:12780',ca],{env:nodeEnv});
 const dump=composeRun(['exec','-T','database','pg_dump','-U','vaults','-d','vaults_experimental','--data-only'],{capture:true}),logs=composeRun(['logs','--no-color','server'],{capture:true});
 for(const marker of ['fictitious password 127vaults','not-a-secret','updated-fiction','race-a','race-b','127V-B1-','BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'])if(dump.includes(marker)||logs.includes(marker))throw Error('Known fictitious plaintext marker reached PostgreSQL or server logs.');
 console.log(JSON.stringify({ok:true,databaseAndLogsPlaintextFree:true}));
}else if(action==='browser'){
 if(!composeRun(['ps'],{capture:true}).includes('server'))throw Error('Run pnpm mvp:start first.');
 const ca=join(root,'.tools','acceptance-ca.crt');await mkdir(dirname(ca),{recursive:true});copyCa(ca);
 const state=JSON.parse(composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','status'],{capture:true}));
 console.log(`Trust this local CA in your browser/OS: ${ca}`);
 console.log('Open https://127.0.0.1:12780');
 if(state.bootstrapRequired)console.log(`One-time first-owner bootstrap code: ${ensureBootstrap()}`);
 else console.log('An owner already exists. Use its original browser profile, or run pnpm mvp:stop then pnpm mvp:reset for a fresh disposable browser demo.');
}else if(action==='view'){
 run(composeProvider,[...compose,'ps']);console.log('Open https://127.0.0.1:12780/health/live after trusting the local CA.');
}else if(action==='reset'){run(composeProvider,[...compose,'down','--volumes']);console.log('Deleted the disposable acceptance PostgreSQL volume.');}
else {run(composeProvider,[...compose,'down']);console.log('Stopped acceptance containers; PostgreSQL evidence volume retained.');}
