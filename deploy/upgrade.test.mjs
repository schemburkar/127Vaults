import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { upgradeInstallation } from './upgrade.mjs';

async function fixture(t, failAt, initialVersion = 8) {
  const root=await mkdtemp(join(tmpdir(),'127v-upgrade-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'new'),from=join(root,'old'),privateDir=join(root,'private'),keyFile=join(root,'backup-key');
  await Promise.all([mkdir(directory),mkdir(from),mkdir(privateDir)]);await writeFile(keyFile,Buffer.alloc(32,1));
  const env=`VAULTS_PROJECT=vaults-test-123456789abc\nVAULTS_TLS_DIR=${privateDir}\nVAULTS_ENDPOINT_HOST=127.0.0.1\nVAULTS_LICENSE_FILE=preserved\n`;
  await writeFile(join(from,'.env'),env);const calls=[];let schemaVersion=initialVersion;
  const options={directory,from,keyFile,backupDirectory:join(root,'backups'),verify:async()=>{},inspect:async()=>({status:'pass'}),
    run:async(program,args)=>{calls.push({program,args});if(failAt&&args.includes(failAt))throw Error('simulated failure');
      if(args[0]==='ps')return{stdout:args.includes('label=com.docker.compose.service=server')?'server-id':'database-id'};
      if(args.includes('schema')) { if(args.at(-1)==='apply') schemaVersion+=1; return {stdout:JSON.stringify({version:schemaVersion})}; }
      if(args[0]==='exec')return{stdout:JSON.stringify({schemaVersion,installationId:'12345678-1234-1234-1234-123456789abc',seatUsage:{activeUsers:1},license:{mode:'active'}})};
      return{stdout:''};}};
  return{options,calls,env,directory,from};
}
test('upgrade backs up and rehearses before starting and retains exact configuration',async t=>{
  const f=await fixture(t);await upgradeInstallation(f.options);
  assert.equal(await readFile(join(f.directory,'.env'),'utf8'),f.env);
  assert.equal(await readFile(join(f.from,'.env'),'utf8'),f.env);
  const actions=f.calls.map(c=>c.args.join(' '));
  assert(actions.findIndex(a=>a.includes('database rehearse'))<actions.findIndex(a=>a.includes('schema apply')));
  assert(actions.findIndex(a=>a.includes('schema dry-run'))<actions.findIndex(a=>a.includes('schema apply')));
  assert(actions.findIndex(a=>a.includes('schema apply'))<actions.findIndex(a=>a.includes('install start')));
  assert.equal(JSON.parse(await readFile(join(f.options.backupDirectory,'upgrade-receipt.json'),'utf8')).schemaVersion,10);
  assert(actions.find(a=>a.includes('install start')).includes('--private-dir'));
  assert(existsSync(join(f.options.backupDirectory,'upgrade-receipt.json')));
});
test('failed backup restarts the old server and never creates the new configuration',async t=>{
  const f=await fixture(t,'backup');await assert.rejects(upgradeInstallation(f.options),/Upgrade stopped/);
  assert(!existsSync(join(f.directory,'.env')));
  assert.deepEqual(f.calls.at(-1).args,['start','server-id']);
  assert(!f.calls.some(c=>c.args.includes('init')));
});
test('upgrade refuses an existing target or wrong key before any engine mutation',async t=>{
  const f=await fixture(t);await writeFile(join(f.directory,'.env'),'existing');
  await assert.rejects(upgradeInstallation(f.options),/new extracted bundle/);assert.equal(f.calls.length,0);
});


test('failed migration preserves backups and never auto-restarts the old schema server',async t=>{
  const f=await fixture(t,'apply');await assert.rejects(upgradeInstallation(f.options),/Upgrade stopped/);
  assert(!f.calls.some(c=>c.args[0]==='start'&&c.args[1]==='server-id'));
  assert(!f.calls.some(c=>c.args.includes('init')));
});


test('schema 10 upgrades verify the existing schema without reapplying a migration',async t=>{
  const f=await fixture(t,undefined,10);await upgradeInstallation(f.options);
  assert(!f.calls.some(c=>c.args.includes('apply')));
  assert.equal(JSON.parse(await readFile(join(f.options.backupDirectory,'upgrade-receipt.json'),'utf8')).schemaVersion,10);
});

test('unknown schemas are refused before stopping the old server',async t=>{
  const f=await fixture(t,undefined,11);await assert.rejects(upgradeInstallation(f.options),/schema 8, 9 or 10/);
  assert(!f.calls.some(c=>c.args[0]==='stop'));
});
