// Fresh, retained installation only; real supported license/revocation workflow.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {verifyRelease} from '../../../scripts/release/verify-release.mjs';
import {verify} from '../../../deploy/install.mjs';
import {issueSelfHostedLicense} from '../../../scripts/ops/issue-self-hosted-license.mjs';
import {issueLicenseRevocation} from '../../../scripts/ops/issue-license-revocation.mjs';
const work='C:/Projects/127Vaults-license-isolated-20261015-a',repo='C:/Projects/127Vaults';const sanity=process.argv[2]==='--sanity-server-b';
assert.equal(process.platform,'win32');assert.ok(process.argv[2]===undefined||['--peer-only','--upgrade-server','--sanity-server-b'].includes(process.argv[2]));const base=JSON.parse(await readFile(work+'/evidence.json','utf8'));
assert.equal(base.status,'passed');assert.equal(base.fixturePort,12900);assert.equal(base.checks.length,7);
assert.ok(!['vaults-test-632a4442dfd2','vaults-test-a0540f7d9c99'].includes(base.sourceProject));
if(!sanity)await assert.rejects(access(work+'/server-b-upgrade-evidence.json'),error=>error.code==='ENOENT','This fixture is already upgraded; do not restart its old server-a bundle. Extend an explicitly guarded server-b phase instead.');
let bundle=work+(sanity?'/extracted-b':'/extracted')+'/127vaults-server-0.0.0-linux-amd64';const identity=work+'/identity';
assert.equal(/^VAULTS_PROJECT=(.+)$/m.exec(await readFile(bundle+'/.env','utf8'))[1],base.sourceProject);
const manifest=JSON.parse(await readFile(bundle+'/manifest.json','utf8'));assert.equal(manifest.revision,sanity?'a574a62e6afd9423be4636db5f5f941d4ab037bf':'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.ok(!manifest.files['issuer-keys.json'],'Do not replace pinned issuer keys');
async function run(args,cwd=bundle,env=process.env){return new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',async code=>{if(code){await writeFile(work+'/license-failure-'+Date.now()+'.log',err,{flag:'wx',mode:0o600});reject(Error('License rehearsal operation failed; private diagnostic retained'));}else resolve(out.trim());});});}
const operator=(action,...args)=>run(['server.mjs','install',action,'--private-dir',identity,'--compose-provider',repo+'/.tools/compose/Scripts/podman-compose.exe',...args]);
const ca=await readFile(identity+'/ca/ca.crt');
async function ready(){for(let i=0;i<45;i++){try{await new Promise((resolve,reject)=>{const r=request('https://127.0.0.1:12900/health/live',{ca,timeout:2000},s=>{s.resume();s.statusCode===200?resolve():reject(Error('Not ready'));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Timeout')));r.end();});return;}catch{if(i===44)throw Error('License fixture not ready');await new Promise(r=>setTimeout(r,1000));}}}
const probe=async phase=>{console.log(await run([repo+'/tests/internal/licensing/license-native-client.mjs',phase],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));};
const privateKeyPem=await readFile(work+'/fictitious-license-issuer.key','utf8');
const issued=[];
async function issue(sequence,expiresAt){const signed=issueSelfHostedLicense({privateKeyPem,keyId:'isolated-license-test',installationId:base.installation,plan:'personal',majorVersion:1,maxActiveUsers:5,sequence,expiresAt});const path=work+'/signed-license-'+sequence+'.json';await writeFile(path,signed.license,{flag:'wx',mode:0o600});await writeFile(work+'/issuer-'+sequence+'.json',signed.publicKeys,{flag:'wx',mode:0o600});await operator('license','--file',path,'--public-keys',work+'/issuer-'+sequence+'.json');issued.push(JSON.parse(Buffer.from(JSON.parse(signed.license).payload,'base64url')));await operator('stop');await operator('start');await ready();console.log('Supported license sequence '+sequence+' installed and server ready.');}
try{
 await operator('start');assert.equal(execFileSync('podman',['inspect',base.sourceProject+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,''),manifest.imageIds[manifest.image]);await ready();

 if(sanity){
 const prior=JSON.parse(await readFile(work+'/server-b-upgrade-evidence.json','utf8'));assert.equal(prior.installation,base.installation);assert.equal(prior.serverImageId,manifest.imageIds[manifest.image]);
 const independent=JSON.parse(await run([repo+'/tests/internal/licensing/license-server-probe.mjs',work,'read-native'],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));assert.deepEqual(independent,prior.after);
 await probe('sanity');
 const http=(path,{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{const r=request('https://127.0.0.1:12900'+path,{ca,method,timeout:10000,headers:{origin:'https://127.0.0.1:12900',...(body?{'content-type':'application/json'}:{}),...headers}},response=>{let text='';response.on('data',b=>text+=b);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Sanity timeout')));r.end(body&&JSON.stringify(body));});
 const web=await http('/');assert.equal(web.status,200);assert.match(web.text,/127Vaults/);const client=await http('/app/mvp-client.mjs');assert.equal(client.status,200);assert.match(client.text,/monitorLicenseStatus/);assert.match(client.text,/30000/);
 const adminPage=await http('/admin/');assert.equal(adminPage.status,200);const login=await http('/api/admin/session',{method:'POST',body:{username:'localowner',password:'synthetic-internal-admin-password'}});assert.equal(login.status,200);const actor=JSON.parse(login.text),cookie=login.headers['set-cookie'][0].split(';')[0];assert.equal((await http('/api/admin/users',{headers:{cookie}})).status,200);assert.equal((await http('/api/admin/session',{method:'DELETE',headers:{cookie,'x-127v-admin-csrf':actor.csrf}})).status,200);
 await writeFile(work+'/functional-sanity-2026-10-16.json',JSON.stringify({status:'passed',sourceRevision:manifest.revision,installation:base.installation,independent,checks:['Existing server-b installation starts under its pinned CA','Independent owner authenticates/decrypts retained data; exact ciphertext digest preserved','Actual packaged CLI-b unlock/sync/redacted and explicit-secret read; queue empty','Web entry and rebuilt license-refresh client served','Admin page, operator sign-in, account listing and sign-out'],at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log('Basic server/web/CLI/admin functional sanity passed.');
 }else if(process.argv[2]==='--upgrade-server'){

 const native=JSON.parse(await readFile(work+'/native-license-baseline.json','utf8'));const replica=JSON.parse(await readFile(work+'/native-cli-windows-b/replicas/'+native.vaultId+'.json','utf8'));assert.deepEqual(replica.pending,[]);assert.deepEqual(replica.conflicts,[]);
 const peer=async()=>JSON.parse(await run([repo+'/tests/internal/licensing/license-server-probe.mjs',work,'read-native'],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));
 const before=await peer();
 await run(['server.mjs','database','backup','--container',base.sourceProject+'_database_1','--output',work+'/pre-server-b-database.127vbak','--key-file',work+'/database.key']);
 await run(['server.mjs','identity','backup','--private-dir',identity,'--output',work+'/pre-server-b-identity.127vbak','--key-file',work+'/identity.key','--server-id',base.installation]);
 const release='C:/Projects/127Vaults-Releases/server/internal-20261015-b/linux-amd64',verified=await verifyRelease(release);assert.equal(verified.sourceRevision,'a574a62e6afd9423be4636db5f5f941d4ab037bf');
 const extracted=work+'/extracted-b';await mkdir(extracted);const archive=verified.files.find(f=>f.name.endsWith('.tar'));assert.ok(archive);execFileSync('tar',['-xf',release+'/'+archive.name,'-C',extracted],{windowsHide:true});
 const target=extracted+'/127vaults-server-0.0.0-linux-amd64';await verify(target);const nextManifest=JSON.parse(await readFile(target+'/manifest.json','utf8'));assert.equal(nextManifest.revision,verified.sourceRevision);
 const env=await readFile(bundle+'/.env');await copyFile(bundle+'/.env',target+'/.env');const compose=await readFile(target+'/compose.test.yaml','utf8');assert.ok(compose.includes(':12780')&&compose.includes("      VAULTS_EXPERIMENTAL: '1'"));const overridden=compose.replaceAll(':12780',':12900').replace("      VAULTS_EXPERIMENTAL: '1'","      PORT: '12900'\n      VAULTS_EXPERIMENTAL: '1'");await writeFile(target+'/compose.test.yaml',overridden);nextManifest.files['compose.test.yaml']=createHash('sha256').update(overridden).digest('hex');await writeFile(target+'/manifest.json',JSON.stringify(nextManifest,null,2)+'\n');await verify(target);
 await operator('stop');bundle=target;await operator('start');await ready();const running=execFileSync('podman',['inspect',base.sourceProject+'_server_1','--format','{{.Image}}'],{encoding:'utf8',windowsHide:true}).trim().replace(/^sha256:/,'');assert.equal(running,nextManifest.imageIds[nextManifest.image]);
 const after=await peer();assert.deepEqual(after,before);assert.deepEqual(await readFile(target+'/.env'),env);
 await writeFile(work+'/server-b-upgrade-evidence.json',JSON.stringify({status:'passed',installation:base.installation,project:base.sourceProject,sourceRevision:verified.sourceRevision,serverImageId:running,archiveSha256:archive.sha256,bundle:target,before,after,configurationPreserved:true,backups:['pre-server-b-database.127vbak','pre-server-b-identity.127vbak'],fixtureOverride:'Same loopback PORT 12900, project/volume, identity and license sequence 6; only fixture compose port/checksum adjusted',at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log('Backed-up existing installation upgraded to server-b; independent decrypted fields/history and ciphertext digest preserved.');
 }else if(process.argv[2]==='--peer-only'){
 console.log(await run([repo+'/tests/internal/licensing/license-server-probe.mjs',work,'verify-native'],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));
 const evidence=JSON.parse(await readFile(work+'/native-license-evidence.json','utf8'));assert.equal(evidence.status,'passed');evidence.peer=JSON.parse(await readFile(work+'/native-license-peer-read.json','utf8'));await writeFile(work+'/native-license-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 }else{
 await probe('enroll');const expires=Date.now()+45000;await issue(4,new Date(expires).toISOString());console.log('Waiting for natural expiry before packaged native queue test.');while(Date.now()<expires+1500)await new Promise(r=>setTimeout(r,1000));
 await probe('queue-grace');await probe('retry-grace');await issue(5,new Date(Date.now()+86400000).toISOString());await probe('finish-grace');
 const revocation=issueLicenseRevocation({privateKeyPem,keyId:'isolated-license-test',installationId:base.installation,licenseId:issued[1].licenseId,revokedAt:'now'});await writeFile(work+'/native-signed-revocation.json',revocation,{flag:'wx',mode:0o600});await operator('revoke','--file',work+'/native-signed-revocation.json');await operator('stop');await operator('start');await ready();
 await probe('queue-revoked');await probe('retry-revoked');await issue(6,new Date(Date.now()+86400000).toISOString());await probe('finish-revoked');
 console.log(await run([repo+'/tests/internal/licensing/license-server-probe.mjs',work,'verify-native'],repo,{...process.env,NODE_EXTRA_CA_CERTS:identity+'/ca/ca.crt'}));
 const phases=[];for(const phase of ['enroll','queue-grace','retry-grace','finish-grace','queue-revoked','retry-revoked','finish-revoked'])phases.push(JSON.parse(await readFile(work+'/native-license-'+phase+'.json','utf8')));
 const pending=[];for(const kind of ['grace','revoked'])pending.push({kind,sha256:createHash('sha256').update(await readFile(work+'/native-license-'+kind+'-original.json')).digest('hex')});
 await writeFile(work+'/native-license-evidence.json',JSON.stringify({status:'passed',installation:base.installation,project:base.sourceProject,sourceRevision:'cd67ab2c224df758f173fd393590c4586386f8b8',profile:work+'/native-cli-windows-b',phases,pending,peer:JSON.parse(await readFile(work+'/native-license-peer-read.json','utf8')),limits:['Windows CLI-b only; Linux GUI/client, later-expiry locked and physical cases separate','Genuine new CLI key/possession/keyring; approval by registered production-crypto fixture owner, not browser UI','Synthetic missing username/website normalized to empty strings through supported CLI edits'],at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log('Genuine Windows CLI license notices, restart-preserved exact queues and renewal recovery passed.');

 }
}finally{await operator('stop');}
