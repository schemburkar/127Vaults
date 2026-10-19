import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function fileHash(path) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest('hex');
}
export async function verifyRelease(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.status !== 'complete' || !['desktop', 'cli', 'extension', 'server', 'installer'].includes(manifest.product)
    || manifest.channel !== 'private-test' || manifest.signed !== false || !/^[a-f0-9]{40,64}$/.test(manifest.sourceRevision)
    || !/^[a-f0-9]{64}$/.test(manifest.inputFingerprint) || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Invalid release manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.name) || ['release.json', 'SHA256SUMS'].includes(file.name) || names.has(file.name)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) throw Error('Invalid release file entry.');
    names.add(file.name);
    const path = resolve(directory, file.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes || await fileHash(path) !== file.sha256) throw Error(`Release checksum mismatch: ${file.name}`);
  }
  const sums = manifest.files.map(file => `${file.sha256}  ${file.name}\n`).join('');
  if (await readFile(resolve(directory, 'SHA256SUMS'), 'utf8') !== sums) throw Error('SHA256SUMS differs from release metadata.');
  const expected = new Set([...names, 'release.json', 'SHA256SUMS']);
  for (const name of await readdir(directory)) if (!expected.has(name)) throw Error(`Unexpected release content: ${name}`);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRelease(resolve(process.argv[2] ?? '.')).then(value => console.log(`Verified ${value.product}/${value.platform}: ${value.files.length} files from ${value.sourceRevision}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
