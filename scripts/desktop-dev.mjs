import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { runtimeNamespace, assertNamespacePath, prepareNamespace, namespaceProcessLease } from './runtime-namespace.mjs';

const namespace = runtimeNamespace(process.env, { launcher: true });
if (process.env.VAULTS_CONFIG_DIR) await assertNamespacePath(namespace, process.env.VAULTS_CONFIG_DIR);
await prepareNamespace(namespace);
const releaseLease=await namespaceProcessLease(namespace);
const root = resolve(import.meta.dirname, '..');
const config = { productName: `${namespace.displayName} Desktop`, identifier: `com.127vaults.desktop.${namespace.id}`,
  app: { windows: [{ label: 'main', title: `${namespace.displayName} Desktop`, width:1180,height:760,minWidth:800,minHeight:560,dragDropEnabled:false }] } };
const child = spawn(process.execPath, [join(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', JSON.stringify(config), ...process.argv.slice(2)],
  { cwd:join(root,'apps/desktop'), stdio:'inherit', windowsHide:true,
    env:{...process.env,...namespace.environment,VAULTS_BUILD_NAMESPACE:namespace.name,...(namespace.name==='test'?{VAULTS_BUILD_TEST_INSTANCE:namespace.environment.VAULTS_TEST_INSTANCE}:{}),VAULTS_CONFIG_DIR:process.env.VAULTS_CONFIG_DIR ?? namespace.profile} });
child.on('error',async error=>{await releaseLease();console.error(error.message);process.exitCode=1;});
child.on('exit',async code=>{await releaseLease();process.exitCode=code ?? 1;});
