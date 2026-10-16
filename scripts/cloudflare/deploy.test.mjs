import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfig, loadSecrets, stageAssets, assetFiles, wranglerConfig } from './config.mjs';
import { assertPrivateBucket, execute, parseBucketNames, provision, runWrangler } from './deploy.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), '127v-cloudflare-deploy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secretsDirectory = join(directory, 'secrets'); await mkdir(secretsDirectory);
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const issuerPublicKeys = { trial: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) };
  await writeFile(join(secretsDirectory, 'issuer.pem'), privateKey);
  await writeFile(join(secretsDirectory, 'intake-key'), randomBytes(32).toString('hex'));
  await writeFile(join(secretsDirectory, 'operator-token'), randomBytes(32).toString('base64url'));
  const bytes = 'synthetic server archive'; const path = join(directory, 'server.tar'); await writeFile(path, bytes);
  const catalogue = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys,
    artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', path,
      sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: Buffer.byteLength(bytes) }] };
  const catalogueFile = join(directory, 'catalogue.json'); await writeFile(catalogueFile, JSON.stringify(catalogue));
  const config = validateConfig({ schemaVersion: 1, accountId: 'a'.repeat(32), origin: 'https://trial.example.com',
    workerName: '127vaults-access-test', databaseName: '127vaults-access-test', bucketName: '127vaults-private-test',
    releaseId: 'test', catalogueFile, secretsDirectory, stateDirectory: join(directory, 'state'), issuerKeyId: 'trial' }, join(directory, 'config.json'));
  return { directory, config, catalogue };
}

test('provisioning is resumable, pins D1 identity and refuses public R2 custom domains', async () => {
  const calls = [], config = { accountId: 'a'.repeat(32), databaseName: 'trial-db', bucketName: 'trial-bucket', location: 'apac' };
  let exists = false;
  const run = async args => {
    calls.push(args);
    if (args.join(' ') === 'd1 list --json') return JSON.stringify(exists ? [{ name: 'trial-db', uuid: '11111111-1111-4111-8111-111111111111' }] : []);
    if (args[0] === 'd1' && args[1] === 'create') { exists = true; return ''; }
    if (args.join(' ') === 'r2 bucket list') return 'Listing buckets...\nname:          trial-bucket\ncreation_date: 2026-10-16\n';
    if (args[2] === 'domain') return 'There are no custom domains connected to this bucket.';
    if (args[2] === 'dev-url') return 'Public access via the r2.dev URL is disabled.';
    throw Error(`Unexpected CLI call ${args.join(' ')}`);
  };
  const state = await provision(config, {}, run); await provision(config, state, run);
  assert.equal(calls.filter(args => args[0] === 'd1' && args[1] === 'create').length, 1);
  assert.equal(state.databaseId, '11111111-1111-4111-8111-111111111111');
  await assert.rejects(provision(config, { databaseId: '22222222-2222-4222-8222-222222222222' }, run), /D1 ID changed/);
  await assert.rejects(assertPrivateBucket(config, async () => 'domain: public.example.com'), /custom domains/);
  assert.deepEqual(parseBucketNames('\u001b[0mname: bucket-a\ncreation_date: now\n\nname: bucket-b\n'), ['bucket-a', 'bucket-b']);
});

test('static staging includes the real website and excludes mock checkout, tests, scripts and documentation', async t => {
  const { directory } = await fixture(t), assets = join(directory, 'site'); await stageAssets(assets);
  assert.deepEqual((await readdir(assets)).sort(), [...assetFiles, '_headers', '_redirects'].sort());
  const headers = await readFile(join(assets, '_headers'), 'utf8');
  assert.match(headers, /Content-Security-Policy/); assert.match(headers, /\/access-admin.html\n  Cache-Control: no-store/);
  await assert.rejects(readFile(join(assets, 'mock-checkout.html')), { code: 'ENOENT' });
});

test('configuration and issuer preflight reject secrets in the repository and mismatched release keys', async t => {
  const { directory, config, catalogue } = await fixture(t);
  assert.ok((await loadSecrets(config, catalogue)).TRIAL_ISSUER_PRIVATE_KEY);
  assert.throws(() => validateConfig({ ...config, stateDirectory: process.cwd() }, join(directory, 'config.json')), /outside the repository/);
  assert.throws(() => validateConfig({ ...config, origin: 'http://trial.example.com' }, join(directory, 'config.json')), /Invalid Cloudflare/);
  assert.throws(() => validateConfig({ ...config, origin: 'https://trial.example.com/path' }, join(directory, 'config.json')), /Invalid Cloudflare/);
  assert.throws(() => validateConfig({ ...config, stateDirectory: parse(process.cwd()).root }, join(directory, 'config.json')), /ancestor of the repository/);
  await assert.rejects(loadSecrets(config, { ...catalogue, issuerPublicKeys: {} }), /Issuer does not match/);
});

test('real Wrangler dry-run bundles the Worker and config without account access or deployment', async t => {
  const { config } = await fixture(t); let called = false;
  await execute('dry-run', config, { run: async (args, cfg) => {
    assert.ok(args.includes('--dry-run')); assert.ok(!args.includes('--secrets-file')); called = true;
    const output = await runWrangler(args, cfg, { capture: true });
    assert.match(output, /dry.run|exiting now/i);
  } });
  assert.ok(called);
  const generated = JSON.parse(await readFile(join(config.stateDirectory, 'wrangler.json'), 'utf8'));
  assert.equal(generated.workers_dev, false); assert.equal(generated.preview_urls, false);
  assert.deepEqual(generated.assets.run_worker_first, ['/api/*']);
  assert.equal(generated.vars.OPERATOR_TOKEN, undefined);
  assert.equal(generated.vars.TRIAL_ISSUER_PRIVATE_KEY, undefined);
});

