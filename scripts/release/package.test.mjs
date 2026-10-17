import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { outputDirectory, packageExtension, writeManifest, macSigningReady } from './package.mjs';
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
test('extension handoff excludes tests and developer installers; manifest detects corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-package-'));
  try {
    await packageExtension(directory);
    assert.deepEqual((await readdir(join(directory, '127vaults-extension'))).sort(), ['README.md', 'manifest.json', 'popup.html', 'src']);
    const extension = JSON.parse(await readFile(join(directory, '127vaults-extension/manifest.json'), 'utf8'));
    assert.equal(extension.manifest_version, 3);
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
    await writeManifest(first, ['desktop']); await writeManifest(second, ['server']);
    const output = join(directory, 'combined');
    await assemble(output, [first, second], true);
    assert.equal((await verifyPackages(output)).files.some(file => file.name === 'client.zip'), true);
    assert.match(await readFile(`${output}.zip.sha256`, 'utf8'), /^[a-f0-9]{64}  combined.zip\n$/);
    const path = join(second, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.revision = 'different-revision';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(assemble(join(directory, 'mixed'), [first, second]), /same source revision/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
