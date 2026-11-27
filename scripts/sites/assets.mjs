import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const sharedAssets = ['site.css', 'theme.mjs', 'package-list.mjs', 'brand-mark.svg', 'favicon.svg', 'wordmark.svg'];
export const publicAssets = ['index.html', 'product.html', 'security.html', 'security-technical.html', 'deployment.html',
  'pricing.html', 'downloads.html', 'release-notes-history.html', 'get-started.html', 'faq.html', 'setup-guide.html',
  'terms.html', 'privacy.html', 'refunds.html', 'support.html',
  'tour.mjs', 'access.mjs', 'downloads.mjs', 'cloud-pricing.mjs', 'setup-guide.mjs', 'releases.json', ...sharedAssets];
export const adminAssets = ['access-admin.html', 'access-admin.mjs', 'access-desk.mjs', 'request-data.mjs', 'invitation-status.mjs', 'billing-actions.mjs', 'workspace-ui.mjs', 'request-drawer.mjs', 'billing-admin.mjs', 'admin-shell.mjs', 'admin.css', 'subscriptions.html', 'coupons.html', 'licenses.html', 'licenses.mjs', 'releases.html', 'releases.mjs', 'customer-mail.html', 'customer-mail.mjs', 'cloud-tenants.html', 'cloud-tenants.mjs', 'trial.css', ...sharedAssets];
export const customerAssets = ['join.html', 'join.mjs', 'portal.html', 'portal.mjs', 'portal.css', 'portal-client.mjs', 'manage-shell.mjs', 'manage-state.mjs', 'passkeys.mjs', 'trial.html', 'trial.mjs', 'billing.html', 'billing.mjs', 'trial.css', 'setup-guide.html', 'setup-guide.mjs', ...sharedAssets];
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
export async function stageSite(surface, directory, { publicOrigin, personalBuyUrl, personalSubscriptionTrial } = {}) {
  if (!siteAssets[surface]) throw Error('Unknown site');
  const sources = new Map(await Promise.all(siteAssets[surface].map(async name => [name, await readSiteAsset(surface, name)])));
  if (surface === 'public' && personalBuyUrl) {
    const button = '<a class="plan-cta" href="get-started.html?plan=personal">Request access</a>';
    for (const name of ['index.html', 'pricing.html']) {
      const content = sources.get(name).toString('utf8');
      if (!content.includes(button)) throw Error(`Personal plan action missing in ${name}`);
      let updated = content.replace(/<article\b[^>]*>[\s\S]*?<\/article>/g, article => article.includes(button)
        ? article.replace(button, `<a class="plan-cta" href="${personalBuyUrl}">Subscribe now</a>`)
        : article);
      if (name === 'index.html') updated = updated.replace(
        '<a class="button primary" data-personal-subscribe href="get-started.html?plan=personal">Subscribe to Personal</a>',
        `<a class="button primary" data-personal-subscribe href="${personalBuyUrl}">Subscribe to Personal</a>`);
      sources.set(name, Buffer.from(updated));
    }
    const downloads = sources.get('downloads.html').toString('utf8');
    sources.set('downloads.html', Buffer.from(downloads.replace(
      '<!-- personal-purchase -->',
      `<p><a class="button primary" href="${personalBuyUrl}">Subscribe to Personal</a></p>`)));
    for (const name of ['deployment.html', 'get-started.html']) {
      sources.set(name, Buffer.from(sources.get(name).toString('utf8').replace('<!-- personal-purchase -->',
        `<p><a class="button primary" href="${personalBuyUrl}">Subscribe to Personal</a></p>`)));
    }
    if (personalSubscriptionTrial) {
      const update = (name, edit) => sources.set(name, Buffer.from(edit(sources.get(name).toString('utf8'))));
      update('get-started.html', html => html
        .replace('Request a Personal trial or Commercial access below.', 'Request Commercial access below. To start a 15-day Personal trial or subscribe, open Manage.')
        .replace(/<label><input type="radio" name="plan" value="personal" checked>.*?<\/label>\s*/, '')
        .replace('value="commercial"', 'value="commercial" checked')
        .replace('Choose Personal or Commercial to try self-hosting.', 'Choose Commercial for self-hosted access.'));
      update('downloads.html', html => html.replace('Subscribe to Personal or request trial access to get started.',
        'Choose Subscribe to Personal to start a free 15-day trial or buy an annual license.'));
      update('deployment.html', html => html.replace('You can request a Personal trial before subscribing.',
        'Choose Subscribe to Personal to start a free 15-day trial or buy an annual license.'));
      update('terms.html', html => html.replace('<h2>Requesting access</h2>',
        '<h2>Personal self-service trial</h2><p>Eligible accounts can start a free Personal trial through Manage. It runs for 15 days from activation on one self-hosted server. The one-time checkout requires no card and does not renew. A separate subscription purchase is required for continued writes.</p><h2>Invitation-based access</h2>'));
      update('refunds.html', html => html.replace('<h2>Free trials</h2>', '<h2>Invitation-based trials</h2>')
        .replace('The 10-day self-hosted trial', 'The invitation-based 10-day self-hosted trial')
        .replace('<h2>Invitation-based trials</h2>', '<h2>Free trials</h2><p>The self-service Personal trial lasts 15 days from activation and ends automatically. Starting a subscription requires a separate purchase.</p>'));
    }
  }
  if (surface !== 'public') sources.set('index.html', sources.get(surface === 'admin' ? 'access-admin.html' : 'portal.html'));
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
  await writeFile(join(directory, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Cache-Control: no-store\n  Content-Security-Policy: default-src 'self'; script-src 'self'${surface === 'public' ? ' https://challenges.cloudflare.com' : ''}; frame-src${surface === 'public' ? ' https://challenges.cloudflare.com' : " 'none'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\n${surface === 'public' ? '' : '  X-Robots-Tag: noindex, nofollow\n'}`);
  return { surface, directory, version, files: [...sources.keys()] };
}
