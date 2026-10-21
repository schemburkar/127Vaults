import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
// Public-site SVGs are the canonical brand artwork. Run after artwork changes.
for (const target of ['apps/web/public', 'apps/desktop/public', 'apps/extension/src/icons']) {
  await mkdir(target, { recursive: true });
  for (const name of ['brand-mark.svg', 'wordmark.svg']) await copyFile(`public-website/${name}`, `${target}/${name}`);
}
await copyFile('public-website/brand-mark.svg', 'apps/desktop/app-icon.svg');
// The extension pairs the red 127 mark with only the white Vaults lettering.
// Derive it from the canonical paths instead of maintaining separate artwork.
const wordmark = await readFile('public-website/wordmark.svg', 'utf8');
const paths = wordmark.match(/<path\b[^>]*\/>/g);
if (paths?.length !== 2) throw Error('Review canonical wordmark paths before deriving the Vaults-only lettering.');
await writeFile('apps/extension/src/icons/vaults-wordmark.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 16 198 68" fill="#fff"><title>Vaults</title>${paths[1]}</svg>\n`);
console.log('Canonical logo and wordmark synced to all graphical clients.');
