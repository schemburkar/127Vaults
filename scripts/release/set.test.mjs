import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { buildSet, publishSet, nextPatch, retainPreviousMajors } from './set.mjs';
import { verifyRelease } from './verify-release.mjs';
import { verifyEmbeddedAgreements, verifyLiveDelivery } from './verify-set.mjs';
import { checkLocalCatalogue } from '../cloudflare/artifacts.mjs';
import { catalogueIdentity } from '../../apps/public-intake/cloudflare/catalogue.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = 'a'.repeat(40);
const present = path => access(path).then(() => true, () => false);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value));
const platforms = [['extension','chromium'],['desktop','windows'],['desktop','linux'],['cli','windows'],['cli','linux'],['server','linux-amd64']];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), '127vaults-release-set-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const issuer = { trial: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) };
  async function release(directory, product, platform, version) {
    await mkdir(directory, { recursive: true });
    const extension = { server: 'tar.gz', extension: 'zip', cli: 'zip', desktop: 'exe' }[product];
    const name = `127vaults-${product}-${version}-${platform}.${extension}`;
    const files = [];
    for (const [file, bytes] of [[name, Buffer.from(name)], ['LICENSE.md', Buffer.from('Source terms\n')], ['COMMERCIAL-LICENSE.md', Buffer.from('Commercial terms\n')]]) {
      await writeFile(join(directory, file), bytes); files.push({ name: file, sizeBytes: bytes.length, sha256: sha(bytes) });
    }
    await writeFile(join(directory, 'SHA256SUMS'), files.map(f => `${f.sha256}  ${f.name}\n`).join(''));
    await save(join(directory, 'release.json'), { schemaVersion: 1, status: 'complete', channel: 'private-test', signed: false,
      product, platform, packageVersion: version, sourceRevision: revision, requestedSourceRevision: revision,
      inputFingerprint: 'b'.repeat(64), files, ...(product === 'server' ? { issuerPublicKeys: issuer } : {}) });
  }
  async function catalogue({ releaseDirectories }) {
    const artifacts = [];
    for (const directory of releaseDirectories) {
      const m = await verifyRelease(directory);
      for (const [index, file] of m.files.entries()) artifacts.push({ id: m.product === 'server' && index === 0 ? 'server' : `${m.product}-${m.platform}-${index}`,
        filename: file.name, label: file.name, path: join(directory, file.name), sourceRevision: revision,
        product: m.product, platform: m.platform, supporting: index > 0, sha256: file.sha256, sizeBytes: file.sizeBytes });
    }
    return { schemaVersion: 1, sourceRevision: revision, issuerPublicKeys: issuer, artifacts };
  }
  const baselineDirectories = [];
  for (const [p, platform] of platforms) {
    const directory = join(root, 'baseline', p, platform); await release(directory, p, platform, p === 'extension' ? '0.1.2' : p === 'server' ? '0.0.5' : '0.0.3'); baselineDirectories.push(directory);
  }
  const baseline = await catalogue({ releaseDirectories: baselineDirectories });
  const active = { origin: 'https://vaults.example.com', issuerKeyId: 'trial', catalogueFile: join(root, 'baseline.json'),
    stateDirectory: join(root, 'state'), secretsDirectory: join(root, 'secrets') };
  await save(active.catalogueFile, baseline); await mkdir(active.stateDirectory); await save(join(active.stateDirectory, 'state.json'), { databaseId: 'fixture' });
  await mkdir(active.secretsDirectory); await writeFile(join(active.secretsDirectory, 'r2-upload.json'), JSON.stringify({ R2_ACCESS_KEY_ID: 'fixture-access', R2_SECRET_ACCESS_KEY: 'fixture-secret' }));
  const settings = { cacheRoot: join(root, 'cache'), outputRoot: join(root, 'output'), versions: {},
    composeProvider: join(root, 'compose.exe'), sevenZip: join(root, '7z.exe'), port: 12935,
    deploymentConfig: join(root, 'config.json'), pointer: join(root, 'latest.json') };
  await writeFile(settings.composeProvider, ''); await writeFile(settings.sevenZip, ''); await save(settings.deploymentConfig, active);
  const deps = { hostPlatform: 'win32', git: async (_repo, args) => args[0] === 'rev-parse' ? revision : '',
    createPlan: async () => ({}), checkLocalCatalogue, verifyRelease, catalogueIdentity,
    protectedDirectory: directory => mkdir(directory, { recursive: true }),
    loadSecrets: async () => ({ OPERATOR_TOKEN: 'private-token' }), auditPublication: async () => calls.push('audit'),
    prepareTrialCatalogue: catalogue,
    runRelease: async r => { calls.push(`build:${r.product}/${r.platform}`); await release(join(r.outputRoot, r.product, r.label, r.product === 'server' ? 'linux-amd64' : r.product === 'extension' ? 'chromium' : r.platform), r.product, r.product === 'server' ? 'linux-amd64' : r.product === 'extension' ? 'chromium' : r.platform, r.version); },
    verifyEmbeddedAgreements: async dirs => { assert.equal(dirs.length, 6); calls.push('embedded'); },
    execute: async (command, args) => {
      if (command === 'podman' && args[0] === 'machine') return JSON.stringify([{ ConnectionInfo: { PodmanPipe: { Path: '\\\\.\\pipe\\fixture' } } }]);
      if (args[0]?.endsWith('server-release-smoke.mjs')) {
        calls.push('acceptance'); const work = args[args.indexOf('--work') + 1]; await mkdir(work);
        const bytes = await readFile(args[args.indexOf('--bundle') + 1]);
        await save(join(work, 'evidence.json'), { status: 'passed', archiveSha256: sha(bytes), checks: Array.from({ length: 9 }, () => ({ status: 'passed' })) });
      }
      return '';
    },
    cloudflare: async action => { calls.push(action); },
    verifyLiveDelivery: async () => { calls.push('live'); assert.deepEqual(await json(settings.deploymentConfig), active); return { status: 'passed' }; },
  };
  const request = { action: 'build', label: 'fixture-set', ref: revision };
  return { root, calls, settings, active, deps, request };
}

