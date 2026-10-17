import { copyFile, mkdir } from 'node:fs/promises';
// Public-site SVGs are the canonical brand artwork. Run after artwork changes.
for (const target of ['apps/web/public', 'apps/desktop/public', 'apps/extension/src/icons']) {
  await mkdir(target, { recursive: true });
  for (const name of ['brand-mark.svg', 'wordmark.svg']) await copyFile(`public-website/${name}`, `${target}/${name}`);
}
await copyFile('public-website/brand-mark.svg', 'apps/desktop/app-icon.svg');
console.log('Canonical logo and wordmark synced to all graphical clients.');
