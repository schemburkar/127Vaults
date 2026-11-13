import { runtimeNamespace, assertNamespacePath, prepareNamespace } from './runtime-namespace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const namespace = runtimeNamespace(process.env, { launcher:true });
const action = process.argv[2] ?? 'status';
if (!['status','init','cleanup'].includes(action)) throw Error('Use namespace.mjs status|init|cleanup. Changes are preview-only without --confirm.');
console.log(JSON.stringify({namespace:namespace.id,root:namespace.root,profile:namespace.profile,cliProfile:namespace.cliProfile,
  serverIdentity:namespace.serverIdentity,environmentFile:namespace.serverEnvironment,composeProject:namespace.project,nativeHost:namespace.nativeHost},null,2));
if(action==='cleanup') {
  const {cleanupNamespace}=await import('./namespace-cleanup.mjs');
  const args=process.argv.slice(3),value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
  for(let i=0;i<args.length;i++){if(args[i]==='--confirm')continue;if(!['--engine','--cli'].includes(args[i])||!args[++i]||args[i].startsWith('--'))throw Error('Use cleanup [--confirm] [--engine podman|docker] [--cli PATH]');}
  console.log(JSON.stringify(await cleanupNamespace(namespace,{confirm:args.includes('--confirm'),engine:value('--engine')??'podman',cli:value('--cli')}),null,2));
}
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
