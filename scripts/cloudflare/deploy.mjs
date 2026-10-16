// Explicit local CLI. Importing this module never provisions or deploys resources.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadSecrets, protectedDirectory, repository, saveJson, stageAssets, wranglerConfig } from './config.mjs';
import { checkLocalCatalogue, r2Client, uploadArtifacts } from './artifacts.mjs';
import { catalogueIdentity } from '../../apps/public-intake/cloudflare/catalogue.mjs';
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');

export function runWrangler(args, config, { capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: repository, windowsHide: true,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.accountId, WRANGLER_SEND_METRICS: 'false',
        CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (!capture) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { if (!capture) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun(output) : reject(Error(`Wrangler ${args.slice(0, 2).join(' ')} failed (exit ${code}); no later step ran`)));
  });
}
export function parseBucketNames(output) {
  return [...output.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/^\s*name:\s+(\S+)\s*$/gm)].map(match => match[1]);
}
export async function readState(config) {
  const file = join(config.stateDirectory, 'state.json');
  const value = await readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  if (value.accountId && (value.accountId !== config.accountId || value.databaseName !== config.databaseName
    || value.bucketName !== config.bucketName || value.workerName !== config.workerName)) throw Error('State belongs to a different deployment; use a separate state directory');
  return { ...value, accountId: config.accountId, databaseName: config.databaseName, bucketName: config.bucketName, workerName: config.workerName };
}
export async function assertPrivateBucket(config, run = runWrangler) {
  // The pinned Wrangler version has labelled text output for R2 rather than --json.
  const domains = await run(['r2', 'bucket', 'domain', 'list', config.bucketName], config, { capture: true });
  if (!domains.includes('There are no custom domains connected to this bucket.')) throw Error('Private release bucket has custom domains or an unrecognized response; remove public access before continuing');
  const dev = await run(['r2', 'bucket', 'dev-url', 'get', config.bucketName], config, { capture: true });
  if (!/disabled/i.test(dev) || /enabled/i.test(dev)) throw Error('Private release bucket r2.dev access is not confirmed disabled');
}
export async function provision(config, state, run = runWrangler) {
  let databases = JSON.parse(await run(['d1', 'list', '--json'], config, { capture: true }));
  let db = databases.find(row => row.name === config.databaseName);
  if (!db) {
    await run(['d1', 'create', config.databaseName, '--update-config=false', ...(config.location ? ['--location', config.location] : [])], config);
    databases = JSON.parse(await run(['d1', 'list', '--json'], config, { capture: true }));
    db = databases.find(row => row.name === config.databaseName);
  }
  if (!db?.uuid) throw Error('Could not resolve the D1 database ID');
  if (state.databaseId && state.databaseId !== db.uuid) throw Error('D1 ID changed; refusing to attach another database');
  state.databaseId = db.uuid;
  const buckets = parseBucketNames(await run(['r2', 'bucket', 'list'], config, { capture: true }));
  if (!buckets.includes(config.bucketName)) {
    await run(['r2', 'bucket', 'create', config.bucketName, '--storage-class', 'Standard', '--update-config=false',
      ...(config.location ? ['--location', config.location] : [])], config);
  }
  // Enforce private r2.dev for this dedicated bucket, but never delete custom domain bindings silently.
  await run(['r2', 'bucket', 'dev-url', 'disable', config.bucketName, '--force'], config);
  await assertPrivateBucket(config, run);
  return state;
}
async function render(config, state) {
  const assetDirectory = await mkdtemp(join(config.stateDirectory, 'site-'));
  // stageAssets creates its own directory so an existing tree is never reused accidentally.
  const assets = join(assetDirectory, 'assets'); await stageAssets(assets);
  const file = join(config.stateDirectory, 'wrangler.json');
  await saveJson(file, wranglerConfig(config, state, assets));
  return file;
}
export async function execute(command, config, { run = runWrangler, createClient = r2Client,
  upload = uploadArtifacts, fetchImpl = fetch } = {}) {
  if (!['plan', 'provision', 'upload', 'deploy', 'all', 'dry-run', 'backup', 'verify'].includes(command)) throw Error('Unknown command');
  // An encrypted backup must remain possible even when local installers or issuer keys are temporarily unavailable.
  if (command === 'backup') {
    await protectedDirectory(config.stateDirectory);
    const state = await readState(config), file = await render(config, state);
    const output = join(config.stateDirectory, `d1-backup-${new Date().toISOString().replaceAll(':', '-')}.sql`);
    await run(['d1', 'export', 'DB', '--remote', '--config', file, '--output', output, '--skip-confirmation'], config);
    console.log(`Encrypted application records exported to ${output}; back up matching keys separately.`); return;
  }
  // No remote call is made by plan or dry-run. Validate bytes and issuer before any remote mutation.
  const catalogue = await checkLocalCatalogue(config.catalogueFile);
  const secrets = await loadSecrets(config, catalogue);
  if (command === 'plan') {
    console.log(JSON.stringify({ origin: config.origin, worker: config.workerName, database: config.databaseName,
      privateBucket: config.bucketName, releaseId: config.releaseId, artifacts: catalogue.artifacts.length,
      totalBytes: catalogue.artifacts.reduce((sum, asset) => sum + asset.sizeBytes, 0),
      sourceRevision: catalogue.sourceRevision, email: config.emailFrom ? 'Cloudflare sending (Paid required for arbitrary recipients)' : 'manual copy/send',
      steps: ['Create/reuse D1 and private R2', 'Apply D1 migrations', 'Multipart upload and verify R2 bytes', 'Deploy Worker, static assets, secrets and custom domain', 'Verify public endpoint'],
      remoteChanges: false }, null, 2));
    return;
  }
  await protectedDirectory(config.stateDirectory);
  const state = await readState(config), stateFile = join(config.stateDirectory, 'state.json');
  if (command === 'dry-run') {
    const file = await render(config, { ...state, databaseId: state.databaseId ?? '00000000-0000-4000-8000-000000000000' });
    await run(['deploy', '--config', file, '--dry-run', '--outdir', join(config.stateDirectory, 'bundle')], config);
    return;
  }
  if (command === 'provision' || command === 'all') {
    await provision(config, state, run); await saveJson(stateFile, state);
    const file = await render(config, state);
    await run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', file], config);
    if (command === 'provision') return;
  }
  if (command === 'upload' || command === 'all') {
    if (!state.databaseId) throw Error('Run provision before upload');
    await assertPrivateBucket(config, run);
    const client = createClient(config.accountId);
    try {
      const result = await upload({ client, bucket: config.bucketName, releaseId: config.releaseId, catalogue });
      const identity = await catalogueIdentity(catalogue);
      if (state.releaseIdentity !== identity) { delete state.verifiedAt; delete state.verifiedReleaseIdentity; }
      state.catalogueKey = result.catalogueKey; state.sourceRevision = catalogue.sourceRevision;
      state.catalogueSha256 = result.catalogueSha256;
      state.releaseIdentity = identity; state.uploadedAt = new Date().toISOString();
      await saveJson(join(config.stateDirectory, 'r2-catalogue.json'), result.catalogue);
      await saveJson(stateFile, state);
    } finally { client.destroy(); }
    if (command === 'upload') return;
  }
  if (command === 'deploy' || command === 'all') {
    if (!state.catalogueKey || !/^[a-f0-9]{64}$/.test(state.catalogueSha256 ?? '') || state.sourceRevision !== catalogue.sourceRevision
      || state.releaseIdentity !== await catalogueIdentity(catalogue)) throw Error('Upload and verify the selected release before deployment');
    await assertPrivateBucket(config, run);
    const file = await render(config, state);
    const secretFile = join(config.stateDirectory, `.worker-secrets-${crypto.randomUUID()}.json`);
    try {
      await writeFile(secretFile, JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
      await run(['deploy', '--config', file, '--secrets-file', secretFile], config);
    } finally { await unlink(secretFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    state.deployedAt = new Date().toISOString(); state.deployedReleaseIdentity = state.releaseIdentity;
    delete state.verifiedAt; delete state.verifiedReleaseIdentity; await saveJson(stateFile, state);
  }
  if (command === 'verify' || command === 'deploy' || command === 'all') {
    await assertPrivateBucket(config, run);
    const check = async (path, expected, headers = {}) => {
      const response = await fetchImpl(config.origin + path, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (response.status !== expected) throw Error(`Deployment check failed: ${path} returned ${response.status}, expected ${expected}`);
      return response;
    };
    const waitlist = await check('/api/waitlist', 200);
    if (!(await waitlist.json()).open || waitlist.headers.get('cache-control') !== 'no-store') throw Error('Intake is not open with no-store responses');
    await check('/api/access-admin/requests', 401);
    await check('/api/access-admin/requests', 200, { Authorization: `Bearer ${secrets.OPERATOR_TOKEN}` });
    const readiness = await (await check('/api/access-admin/readiness', 200, { Authorization: `Bearer ${secrets.OPERATOR_TOKEN}` })).json();
    if (!readiness.ready || readiness.sourceRevision !== catalogue.sourceRevision || readiness.artifacts !== catalogue.artifacts.length) throw Error('Deployed release readiness differs from the selected catalogue');
    await check('/', 200);
    for (const path of ['/trial.html', '/access-admin.html']) {
      const page = await check(path, 200);
      if (!page.headers.get('cache-control')?.includes('no-store')) throw Error(`Protected page cache headers missing: ${path}`);
    }
    await check('/build-pages.mjs', 404); await check('/mock-checkout.html', 404);
    state.verifiedAt = new Date().toISOString(); state.verifiedReleaseIdentity = await catalogueIdentity(catalogue);
    await saveJson(stateFile, state);
    console.log('Deployment checks passed. Complete one explicit request/download/install/activation rehearsal before invitations.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file] = process.argv.slice(2);
  if (!command || !file || process.argv.length !== 4) {
    console.error('Use: node scripts/cloudflare/deploy.mjs <plan|dry-run|provision|upload|deploy|all|verify|backup> <external-config.json>');
    process.exitCode = 1;
  } else {
    try { await execute(command, await loadConfig(resolve(file))); }
    catch (error) { console.error(`Cloudflare deployment: ${error.message}`); process.exitCode = 1; }
  }
}
