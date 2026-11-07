import { createHash, createPublicKey } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validIntakeOrigin } from '../../apps/public-intake/src/intake-origin.mjs';
import { issuer } from '../../apps/public-intake/cloudflare/crypto.mjs';
import { versionParts } from '../../apps/public-intake/cloudflare/installer.mjs';
import { billingConfig } from '../../apps/public-intake/cloudflare/dodo.mjs';
import { legacyAssetDirectory } from '../sites/assets.mjs';
const run = promisify(execFile);
export const repository = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const localDeploymentDirectory = join(repository, '.cloudflare-deploy');
export const workerDirectory = join(repository, 'apps/public-intake/cloudflare');
export const assetFiles = ['index.html', 'product.html', 'security.html', 'security-technical.html', 'deployment.html', 'pricing.html',
  'downloads.html', 'release-notes-history.html', 'get-started.html', 'faq.html', 'setup-guide.html', 'trial.html', 'access-admin.html',
  'terms.html', 'privacy.html', 'refunds.html', 'support.html',
  'site.css', 'trial.css', 'theme.mjs', 'package-list.mjs', 'tour.mjs', 'access.mjs', 'downloads.mjs', 'cloud-pricing.mjs',
  'trial.mjs', 'access-admin.mjs', 'billing.html', 'billing.mjs', 'portal.html', 'portal.mjs', 'portal.css', 'portal-client.mjs', 'billing-admin.mjs', 'admin-shell.mjs', 'admin.css', 'subscriptions.html', 'coupons.html', 'licenses.html', 'licenses.mjs', 'releases.html', 'releases.mjs', 'customer-mail.html', 'customer-mail.mjs', 'setup-guide.mjs', 'releases.json', 'brand-mark.svg', 'favicon.svg', 'wordmark.svg'];
function contains(directory, path) {
  const rel = relative(directory, path);
  return !rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}
