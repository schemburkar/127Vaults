import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {rootCertificates} from 'node:tls';
import {generateKeyPairSync,sign} from 'node:crypto';
import {validateMaintenance,schedulerDefinition,runScheduledBackup,maintenanceWizard,restorePlan,updatePreview,installSchedule} from './maintenance.mjs';

const id='10000000-0000-4000-8000-000000000001';
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'127v-maintenance-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});
  const bundle=join(root,'bundle'),privateDir=join(root,'private'),keyFile=join(root,'key'),destination=join(root,'backups');
  await mkdir(bundle);await mkdir(join(privateDir,'runtime'),{recursive:true});await mkdir(join(privateDir,'output'));await mkdir(join(privateDir,'ca'));await mkdir(join(privateDir,'live'));
  await writeFile(keyFile,Buffer.alloc(32,7),{mode:0o600});
  await writeFile(join(bundle,'.env'),`VAULTS_PROJECT=vaults-test-123456abcdef\nVAULTS_TLS_DIR=${privateDir}\nVAULTS_ENDPOINT_HOST=127.0.0.1\n`);
  await writeFile(join(privateDir,'ca/ca.crt'),rootCertificates[0]);await writeFile(join(privateDir,'live/server.crt'),rootCertificates[0]);
  const calls=[];
  const run=async(program,args,cwd,options)=>{
    calls.push({program,args,cwd,options});
    if(args[0]==='ps')return args.includes('label=com.docker.compose.service=server')?'a'.repeat(12):'b'.repeat(12);
    if(args.includes('status'))return JSON.stringify({installationId:id,schemaVersion:10,license:{mode:'active'}});
    if(args.includes('psql'))return id;
    return '';
  };
  return {root,bundle,privateDir,keyFile,destination,calls,run,config:{version:1,bundle,keyFile,destination,engine:'podman',hour:2,minute:30}};
}
test('backup settings reject unsafe key placement, relative paths and undocumented fields',async t=>{
  const f=await fixture(t);assert.equal(validateMaintenance(f.config).hour,2);
  for(const change of [{keyFile:join(f.destination,'key')},{destination:f.bundle},{bundle:'relative'},{hour:24},{password:'secret'}])assert.throws(()=>validateMaintenance({...f.config,...change}));
});
test('scheduler definitions quote literal paths and create user-only schedules without shell command files',async t=>{
  const f=await fixture(t),file=join(f.root,"settings's $name%.json");
  const windows=schedulerDefinition(f.config,file,'win32');
  assert.match(windows.args.at(-1),/LogonType Interactive/);assert.ok(windows.args.at(-1).includes("settings''s $name%.json"));
  const linux=schedulerDefinition(f.config,file,'linux');assert.match(linux.service,/\$\$name%%/);assert.match(linux.timer,/02:30:00/);
  const home=join(f.root,'home');await installSchedule(f.config,join(f.root,'schedule.json'),{run:f.run,platform:'linux',home});
  await access(join(home,'.config/systemd/user',linux.id+'.timer'));
  assert.ok(f.calls.some(call=>call.program==='systemctl'&&call.args.includes('--now')));
  await assert.rejects(installSchedule(f.config,join(f.root,'schedule.json'),{run:f.run,platform:'linux',home}),/EEXIST/);
});
test('scheduled backups bind database and identity, record failures without secret errors, and release their lock',async t=>{
  const f=await fixture(t);const output=await runScheduledBackup(f.config,{run:f.run,now:new Date('2026-01-01T00:00:00Z')});
  assert.equal(JSON.parse(await readFile(join(output,'receipt.json'),'utf8')).installationId,id);
  assert.ok(f.calls.some(call=>call.args.includes('identity')&&call.args.includes(id)));
  const failure=async(program,args,...rest)=>{if(args.includes('backup'))throw Error('password=must-never-be-in-admin');return f.run(program,args,...rest);};
  await assert.rejects(runScheduledBackup(f.config,{run:failure}),/must-never/);
  const receipt=await readFile(join(f.privateDir,'output/maintenance-attempt.json'),'utf8');assert.equal(JSON.parse(receipt).outcome,'failed');assert.ok(!receipt.includes('password'));
  await assert.rejects(access(join(f.destination,'maintenance.lock')));
  const mismatch=async(program,args,...rest)=>args.includes('psql')?'20000000-0000-4000-8000-000000000002':f.run(program,args,...rest);
  await assert.rejects(runScheduledBackup(f.config,{run:mismatch}),/IDs differ/);
});
test('operator cancellation makes no backup or scheduler changes',async t=>{
  const f=await fixture(t),answers=['2','podman',f.keyFile,f.destination,'NO'];
  await assert.rejects(maintenanceWizard(f.bundle,{ask:async()=>answers.shift(),run:f.run,log:()=>{}}),/Cancelled/);
  assert.equal(f.calls.length,0);await assert.rejects(access(f.destination));
});
test('certificate renewal passes the chosen engine, preserves CA, and restarts only after review',async t=>{
  const f=await fixture(t),answers=['3','docker','YES'];
  await maintenanceWizard(f.bundle,{ask:async()=>answers.shift(),run:f.run,log:()=>{}});
  assert.equal(f.calls[0].options.env.VAULTS_ENGINE,'docker');
  assert.deepEqual(f.calls.map(call=>call.args[2]),['renew','stop','start']);
  const changed=async(program,args,...rest)=>{if(args.includes('renew'))await writeFile(join(f.privateDir,'ca/ca.crt'),'changed');return f.run(program,args,...rest);};
  const again=['3','podman','YES'];f.calls.length=0;
  await assert.rejects(maintenanceWizard(f.bundle,{ask:async()=>again.shift(),run:changed,log:()=>{}}),/CA changed/);
  assert.equal(f.calls.length,1);
});
test('update preview checks both bundles and supported schema before any update action',async t=>{
  const f=await fixture(t),target=join(f.root,'new-bundle');await mkdir(join(target,'lib'),{recursive:true});await writeFile(join(target,'lib/license-version.mjs'),'export const SERVER_MAJOR_VERSION = 0;');await writeFile(join(target,'manifest.json'),JSON.stringify({version:'0.2.0'}));
  const verified=[];const preview=await updatePreview({bundle:target,from:f.bundle,keyFile:f.keyFile,backupDirectory:join(f.root,'upgrade-backup')},{run:f.run,verify:async dir=>verified.push(dir)});
  assert.equal(preview.targetSchema,10);assert.deepEqual(verified,[target,f.bundle]);assert.equal(preview.installationId,id);assert.ok(preview.steps.some(line=>line.includes('downtime')));
  const unsupported=async(program,args,...rest)=>args.includes('status')?JSON.stringify({installationId:id,schemaVersion:99}):f.run(program,args,...rest);
  await assert.rejects(updatePreview({bundle:target,from:f.bundle,keyFile:f.keyFile,backupDirectory:join(f.root,'upgrade-backup')},{run:unsupported}),/schema/);
});
test('recovery delegates identity matching and nonempty-database guards, and refuses an initialized bundle',async t=>{
  const f=await fixture(t),plan=restorePlan({bundle:f.bundle,identityDestination:join(f.root,'new-identity'),databaseBackup:join(f.root,'database'),identityBackup:join(f.root,'identity'),keyFile:f.keyFile,installationId:id});
  assert.deepEqual(plan.map(row=>row[1]),['envelope','database','identity','install','install','install','install']);
  assert.ok(plan[2].includes(id));assert.ok(plan[3].includes('--restore-identity'));
  const answers=['5','podman'];await assert.rejects(maintenanceWizard(f.bundle,{ask:async()=>answers.shift(),run:f.run,log:()=>{}}),/fresh extracted/);assert.equal(f.calls.length,0);
});
test('update license preview includes V1 for a V0 purchase and refuses V2 before mutation',async t=>{
  const f=await fixture(t),target=join(f.root,'licensed-target');await mkdir(join(target,'lib'),{recursive:true});
  await writeFile(join(target,'manifest.json'),'{}');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const payload={licenseId:'20000000-0000-4000-8000-000000000002',installationId:id,plan:'personal',majorVersion:0,maxActiveUsers:5,issuedAt:'2026-01-01T00:00:00.000Z',notBefore:'2026-01-01T00:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',sequence:1};
  const bytes=Buffer.from(JSON.stringify(payload)),envelope={schemaVersion:1,keyId:'fixture',payload:bytes.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from('127Vaults license v1\0'),bytes]),privateKey).toString('base64url')};
  const licenses=join(f.privateDir,'runtime/licenses');await mkdir(licenses);
  await writeFile(join(licenses,'1.json'),JSON.stringify(envelope));await writeFile(join(licenses,'1.keys.json'),JSON.stringify({fixture:publicKey.export({type:'spki',format:'pem'})}));
  await writeFile(join(f.bundle,'.env'),await readFile(join(f.bundle,'.env'),'utf8')+'VAULTS_LICENSE_FILE=/run/secrets/runtime/licenses/1.json\nVAULTS_LICENSE_PUBLIC_KEYS_FILE=/run/secrets/runtime/licenses/1.keys.json\n');
  const options={bundle:target,from:f.bundle,keyFile:f.keyFile,backupDirectory:join(f.root,'upgrade')};
  await writeFile(join(target,'lib/license-version.mjs'),'export const SERVER_MAJOR_VERSION = 1;');
  assert.equal((await updatePreview(options,{run:f.run})).purchasedMajor,0);
  await writeFile(join(target,'lib/license-version.mjs'),'export const SERVER_MAJOR_VERSION = 2;');
  await assert.rejects(updatePreview(options,{run:f.run}),/invalid_license/);
  assert.ok(f.calls.every(call=>call.args[0]==='ps'||call.args.includes('status')));
});
test('isolated rehearsal is explicitly reviewed and records the restore result separately',async t=>{
  const f=await fixture(t),answers=['6','podman',f.keyFile,join(f.root,'encrypted-backup'),'YES'];
  await maintenanceWizard(f.bundle,{ask:async()=>answers.shift(),run:f.run,log:()=>{}});
  const receipt=JSON.parse(await readFile(join(f.privateDir,'output/maintenance-attempt.json'),'utf8'));
  assert.equal(receipt.operation,'restore');assert.equal(receipt.outcome,'success');
  assert.ok(f.calls.some(call=>call.args.includes('rehearse')));assert.ok(!f.calls.some(call=>call.args.includes('init')));
});
