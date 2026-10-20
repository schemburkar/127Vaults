// Complete release sets. Build locally, then explicitly publish one verified catalogue.
import { access, copyFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPlan, git, labelValue, outside } from './plan.mjs';
import { acquireLock, runRelease } from './release.mjs';
import { execute } from './process.mjs';
import { verifyRelease } from './verify-release.mjs';
import { prepareTrialCatalogue } from '../ops/prepare-private-trial.mjs';
import { loadConfig, loadSecrets, protectedDirectory, saveJson, repository } from '../cloudflare/config.mjs';
import { execute as cloudflare, runWrangler } from '../cloudflare/deploy.mjs';
import { checkLocalCatalogue, r2Client } from '../cloudflare/artifacts.mjs';
import { auditPublication } from '../cloudflare/publication.mjs';
import { catalogueIdentity, serverMajor } from '../../apps/public-intake/cloudflare/catalogue.mjs';
import { verifyEmbeddedAgreements, verifyLiveDelivery } from './verify-set.mjs';

const exists = async path => access(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const components = [['extension', 'chromium'], ['desktop', 'windows'], ['desktop', 'linux'], ['cli', 'windows'], ['cli', 'linux'], ['server', 'linux-amd64'], ['installer', 'windows'], ['installer', 'linux']];
const products = ['extension', 'desktop', 'cli', 'server', 'installer'];
function setLabel(value) {
  labelValue(value);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw Error('Release-set labels must use lowercase letters, numbers and hyphens for Cloudflare.');
  return value;
}

export function nextPatch(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Supply an explicit X.Y.Z version for this component.');
  const values = version.split('.').map(Number); values[2]++;
  if (values.some(value => !Number.isSafeInteger(value))) throw Error('Invalid package version.');
  return values.join('.');
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function coordinatedVersions(current, overrides = {}, requested) {
  for (const version of Object.values(current)) nextPatch(version);
  const targets = new Set([...Object.values(overrides), ...(requested ? [requested] : [])]);
  if (targets.size > 1) throw Error('A combined release must use one coordinated version for every component.');
  const highest = Object.values(current).sort(compareVersions).at(-1);
  const target = targets.size ? [...targets][0] : nextPatch(highest);
  nextPatch(target);
  if (Object.values(current).some(version => compareVersions(target, version) <= 0)) {
    throw Error('The coordinated version must be newer than every current component; published versions cannot be reused.');
  }
  return Object.fromEntries(products.map(product => [product, target]));
}

export function retainPreviousMajors(catalogue, baseline, state) {
  const current = serverMajor(catalogue), previous = serverMajor(baseline);
  const history = (baseline.previousMajors || []).filter(row => row.majorVersion !== current && row.majorVersion !== previous);
  if (current !== previous) {
    if (!state.catalogueKey || !/^[a-f0-9]{64}$/.test(state.catalogueSha256 || '')) throw Error('Previous major needs its verified deployed catalogue before replacement.');
    history.push({ majorVersion: previous, objectKey: state.catalogueKey, sha256: state.catalogueSha256 });
  }
  if (current === previous && baseline.previousMajors) catalogue.previousMajors = baseline.previousMajors;
  else if (history.length) catalogue.previousMajors = history;
  return catalogue;
}

export async function settingsFor(request) {
  const file = resolve(request.config || join(repository, '.cloudflare-deploy/release-set.json'));
  const value = await exists(file) ? await json(file) : {};
  const allowed = ['deploymentConfig', 'outputRoot', 'cacheRoot', 'wslDistro', 'wslUser', 'linuxCacheRoot', 'composeProvider', 'sevenZip', 'port', 'version', 'versions', 'r2CredentialsFile'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw Error('Unknown release-set configuration field.');
  const path = (name, fallback) => resolve(dirname(file), value[name] || fallback);
  const settings = { deploymentConfig: path('deploymentConfig', 'config.json'),
    outputRoot: path('outputRoot', resolve(repository, '../127Vaults-Releases')),
    cacheRoot: path('cacheRoot', join(homedir(), '.127vaults-release-cache')),
    wslDistro: value.wslDistro || 'Ubuntu-24.04', wslUser: value.wslUser,
    linuxCacheRoot: value.linuxCacheRoot,
    composeProvider: path('composeProvider', join(process.env.LOCALAPPDATA || homedir(), 'Microsoft/WindowsApps/docker-compose.exe')),
    sevenZip: path('sevenZip', join(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe')),
    port: value.port ?? 12935, version: value.version, versions: value.versions || {},
    r2CredentialsFile: value.r2CredentialsFile ? path('r2CredentialsFile') : null,
    pointer: join(dirname(file), 'latest-release-set.json') };
  outside(repository, settings.outputRoot, 'OutputRoot'); outside(repository, settings.cacheRoot, 'CacheRoot');
  if (!Number.isInteger(settings.port) || settings.port < 1025 || settings.port > 65535) throw Error('Invalid fixture port.');
  if (Object.keys(settings.versions).some(p => !products.includes(p))) throw Error('Unknown component version.');
  return settings;
}

const defaults = { runRelease, verifyRelease, prepareTrialCatalogue, verifyEmbeddedAgreements, verifyLiveDelivery,
  checkLocalCatalogue, loadSecrets, auditPublication, cloudflare, execute, protectedDirectory, createPlan,
  git, catalogueIdentity, hostPlatform: process.platform };

async function deploymentSource(revision, deps) {
  // Cloudflare stages the controller checkout. Refuse a different/uncommitted website or Worker.
  await deps.git(repository, ['diff', '--quiet', revision, '--', 'public-website', 'apps/public-intake', 'scripts/cloudflare']);
}

export async function planSet(request, settings, active, deps = defaults) {
  const revision = await deps.git(repository, ['rev-parse', '--verify', `${request.ref || 'HEAD'}^{commit}`]);
  const label = setLabel(request.label || `release-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').toLowerCase()}-${revision.slice(0, 7)}`);
  const baseline = await deps.checkLocalCatalogue(active.catalogueFile);
  const current = {};
  for (const product of products) {
    const artifact = baseline.artifacts.find(a => a.product === product && !a.supporting);
    if (artifact) current[product] = (await deps.verifyRelease(dirname(artifact.path))).packageVersion;
    else if (product !== 'installer') throw Error(`Active catalogue has no ${product} package.`);
    if (product === 'installer') {
      const source = await deps.createPlan({ repository, product, platform: 'both',
        ref: revision, label, outputRoot: settings.outputRoot, cacheRoot: settings.cacheRoot });
      if (!current[product] || compareVersions(source.packageVersion, current[product]) > 0) current[product] = source.packageVersion;
    }
  }
  const versions = coordinatedVersions(current, settings.versions, settings.version);
  for (const product of products) {
    // Validate every target format before creating outputs or touching deployment state.
    await deps.createPlan({ repository, product, platform: ['desktop', 'cli', 'installer'].includes(product) ? 'both' : 'native',
      version: versions[product], ref: revision, label, outputRoot: settings.outputRoot, cacheRoot: settings.cacheRoot });
  }
  return { schemaVersion: 1, revision, label, versions, baselineIdentity: await deps.catalogueIdentity(baseline),
    baseline, directory: join(settings.cacheRoot, 'sets', label),
    releaseDirectories: components.map(([p, platform]) => join(settings.outputRoot, p, versions[p], platform)) };
}

async function fixtureEnvironment(settings, deps) {
  await access(settings.sevenZip); await access(settings.composeProvider);
  const machine = JSON.parse(await deps.execute('podman', ['machine', 'inspect'], { capture: true, quiet: true }));
  const pipe = machine[0]?.ConnectionInfo?.PodmanPipe?.Path;
  if (typeof pipe !== 'string' || !pipe.startsWith('\\\\.\\pipe\\')) throw Error('Cannot identify the selected Podman machine pipe.');
  const env = { ...process.env, DOCKER_HOST: 'npipe:////./pipe/' + pipe.split('\\').at(-1), PODMAN_COMPOSE_PROVIDER: settings.composeProvider };
  await deps.execute('podman', ['compose', 'ls', '--format', 'json'], { env, capture: true, quiet: true });
  return env;
}

export async function buildSet(request, settings, active, deps = defaults) {
  if (deps.hostPlatform !== 'win32' && !request.plan) throw Error('The complete Windows/Linux release set requires the Windows build host with WSL.');
  const plan = await planSet(request, settings, active, deps);
  if (request.plan) { console.log(JSON.stringify({ ...plan, baseline: undefined, remoteChanges: false }, null, 2)); return plan; }
  await deploymentSource(plan.revision, deps);
  const env = await fixtureEnvironment(settings, deps);
  await deps.protectedDirectory(plan.directory);
  const unlock = await acquireLock(join(plan.directory, '.set-lock'));
  try {
    const requestFile = join(plan.directory, 'request.json');
    const identity = { revision: plan.revision, versions: plan.versions, baselineIdentity: plan.baselineIdentity,
      releaseDirectories: plan.releaseDirectories };
    if (await exists(requestFile)) {
      if (JSON.stringify(await json(requestFile)) !== JSON.stringify(identity)) throw Error('That label belongs to another release request. Choose a new label.');
    } else await saveJson(requestFile, identity);
    const issuer = join(plan.directory, 'issuer-public-keys.json');
    await saveJson(issuer, plan.baseline.issuerPublicKeys);
    await deps.loadSecrets(active, plan.baseline); // Preserve the existing issuer; never generate replacement keys.
    const tests = [];
    for (const folder of ['scripts/cloudflare', 'public-website', 'apps/public-intake/test']) {
      tests.push(...(await readdir(join(repository, folder))).filter(n => n.endsWith('.test.mjs')).map(n => join(repository, folder, n)));
    }
    await deps.execute(process.execPath, ['--test', ...tests]);
    for (const product of products) {
      const selected = components.filter(([p]) => p === product);
      const complete = await Promise.all(selected.map(async ([p, platform]) => {
        const directory = join(settings.outputRoot, p, plan.versions[p], platform);
        if (!await exists(directory)) return false;
        const manifest = await deps.verifyRelease(directory);
        if (manifest.product !== p || manifest.platform !== platform || manifest.packageVersion !== plan.versions[p]
          || (manifest.requestedSourceRevision || manifest.sourceRevision) !== plan.revision) throw Error('Existing release output belongs to another build.');
        return true;
      }));
      for (let i = 0; i < selected.length; i++) {
        if (complete[i]) continue;
        const platform = selected[i][1];
        await deps.runRelease({ repository, product, platform: platform === 'linux-amd64' || platform === 'chromium' ? 'native' : platform,
          ref: plan.revision, label: plan.label, version: plan.versions[product], outputRoot: settings.outputRoot, cacheRoot: settings.cacheRoot,
          // Keep every newly built package on this exact snapshot. Resume already completed set outputs above.
          force: true,
          wslDistro: settings.wslDistro, wslUser: settings.wslUser, linuxCacheRoot: settings.linuxCacheRoot,
          ...(product === 'server' ? { issuerPublicKeys: issuer } : {}) });
      }
    }
    await deps.verifyEmbeddedAgreements(plan.releaseDirectories, settings);
    const catalogue = retainPreviousMajors(await deps.prepareTrialCatalogue({ releaseDirectories: plan.releaseDirectories, requiredFeatureRevision: plan.revision, issuerKeyId: active.issuerKeyId }),
      plan.baseline, await json(join(active.stateDirectory, 'state.json')));
    const catalogueFile = join(plan.directory, 'catalogue.json'); await saveJson(catalogueFile, catalogue);
    const baselineServer = plan.baseline.artifacts.find(a => a.id === 'server');
    const server = catalogue.artifacts.find(a => a.id === 'server');
    const work = join(plan.directory, 'acceptance-' + crypto.randomUUID());
    await deps.execute(process.execPath, [join(repository, 'tests/internal/server/server-release-smoke.mjs'),
      '--bundle', server.path, '--upgrade-from', baselineServer.path, '--work', work,
      '--compose-provider', settings.composeProvider, '--port', String(settings.port),
      '--issuer-private-key', join(active.secretsDirectory, 'issuer.pem')], { env });
    const acceptance = await json(join(work, 'evidence.json'));
    if (acceptance.status !== 'passed' || acceptance.archiveSha256 !== server.sha256 || acceptance.checks?.length < 9 || acceptance.checks.some(c => c.status !== 'passed')) throw Error('Server upgrade/restore acceptance is incomplete.');
    const record = { schemaVersion: 1, status: 'tested', revision: plan.revision, label: plan.label, versions: plan.versions,
      releaseDirectories: plan.releaseDirectories, catalogueFile, catalogueIdentity: await deps.catalogueIdentity(catalogue),
      baselineIdentity: plan.baselineIdentity, acceptanceFile: join(work, 'evidence.json'), testedAt: new Date().toISOString() };
    await saveJson(join(plan.directory, 'build.json'), record);
    await saveJson(settings.pointer, { directory: plan.directory });
    console.log(`Complete installer set tested: ${plan.label}. Run release-set.ps1 publish to publish it.`);
    return record;
  } finally { await unlock(); }
}

export async function publishSet(request, settings, active, deps = defaults) {
  if (!request.label && !await exists(settings.pointer)) throw Error('No tested release set is selected. Run release-set.ps1 build first.');
  const directory = request.label ? join(settings.cacheRoot, 'sets', setLabel(request.label)) : (await json(settings.pointer)).directory;
  outside(repository, directory, 'Release set');
  const record = await json(join(directory, 'build.json'));
  if (record.schemaVersion !== 1 || record.status !== 'tested') throw Error('Build and test a complete installer set first.');
  setLabel(record.label);
  await deploymentSource(record.revision, deps);
  const catalogue = await deps.checkLocalCatalogue(record.catalogueFile);
  if (await deps.catalogueIdentity(catalogue) !== record.catalogueIdentity) throw Error('Tested catalogue was changed; rebuild before publishing.');
  const acceptance = await json(record.acceptanceFile);
  if (acceptance.status !== 'passed' || acceptance.archiveSha256 !== catalogue.artifacts.find(a => a.id === 'server')?.sha256
    || acceptance.checks?.length < 9 || acceptance.checks.some(c => c.status !== 'passed')) throw Error('Upgrade/restore evidence is incomplete.');
  const found = [];
  for (const folder of record.releaseDirectories) {
    const m = await deps.verifyRelease(folder);
    if (m.packageVersion !== record.versions[m.product] || (m.requestedSourceRevision || m.sourceRevision) !== record.revision) throw Error('Package does not match the tested release request.');
    found.push(`${m.product}/${m.platform}`);
  }
  if (JSON.stringify(found.sort()) !== JSON.stringify(components.map(([p, platform]) => `${p}/${platform}`).sort())) throw Error('A complete Windows/Linux installer set is required.');
  if (request.plan) { console.log(JSON.stringify({ action: 'publish', label: record.label, versions: record.versions, artifacts: catalogue.artifacts.length, remoteChanges: false }, null, 2)); return record; }
  const unlock = await acquireLock(join(directory, '.set-lock'));
  let unlockDeployment;
  try {
    unlockDeployment = await acquireLock(settings.deploymentConfig + '.publish-lock');
    const secrets = await deps.loadSecrets(active, catalogue);
    const credentials = settings.r2CredentialsFile ? await json(settings.r2CredentialsFile)
      : await exists(join(active.secretsDirectory, 'r2-upload.json')) ? await json(join(active.secretsDirectory, 'r2-upload.json')) : process.env;
    if (!credentials.R2_ACCESS_KEY_ID || !credentials.R2_SECRET_ACCESS_KEY) throw Error('Configure the private R2 upload credentials before publishing.');
    await deps.auditPublication(catalogue, secrets, { environment: credentials });
    const stateDirectory = join(directory, 'cloudflare'); await deps.protectedDirectory(stateDirectory);
    const config = { ...active, releaseId: record.label, catalogueFile: record.catalogueFile, stateDirectory };
    const current = await deps.checkLocalCatalogue(active.catalogueFile);
    const currentIdentity = await deps.catalogueIdentity(current);
    if (currentIdentity !== record.baselineIdentity && currentIdentity !== record.catalogueIdentity) throw Error('The active release changed since this set was built. Review and build against the new baseline.');
    if (!await exists(join(stateDirectory, 'state.json'))) await copyFile(join(active.stateDirectory, 'state.json'), join(stateDirectory, 'state.json'));
    if (!await exists(join(directory, 'previous-deployment.json'))) await saveJson(join(directory, 'previous-deployment.json'), active);
    await saveJson(join(directory, 'deployment.json'), config);
    // Capture Wrangler's backup output: its temporary signed export URL stays out of terminal logs.
    await deps.cloudflare('backup', active, { run: (args, cfg) => runWrangler(args, cfg, { capture: true }) });
    await deps.cloudflare('dry-run', config);
    await deps.cloudflare('provision', config); // Reuse pinned resources, enforce bucket privacy and apply pending migrations.
    const createClient = account => r2Client(account, credentials);
    await deps.cloudflare('upload', config, { createClient }); // Upload includes full remote SHA-256 verification.
    await deploymentSource(record.revision, deps); // Uploads can be long; reject website/Worker edits made meanwhile.
    await deps.cloudflare('deploy', config); // One activation after the complete set has passed.
    const delivery = await deps.verifyLiveDelivery(config, catalogue, secrets.OPERATOR_TOKEN);
    await saveJson(join(directory, 'delivery.json'), delivery);
    await saveJson(settings.deploymentConfig, config);
    await saveJson(join(directory, 'published.json'), { label: record.label, versions: record.versions, ...delivery });
    console.log(`Published and verified complete installer set: ${record.label}`);
    return delivery;
  } finally { if (unlockDeployment) await unlockDeployment(); await unlock(); }
}

export async function runSet(request) {
  if (request.help) {
    console.log('release-set.ps1 build|publish [-Plan] [-Label name] [-Ref commit] [-Config private-settings.json]\nBuild: all Windows/Linux installers, checks, embedded agreements, catalogue and isolated upgrade/restore.\nPublish: backup, Cloudflare dry-run, R2 upload/hash verification, one deployment and live download verification.\nDefault configuration: .cloudflare-deploy/release-set.json (optional). Receipts stay in the private release cache.'); return;
  }
  if (!['build', 'publish'].includes(request.action)) throw Error('Choose build or publish.');
  const settings = await settingsFor(request), active = await loadConfig(settings.deploymentConfig);
  return request.action === 'build' ? buildSet(request, settings, active) : publishSet(request, settings, active);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    let request;
    if (process.argv[2] === '--request') { let input = ''; for await (const chunk of process.stdin) input += chunk; request = JSON.parse(input.replace(/^\uFEFF/, '')); }
    else if (process.argv[2] === '--help') request = { help: true };
    else throw Error('Use release-set.ps1 build|publish.');
    await runSet(request);
  })().catch(error => { console.error(`Release set: ${error.message}`); process.exitCode = 1; });
}