function deploymentPath(path, label) {
  const absolute = resolve(path);
  if (contains(repository, absolute) && !contains(localDeploymentDirectory, absolute)) {
    throw Error(`${label} must be outside the repository or inside .cloudflare-deploy`);
  }
  const inverse = relative(absolute, repository);
  if (inverse && !inverse.startsWith('..' + sep) && inverse !== '..' && !isAbsolute(inverse)) throw Error(`${label} must not be an ancestor of the repository`);
  return absolute;
}
export function validateConfig(value, file) {
  const allowed = ['schemaVersion', 'accountId', 'origin', 'workerName', 'databaseName', 'bucketName', 'releaseId',
    'catalogueFile', 'secretsDirectory', 'stateDirectory', 'issuerKeyId', 'location', 'emailFrom', 'requestAlertTo', 'requestAlertFrom', 'minimumInstallerVersion', 'billing', 'sites', 'customerEmail', 'intakeProtection', 'cloudAdmin'];
  if (!value || Object.keys(value).some(key => !allowed.includes(key)) || value.schemaVersion !== 1
    || !/^[a-f0-9]{32}$/.test(value.accountId) || !validIntakeOrigin(value.origin)
    || new URL(value.origin).port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(new URL(value.origin).hostname)
    || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.workerName) || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.databaseName)
    || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.bucketName) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.releaseId)
    || !/^[A-Za-z0-9_-]{1,40}$/.test(value.issuerKeyId ?? '')
    || (value.location && !['weur', 'eeur', 'apac', 'oc', 'wnam', 'enam'].includes(value.location))
    || (value.emailFrom && !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(value.emailFrom))
    || Boolean(value.requestAlertTo) !== Boolean(value.requestAlertFrom)
    || (value.requestAlertTo && (!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(value.requestAlertTo)
      || !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(value.requestAlertFrom)
      || value.requestAlertFrom.split('@')[1].toLowerCase() !== new URL(value.origin).hostname))) throw Error('Invalid Cloudflare deployment configuration');
  if (value.minimumInstallerVersion !== undefined && !versionParts(value.minimumInstallerVersion)) throw Error('Invalid minimum installer version');
  if (value.intakeProtection) {
    const p = value.intakeProtection;
    if (!value.sites || Object.keys(p).sort().join(',') !== 'cookieCooldownMs,siteKey,volumeThreshold,volumeWindowMs,waitMs'
      || !/^[A-Za-z0-9_-]{10,100}$/.test(p.siteKey ?? '')
      || !Number.isSafeInteger(p.waitMs) || p.waitMs < 1000 || p.waitMs > 60000
      || !Number.isSafeInteger(p.cookieCooldownMs) || p.cookieCooldownMs < 1000 || p.cookieCooldownMs > 86400000
      || !Number.isSafeInteger(p.volumeThreshold) || p.volumeThreshold < 2
      || !Number.isSafeInteger(p.volumeWindowMs) || p.volumeWindowMs < 3600000 || p.volumeWindowMs > 86400000) throw Error('Invalid intake protection configuration');
  }
  if (value.customerEmail) {
    const email = value.customerEmail;
    if (!value.sites || Object.keys(email).some(key => !['provider', 'from', 'enabled', 'dailyLimit', 'monthlyLimit'].includes(key))
      || email.provider !== 'resend' || typeof email.enabled !== 'boolean'
      || !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email.from ?? '')
      || (email.dailyLimit !== undefined && (!Number.isSafeInteger(email.dailyLimit) || email.dailyLimit < 21 || email.dailyLimit > 90))
      || (email.monthlyLimit !== undefined && (!Number.isSafeInteger(email.monthlyLimit) || email.monthlyLimit < 1 || email.monthlyLimit > 2800))) throw Error('Invalid production customer email configuration');
  }
  if (value.sites) {
    const sites = value.sites;
    if (Object.keys(sites).some(key => !['adminOrigin', 'customerOrigin', 'adminEmails', 'emailLogin', 'adminAccess'].includes(key))
      || ![sites.adminOrigin, sites.customerOrigin].every(origin => validIntakeOrigin(origin) && !new URL(origin).port)
      || new Set([value.origin, sites.adminOrigin, sites.customerOrigin].map(origin => new URL(origin).hostname)).size !== 3
      || !Array.isArray(sites.adminEmails) || !sites.adminEmails.length
      || sites.adminEmails.some(email => typeof email !== 'string' || !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email))
      || (sites.emailLogin !== undefined && typeof sites.emailLogin !== 'boolean')
      || (sites.adminAccess !== undefined && typeof sites.adminAccess !== 'boolean')
      || (sites.emailLogin && !value.emailFrom && !value.customerEmail?.enabled)) throw Error('Invalid separated site configuration');
    if (value.workerName.length > 53) throw Error('Worker name is too long for separated targets');
  }
  if (value.billing) {
    if (Object.keys(value.billing).some(key => !['mode', 'businessId', 'plans'].includes(key))) throw Error('Invalid billing configuration');
    billingConfig({ DODO_ENABLED: '1', DODO_MODE: value.billing.mode ?? 'test_mode', DODO_BUSINESS_ID: value.billing.businessId,
      DODO_PLANS: JSON.stringify(value.billing.plans), DODO_API_KEY: 'validate-only', DODO_WEBHOOK_SECRET: 'validate-only' });
  }
  if (value.cloudAdmin !== undefined) {
    const cloud = value.cloudAdmin;
    if (!value.sites || !cloud || Object.keys(cloud).sort().join(',') !== 'accessAudience,accessIssuer,managementOrigin,operators' ||
        !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(cloud.accessIssuer ?? '') ||
        !/^[a-f0-9]{64}$/.test(cloud.accessAudience ?? '') || !validIntakeOrigin(cloud.managementOrigin) ||
        !/^https:\/\/[a-z0-9.-]+$/.test(cloud.managementOrigin) ||
        [value.origin, value.sites.adminOrigin, value.sites.customerOrigin].includes(cloud.managementOrigin) ||
        !Array.isArray(cloud.operators) || !cloud.operators.length ||
        cloud.operators.some(email => typeof email !== 'string' || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email))) {
      throw Error('Invalid Cloud admin deployment configuration');
    }
  }
  const base = dirname(resolve(file));
  for (const name of ['catalogueFile', 'secretsDirectory', 'stateDirectory']) {
    if (typeof value[name] !== 'string' || !value[name]) throw Error(`Missing ${name}`);
    value[name] = deploymentPath(resolve(base, value[name]), name);
  }
  if (contains(value.stateDirectory, value.secretsDirectory) || contains(value.secretsDirectory, value.stateDirectory)) {
    throw Error('Keep secrets outside the generated state directory and use separate directories');
  }
  return value;
}
async function physicalPath(path) {
  let parent = path;
  const missing = [];
  while (true) {
    try { return resolve(await realpath(parent), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(parent); if (next === parent) throw error;
      missing.push(relative(next, parent)); parent = next;
    }
  }
}
export async function loadConfig(file) {
  const value = validateConfig(JSON.parse(await readFile(file, 'utf8')), file);
  // Also validate physical paths: a junction must not redirect private deployment files into public source/assets.
  for (const name of ['catalogueFile', 'secretsDirectory', 'stateDirectory']) value[name] = await physicalPath(value[name]);
  return validateConfig(value, file);
}
export async function protectedDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await run('whoami.exe', [], { windowsHide: true });
    const identity = stdout.trim(); if (!identity || /[\r\n]/.test(identity)) throw Error('Cannot identify operator');
    await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true });
  } else await chmod(directory, 0o700);
}
export async function saveJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temp, file);
}
export async function loadSecrets(config, catalogue) {
  const read = name => readFile(join(config.secretsDirectory, name), 'utf8').then(v => v.trim());
  const values = { INTAKE_KEY: await read('intake-key'), OPERATOR_TOKEN: await read('operator-token'),
    TRIAL_ISSUER_PRIVATE_KEY: await read('issuer.pem') };
  if (!/^[a-f0-9]{64}$/i.test(values.INTAKE_KEY) || !/^[A-Za-z0-9_-]{43,128}$/.test(values.OPERATOR_TOKEN)) throw Error('Invalid deployment secrets');
  const publicKey = createPublicKey(values.TRIAL_ISSUER_PRIVATE_KEY).export({ type: 'spki', format: 'pem' });
  if (catalogue.issuerPublicKeys?.[config.issuerKeyId] !== publicKey) throw Error('Issuer does not match the selected server release');
  await issuer(values.TRIAL_ISSUER_PRIVATE_KEY, publicKey);
  if (config.emailFrom && !config.customerEmail) {
    values.TRIAL_EMAIL_API_TOKEN = await read('cloudflare-email-token');
    if (!/^[\x21-\x7e]{20,512}$/.test(values.TRIAL_EMAIL_API_TOKEN)) throw Error('Invalid email API token');
  }
  if (config.customerEmail?.enabled) {
    values.RESEND_API_KEY = await read('resend-api-key');
    if (!/^re_[A-Za-z0-9_-]{16,200}$/.test(values.RESEND_API_KEY)) throw Error('Invalid Resend sending key');
  }
  if (config.intakeProtection) {
    values.TURNSTILE_SECRET_KEY = await read('turnstile-secret-key');
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(values.TURNSTILE_SECRET_KEY)) throw Error('Invalid Turnstile secret');
  }
  if (config.billing) {
    values.DODO_API_KEY = await read('dodo-api-key');
    values.DODO_WEBHOOK_SECRET = await read('dodo-webhook-secret');
    if (!/^[\x21-\x7e]{20,512}$/.test(values.DODO_API_KEY)
      || !/^(?:whsec_)?[A-Za-z0-9+/=_-]{20,512}$/.test(values.DODO_WEBHOOK_SECRET)) throw Error('Invalid billing secrets');
  }
  if (config.cloudAdmin) {
    values.CLOUD_MANAGEMENT_TOKEN = await read('cloud-management-token');
    values.CLOUD_MANAGEMENT_ACCESS_ID = await read('cloud-management-access-id');
    values.CLOUD_MANAGEMENT_ACCESS_SECRET = await read('cloud-management-access-secret');
    if (!/^[a-f0-9]{64}$/.test(values.CLOUD_MANAGEMENT_TOKEN) ||
        !/^[a-z0-9]+\.access$/.test(values.CLOUD_MANAGEMENT_ACCESS_ID) ||
        !/^[A-Za-z0-9_-]{20,200}$/.test(values.CLOUD_MANAGEMENT_ACCESS_SECRET)) throw Error('Invalid Cloud management secrets');
  }
  return values;
}
export function wranglerConfig(config, state, assetsDirectory) {
  if (!/^[a-f0-9-]{36}$/i.test(state.databaseId ?? '')) throw Error('Provision the D1 database first');
  return { name: config.workerName, account_id: config.accountId, main: join(workerDirectory, 'worker.mjs'),
    compatibility_date: '2026-07-01', workers_dev: false, preview_urls: false, upload_source_maps: false,
    routes: [{ pattern: new URL(config.origin).hostname, custom_domain: true }],
    assets: { directory: assetsDirectory, binding: 'ASSETS', run_worker_first: ['/api/*'], html_handling: 'drop-trailing-slash', not_found_handling: 'none' },
    d1_databases: [{ binding: 'DB', database_name: config.databaseName, database_id: state.databaseId, migrations_dir: join(workerDirectory, 'migrations') }],
    r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: config.bucketName }],
    ...(config.requestAlertTo ? { send_email: [{ name: 'REQUEST_ALERTS', destination_address: config.requestAlertTo }] } : {}),
    vars: { PUBLIC_INTAKE_ORIGIN: config.origin, TRIAL_ISSUER_KEY_ID: config.issuerKeyId,
      DODO_ENABLED: config.billing ? '1' : '0',
      ...(config.billing ? { DODO_MODE: config.billing.mode ?? 'test_mode', DODO_BUSINESS_ID: config.billing.businessId,
        DODO_PLANS: JSON.stringify(config.billing.plans) } : {}),
      INSTALLER_MIN_VERSION: config.minimumInstallerVersion ?? '0.1.0',
      TRIAL_CATALOGUE_KEY: state.catalogueKey ?? 'not-uploaded', TRIAL_CATALOGUE_SHA256: state.catalogueSha256 ?? 'not-uploaded',
      TRIAL_SOURCE_REVISION: state.sourceRevision ?? 'not-uploaded',
      ...(config.requestAlertTo ? { REQUEST_ALERT_TO: config.requestAlertTo, REQUEST_ALERT_FROM: config.requestAlertFrom } : {}),
      ...(config.emailFrom ? { CF_ACCOUNT_ID: config.accountId, TRIAL_EMAIL_FROM: config.emailFrom } : {}) },
    triggers: { crons: ['17 * * * *'] }, observability: { enabled: false },
  };
}
export async function stageAssets(directory) {
  // Explicit allowlist: no source tests, README, mock checkout, build scripts, secrets or artifacts become public assets.
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const sources = new Map();
  const digest = createHash('sha256');
  for (const name of assetFiles) {
    const source = await readPublicAsset(name);
    sources.set(name, source);
    digest.update(name).update('\0').update(source).update('\0');
  }
  const version = digest.digest('hex').slice(0, 20);
  for (const [name, source] of sources) {
    // HTML revalidates on every visit. A content-derived URL bypasses older browser
    // copies of mutable CSS/modules without relying on a CDN purge.
    const content = name.endsWith('.html') ? source.toString('utf8').replace(
      /(href=["'])([a-z0-9-]+)\.html(?=[?#"'])/g,
      (match, prefix, page) => sources.has(`${page}.html`) ? `${prefix}/${page === 'index' ? '' : page}` : match,
    ).replace(
      /((?:src|href)=["'])([^"'?#]+\.(?:css|mjs|svg))(?:\?[^"'#]*)?(["'])/g,
      (match, prefix, path, quote) => sources.has(path.replace(/^(?:\.\/|\/)/, ''))
        ? `${prefix}${path}?v=${version}${quote}` : match,
    ) : source;
    await writeFile(join(directory, name), content, { flag: 'wx' });
  }
  // Native HTML handling serves / and extensionless paths and redirects legacy URLs.
  await writeFile(join(directory, '_redirects'), '# HTML canonicalization uses assets.html_handling.\n');
  await writeFile(join(directory, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
/trial.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
/trial
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
/access-admin.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
/access-admin
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
${assetFiles.filter(name => /\.(?:css|mjs|svg)$/.test(name)).map(name => `/${name}\n  Cache-Control: public, max-age=86400, must-revalidate\n`).join('')}`);
}
export async function readPublicAsset(name, sourceDirectory) {
  if (!assetFiles.includes(name)) throw Error('File is not approved for public hosting');
  sourceDirectory ??= legacyAssetDirectory(name);
  const source = join(sourceDirectory, name), info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()
    || relative(await realpath(sourceDirectory), await realpath(source)) !== name) throw Error(`Public asset is not a regular direct file: ${name}`);
  const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino) throw Error('Public asset changed during validation');
    return await handle.readFile();
  } finally { await handle.close(); }
}
