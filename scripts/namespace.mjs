import { runtimeNamespace, assertNamespacePath, prepareNamespace } from './runtime-namespace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const namespace = runtimeNamespace(process.env, { launcher:true });
const action = process.argv[2] ?? 'status';
if (!['status','init'].includes(action)) throw Error('Use namespace.mjs status|init. Initialization is preview-only without --confirm.');
console.log(JSON.stringify({namespace:namespace.id,root:namespace.root,profile:namespace.profile,cliProfile:namespace.cliProfile,
  serverIdentity:namespace.serverIdentity,environmentFile:namespace.serverEnvironment,composeProject:namespace.project,nativeHost:namespace.nativeHost},null,2));
if (action === 'init') {
  console.log('Creates fresh development/test configuration only. Existing profiles, database and identity are never adopted.');
  if (process.argv.includes('--confirm')) {
    await prepareNamespace(namespace);
    await assertNamespacePath(namespace,namespace.serverEnvironment);
    await mkdir(join(namespace.root,'server'),{recursive:true,mode:0o700});
    const source = `VAULTS_NAMESPACE=${namespace.name}\n${namespace.name==='test'?`VAULTS_TEST_INSTANCE=${process.env.VAULTS_TEST_INSTANCE}\n`:''}VAULTS_TLS_DIR=${namespace.serverIdentity}\nPOSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nVAULTS_READINESS_TOKEN=${randomBytes(32).toString('hex')}\n`;
    await writeFile(namespace.serverEnvironment,source,{flag:'wx',mode:0o600});
    console.log(`Initialize the NEW identity with: node server.mjs tls init 127.0.0.1 "${namespace.serverIdentity}"`);
    console.log('Then run dev.ps1. Keep old database/identity together until deliberate migration or retirement.');
  }
}
