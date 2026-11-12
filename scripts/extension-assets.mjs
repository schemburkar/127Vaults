import { copyFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Unpacked extensions cannot import outside their own root. Stage the canonical
// dependency for local loading and for packages; never maintain a second source.
export async function prepareExtensionAssets(repository = resolve(import.meta.dirname, '..'), destination = join(repository, 'apps/extension')) {
  const shared = join(destination, 'src/shared');
  await mkdir(shared, { recursive: true });
  await copyFile(join(repository, 'packages/domain/src/passkey-metadata.mjs'), join(shared, 'passkey-metadata.mjs'));
  await copyFile(join(repository,'packages/domain/src/connection-help.mjs'),join(shared,'connection-help.mjs'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareExtensionAssets();
  console.log('Canonical passkey metadata staged for the unpacked extension.');
}
