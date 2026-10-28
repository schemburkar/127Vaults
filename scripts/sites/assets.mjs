import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const sharedAssets = ['site.css', 'theme.mjs', 'brand-mark.svg', 'favicon.svg', 'wordmark.svg'];
export const publicAssets = ['index.html', 'product.html', 'security.html', 'security-technical.html', 'deployment.html',
  'pricing.html', 'downloads.html', 'release-notes-history.html', 'get-started.html', 'faq.html', 'setup-guide.html',
  'tour.mjs', 'access.mjs', 'downloads.mjs', 'cloud-pricing.mjs', 'setup-guide.mjs', 'releases.json', ...sharedAssets];
export const adminAssets = ['access-admin.html', 'access-admin.mjs', 'billing-admin.mjs', 'releases.html', 'releases.mjs', 'trial.css', ...sharedAssets];
export const customerAssets = ['trial.html', 'trial.mjs', 'billing.html', 'billing.mjs', 'trial.css', 'setup-guide.html', 'setup-guide.mjs', ...sharedAssets];
export const siteAssets = { public: publicAssets, admin: adminAssets, customer: customerAssets };
const common = new Set([...sharedAssets, 'trial.css', 'setup-guide.html', 'setup-guide.mjs']);
export function assetDirectory(surface, name) {
  if (!siteAssets[surface]?.includes(name)) throw Error('Asset does not belong to this site');
  return join(repository, common.has(name) || surface === 'public' ? 'public-website' : `${surface === 'customer' ? 'customer' : 'admin'}-website`);
}
// Compatibility source lookup only. Existing Cloudflare publication stays combined until its separate deployment migration.
export function legacyAssetDirectory(name) {
  if (common.has(name)) return join(repository, 'public-website');
  const surface = adminAssets.includes(name) && !common.has(name) ? 'admin'
    : customerAssets.includes(name) && !common.has(name) ? 'customer' : 'public';
  return assetDirectory(surface, name);
}
export async function readSiteAsset(surface, name) {
  const directory = assetDirectory(surface, name), path = join(directory, name), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || relative(await realpath(directory), await realpath(path)) !== name) throw Error('Invalid site asset');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    if (!current.isFile() || info.ino !== current.ino || info.dev !== current.dev) throw Error('Site asset changed');
    return await file.readFile();
  } finally { await file.close(); }
}
export async function stageSite(surface, directory, { publicOrigin } = {}) {
  if (!siteAssets[surface]) throw Error('Unknown site');
  const sources = new Map(await Promise.all(siteAssets[surface].map(async name => [name, await readSiteAsset(surface, name)])));
  if (surface !== 'public') sources.set('index.html', sources.get(surface === 'admin' ? 'access-admin.html' : 'trial.html'));
  const digest = createHash('sha256');
  for (const [name, data] of sources) digest.update(name).update('\0').update(data);
  const version = digest.digest('hex').slice(0, 20);
  await mkdir(resolve(directory), { recursive: false, mode: 0o700 });
  for (const [name, data] of sources) {
    const content = name.endsWith('.html') ? data.toString('utf8')
      .replace(/(href=["'])([a-z0-9-]+)\.html(?=[?#"'])/g, (all, prefix, page) => sources.has(`${page}.html`)
        ? `${prefix}/${page === 'index' ? '' : page}` : publicOrigin && publicAssets.includes(`${page}.html`) ? `${prefix}${publicOrigin}/${page}` : all)
      .replace(/((?:src|href)=["'])([^"'?#]+\.(?:css|mjs|svg))(?:\?[^"'#]*)?(["'])/g,
        (all, prefix, path, quote) => sources.has(path.replace(/^\//, '')) ? `${prefix}${path}?v=${version}${quote}` : all) : data;
    await writeFile(join(directory, name), content, { flag: 'wx' });
  }
  await writeFile(join(directory, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cache-Control: no-store\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\n${surface === 'public' ? '' : '  X-Robots-Tag: noindex, nofollow\n'}`);
  return { surface, directory, version, files: [...sources.keys()] };
}