test('deploy refuses unverified catalogues and cleans temporary secrets after CLI failure', async t => {
  const { config, catalogue } = await fixture(t);
  await assert.rejects(execute('deploy', config, { run: async () => { throw Error('should not call CLI'); } }), /Upload and verify/);
  const stateFile = join(config.stateDirectory, 'state.json');
  const { catalogueIdentity } = await import('../../apps/public-intake/cloudflare/catalogue.mjs');
  await writeFile(stateFile, JSON.stringify({ databaseId: '11111111-1111-4111-8111-111111111111',
    catalogueKey: 'releases/test/catalogues/test.json', sourceRevision: catalogue.sourceRevision,
    catalogueSha256: 'a'.repeat(64),
    releaseIdentity: await catalogueIdentity(catalogue) }));
  const run = async args => {
    if (args[2] === 'domain') return 'There are no custom domains connected to this bucket.';
    if (args[2] === 'dev-url') return 'Public access via the r2.dev URL is disabled.';
    if (args[0] === 'deploy') {
      const file = args[args.indexOf('--secrets-file') + 1];
      assert.match(await readFile(file, 'utf8'), /TRIAL_ISSUER_PRIVATE_KEY/);
      throw Error('simulated deploy failure');
    }
    throw Error('unexpected command');
  };
  await assert.rejects(execute('deploy', config, { run }), /simulated deploy failure/);
  assert.ok(!(await readdir(config.stateDirectory)).some(name => name.startsWith('.worker-secrets-')));
  assert.equal(wranglerConfig(config, { databaseId: '11111111-1111-4111-8111-111111111111' }, 'site').observability.enabled, false);
});

test('full deployment orchestration orders provisioning, migrations, verified upload, secret deployment and endpoint checks', async t => {
  const { config, catalogue } = await fixture(t), steps = [];
  const run = async args => {
    if (args[0] === 'd1' && args[1] === 'list') { steps.push('provision'); return JSON.stringify([{ name: config.databaseName, uuid: '11111111-1111-4111-8111-111111111111' }]); }
    if (args.join(' ') === 'r2 bucket list') return `name: ${config.bucketName}\ncreation_date: now\n`;
    if (args[2] === 'domain') return 'There are no custom domains connected to this bucket.';
    if (args[2] === 'dev-url') return 'Public access via the r2.dev URL is disabled.';
    if (args[0] === 'd1' && args[1] === 'migrations') { steps.push('migrate'); assert.ok(args.includes('--remote')); return ''; }
    if (args[0] === 'deploy') {
      steps.push('deploy');
      const file = args[args.indexOf('--secrets-file') + 1];
      const secrets = JSON.parse(await readFile(file, 'utf8')); assert.ok(secrets.OPERATOR_TOKEN);
      const generated = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
      assert.equal(generated.vars.TRIAL_CATALOGUE_KEY, 'releases/test/catalogue.json');
      assert.equal(generated.vars.TRIAL_CATALOGUE_SHA256, 'c'.repeat(64)); return '';
    }
    throw Error(`Unexpected command ${args.join(' ')}`);
  };
  const upload = async options => {
    steps.push('upload-verified'); assert.equal(options.bucket, config.bucketName);
    return { catalogue, catalogueKey: 'releases/test/catalogue.json', catalogueSha256: 'c'.repeat(64) };
  };
  const fetchImpl = async (url, options) => {
    steps.push('verify'); const path = new URL(url).pathname;
    if (path === '/api/waitlist') return Response.json({ open: true }, { headers: { 'Cache-Control': 'no-store' } });
    if (path === '/api/access-admin/requests') return Response.json({}, { status: options.headers.Authorization ? 200 : 401 });
    if (path === '/api/access-admin/readiness') return Response.json({ ready: true, sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.length });
    return new Response('', { status: ['/', '/trial.html', '/access-admin.html'].includes(path) ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' } });
  };
  await execute('all', config, { run, upload, fetchImpl, createClient: () => ({ destroy() { steps.push('close-client'); } }) });
  assert.deepEqual(steps.slice(0, 5), ['provision', 'migrate', 'upload-verified', 'close-client', 'deploy']);
  assert.ok(steps.indexOf('verify') > steps.indexOf('deploy'));
  const state = JSON.parse(await readFile(join(config.stateDirectory, 'state.json'), 'utf8'));
  assert.ok(state.deployedAt); assert.ok(state.verifiedAt);
  assert.ok(!(await readdir(config.stateDirectory)).some(name => name.startsWith('.worker-secrets-')));
});

test('encrypted database backup works without local installer files or issuer access', async t => {
  const { config } = await fixture(t);
  await mkdir(config.stateDirectory);
  await writeFile(join(config.stateDirectory, 'state.json'), JSON.stringify({ databaseId: '11111111-1111-4111-8111-111111111111' }));
  config.catalogueFile = join(config.stateDirectory, 'missing-catalogue.json');
  config.secretsDirectory = join(config.stateDirectory, 'missing-secrets');
  let exported = false;
  await execute('backup', config, { run: async args => {
    assert.deepEqual(args.slice(0, 4), ['d1', 'export', 'DB', '--remote']);
    assert.ok(args.includes('--skip-confirmation')); exported = true; return '';
  } });
  assert.ok(exported);
});
