// Fresh, retained installation only; real supported license/revocation workflow.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {request} from 'node:https';
import {issueSelfHostedLicense} from '../../../scripts/ops/issue-self-hosted-license.mjs';
import {issueLicenseRevocation} from '../../../scripts/ops/issue-license-revocation.mjs';
const work='C:/Projects/127Vaults-license-isolated-20261015-a',repo='C:/Projects/127Vaults';
assert.equal(process.platform,'win32');const base=JSON.parse(await readFile(work+'/evidence.json','utf8'));
assert.equal(base.status,'passed');assert.equal(base.fixturePort,12900);assert.equal(base.checks.length,7);
assert.ok(!['vaults-test-632a4442dfd2','vaults-test-a0540f7d9c99'].includes(base.sourceProject));
const bundle=work+'/extracted/127vaults-server-0.0.0-linux-amd64',identity=work+'/identity';
assert.equal(/^VAULTS_PROJECT=(.+)$/m.exec(await readFile(bundle+'/.env','utf8'))[1],base.sourceProject);
const manifest=JSON.parse(await readFile(bundle+'/manifest.json','utf8'));assert.equal(manifest.revision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.ok(!manifest.files['issuer-keys.json'],'Do not replace pinned issuer keys');
async function run(args,cwd=bundle,env=process.env){return new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(work+'/license-failure-'+Date.now()+'.log',err,{flag:'wx',mode:0o600});reject(Error('License rehearsal operation failed; private diagnostic retained'));}else resolve(out.trim());});});}
const operator=(action,...args)=>run(['server.mjs','install',action,'--private-dir',identity,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe',...args]);
const ca=await readFile(identity+'/ca/ca.crt');
async function ready(){for(let i=0;i<45;i++){try{await new Promise((resolve,reject)=>{const r=request('https://127.0.0.1:12900/health/live',{ca,timeout:2000},s=>{s.resume();s.statusCode===200?resolve():reject(Error('Not ready'));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Timeout')));r.end();});return;}catch{if(i===44)throw Error('License fixture not ready');await new Promise(r=>setTimeout(r,1000));}}}
const probe=async phase=>{console.log(await run([repo+'/tests/internal/licensing/license-server-probe.mjs',work,phase],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));};
const {privateKey}=generateKeyPairSync('ed25519'),privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'});
await writeFile(work+'/fictitious-license-issuer.key',privateKeyPem,{flag:'wx',mode:0o600});
const issued=[];
async function issue(sequence,expiresAt){const signed=issueSelfHostedLicense({privateKeyPem,keyId:'isolated-license-test',installationId:base.installation,plan:'personal',majorVersion:1,maxActiveUsers:5,sequence,expiresAt});const path=work+'/signed-license-'+sequence+'.json';await writeFile(path,signed.license,{flag:'wx',mode:0o600});await writeFile(work+'/issuer-'+sequence+'.json',signed.publicKeys,{flag:'wx',mode:0o600});await operator('license','--file',path,'--public-keys',work+'/issuer-'+sequence+'.json');issued.push(JSON.parse(Buffer.from(JSON.parse(signed.license).payload,'base64url')));await operator('stop');await operator('start');await ready();console.log('Supported license sequence '+sequence+' installed and server ready.');}
try{
 await operator('start');assert.equal(execFileSync('podman',['inspect',base.sourceProject+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),manifest.imageIds[manifest.image]);await ready();
 await probe('prepare-grace');const expires=Date.now()+45000;await issue(1,new Date(expires).toISOString());console.log('Waiting for the short-lived signed test license to expire naturally.');while(Date.now()<expires+1500)await new Promise(r=>setTimeout(r,1000));
 await probe('check-grace');await issue(2,new Date(Date.now()+86400000).toISOString());await probe('replay-grace');await probe('prepare-revoked');
 const revocation=issueLicenseRevocation({privateKeyPem,keyId:'isolated-license-test',installationId:base.installation,licenseId:issued[1].licenseId,revokedAt:'now'});await writeFile(work+'/signed-revocation.json',revocation,{flag:'wx',mode:0o600});await operator('revoke','--file',work+'/signed-revocation.json');await operator('stop');await operator('start');await ready();await probe('check-revoked');
 await issue(3,new Date(Date.now()+86400000).toISOString());await probe('replay-revoked');
 const before=await readFile(bundle+'/.env');await assert.rejects(operator('license','--file',work+'/signed-license-2.json','--public-keys',work+'/issuer-2.json'));assert.deepEqual(await readFile(bundle+'/.env'),before);
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');const pendingFilesPreserved=[];for(const kind of ['grace','revoked'])pendingFilesPreserved.push({kind,fileSha256:digest(await readFile(work+'/license-'+kind+'-pending.json'))});const phases=[];for(const phase of ['prepare-grace','check-grace','replay-grace','prepare-revoked','check-revoked','replay-revoked'])phases.push(JSON.parse(await readFile(work+'/license-'+phase+'.json','utf8')));
 await writeFile(work+'/license-server-evidence.json',JSON.stringify({status:'passed',installation:base.installation,project:base.sourceProject,sourceRevision:manifest.revision,serverImageId:manifest.imageIds[manifest.image],phases,sequenceRollbackRefused:true,pendingFilesPreserved,limits:['Server/production crypto-protocol owner only; native/GUI notices and client durable queues remain separate','Naturally expired read-only grace and signed revocation/higher-sequence renewal; later expiry locked mode not exercised','Fresh existing-host loopback Podman fixture; physical/intended-host acceptance remains'],at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 console.log('Selected server read-only/revocation refusal and exact encrypted-request renewal/replay passed.');
}finally{await operator('stop');}
