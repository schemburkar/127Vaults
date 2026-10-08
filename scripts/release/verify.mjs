import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './package.mjs';

export async function verifyPackages(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.channel !== 'private-test' || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Invalid package manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(file.name) || names.has(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) throw Error('Invalid package entry.');
    names.add(file.name);
    const path = resolve(directory, file.name);
    if ((await stat(path)).size !== file.sizeBytes || await sha256(path) !== file.sha256) throw Error(`Package checksum mismatch: ${file.name}`);
  }
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPackages(resolve(process.argv[2] ?? '.')).then(value => console.log(`Verified ${value.files.length} files from ${value.revision}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
