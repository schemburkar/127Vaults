// Local operator ceremonies. Browser administration never receives key paths or runs commands.
import { readFile, writeFile, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

const licenseVerifier = existsSync(new URL('./license-status.mjs',import.meta.url)) ? './license-status.mjs' : '../apps/server/src/license-status.mjs';

const execute = promisify(execFile);
const within = (parent, child) => { const path=relative(parent,child); return !path || path!=='..' && !isAbsolute(path) && !path.startsWith('..'+sep); };
const pathValue = value => typeof value === 'string' && isAbsolute(value) && !/[\r\n\0]/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const envValue = (text,key) => {
  const rows=text.split(/\r?\n/).filter(line=>line.startsWith(key+'='));
  if(rows.length!==1 || !rows[0].slice(key.length+1)) throw Error('Missing or ambiguous initialized server setting: '+key);
  return rows[0].slice(key.length+1);
};
export function validateMaintenance(value) {
  const keys=['version','bundle','keyFile','destination','engine','hour','minute'];
  if(!value || Object.keys(value).some(key=>!keys.includes(key)) || value.version!==1 ||
     !['bundle','keyFile','destination'].every(key=>pathValue(value[key])) || !['podman','docker'].includes(value.engine) ||
     !Number.isInteger(value.hour) || value.hour<0 || value.hour>23 || !Number.isInteger(value.minute) || value.minute<0 || value.minute>59)
    throw Error('Invalid maintenance settings. Use absolute paths and a daily time.');
  const config={...value,bundle:resolve(value.bundle),keyFile:resolve(value.keyFile),destination:resolve(value.destination)};
  if(within(config.bundle,config.destination) || within(config.bundle,config.keyFile) || within(config.destination,config.keyFile))
    throw Error('Keep encrypted backups outside the bundle and keep the key separate from both.');
  return config;
}
export function schedulerDefinition(config, configFile, platform=process.platform, node=process.execPath) {
  config=validateMaintenance(config);
  if(!pathValue(configFile) || !pathValue(node)) throw Error('Scheduler paths must be absolute.');
  const id='127vaults-backup-'+hash(config.bundle).slice(0,12);
  const args=[join(config.bundle,'server.mjs'),'maintenance','run','--config',configFile];
  const time=[config.hour,config.minute].map(number=>String(number).padStart(2,'0')).join(':');
  if(platform==='win32') {
    const quote=value=>'"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
    const literal=value=>"'"+value.replaceAll("'","''")+"'";
    return {id,time,program:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',
      `$ErrorActionPreference='Stop'; $a=New-ScheduledTaskAction -Execute ${literal(node)} -Argument ${literal(args.map(quote).join(' '))} -WorkingDirectory ${literal(config.bundle)}; $t=New-ScheduledTaskTrigger -Daily -At ${literal(time)}; $p=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; $s=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName ${literal(id)} -Action $a -Trigger $t -Principal $p -Settings $s`],
      availability:'Runs as the current signed-in Windows user. Keep the engine available; missed runs start when that user and engine are available.'};
  }
  if(platform!=='linux') throw Error('Automatic scheduling supports Windows and Linux. Run the saved configuration manually on other platforms.');
  const quote=(value,exec=false)=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=>exec?'$$':'$')+'"';
  return {id,time,service:`[Unit]\nDescription=127Vaults encrypted database and identity backup\n[Service]\nType=oneshot\nWorkingDirectory=${quote(config.bundle)}\nExecStart=${[node,...args].map(value=>quote(value,true)).join(' ')}\nUMask=0077\n`,
    timer:`[Unit]\nDescription=127Vaults daily backup\n[Timer]\nOnCalendar=*-*-* ${time}:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n`,
    availability:'Uses the current Linux user’s systemd timer. It runs while that user’s service manager is active; ask the host administrator about lingering for unattended operation.'};
}
async function localRun(program,args,cwd,options={}) {
  const result=await execute(program,args,{cwd,windowsHide:true,timeout:900000,maxBuffer:1024*1024,env:process.env,...options});
  return result.stdout.trim();
}
async function installation(config,run) {
  const source=await readFile(join(config.bundle,'.env'),'utf8');
  const project=envValue(source,'VAULTS_PROJECT'), privateDir=envValue(source,'VAULTS_TLS_DIR');
  if(!/^vaults-test-[a-f0-9]{12}$/.test(project) || !pathValue(privateDir)) throw Error('Invalid initialized server identity settings.');
  const find=async service=>{
    const id=await run(config.engine,['ps','--filter',`label=com.docker.compose.project=${project}`,'--filter',`label=com.docker.compose.service=${service}`,'--format','{{.ID}}'],config.bundle);
    if(!/^[a-f0-9]{12,64}$/.test(id)) throw Error('Exactly one healthy '+service+' container is required.');
    return id;
  };
  const server=await find('server'), database=await find('database');
  const status=JSON.parse(await run(config.engine,['exec',server,'node','apps/server/src/entry.mjs','provision','status'],config.bundle));
  if(!/^[a-f0-9-]{36}$/.test(status.installationId) || !Number.isInteger(status.schemaVersion)) throw Error('Cannot verify installation identity.');
  return {...status,source,project,privateDir,server,database};
}
async function validateKey(path) {
  const info=await lstat(path);
  if(!info.isFile() || info.isSymbolicLink() || info.size!==32 || process.platform!=='win32' && (info.mode&0o077)) throw Error('Use the existing protected 32-byte backup key. Missing keys are never regenerated.');
}
export async function recordMaintenanceAttempt(directory, identity, outcome, operation, now=new Date()) {
  if(!/^[a-f0-9-]{36}$/.test(identity.installationId) || !Number.isInteger(identity.schemaVersion) || !['success','failed'].includes(outcome) || !['backup','restore'].includes(operation)) throw Error('Invalid maintenance receipt');
  const destination=join(directory,'maintenance-attempt.json'), temporary=destination+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify({version:1,installationId:identity.installationId,schemaVersion:identity.schemaVersion,completedAt:now.toISOString(),outcome,operation})+'\n',{flag:'wx',mode:0o644});
  await rename(temporary,destination);
}
export async function runScheduledBackup(value,{run=localRun,now=new Date()}={}) {
  const config=validateMaintenance(value);await validateKey(config.keyFile);
  await run(process.execPath,[join(config.bundle,'install.mjs'),'verify'],config.bundle);
  const info=await installation(config,run);
  if(within(resolve(info.privateDir),config.destination) || within(config.destination,resolve(info.privateDir))) throw Error('Keep backups separate from private server identity files.');
  await mkdir(config.destination,{recursive:true,mode:0o700});
  if((await lstat(config.destination)).isSymbolicLink()) throw Error('Backup destination cannot be a symbolic link.');
  const lock=join(config.destination,'maintenance.lock');
  await writeFile(lock,JSON.stringify({startedAt:now.toISOString()}),{flag:'wx',mode:0o600});
  const output=join(config.destination,now.toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  const operator=join(config.bundle,'server.mjs'), statusDir=join(info.privateDir,'output');
  try {
    await mkdir(output,{mode:0o700});
    const databaseId=await run(config.engine,['exec',info.database,'psql','-U','vaults','-d','vaults_experimental','-At','-c','SELECT id FROM vaults.installation WHERE singleton=true'],config.bundle);
    if(databaseId!==info.installationId)throw Error('Server and database installation IDs differ. Backup pair refused.');
    await run(process.execPath,[operator,'database','backup','--engine',config.engine,'--container',info.database,'--key-file',config.keyFile,'--output',join(output,'database.vaults-backup'),'--admin-status-dir',statusDir],config.bundle);
    await run(process.execPath,[operator,'identity','backup','--private-dir',info.privateDir,'--key-file',config.keyFile,'--server-id',info.installationId,'--output',join(output,'identity.vaults-backup')],config.bundle);
    await writeFile(join(output,'receipt.json'),JSON.stringify({version:1,installationId:info.installationId,completedAt:now.toISOString(),database:'database.vaults-backup',identity:'identity.vaults-backup'})+'\n',{flag:'wx',mode:0o600});
    await recordMaintenanceAttempt(statusDir,info,'success','backup',now);
    return output;
  } catch(error) { await recordMaintenanceAttempt(statusDir,info,'failed','backup').catch(()=>{}); throw error; }
  finally { await unlink(lock); }
}
export async function updatePreview({bundle,from,keyFile,backupDirectory,engine='podman'}, {run=localRun,verify}={}) {
  bundle=resolve(bundle);from=resolve(from);backupDirectory=resolve(backupDirectory);
  if(bundle===from || existsSync(join(bundle,'.env')) || existsSync(backupDirectory) || within(bundle,backupDirectory) || within(from,backupDirectory)) throw Error('Use a fresh extracted bundle and a new backup directory outside both bundles.');
  await validateKey(keyFile);
  if(verify){await verify(bundle);await verify(from);}
  const current=await installation({bundle:from,engine},run);
  if(![8,9,10].includes(current.schemaVersion)) throw Error('This update supports database schema 8, 9 or 10 only.');
  const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));
  const majorSource=await readFile(join(bundle,'lib/license-version.mjs'),'utf8');
  const targetMajor=Number(/export const SERVER_MAJOR_VERSION = (\d+);/.exec(majorSource)?.[1]);
  if(!Number.isSafeInteger(targetMajor))throw Error('Target bundle license version is unavailable.');
  const licenseName=/^VAULTS_LICENSE_FILE=\/run\/secrets\/runtime\/licenses\/([1-9]\d*\.json)\r?$/m.exec(current.source)?.[1];
  const keysName=/^VAULTS_LICENSE_PUBLIC_KEYS_FILE=\/run\/secrets\/runtime\/licenses\/([1-9]\d*\.keys\.json)\r?$/m.exec(current.source)?.[1];
  let purchasedMajor=null;
  if(licenseName || keysName) {
    if(!licenseName || !keysName)throw Error('Existing signed license configuration is incomplete.');
    const {verifyLicenseFile}=await import(licenseVerifier);
    const directory=join(current.privateDir,'runtime/licenses');
    const keys=JSON.parse(await readFile(join(directory,keysName),'utf8'));
    const accepted=verifyLicenseFile(await readFile(join(directory,licenseName),'utf8'),keys,current.installationId,targetMajor);
    purchasedMajor=accepted.majorVersion;
    const renewedPath=join(current.privateDir,'output/subscription-license.json');
    if(existsSync(renewedPath)) {
      const renewed=JSON.parse(await readFile(renewedPath,'utf8'));
      verifyLicenseFile(renewed.license,keys,current.installationId,targetMajor);
    }
  }
  const certificate=new X509Certificate(await readFile(join(current.privateDir,'live/server.crt')));
  return {installationId:current.installationId,currentSchema:current.schemaVersion,targetSchema:10,
    targetVersion:manifest.version??'See bundle manifest',targetMajor,purchasedMajor,certificateExpires:certificate.validTo,
    license:current.license?.mode??'unavailable',
    steps:['Create authenticated encrypted database and identity backups before stopping the server.','Stop the server, apply compatible schema migrations and start the new version. Expect downtime; clients can use their previously unlocked offline copies.','Preserve the installation ID, CA, users, license and existing database volume. Never initialize a replacement.','Verify an existing client login and sync before removing the old bundle.']};
}
export function restorePlan({bundle,identityDestination,databaseBackup,identityBackup,keyFile,installationId,endpoint='127.0.0.1',engine='podman',hostname}) {
  if(![bundle,identityDestination,databaseBackup,identityBackup,keyFile].every(pathValue) || !/^[a-f0-9-]{36}$/.test(installationId) || !['podman','docker'].includes(engine) || !/^(?:127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(endpoint) || hostname && !/^[a-z0-9.-]+$/.test(hostname)) throw Error('Invalid restore plan; use the original private endpoint and installation UUID. Tailscale network migration requires its reviewed runbook.');
  if(within(bundle,identityDestination) || [databaseBackup,identityBackup,keyFile].some(path=>within(identityDestination,path))) throw Error('Restore identity into a new directory separate from bundle, key and backups.');
  const flags=[...(engine==='docker'?['--docker']:[]),'--endpoint',endpoint,...(hostname?['--hostname',hostname]:[])];
  return [
    ['server.mjs','envelope','verify','--input',databaseBackup,'--key-file',keyFile],
    ['server.mjs','database','rehearse','--engine',engine,'--input',databaseBackup,'--key-file',keyFile],
    ['server.mjs','identity','restore','--input',identityBackup,'--output-dir',identityDestination,'--key-file',keyFile,'--server-id',installationId],
    ['server.mjs','install','init','--restore-identity',identityDestination,...flags],
    ['server.mjs','install','restore','--input',databaseBackup,'--key-file',keyFile,...flags],
    ['server.mjs','install','start',...flags],
    ['server.mjs','install','identify',...flags],
  ];
}
export async function installSchedule(config,configFile,{run=localRun,platform=process.platform,home=homedir()}={}) {
  config=validateMaintenance(config);await validateKey(config.keyFile);
  // Never replace an existing task/config silently; operators remove/review old schedules explicitly.
  await writeFile(configFile,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  if(platform==='win32') {
    const tlsModule=existsSync(new URL('./tls.mjs',import.meta.url))?'./tls.mjs':'../scripts/tls.mjs';
    const {windowsOperatorSid}=await import(tlsModule);
    await run('icacls.exe',[configFile,'/inheritance:r','/grant:r',windowsOperatorSid()+':F','*S-1-5-18:F','*S-1-5-32-544:F'],config.bundle);
  }
  const definition=schedulerDefinition(config,configFile,platform);
  if(platform==='win32') await run(definition.program,definition.args,config.bundle);
  else {
    const directory=join(home,'.config/systemd/user');await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(join(directory,definition.id+'.service'),definition.service,{flag:'wx',mode:0o600});
    await writeFile(join(directory,definition.id+'.timer'),definition.timer,{flag:'wx',mode:0o600});
    await run('systemctl',['--user','daemon-reload'],config.bundle);
    await run('systemctl',['--user','enable','--now',definition.id+'.timer'],config.bundle);
  }
  return definition;
}
export async function maintenanceWizard(directory,{ask,run=localRun,log=console.log,verify}={}) {
  let reader;
  if(!ask) {
    if(!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Maintenance wizard needs a local interactive terminal.');
    reader=createInterface({input:process.stdin,output:process.stdout});ask=question=>reader.question(question+' ');
  }
  const confirm=async message=>{if(await ask(message+' Type YES to continue:')!=='YES')throw Error('Cancelled; existing data preserved.');};
  const absolute=async question=>{const value=await ask(question);if(!pathValue(value))throw Error('Supply an absolute local path.');return resolve(value);};
  try {
    log('Server maintenance: keys remain on this computer. Keep a separate safe copy of the backup key. No backup is useful until restoration has been rehearsed.');
    const action=await ask('Choose: 1 daily backups, 2 backup now, 3 renew HTTPS certificate, 4 update preview, 5 restore/migrate into a new installation, 6 isolated restore rehearsal:');
    const engine=(await ask('Container engine (podman/docker):'))||'podman';
    if(!['podman','docker'].includes(engine))throw Error('Invalid container engine.');
    if(action==='1'||action==='2') {
      const keyFile=await absolute('Existing protected 32-byte backup key path:'),destination=await absolute('Encrypted backup destination (separate from the key and bundle):');
      const time=action==='1'?await ask('Daily local time HH:MM (24-hour):'):'02:00';
      if(!/^\d{2}:\d{2}$/.test(time))throw Error('Invalid daily time.');
      const [hour,minute]=time.split(':').map(Number);const config=validateMaintenance({version:1,bundle:directory,keyFile,destination,engine,hour,minute});
      log(JSON.stringify(config,null,2));
      if(action==='1') {
        const file=await absolute('New maintenance settings file path (outside the bundle):');
        if(within(directory,file))throw Error('Keep schedule settings outside the bundle.');
        log(schedulerDefinition(config,file).availability);await confirm('Create the daily schedule and its first encrypted backup?');
        const first=await runScheduledBackup(config,{run});log('First verified database + identity backup: '+first);
        log((await installSchedule(config,file,{run})).availability);
      } else {await confirm('Create an encrypted database and identity backup?');log('Backup completed: '+await runScheduledBackup(config,{run}));}
    } else if(action==='6') {
      const keyFile=await absolute('Matching protected backup key:'),input=await absolute('Encrypted database backup to rehearse:');
      await validateKey(keyFile);const info=await installation({bundle:directory,engine},run),statusDir=join(info.privateDir,'output');
      log('This restores into an isolated temporary database with no network and removes only that temporary rehearsal container. It does not change the running database.');
      await confirm('Rehearse this backup without replacing the running installation?');
      try {
        await run(process.execPath,['server.mjs','database','rehearse','--engine',engine,'--input',input,'--key-file',keyFile,'--admin-status-dir',statusDir],directory);
        await recordMaintenanceAttempt(statusDir,info,'success','restore');log('Isolated restore verified. Refresh Server administration → Backups for its receipt.');
      } catch(error) {await recordMaintenanceAttempt(statusDir,info,'failed','restore').catch(()=>{});throw error;}
    } else if(action==='3') {
      if(verify)await verify(directory);
      const source=await readFile(join(directory,'.env'),'utf8'),privateDir=envValue(source,'VAULTS_TLS_DIR'),endpoint=envValue(source,'VAULTS_ENDPOINT_HOST');
      const caPath=join(privateDir,'ca/ca.crt'),before=hash(await readFile(caPath));
      const certificate=new X509Certificate(await readFile(join(privateDir,'live/server.crt')));
      log('Certificate expires '+certificate.validTo+'. Renewal preserves the CA and installation identity. A server restart causes brief downtime.');
      await confirm('Renew the leaf certificate using the existing CA, then restart?');
      await run(process.execPath,['server.mjs','tls','renew',endpoint,privateDir],directory,{env:{...process.env,VAULTS_ENGINE:engine}});
      if(hash(await readFile(caPath))!==before)throw Error('CA changed unexpectedly. Server restart refused; preserve identity files and inspect the TLS operation.');
      await run(process.execPath,['server.mjs','install','stop',...(engine==='docker'?['--docker']:[])],directory);
      await run(process.execPath,['server.mjs','install','start',...(engine==='docker'?['--docker']:[])],directory);log('Certificate renewed; existing CA trust is preserved.');
    } else if(action==='4') {
      const from=await absolute('Existing server bundle path:'),keyFile=await absolute('Existing backup key path:'),backupDirectory=await absolute('New upgrade backup directory:');
      log(JSON.stringify(await updatePreview({bundle:directory,from,keyFile,backupDirectory,engine},{run,verify}),null,2));
      await confirm('Apply this backed-up update with the established upgrade workflow?');
      await run(process.execPath,['install.mjs','upgrade','--from',from,'--backup-dir',backupDirectory,'--backup-key-file',keyFile,...(engine==='docker'?['--docker']:[])],directory);
      log('Update any daily backup schedule to this new bundle path before retiring the old bundle. Schedules are never silently redirected.');
    } else if(action==='5') {
      if(existsSync(join(directory,'.env')))throw Error('Run recovery from a fresh extracted verified bundle. Existing installations cannot be overwritten.');
      const identityDestination=await absolute('New private identity directory:'),databaseBackup=await absolute('Encrypted database backup:'),identityBackup=await absolute('Matching encrypted identity backup:'),keyFile=await absolute('Matching backup key:');
      if(existsSync(identityDestination))throw Error('Identity destination must not exist.');
      await validateKey(keyFile);if(verify)await verify(directory);
      const installationId=await ask('Original installation UUID:'),endpoint=await ask('Original private IPv4 endpoint (or 127.0.0.1):'),hostname=(await ask('Original custom DNS hostname, or leave empty:'))||undefined;
      const plan=restorePlan({bundle:directory,identityDestination,databaseBackup,identityBackup,keyFile,installationId,endpoint,hostname,engine});
      log('This preserves the original CA, signing identity and database installation ID in a NEW project. Stop the original server before starting the replacement; never run both identities concurrently. Keep the original host and all backups intact.');
      log(JSON.stringify(plan,null,2));await confirm('Original server is stopped, destination is new, and both backups belong to this installation. Restore?');
      for(const command of plan)await run(process.execPath,command,directory);
      log('Restore completed. Verify an existing client login, vault read and sync before retiring the original host.');
    } else throw Error('Choose a listed maintenance action.');
  } finally {reader?.close();}
}
export async function runMaintenance(args) {
  if(args.length!==3 || args[0]!=='run' || args[1]!=='--config' || !pathValue(args[2]))throw Error('Use maintenance run --config <absolute settings file>. For guided setup use node install.mjs maintain.');
  const info=await lstat(args[2]);if(!info.isFile() || info.isSymbolicLink() || info.size>8192 || process.platform!=='win32'&&(info.mode&0o077))throw Error('Invalid or unprotected maintenance settings file.');
  const config=JSON.parse(await readFile(args[2],'utf8'));console.log('Encrypted backup: '+await runScheduledBackup(config));
}
