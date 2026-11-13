// Disposable Windows acceptance: no real account, key or installed app is used.
import {mkdir,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {runtimeNamespace,prepareNamespace} from './runtime-namespace.mjs';
import {cleanupNamespace} from './namespace-cleanup.mjs';
if(process.platform!=='win32')throw Error('Use namespace-cleanup.test.mjs for platform-independent cleanup checks');
const exec=promisify(execFile),id=`cleanup-${process.pid}`;
const n=runtimeNamespace({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:id,APPDATA:process.env.APPDATA});
await exec('cargo',['build','-p','vaults-cli','--example','namespace_cleanup_probe','--offline'],{windowsHide:true});
const probe=resolve('target/debug/examples/namespace_cleanup_probe.exe');
const run=async action=>exec(probe,[action],{windowsHide:true,env:{...process.env,...n.environment}});
await assert.rejects(access(n.root));
await prepareNamespace(n);await mkdir(n.cliProfile);
await writeFile(join(n.cliProfile,'trust.conf'),'server_id=synthetic\nurl=https://127.0.0.1:12961\n');
await writeFile(join(n.cliProfile,'device.conf'),'device_id=synthetic\nusername=synthetic\n');
await writeFile(join(n.cliProfile,'namespace-owner'),n.id);
try {
 await run('seed');
 const options={cli:resolve('target/debug/127vaults.exe')};
 const preview=await cleanupNamespace(n,options);
 const result=await cleanupNamespace(n,{...options,confirm:true});
 await assert.rejects(access(n.root));
 await run('absent');
 await mkdir('.tools/verification/isolation-settlement',{recursive:true});
 await writeFile('.tools/verification/isolation-settlement/windows-cleanup.json',JSON.stringify({at:new Date().toISOString(),preview,result,credentialDeletionVerified:true},null,2));
 console.log('Disposable Windows profile and protected credential removed; receipt retained');
} finally {
 // Only this synthetic target, including after a failed assertion.
 await run('remove').catch(()=>{});
}
