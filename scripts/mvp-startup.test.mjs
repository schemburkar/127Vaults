import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureTlsReady, ensureRuntimeKeys, ensureRuntimeSecret, devConfiguration, requireDevUi, ensureDevOriginIsolated, devStartupPlan } from './mvp-startup.mjs';
import {createHash} from 'node:crypto';
import { createServer } from 'node:http';

test('development settings retain defaults and reject ambiguous ports or unsafe project names', () => {
  assert.deepEqual(devConfiguration({}), { webPort: 12780, apiPort: 12781, project: 'vaults-acceptance', origin: 'https://127.0.0.1:12780' });
  assert.equal(devConfiguration({ VAULTS_DEV_WEB_PORT: '12961', VAULTS_DEV_API_PORT: '12962', VAULTS_MVP_PROJECT: 'vaults-acceptance-isolated' }).origin, 'https://127.0.0.1:12961');
  for (const value of ['0', '1024', '65536', '12780.5', 'invalid']) assert.throws(() => devConfiguration({ VAULTS_DEV_WEB_PORT: value }));
  assert.throws(() => devConfiguration({ VAULTS_DEV_WEB_PORT: '12781' }));
  assert.throws(() => devConfiguration({ VAULTS_MVP_PROJECT: 'existing-production' }));
});

test('a listening unrelated server is preserved and cannot be mistaken for Vite', async t => {
  const { identity } = await fixture(t, required);
  const server = createServer((_req, res) => res.end('unrelated listener'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  await assert.rejects(requireDevUi({ VAULTS_TLS_DIR: identity }, server.address().port), /occupied by a listener.*preserved/);
  assert.equal(server.listening, true);
});

async function fixture(t, files = []) {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-startup-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('127vaults-startup-'));
    await rm(directory, { recursive: true, force: true });
  });
  const namespaceRoot=join(directory,'127Vaults Namespaces/development');
  await mkdir(namespaceRoot,{recursive:true});await writeFile(join(namespaceRoot,'namespace-owner'),'development');
  const identity = join(namespaceRoot,'server/identity');
  for (const file of files) {
    const path = join(identity, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `synthetic fixture: ${file}`);
  }
  return { directory, identity };
}
const required = ['live/server.crt', 'live/server.key', 'ca/ca.crt'];

test('runtime secrets are created once and configuration drift never overwrites them',async t=>{
  const {directory}=await fixture(t);
  await ensureRuntimeSecret(directory,'password','synthetic-first');
  await ensureRuntimeSecret(directory,'password','synthetic-first');
  await assert.rejects(ensureRuntimeSecret(directory,'password','replacement'),/rotate explicitly/);
  assert.equal(await readFile(join(directory,'password'),'utf8'),'synthetic-first');
});

test('a new runtime gets both independent keys and an existing identity never rotates a missing or invalid key', async t => {
  const { directory } = await fixture(t);
  await ensureRuntimeKeys(directory);
  const token = await readFile(join(directory, 'token.key'));
  const checkpoint = await readFile(join(directory, 'checkpoint.key'));
  assert.equal(token.length, 32); assert.equal(checkpoint.length, 32);
  assert.notDeepEqual(token, checkpoint);
  await ensureRuntimeKeys(directory);
  assert.deepEqual(await readFile(join(directory, 'token.key')), token);
  await rm(join(directory, 'checkpoint.key'));
  await assert.rejects(ensureRuntimeKeys(directory), /missing a runtime key/);
  assert.deepEqual(await readFile(join(directory, 'token.key')), token);
  await writeFile(join(directory, 'checkpoint.key'), '');
  await assert.rejects(ensureRuntimeKeys(directory), /checkpoint.key must contain exactly 32 bytes/);
  assert.deepEqual(await readFile(join(directory, 'token.key')), token);
});
const missingMessage = (directory, action, files = required) => `TLS startup preflight failed for pnpm mvp:${action}. Unavailable files:\n${files.map(file => `- ${join(directory, file)} (ENOENT)`).join('\n')}\nCheck VAULTS_TLS_DIR and VAULTS_CA_CERT_FILE in .env and restore matching files from the existing identity backup. Do not initialize a replacement identity for an existing server. For a new installation only, follow docs/release/experimental-development.md.`;

test('TLS preflight explains missing .env configuration', async () => {
  await assert.rejects(ensureTlsReady({}, 'dev'), { message: 'VAULTS_TLS_DIR is missing from .env. Complete the TLS setup in docs/release/experimental-development.md.' });
});

for (const action of ['dev', 'start']) {
  test(`${action} reports a missing identity with exact unavailable paths and safe recovery guidance`, async t => {
    const { identity } = await fixture(t);
    await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, action), { message: missingMessage(identity, action) });
  });
}

