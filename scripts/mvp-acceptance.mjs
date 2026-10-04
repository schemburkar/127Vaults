import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
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
async function ensureTlsReady(){
 const directory=values.VAULTS_TLS_DIR;
 if(!directory)throw Error('VAULTS_TLS_DIR is missing from .env. Complete the TLS setup in docs/release/experimental-development.md.');
 const required=[join(directory,'live','server.crt'),join(directory,'live','server.key'),join(directory,'ca',values.VAULTS_CA_CERT_FILE||'ca.crt')];
 if(!(await Promise.all(required.map(exists))).every(Boolean))throw Error(`Local TLS files are missing in ${directory}. Run pnpm tls:init -- 127.0.0.1 "${directory}" before pnpm mvp:${action}.`);
}
const portOpen=port=>new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.on('connect',()=>{socket.destroy();resolve(true)});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false)})});
async function ensureRuntimeSecrets(){const runtime=join(values.VAULTS_TLS_DIR,'runtime');await mkdir(runtime,{recursive:true});for(const name of ['token.key','checkpoint.key']){const path=join(runtime,name);if(!await exists(path))await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600});if((await readFile(path)).length!==32)throw Error(`${name} must contain exactly 32 bytes.`);if(process.platform!=='win32')await chmod(path,0o600)}for(const [name,key] of [['postgres-password','POSTGRES_PASSWORD'],['readiness-token','VAULTS_READINESS_TOKEN']]){if(!/^[a-f0-9]{64}$/.test(values[key]??''))throw Error(`Missing ${key} in .env`);await writeFile(join(runtime,name),values[key],{mode:0o600});if(process.platform!=='win32')await chmod(join(runtime,name),0o600)}const smtp=join(runtime,'smtp-password');if(!await exists(smtp))await writeFile(smtp,'fixture-password',{flag:'wx',mode:0o600});if(process.platform!=='win32')await chmod(smtp,0o600)}
const readBootstrap=()=>composeRun(['exec','-T','server','sh','-c','if test -s /run/runtime/bootstrap.txt; then cat /run/runtime/bootstrap.txt; fi'],{capture:true});
const ensureBootstrap=()=>{
 let token=readBootstrap();
 if(!token){composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','create-bootstrap-token']);token=readBootstrap();}
 if(!token)throw Error('Bootstrap token generation did not produce the expected restricted output file.');
 return token;
};
if(action==='dev' && await portOpen(12780) && await portOpen(12781)){
 console.log('The hot-reload UI and API are already running at https://127.0.0.1:12780.');
}else if(action==='start'||action==='dev'){
 await ensureTlsReady();
 await ensureRuntimeSecrets();
 run(process.execPath,['scripts/build-fixture.mjs']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 composeRun(['down','--remove-orphans']);
 composeRun(['up','-d','--no-build','--force-recreate','database','server']);
 if(action==='start')console.log('Acceptance stack ready at https://127.0.0.1:12780 (disposable fictitious data only).');
 else {
  console.log('Containerized API ready behind the local hot-reload UI at https://127.0.0.1:12780.');
  if(await portOpen(12780))console.log('Using the existing hot-reload UI on port 12780.');
  else run(process.execPath,[join(root,'apps','web','node_modules','vite','bin','vite.js'),'apps/web','--host','127.0.0.1']);
 }
}else if(action==='migrate'){
 await ensureRuntimeSecrets();
 composeRun(['up','-d','database']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 // A compose `run server` inherits the server service's fixed backend address.
 // Remove the long-running app containers first so the one-shot migration job
 // can claim that address while PostgreSQL and its evidence volume stay up.
 composeRun(['stop','server','smtp-capture']);
 run(podman,['rm','-f','--ignore',serverContainer,`${project}_smtp-capture_1`]);
 composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs', 'schema','dry-run']);
 composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs', 'schema','apply']);
 composeRun(['up','-d','--no-build','--force-recreate','server']);
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
