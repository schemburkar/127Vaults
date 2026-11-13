import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { outputDirectory, packageExtension, writeManifest, macSigningReady, desktopPackageIdentity, desktopInstallerCandidates, main } from './package.mjs';
import { verifyPackages } from './verify.mjs';
import { assemble } from './assemble.mjs';

test('Mac distribution refuses absent, ad-hoc, or incomplete notarization credentials', () => {
  assert.equal(macSigningReady({}),false);
  assert.equal(macSigningReady({APPLE_SIGNING_IDENTITY:'-'}),false);
  assert.equal(macSigningReady({APPLE_SIGNING_IDENTITY:'Developer ID Application: Test'}),false);
  assert.equal(macSigningReady({APPLE_SIGNING_IDENTITY:'Developer ID Application: Test',APPLE_ID:'test',APPLE_PASSWORD:'test',APPLE_TEAM_ID:'test'}),true);
});

test('packaging refuses output in the source checkout', () => {
  assert.throws(() => outputDirectory(null));
  assert.throws(() => outputDirectory(resolve('.')));
  assert.throws(() => outputDirectory(resolve('dist/release')));
  assert.equal(outputDirectory(join(tmpdir(), '127vaults-test-output')), resolve(tmpdir(), '127vaults-test-output'));
});

test('missing or misspelled namespace options fail before creating a package directory',async()=>{
  const base=await mkdtemp(join(tmpdir(),'127vaults-package-arguments-'));
  try {
    const output=join(base,'not-created');
    await assert.rejects(main(['--out',output,'--namespace']),/Missing value/);
    await assert.rejects(main(['--out',output,'--namespce','development']),/Unknown packaging option/);
    await assert.rejects(readdir(output),{code:'ENOENT'});
  } finally {await rm(base,{recursive:true,force:true});}
});

test('development packages have distinct application and Linux executable identities',()=>{
  const prod=desktopPackageIdentity(),dev=desktopPackageIdentity({namespace:'development'});
  assert.deepEqual(prod.config,{});
  assert.equal(dev.config.productName,'127Vaults Dev Desktop');
  assert.notEqual(dev.config.identifier,'com.127vaults.desktop.poc');
  assert.equal(dev.config.mainBinaryName,'127vaults-desktop-development');
  assert.ok(dev.sidecars.every(d=>!prod.sidecars.some(p=>p.name===d.name)));
});

test('stale production installers are never selected for a development package at the same version',()=>{
  const files=['127Vaults Desktop_1.2.3_x64-setup.exe','127Vaults Dev Desktop_1.2.3_x64-setup.exe'];
  assert.deepEqual(desktopInstallerCandidates(files,'1.2.3','.exe',['127Vaults Dev Desktop']),[files[1]]);
  assert.deepEqual(desktopInstallerCandidates([files[0]],'1.2.3','.exe',['127Vaults Dev Desktop']),[]);
  assert.deepEqual(desktopInstallerCandidates(['127vaults-desktop_1.2.3_amd64.deb','127vaults-dev-desktop_1.2.3_amd64.deb'],
    '1.2.3','.deb',['127Vaults Dev Desktop']),['127vaults-dev-desktop_1.2.3_amd64.deb']);
});

test('development extension package selects its own native host and keeps production source intact',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'127vaults-dev-package-'));
  try {
    await packageExtension(directory,{namespace:'development'});
    const background=await readFile(join(directory,'127vaults-extension/src/background.mjs'),'utf8');
    assert.ok(background.includes("connectNative('com.127vaults.connector.development')"));
    const manifest=JSON.parse(await readFile(join(directory,'127vaults-extension/manifest.json'),'utf8'));
    assert.equal(manifest.name,'127Vaults Dev');
    assert.ok((await readFile(new URL('../../apps/extension/src/background.mjs',import.meta.url),'utf8')).includes("connectNative('com.127vaults.connector')"));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('extension handoff excludes tests and developer installers; manifest detects corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-package-'));
  try {
    await packageExtension(directory);
    assert.deepEqual((await readdir(join(directory, '127vaults-extension'))).sort(), ['COMMERCIAL-LICENSE.md', 'LICENSE.md', 'README.md', 'manifest.json', 'popup.html', 'src', 'store-review.json']);
    const extension = JSON.parse(await readFile(join(directory, '127vaults-extension/manifest.json'), 'utf8'));
    assert.equal(extension.manifest_version, 3);
    const canonical = await readFile(new URL('../../packages/domain/src/passkey-metadata.mjs', import.meta.url), 'utf8');
    assert.equal(await readFile(join(directory, '127vaults-extension/src/shared/passkey-metadata.mjs'), 'utf8'), canonical);
    const runtime = await import(pathToFileURL(join(directory, '127vaults-extension/src/passkeys.mjs')).href);
    assert.equal(runtime.encode(Uint8Array.of(1)), 'AQ');
    assert.equal(runtime.readMetadata([]), null);
    await writeManifest(directory, ['extension']);
    const manifest = await verifyPackages(directory);
    assert.equal(manifest.files.length, 1);
    await writeFile(join(directory, manifest.files[0].name), 'corrupted');
    await assert.rejects(verifyPackages(directory), /checksum mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('release verifier rejects path traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-manifest-'));
  try {
    const file = { name: '../outside', sha256: 'a'.repeat(64), sizeBytes: 1 };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, channel: 'private-test', files: [file] }));
    await assert.rejects(verifyPackages(directory), /Invalid package entry/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('assembler collects verified artifacts in a ZIP and refuses mixed revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-assemble-'));
  try {
    const first = join(directory, 'first');
    const second = join(directory, 'second');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(first); await mkdir(second);
    await writeFile(join(first, 'client.zip'), 'client');
    await writeFile(join(second, 'server.tar'), 'server');
    for (const dir of [first, second]) {
      await writeFile(join(dir, 'LICENSE.md'), 'source terms from build');
      await writeFile(join(dir, 'COMMERCIAL-LICENSE.md'), 'commercial terms from build');
    }
    await writeManifest(first, ['desktop']); await writeManifest(second, ['server']);
    const output = join(directory, 'combined');
    await assemble(output, [first, second], true);
    assert.equal((await verifyPackages(output)).files.some(file => file.name === 'client.zip'), true);
    assert.equal(await readFile(join(output, 'LICENSE.md'), 'utf8'), 'source terms from build');
    assert.equal(await readFile(join(output, 'COMMERCIAL-LICENSE.md'), 'utf8'), 'commercial terms from build');
    assert.match(await readFile(`${output}.zip.sha256`, 'utf8'), /^[a-f0-9]{64}  combined.zip\n$/);
    const path = join(second, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.namespace = 'development';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(assemble(join(directory, 'mixed-namespace'), [first, second]), /same installation namespace/);
    manifest.namespace = 'production';
    manifest.revision = 'different-revision';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(assemble(join(directory, 'mixed'), [first, second]), /same source revision/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