for (const missing of required) {
  test(`TLS preflight rejects a partial identity missing ${missing} without changing its files`, async t => {
    const retained = required.filter(path => path !== missing);
    const { identity } = await fixture(t, [...retained, 'runtime/token.key', 'runtime/checkpoint.key']);
    await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev'), { message: missingMessage(identity, 'dev', [missing]) });
    for (const file of [...retained, 'runtime/token.key', 'runtime/checkpoint.key']) assert.equal(await readFile(join(identity, file), 'utf8'), `synthetic fixture: ${file}`);
    await assert.rejects(readFile(join(identity, missing)), { code: 'ENOENT' });
  });
}

test('TLS preflight accepts a complete default identity', async t => {
  const { identity } = await fixture(t, required);
  await ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev');
});

test('TLS preflight rejects a directory created at a certificate mount path', async t => {
  const { identity } = await fixture(t, ['live/server.crt', 'live/server.key']);
  await mkdir(join(identity, 'ca', 'ca.crt'), { recursive: true });
  await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev'), /ca\.crt \(not a regular file\)/);
});

test('TLS preflight rejects an empty private key without changing the identity', async t => {
  const { identity } = await fixture(t, required);
  const key = join(identity, 'live', 'server.key');
  await writeFile(key, '');
  await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev'), /server\.key \(empty file\)/);
  assert.equal(await readFile(key, 'utf8'), '');
});

test('custom CA configuration requires that exact filename rather than falling back to ca.crt', async t => {
  const { identity } = await fixture(t, required);
  const values = { VAULTS_TLS_DIR: identity, VAULTS_CA_CERT_FILE: 'trusted-ca.crt' };
  await assert.rejects(ensureTlsReady(values, 'dev'), { message: missingMessage(identity, 'dev', ['ca/trusted-ca.crt']) });
  await writeFile(join(identity, 'ca', 'trusted-ca.crt'), 'synthetic custom CA');
  await ensureTlsReady(values, 'dev');
});

for (const args of [['start'], ['dev'], ['dev', '--check']]) {
test(`actual ${args.join(' ')} exits with the TLS error before creating runtime files or starting containers`, async t => {
  const { directory, identity } = await fixture(t, ['live/server.crt', 'ca/ca.crt']);
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory,'apps/cli/src'),{recursive:true});await copyFile(new URL('../apps/cli/src/namespace-contract.json',import.meta.url),join(directory,'apps/cli/src/namespace-contract.json'));
  for (const script of ['mvp-acceptance.mjs', 'mvp-startup.mjs','runtime-namespace.mjs']) await copyFile(new URL(script, import.meta.url), join(directory, 'scripts', script));
  await writeFile(join(directory,'127Vaults Namespaces/development/server.env'), `VAULTS_TLS_DIR=${identity}\n`);
  const result = spawnSync(process.execPath, ['scripts/mvp-acceptance.mjs', ...args], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true, env:{...process.env,APPDATA:directory,XDG_CONFIG_HOME:directory,VAULTS_NAMESPACE:'development',VAULTS_MVP_ENV_FILE:join(directory,'127Vaults Namespaces/development/server.env'),VAULTS_CONFIG_DIR:join(directory,'client-profile')} });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.replace(/\r\n/g, '\n').includes(missingMessage(identity, args[0], ['live/server.key'])), result.stderr);
  assert.deepEqual((await readdir(identity)).sort(), ['ca', 'live']);
  assert.equal(await readFile(join(identity, 'live', 'server.crt'), 'utf8'), 'synthetic fixture: live/server.crt');
});
}

test('launcher preflight accepts complete TLS files without starting containers or creating runtime secrets', async t => {
  const { directory, identity } = await fixture(t, required);
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory,'apps/cli/src'),{recursive:true});await copyFile(new URL('../apps/cli/src/namespace-contract.json',import.meta.url),join(directory,'apps/cli/src/namespace-contract.json'));
  for (const script of ['mvp-acceptance.mjs', 'mvp-startup.mjs','runtime-namespace.mjs']) await copyFile(new URL(script, import.meta.url), join(directory, 'scripts', script));
  await writeFile(join(directory,'127Vaults Namespaces/development/server.env'), `VAULTS_TLS_DIR=${identity}\n`);
  const result = spawnSync(process.execPath, ['scripts/mvp-acceptance.mjs', 'dev', '--check'], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true, env:{...process.env,APPDATA:directory,XDG_CONFIG_HOME:directory,VAULTS_NAMESPACE:'development',VAULTS_MVP_ENV_FILE:join(directory,'127Vaults Namespaces/development/server.env'),VAULTS_CONFIG_DIR:join(directory,'client-profile')} });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local TLS startup files are present/);
  assert.deepEqual((await readdir(identity)).sort(), ['ca', 'live']);
});

