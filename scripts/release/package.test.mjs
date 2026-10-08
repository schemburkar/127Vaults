import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { outputDirectory, packageExtension, writeManifest } from './package.mjs';
import { verifyPackages } from './verify.mjs';

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
test('release verifier rejects path traversal and duplicate file names', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-manifest-'));
  try {
    const file = { name: '../outside', sha256: 'a'.repeat(64), sizeBytes: 1 };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, channel: 'private-test', files: [file] }));
    await assert.rejects(verifyPackages(directory), /Invalid package entry/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
