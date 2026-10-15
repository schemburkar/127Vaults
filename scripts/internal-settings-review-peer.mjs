// Advance/restore one known fictitious vault name for a held GUI comparison.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
const [phase,exe,profile,work]=process.argv.slice(2);
assert.ok(['advance','restore'].includes(phase));for(const value of [exe,profile,work])assert.ok(value&&isAbsolute(value));
const fixture='14725fef-f5b4-4cb8-afe0-77aa3d80b268',vault='ba855503-c52c-435c-8c0f-d46b6254ae51',name='Fixture review race 2026-10-15-a';
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('username=owner_127\n')&&conf.includes('server_id='+fixture+'\n'));
const baseline=JSON.parse(await readFile(join(work,'baseline.json'),'utf8'));assert.equal(baseline.fixtureServer,fixture);assert.ok(baseline.settings.names[vault].startsWith('Fixture Work '));
async function command(args){return new Promise((resolve,reject)=>{const child=spawn(exe,[...args,'--config-dir',profile],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('close',code=>code?reject(Error(err.trim())):resolve(out.trim()));});}
const agent=spawn(exe,['agent-serve','--username','owner_127','--config-dir',profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ready=false;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned peer readiness timed out')),60000);agent.stdout.on('data',chunk=>{if(String(chunk).includes('ready')){ready=true;clearTimeout(timer);resolve();}});agent.stderr.resume();agent.on('error',reject);agent.on('close',()=>{clearTimeout(timer);if(!ready)reject(Error('Owned peer failed'));});agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'})+'\n');});
 await command(['device','list']);await command(['vault','settings-sync']);let settings=JSON.parse(await command(['vault','settings']));assert.equal(settings.pending,false,'Never discard a pending peer settings draft');
 if(settings.conflict){const review=JSON.parse(await command(['vault','settings-review']));assert.equal(review.localPending,false);assert.equal(review.server.names[vault],phase==='advance'?baseline.settings.names[vault]:name);await command(['vault','settings-resolve','--keep','server']);settings=JSON.parse(await command(['vault','settings']));}
 assert.equal(settings.names[vault],phase==='advance'?baseline.settings.names[vault]:name);
 await command(['vault','rename',vault,phase==='advance'?name:baseline.settings.names[vault]]);
 settings=JSON.parse(await command(['vault','settings']));assert.equal(settings.pending,false);assert.equal(settings.conflict,false);assert.equal(settings.names[vault],phase==='advance'?name:baseline.settings.names[vault]);
 await writeFile(join(work,'gui-peer-'+phase+'.json'),JSON.stringify({status:'passed',fixtureServer:fixture,vaultId:vault,name:settings.names[vault]},null,2)+'\n',{flag:'wx'});console.log('Guarded GUI settings peer '+phase+' passed.');
}finally{if(ready)await command(['lock']).catch(()=>{});if(agent.exitCode===null)agent.kill();}