test('an enrolled origin cannot be taken over even if no listener is running', async t => {
 const dir=await mkdtemp(join(tmpdir(),'127v-origin-pin-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'trust.conf'),'url=https://127.0.0.1:12780/\n');
 await assert.rejects(ensureDevOriginIsolated('https://127.0.0.1:12780',dir),/enrolled Desktop profile/);
 await ensureDevOriginIsolated('https://127.0.0.1:12961',dir);
 await ensureDevOriginIsolated('https://127.0.0.1:12780',join(dir,'missing'));
 await writeFile(join(dir,'tenant-binding.json'),JSON.stringify({tenant_id:'fixture-original'}));
 await writeFile(join(dir,'installation-id'),'fixture-original');
 await assert.rejects(ensureDevOriginIsolated('https://127.0.0.1:12961',dir,dir),/independent identity/);
});

test('development selects only the recorded matching server, leaving fixture takeover blocked',async t=>{
 const {directory,identity}=await fixture(t,['ca/ca.crt']);const profile=join(directory,'profile');await mkdir(profile);await mkdir(join(directory,'.tools'));
 const origin='https://127.0.0.1:12780',installationId='10000000-0000-4000-8000-000000000001';
 const ca=await readFile(join(identity,'ca/ca.crt')),digest=createHash('sha256').update(ca).digest('hex');
 const trust=`url=${origin}/\nca_sha256=${digest}\n`;await writeFile(join(profile,'trust.conf'),trust);await writeFile(join(profile,'installation-ca.pem'),ca);await writeFile(join(profile,'tenant-binding.json'),JSON.stringify({tenant_id:installationId}));
 const input={root:directory,origin,profile};
 await assert.rejects(devStartupPlan(input),/recorded local server is unavailable/);
 const config={origin,identity,installationId,database:'fixture-db',server:'fixture-server',relay:'fixture-relay',mounts:Object.fromEntries(['database','server','relay'].map(role=>[role,[{Source:role,Destination:'/fixture'}]]))};
 await writeFile(join(directory,'.tools/local-server.json'),JSON.stringify(config));
 assert.deepEqual(await devStartupPlan(input),{mode:'pinned',origin,legacyFingerprint:false});
 await assert.rejects(devStartupPlan({...input,allowPinned:false}),/enrolled Desktop/);
 await writeFile(join(profile,'installation-ca.pem'),'other CA');await assert.rejects(devStartupPlan(input),/certificate differs/);await writeFile(join(profile,'installation-ca.pem'),ca);
 await writeFile(join(profile,'tenant-binding.json'),JSON.stringify({tenant_id:'other-installation'}));await assert.rejects(devStartupPlan(input),/differs from Desktop history/);
 await writeFile(join(profile,'tenant-binding.json'),JSON.stringify({tenant_id:installationId}));
 await writeFile(join(profile,'trust.conf'),`url=${origin}/\nca_sha256=${'0'.repeat(64)}\n`);
 assert.equal((await devStartupPlan(input)).legacyFingerprint,true);assert.match(await readFile(join(profile,'trust.conf'),'utf8'),new RegExp('0'.repeat(64)));
 assert.deepEqual(await devStartupPlan({...input,origin:'https://127.0.0.1:12961'}),{mode:'fixture',origin:'https://127.0.0.1:12961'});
 await mkdir(join(directory,'apps/cli/src'),{recursive:true});await copyFile(new URL('../apps/cli/src/namespace-contract.json',import.meta.url),join(directory,'apps/cli/src/namespace-contract.json'));
 await mkdir(join(directory,'scripts'));for(const name of ['mvp-startup.mjs','mvp-acceptance.mjs','runtime-namespace.mjs'])await copyFile(new URL(name,import.meta.url),join(directory,'scripts',name));
 await writeFile(join(directory,'127Vaults Namespaces/development/server.env'),'VAULTS_TLS_DIR='+identity+'\n');
 const result=spawnSync(process.execPath,['scripts/mvp-acceptance.mjs','dev','--check'],{cwd:directory,encoding:'utf8',windowsHide:true,env:{...process.env,APPDATA:directory,XDG_CONFIG_HOME:directory,VAULTS_NAMESPACE:'development',VAULTS_MVP_ENV_FILE:join(directory,'127Vaults Namespaces/development/server.env'),VAULTS_CONFIG_DIR:profile}});
 assert.equal(result.status,1);assert.match(result.stderr,/TLS startup preflight failed/);
 await unlink(join(directory,'127Vaults Namespaces/development/server.env'));
 const noFixtureEnv=spawnSync(process.execPath,['scripts/mvp-acceptance.mjs','dev','--check'],{cwd:directory,encoding:'utf8',windowsHide:true,env:{...process.env,APPDATA:directory,XDG_CONFIG_HOME:directory,VAULTS_NAMESPACE:'development',VAULTS_MVP_ENV_FILE:join(directory,'127Vaults Namespaces/development/server.env'),VAULTS_CONFIG_DIR:profile}});
 assert.equal(noFixtureEnv.status,1);assert.match(noFixtureEnv.stderr,/Initialize this namespace first/);
});