test('set preview increments independent versions without creating outputs or publishing', async t => {
  const f = await fixture(t); const p = await buildSet({ ...f.request, plan: true }, f.settings, f.active, f.deps);
  assert.equal(p.versions.server, '0.0.6'); assert.equal(p.versions.extension, '0.1.3');
  assert.equal(p.releaseDirectories.length, 6); assert.equal(await present(p.directory), false); assert.deepEqual(f.calls, []);
  assert.throws(() => nextPatch('0.1.2.3'), /explicit/);
});

test('failed build leaves no ready pointer and resume preserves completed packages', async t => {
  const f = await fixture(t), build = f.deps.runRelease;
  f.deps.runRelease = async r => { if (r.product === 'cli') throw Error('compiler failed'); return build(r); };
  await assert.rejects(buildSet(f.request, f.settings, f.active, f.deps), /compiler failed/);
  assert.equal(await present(f.settings.pointer), false); const before = f.calls.filter(x => x.startsWith('build:')).length;
  f.deps.runRelease = build;
  const record = await buildSet(f.request, f.settings, f.active, f.deps);
  assert.equal(record.status, 'tested'); assert.equal(f.calls.filter(x => x.startsWith('build:')).length - before, 3);
  assert.equal(f.calls.includes('upload'), false); assert.ok(f.calls.indexOf('embedded') < f.calls.indexOf('acceptance'));
});

test('publish activates once after verification and updates local default only after live checks', async t => {
  const f = await fixture(t); await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  await publishSet({}, f.settings, f.active, f.deps);
  assert.deepEqual(f.calls, ['audit', 'backup', 'dry-run', 'provision', 'upload', 'deploy', 'live']);
  assert.equal((await json(f.settings.deploymentConfig)).releaseId, 'fixture-set');
  assert.equal((await json(join(f.settings.cacheRoot, 'sets/fixture-set/published.json'))).status, 'passed');
});

test('failed upload never deploys or changes active configuration', async t => {
  const f = await fixture(t); await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  f.deps.cloudflare = async action => { f.calls.push(action); if (action === 'upload') throw Error('upload failed'); };
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /upload failed/);
  assert.equal(f.calls.includes('deploy'), false); assert.deepEqual(await json(f.settings.deploymentConfig), f.active);
});

test('website edits during upload stop activation', async t => {
  const f = await fixture(t); await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  let changed = false;
  f.deps.git = async (_repo, args) => { if (args[0] === 'diff' && changed) throw Error('Sources changed during upload'); return revision; };
  f.deps.cloudflare = async action => { f.calls.push(action); if (action === 'upload') changed = true; };
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /during upload/);
  assert.equal(f.calls.includes('deploy'), false); assert.deepEqual(await json(f.settings.deploymentConfig), f.active);
});

