import { ensureTlsReady, ensureRuntimeKeys, ensureRuntimeSecret, devConfiguration, requireDevUi, ensureDevOriginIsolated, devStartupPlan } from './mvp-startup.mjs';
import { runtimeNamespace, assertNamespacePath, assertServerIdentity } from './runtime-namespace.mjs';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url))),action=process.argv[2];
if(!['start','dev','migrate','exercise','view','browser','reset','stop'].includes(action))throw Error('Usage: node scripts/mvp-acceptance.mjs start|dev|migrate|exercise|view|browser|reset|stop');
const namespace=runtimeNamespace(process.env,{launcher:true});
Object.assign(process.env,namespace.environment);
const envFile=process.env.VAULTS_MVP_ENV_FILE || namespace.serverEnvironment;
await assertNamespacePath(namespace,envFile,{owned:true});
const environmentSource=await readFile(envFile,'utf8').catch(error=>{if(error.code==='ENOENT')throw Error('Initialize this namespace first: node scripts/namespace.mjs init (preview), then init --confirm. Existing default-path data is preserved.');throw error;});
const values={};for(const line of environmentSource.split(/\r?\n/)){const match=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(match)values[match[1]]=match[2]}
for (const key of ['VAULTS_DEV_WEB_PORT','VAULTS_DEV_API_PORT','VAULTS_MVP_PROJECT','VAULTS_SMTP_CAPTURE_PORT']) if (process.env[key]) values[key] = process.env[key];
if(values.VAULTS_NAMESPACE && values.VAULTS_NAMESPACE!==namespace.name)throw Error('Server environment namespace conflicts with launcher.');
if(values.VAULTS_TEST_INSTANCE && values.VAULTS_TEST_INSTANCE!==process.env.VAULTS_TEST_INSTANCE)throw Error('Server test instance conflicts with launcher.');
await assertServerIdentity(namespace,values.VAULTS_TLS_DIR);
if(values.VAULTS_MVP_PROJECT && values.VAULTS_MVP_PROJECT!==namespace.project)throw Error('Compose project conflicts with namespace.');
if(namespace.name==='test'&&(!values.VAULTS_DEV_WEB_PORT||!values.VAULTS_DEV_API_PORT||!values.VAULTS_SMTP_CAPTURE_PORT))throw Error('Parallel test instances require explicit independent VAULTS_DEV_WEB_PORT, VAULTS_DEV_API_PORT and VAULTS_SMTP_CAPTURE_PORT.');
values.VAULTS_MVP_PROJECT=namespace.project;
values.VAULTS_DEV_WEB_PORT??='12880';values.VAULTS_DEV_API_PORT??='12881';values.VAULTS_SMTP_CAPTURE_PORT??='1565';
const { webPort, apiPort, project, origin } = devConfiguration(values);
const smtpPort=Number(values.VAULTS_SMTP_CAPTURE_PORT);
if(!/^[0-9]+$/.test(values.VAULTS_SMTP_CAPTURE_PORT)||!Number.isInteger(smtpPort)||smtpPort<1025||smtpPort>65535||[webPort,apiPort].includes(smtpPort))throw Error('Use a separate unprivileged SMTP capture port.');
if(['start','dev','migrate','reset'].includes(action))await ensureDevOriginIsolated('https://127.0.0.1:'+apiPort,namespace.productionProfile,values.VAULTS_TLS_DIR);
if(action==='dev') {
 const plan=await devStartupPlan({origin,root,identity:values.VAULTS_TLS_DIR,profile:namespace.productionProfile,allowPinned:false});
 if(plan.mode==='pinned') {
  console.log(`Using Desktop's recorded local server at ${origin}. Its database, identity and history are preserved; this is not a hot-reload server rebuild.`);
  if(process.argv[3]==='--check') {console.log('Recorded server startup preflight passed.');process.exit(0);}
  const result=spawnSync(process.execPath,['scripts/ops/local-server.mjs','restart'],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.status!==0)throw Error('The recorded server could not restart safely. Review the diagnostic above; no development stack was substituted.');
  console.log(`Server ready at ${origin}. Open or unlock Desktop using its existing account.`);process.exit(0);
 }
}
if(action==='start'||action==='dev'){
 await Promise.all(['live/server.crt','live/server.key','ca/'+(values.VAULTS_CA_CERT_FILE||'ca.crt')].map(name=>assertNamespacePath(namespace,join(values.VAULTS_TLS_DIR,name),{owned:true})));
 await ensureTlsReady(values, action);
 if(action==='start')await ensureDevOriginIsolated(origin,namespace.productionProfile,values.VAULTS_TLS_DIR);
 if(process.argv[3]==='--check'){
  console.log('Local TLS startup files are present.');
  process.exit(0);
 }
}
if (['start', 'dev', 'migrate', 'reset'].includes(action)) await ensureDevOriginIsolated(origin, namespace.productionProfile, values.VAULTS_TLS_DIR);
const localCompose=join(root,'.tools','compose',process.platform==='win32'?'Scripts/podman-compose.exe':'bin/podman-compose');
const podman=process.platform==='win32'?join(process.env.ProgramFiles??'C:\\Program Files','RedHat','Podman','podman.exe'):'podman';
const composeProvider=await (async()=>await access(localCompose).then(()=>true).catch(()=>false)?localCompose:'docker-compose')();
const compose=[...(composeProvider===localCompose?['--podman-path',podman]:[]),...['--env-file',resolve(envFile)],'-p',project,'-f','compose.yaml','-f','compose.acceptance.yaml'];
const environment={...process.env,...values,...namespace.environment,VAULTS_NETWORK_PREFIX:'10.127.'+(1+[...namespace.id].reduce((a,c)=>(a*31+c.charCodeAt(0))%250,0)),VAULTS_ENDPOINT_HOST:'127.0.0.1',VAULTS_PUBLISH_ADDRESS:'127.0.0.1',VAULTS_SERVER_PORT:String(webPort),VAULTS_PUBLISH_PORT:String(action==='dev'?apiPort:webPort),...(process.platform==='win32'?{DOCKER_HOST:'npipe:////./pipe/podman-machine-default',VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS:'1'}:{})};
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
  // A recognized older database needs the explicit migration workflow; waiting
  // through the restart loop cannot make it ready.
  if (state) {
   let logs='';
   const result=spawnSync(podman,['logs','--tail','20',serverContainer],{cwd:root,env:environment,encoding:'utf8',windowsHide:true});
   if(result.status===0)logs=`${result.stdout||''}\n${result.stderr||''}`;
   if(logs.includes('Unknown or changed schema; automatic upgrades are disabled.'))throw Error('The development database schema does not match this server. Preserve a database backup, run pnpm mvp:migrate (which refuses unknown schemas), then retry dev.ps1. Do not reset the database or regenerate the TLS identity.');
  }
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw Error('The acceptance server did not become healthy. Inspect its logs; if the schema is behind, run pnpm mvp:migrate, then pnpm mvp:dev. Do not reset the database.');
}
async function ensureRuntimeSecrets(){const directory=resolve(values.VAULTS_TLS_DIR),fromTemp=relative(resolve(tmpdir()),directory);if(!fromTemp||(fromTemp!=='..'&&!fromTemp.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&!isAbsolute(fromTemp)))throw Error('VAULTS_TLS_DIR must be outside the OS temporary directory. Move the complete existing server identity to a persistent private directory and update .env.');const runtime=join(directory,'runtime');await assertNamespacePath(namespace,runtime,{owned:true});await mkdir(runtime,{recursive:true});await ensureRuntimeKeys(runtime);for(const [name,key] of [['postgres-password','POSTGRES_PASSWORD'],['readiness-token','VAULTS_READINESS_TOKEN']]){if(!/^[a-f0-9]{64}$/.test(values[key]??''))throw Error(`Missing ${key} in .env`);await ensureRuntimeSecret(runtime,name,values[key]);if(process.platform!=='win32')await chmod(join(runtime,name),0o600)}const smtp=join(runtime,'smtp-password');if(!await exists(smtp))await writeFile(smtp,'fixture-password',{flag:'wx',mode:0o600});if(process.platform!=='win32')await chmod(smtp,0o600)}
const readBootstrap=()=>composeRun(['exec','-T','server','sh','-c','if test -s /run/runtime/bootstrap.txt; then cat /run/runtime/bootstrap.txt; fi'],{capture:true});
const ensureBootstrap=()=>{
 let token=readBootstrap();
 if(!token){composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','create-bootstrap-token']);token=readBootstrap();}
 if(!token)throw Error('Bootstrap token generation did not produce the expected restricted output file.');
 return token;
};
if (action === 'dev' && await portOpen(webPort)) await requireDevUi(values, webPort);
if(action==='dev' && await portOpen(webPort) && await portOpen(apiPort)){
 await waitForServerReady();
 run(process.execPath,['scripts/build-fixture.mjs']);
 console.log(`The hot-reload UI and API are already running at ${origin}.`);
}else if(action==='start'||action==='dev'){
 await ensureRuntimeSecrets();
 run(process.execPath,['scripts/build-fixture.mjs']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 composeRun(['down','--remove-orphans']);
 composeRun(['up','-d','--no-build','--force-recreate','database','server']);
 await waitForServerReady();
 if(action==='start')console.log(`Acceptance stack ready at ${origin} (disposable fictitious data only).`);
 else {
  console.log(`Containerized API ready behind the local hot-reload UI at ${origin}.`);
  console.log(`Server admin: ${origin}/admin/ (${apiPort} is the internal backend, not an admin port).`);
  if(await portOpen(webPort))console.log(`Using the existing hot-reload UI on port ${webPort}.`);
  else run(process.execPath,[join(root,'apps','web','node_modules','vite','bin','vite.js'),'apps/web','--host','127.0.0.1']);
 }
}else if(action==='migrate'){
 // Keep the backend on its existing published port when the hot-reload UI is running.
 let mappedPort;
 try { mappedPort=run(podman,['port',serverContainer,`${webPort}/tcp`],{capture:true}).match(/:(\d+)\s*$/)?.[1]; } catch {}
 if(mappedPort)environment.VAULTS_PUBLISH_PORT=mappedPort;
 await ensureRuntimeSecrets();
 composeRun(['up','-d','database']);
 run(podman,['build','-t','localhost/127vaults-server:experimental','-f','apps/server/Dockerfile','.']);
 // A compose `run server` inherits the server service's fixed backend address.
 // Remove the long-running app containers first so the one-shot migration job
 // can claim that address while PostgreSQL and its evidence volume stay up.
 composeRun(['stop','server','smtp-capture']);
 run(podman,['rm','-f','--ignore',serverContainer,`${project}_smtp-capture_1`]);
 for(let step=0;step<8;step++){
  const output=composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','status'],{capture:true});
  const state=JSON.parse(output.split('\n').at(-1));
  if(state.state==='current')break;
  if(state.state!=='migration-required')throw Error('Unknown schema state; no migration was applied.');
  composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','dry-run']);
  composeRun(['run','--rm','--no-deps','server','node','apps/server/src/entry.mjs','schema','apply']);
  if(step===7)throw Error('Schema remains behind after eight migration steps.');
 }
 composeRun(['up','-d','--no-build','--force-recreate','server']);
 await waitForServerReady();
 console.log('Schema migration applied transactionally and the server restarted.');
}else if(action==='exercise'){
 if(!composeRun(['ps'],{capture:true}).includes('server'))throw Error('Run pnpm mvp:start first.');
 const ca=join(root,'.tools/namespaces',namespace.id,'acceptance-ca.crt');await mkdir(dirname(ca),{recursive:true});copyCa(ca);
 const state=JSON.parse(composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','status'],{capture:true}));
 const bootstrap=state.bootstrapRequired?ensureBootstrap():'';
 const nodeEnv={...environment,NODE_EXTRA_CA_CERTS:ca};
 if(bootstrap)run(process.execPath,['scripts/live-mvp-acceptance.mjs',origin,ca,'-'],{env:nodeEnv,input:bootstrap});
 else console.log('Owner already exists; preserving it and exercising the repeatable invited-user path.');
 run(process.execPath,['scripts/live-invite-acceptance.mjs',origin],{env:nodeEnv});
 run(process.execPath,['scripts/live-transport-acceptance.mjs',origin,ca],{env:nodeEnv});
 const dump=composeRun(['exec','-T','database','pg_dump','-U','vaults','-d','vaults_experimental','--data-only'],{capture:true}),logs=composeRun(['logs','--no-color','server'],{capture:true});
 for(const marker of ['fictitious password 127vaults','not-a-secret','updated-fiction','race-a','race-b','127V-B1-','BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'])if(dump.includes(marker)||logs.includes(marker))throw Error('Known fictitious plaintext marker reached PostgreSQL or server logs.');
 console.log(JSON.stringify({ok:true,databaseAndLogsPlaintextFree:true}));
}else if(action==='browser'){
 if(!composeRun(['ps'],{capture:true}).includes('server'))throw Error('Run pnpm mvp:start first.');
 const ca=join(root,'.tools/namespaces',namespace.id,'acceptance-ca.crt');await mkdir(dirname(ca),{recursive:true});copyCa(ca);
 const state=JSON.parse(composeRun(['exec','-T','server','node','apps/server/src/entry.mjs', 'provision','status'],{capture:true}));
 console.log(`Trust this local CA in your browser/OS: ${ca}`);
 console.log(`Open ${origin}`);
 if(state.bootstrapRequired)console.log(`One-time first-owner bootstrap code: ${ensureBootstrap()}`);
 else console.log('An owner already exists. Use its original browser profile, or run pnpm mvp:stop then pnpm mvp:reset for a fresh disposable browser demo.');
}else if(action==='view'){
 run(composeProvider,[...compose,'ps']);console.log(`Open ${origin}/health/live after trusting the local CA.`);
 }else if(action==='reset'){
 console.log(JSON.stringify({namespace:namespace.id,project,identity:values.VAULTS_TLS_DIR,volumes:[project+'_postgres-data-final']},null,2));
 console.log('Preview: removes only this namespace compose stack and database volume. Identity and profiles are retained.');
 if(process.argv.includes('--confirm')){
  await assertNamespacePath(namespace,values.VAULTS_TLS_DIR,{owned:true});
  const running=composeRun(['ps','--status','running','-q'],{capture:true});
  if(running.trim())throw Error('Stop this namespace with pnpm mvp:stop before reset.');
  composeRun(['down','--volumes']);console.log('Removed this namespace database volume. Its retained identity must stay paired with a matching backup for restore.');
 }
}
else {run(composeProvider,[...compose,'down']);console.log('Stopped acceptance containers; PostgreSQL evidence volume retained.');}
