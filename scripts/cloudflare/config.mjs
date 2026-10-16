import { createPublicKey } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validIntakeOrigin } from '../../apps/public-intake/src/intake-origin.mjs';
import { issuer } from '../../apps/public-intake/cloudflare/crypto.mjs';
const run = promisify(execFile);
export const repository = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const workerDirectory = join(repository, 'apps/public-intake/cloudflare');
export const assetFiles = ['index.html', 'product.html', 'security.html', 'deployment.html', 'pricing.html',
  'downloads.html', 'get-started.html', 'faq.html', 'setup-guide.html', 'trial.html', 'access-admin.html',
  'site.css', 'trial.css', 'theme.mjs', 'tour.mjs', 'access.mjs', 'downloads.mjs', 'cloud-pricing.mjs',
  'trial.mjs', 'access-admin.mjs', 'releases.json'];
function outside(path, label) {
  const absolute = resolve(path), rel = relative(repository, absolute);
  if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) throw Error(`${label} must be outside the repository`);
  const inverse = relative(absolute, repository);
  if (inverse && !inverse.startsWith('..' + sep) && inverse !== '..' && !isAbsolute(inverse)) throw Error(`${label} must not be an ancestor of the repository`);
  return absolute;
}
export function validateConfig(value, file) {
  const allowed = ['schemaVersion', 'accountId', 'origin', 'workerName', 'databaseName', 'bucketName', 'releaseId',
    'catalogueFile', 'secretsDirectory', 'stateDirectory', 'issuerKeyId', 'location', 'emailFrom'];
  if (!value || Object.keys(value).some(key => !allowed.includes(key)) || value.schemaVersion !== 1
    || !/^[a-f0-9]{32}$/.test(value.accountId) || !validIntakeOrigin(value.origin)
    || new URL(value.origin).port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(new URL(value.origin).hostname)
    || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.workerName) || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.databaseName)
    || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.bucketName) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.releaseId)
    || !/^[A-Za-z0-9_-]{1,40}$/.test(value.issuerKeyId ?? '')
    || (value.location && !['weur', 'eeur', 'apac', 'oc', 'wnam', 'enam'].includes(value.location))
    || (value.emailFrom && !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(value.emailFrom))) throw Error('Invalid Cloudflare deployment configuration');
  const base = dirname(resolve(file));
  for (const name of ['catalogueFile', 'secretsDirectory', 'stateDirectory']) {
    if (typeof value[name] !== 'string' || !value[name]) throw Error(`Missing ${name}`);
    value[name] = outside(resolve(base, value[name]), name);
  }
  const rel = relative(value.stateDirectory, value.secretsDirectory);
  if (!rel || (!rel.startsWith('..' + sep) && !isAbsolute(rel))) throw Error('Keep secrets outside the generated state directory');
  return value;
}
export async function loadConfig(file) { return validateConfig(JSON.parse(await readFile(file, 'utf8')), file); }
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
  if (config.emailFrom) {
    values.TRIAL_EMAIL_API_TOKEN = await read('cloudflare-email-token');
    if (!/^[\x21-\x7e]{20,512}$/.test(values.TRIAL_EMAIL_API_TOKEN)) throw Error('Invalid email API token');
  }
  return values;
}
export function wranglerConfig(config, state, assetsDirectory) {
  if (!/^[a-f0-9-]{36}$/i.test(state.databaseId ?? '')) throw Error('Provision the D1 database first');
  return { name: config.workerName, account_id: config.accountId, main: join(workerDirectory, 'worker.mjs'),
    compatibility_date: '2026-07-01', workers_dev: false, preview_urls: false, upload_source_maps: false,
    routes: [{ pattern: new URL(config.origin).hostname, custom_domain: true }],
    assets: { directory: assetsDirectory, binding: 'ASSETS', run_worker_first: ['/api/*'], html_handling: 'none', not_found_handling: 'none' },
    d1_databases: [{ binding: 'DB', database_name: config.databaseName, database_id: state.databaseId, migrations_dir: join(workerDirectory, 'migrations') }],
    r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: config.bucketName }],
    vars: { PUBLIC_INTAKE_ORIGIN: config.origin, TRIAL_ISSUER_KEY_ID: config.issuerKeyId,
      TRIAL_CATALOGUE_KEY: state.catalogueKey ?? 'not-uploaded', TRIAL_CATALOGUE_SHA256: state.catalogueSha256 ?? 'not-uploaded',
      TRIAL_SOURCE_REVISION: state.sourceRevision ?? 'not-uploaded',
      ...(config.emailFrom ? { CF_ACCOUNT_ID: config.accountId, TRIAL_EMAIL_FROM: config.emailFrom } : {}) },
    triggers: { crons: ['17 * * * *'] }, observability: { enabled: false },
  };
}
export async function stageAssets(directory) {
  // Explicit allowlist: no source tests, README, mock checkout, build scripts, secrets or artifacts become public assets.
  await mkdir(directory, { recursive: false, mode: 0o700 });
  for (const name of assetFiles) await writeFile(join(directory, name), await readPublicAsset(name), { flag: 'wx' });
  // Keep .html URLs stable (including private fragment links), but still serve the homepage at /.
  await writeFile(join(directory, '_redirects'), '/ /index.html 200\n');
  await writeFile(join(directory, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
/trial.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
/access-admin.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
`);
}
export async function readPublicAsset(name, sourceDirectory = join(repository, 'public-website')) {
  if (!assetFiles.includes(name)) throw Error('File is not approved for public hosting');
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
