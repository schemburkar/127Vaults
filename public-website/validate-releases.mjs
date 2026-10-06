import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateReleaseCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.releases)) throw new Error('invalid release catalogue');
  const ids = new Set();
  for (const item of catalog.releases) {
    if (!item || !['desktop-windows', 'extension-chrome', 'extension-edge', 'cli-windows', 'cli-linux', 'server'].includes(item.platform)
      || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(item.version)
      || !['stable', 'beta'].includes(item.channel)
      || !/^https:\/\//.test(item.url) || !/^https:\/\//.test(item.signatureUrl) || !/^https:\/\//.test(item.licenseUrl)
      || !/^[a-f0-9]{64}$/.test(item.sha256) || !/^[A-Za-z0-9_-]{1,40}$/.test(item.signingKeyId)
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(item.changeDate)
      || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1
      || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(item.minServerVersion)) throw new Error('invalid release entry');
    const id = `${item.platform}:${item.version}:${item.channel}`;
    if (ids.has(id)) throw new Error('duplicate release entry');
    ids.add(id);
  }
  return catalog;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  validateReleaseCatalog(JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'releases.json'), 'utf8')));
  process.stdout.write('Release catalogue valid.\n');
}
