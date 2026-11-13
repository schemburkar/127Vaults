import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeNamespace, assertNamespacePath, prepareNamespace, assertServerIdentity } from './runtime-namespace.mjs';

test('build-bound test identity survives a launch without runtime selectors',()=>{
  const n=runtimeNamespace({VAULTS_BUILD_NAMESPACE:'test',VAULTS_BUILD_TEST_INSTANCE:'one'},{configRoot:tmpdir()});
  assert.equal(n.id,'test-one');
  assert.throws(()=>runtimeNamespace({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:'two',VAULTS_BUILD_TEST_INSTANCE:'one'},{configRoot:tmpdir()}));
});

test('server database identity cannot be rebound and unmarked existing data cannot be adopted',async()=>{
  const base=await mkdtemp(join(tmpdir(),'vaults-namespace-binding-'));
  try {
    const n=runtimeNamespace({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:'binding'},{configRoot:base});
    await mkdir(n.root,{recursive:true});await writeFile(join(n.root,'existing-vault'),'preserve');
    await assert.rejects(prepareNamespace(n),/migrate.*explicitly/);
    assert.equal(await readFile(join(n.root,'existing-vault'),'utf8'),'preserve');
    await writeFile(join(n.root,'namespace-owner'),n.id);
    await assertServerIdentity(n,n.serverIdentity);
    await assert.rejects(assertServerIdentity(n,join(n.root,'another-identity')),/database binding/);
  } finally {await rm(base,{recursive:true,force:true});}
});

test('explicit selection rejects invalid, missing and conflicting namespaces', () => {
  const configRoot = tmpdir();
  for (const env of [{}, {VAULTS_NAMESPACE:'dev'}, {VAULTS_NAMESPACE:'test'}, {VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:'../prod'},
    {VAULTS_NAMESPACE:'production',VAULTS_TEST_INSTANCE:'one'}, {VAULTS_NAMESPACE:'development',VAULTS_BUILD_NAMESPACE:'production'}])
    assert.throws(() => runtimeNamespace(env, {configRoot}));
  assert.throws(() => runtimeNamespace({VAULTS_NAMESPACE:'production'}, {configRoot,launcher:true}));
  assert.equal(runtimeNamespace({}, {configRoot,launcher:true}).id, 'development');
});

test('parallel instances, credentials and connectors have independent roots and identities', () => {
  const options = {configRoot:tmpdir()};
  const all = [{VAULTS_NAMESPACE:'production'},{VAULTS_NAMESPACE:'development'},
    ...['one','two'].map(VAULTS_TEST_INSTANCE => ({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE}))].map(env => runtimeNamespace(env,options));
  assert.equal(new Set(all.map(n=>n.root)).size,4);
  assert.equal(new Set(all.map(n=>n.nativeHost)).size,4);
  assert.equal(new Set(all.map(n=>n.project)).size,4);
});

test('ownership, traversal and redirected cleanup targets fail closed', async () => {
  const base = await mkdtemp(join(tmpdir(),'vaults-namespace-'));
  try {
    const n = runtimeNamespace({VAULTS_NAMESPACE:'test',VAULTS_TEST_INSTANCE:'one'},{configRoot:base});
    await assert.rejects(assertNamespacePath(n,n.root,{owned:true}));
    await prepareNamespace(n);
    await assertNamespacePath(n,n.root,{owned:true});
    await assert.rejects(assertNamespacePath(n,join(n.root,'../../production')));
    await writeFile(join(n.root,'namespace-owner'),'test-two');
    await assert.rejects(assertNamespacePath(n,n.root,{owned:true}));
    await writeFile(join(n.root,'namespace-owner'),n.id);
    const elsewhere=join(base,'production');await mkdir(elsewhere);
    try {await symlink(elsewhere,join(n.root,'redirect'),process.platform==='win32'?'junction':'dir');}
    catch(error){if(error.code==='EPERM')return;throw error;}
    await assert.rejects(assertNamespacePath(n,join(n.root,'redirect/vault')));
  } finally { await rm(base,{recursive:true,force:true}); }
});