test('tampered installer or unrelated acceptance evidence blocks all remote operations', async t => {
  const f = await fixture(t), record = await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  const proof = await json(record.acceptanceFile); await save(record.acceptanceFile, { ...proof, archiveSha256: '0'.repeat(64) });
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /evidence/); assert.deepEqual(f.calls, []);
  await save(record.acceptanceFile, proof);
  const cat = await json(record.catalogueFile); await writeFile(cat.artifacts[0].path, 'tampered');
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /checksum/); assert.deepEqual(f.calls, []);
});

test('publish preview runs no remote commands and failed live check preserves previous default', async t => {
  const f = await fixture(t); await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  await publishSet({ plan: true }, f.settings, f.active, f.deps); assert.deepEqual(f.calls, []);
  f.deps.verifyLiveDelivery = async () => { throw Error('delivery mismatch'); };
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /delivery mismatch/);
  assert.deepEqual(await json(f.settings.deploymentConfig), f.active);
  assert.equal(await present(join(f.settings.cacheRoot, 'sets/fixture-set/published.json')), false);
});

test('embedded license checker rejects an installer containing different terms', async t => {
  const f = await fixture(t); const dir = dirname((await json(f.active.catalogueFile)).artifacts.find(a => a.product === 'desktop').path);
  await assert.rejects(verifyEmbeddedAgreements([dir], { sevenZip: 'fixture' }, async () => 'different terms'), /Embedded agreement differs/);
});

test('website changes and incomplete platform sets block publication before remote commands', async t => {
  const f = await fixture(t), record = await buildSet(f.request, f.settings, f.active, f.deps); f.calls.length = 0;
  const git = f.deps.git;
  f.deps.git = async (_repo, args) => { if (args[0] === 'diff') throw Error('Website changed'); return revision; };
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /Website changed/); assert.deepEqual(f.calls, []);
  f.deps.git = git;
  await save(join(f.settings.cacheRoot, 'sets/fixture-set/build.json'), { ...record, releaseDirectories: record.releaseDirectories.slice(1) });
  await assert.rejects(publishSet({}, f.settings, f.active, f.deps), /complete Windows\/Linux/); assert.deepEqual(f.calls, []);
});

test('release catalogues preserve older-major download routes across updates', () => {
  const major = version => ({ artifacts: [{ id: 'server', filename: `127vaults-server-${version}.0.0-linux.tar.gz` }] });
  const old = { ...major(1), previousMajors: [{ majorVersion: 0, objectKey: 'releases/zero/catalogue.json', sha256: 'a'.repeat(64) }] };
  assert.deepEqual(retainPreviousMajors(major(1), old, {}).previousMajors, old.previousMajors);
  const next = retainPreviousMajors(major(2), old, { catalogueKey: 'releases/one/catalogue.json', catalogueSha256: 'b'.repeat(64) });
  assert.deepEqual(next.previousMajors.map(v => v.majorVersion), [0, 1]);
  assert.throws(() => retainPreviousMajors(major(2), old, {}), /Previous major/);
});

test('live verification hashes all download ranges and refuses public access or altered bytes', async () => {
  const bytes = Buffer.from('complete-server-download'), asset = { id: 'server', sha256: sha(bytes), sizeBytes: bytes.length, supporting: false };
  const catalogue = { sourceRevision: revision, artifacts: [asset] }; let corrupt = false, publicAccess = false;
  const fetchImpl = async (url, options = {}) => {
    assert.ok(!url.includes('private-token'));
    if (url.endsWith('/releases')) return Response.json(catalogue);
    if (!options.headers?.Authorization) return new Response(null, { status: publicAccess ? 200 : 401 });
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(bytes.length) } });
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    const body = Buffer.from(bytes.subarray(Number(start), Number(end) + 1)); if (corrupt) body[0] ^= 1;
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  };
  const verify = () => verifyLiveDelivery({ origin: 'https://vaults.example.com' }, catalogue, 'private-token', { fetchImpl, partSize: 5 });
  assert.equal((await verify()).status, 'passed'); corrupt = true; await assert.rejects(verify(), /checksum/);
  corrupt = false; publicAccess = true; await assert.rejects(verify(), /unauthenticated/);
});
