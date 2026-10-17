import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { createPlan, git, labelValue, numericVersion, targets, inputFingerprint } from './plan.mjs';
import { acquireLock, runRelease, within } from './release.mjs';
import { execute, pnpm } from './process.mjs';
import { verifyRelease } from './verify-release.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-release-'));
  const repository = join(directory, 'repo');
  await mkdir(repository);
  const files = {
    'apps/extension/manifest.json': JSON.stringify({ manifest_version: 3, name: 'fixture', version: '0.1.0', background: { service_worker: 'src/background.mjs', type: 'module' } }),
    'apps/extension/package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'apps/extension/popup.html': '<html>fixture</html>',
    'apps/extension/src/background.mjs': 'export const snapshotValue = "committed";\n',
    'apps/extension/src/types.d.mts': 'export const snapshotValue: string;\n',
    'apps/extension/test/snapshot.test.mjs': 'import test from "node:test"; import assert from "node:assert/strict"; import {snapshotValue} from "../src/background.mjs"; test("snapshot", () => assert.equal(snapshotValue,"committed"));\n',
    'docs/release/extension-install.md': 'Install the test extension.\n',
    'LICENSE-POLICY.md': 'Fixture policy, not a license grant.\n',
    'unrelated.txt': 'one\n',
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(repository, name, '..'), { recursive: true });
    await writeFile(join(repository, name), contents);
  }
  await execute('git', ['init', '-q', repository], { quiet: true });
  await git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repository, ['config', 'user.name', 'Release fixture']);
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'fixture']);
  return { directory, repository, outputRoot: join(directory, 'output'), cacheRoot: join(directory, 'cache') };
}
async function cleanup(directory) {
  assert.equal(within(tmpdir(), directory), true);
  await rm(directory, { recursive: true, force: true });
}
test('target and metadata validation keep label policy separate from native versions', () => {
  assert.deepEqual(targets('desktop', 'both', 'win32'), ['windows', 'linux']);
  assert.deepEqual(targets('extension'), ['chromium']);
  assert.deepEqual(targets('desktop', 'native', 'darwin', 'arm64'), ['macos-arm64']);
  assert.deepEqual(targets('desktop', 'native', 'darwin', 'x64'), ['macos-x64']);
  assert.throws(() => targets('cli', 'native', 'darwin', 'arm64'), /desktop only/);
  assert.throws(() => targets('web'), /server image/);
  assert.throws(() => targets('server', 'windows'), /portable package/);
  assert.equal(labelValue('friends_october'), 'friends_october');
  for (const value of ['../escape', 'a b', 'CON', 'NUL.txt', 'name.']) assert.throws(() => labelValue(value));
  assert.equal(numericVersion('1.2.3.4', 'extension'), '1.2.3.4');
  for (const value of ['beta-1', '01.2.3', '1.2.70000']) assert.throws(() => numericVersion(value, 'desktop'));
  assert.throws(() => numericVersion('0.0.0', 'extension'));
});

test('server trial issuer keys affect cached inputs and private keys cannot be supplied as public keys', async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.repository, 'apps/server'), { recursive: true });
    await writeFile(join(item.repository, 'apps/server/package.json'), JSON.stringify({ version: '0.0.0' }));
    await git(item.repository, ['add', '.']); await git(item.repository, ['commit', '-qm', 'server metadata']);
    const file = join(item.directory, 'issuer-keys.json');
    const first = generateKeyPairSync('ed25519'), second = generateKeyPairSync('ed25519');
    await writeFile(file, JSON.stringify({ trial: first.publicKey.export({ type: 'spki', format: 'pem' }) }));
    const plain = await createPlan({ ...item, product: 'server' });
    const pinned = await createPlan({ ...item, product: 'server', issuerPublicKeys: file });
    assert.notEqual(pinned.inputFingerprint, plain.inputFingerprint);
    await writeFile(file, JSON.stringify({ trial: second.publicKey.export({ type: 'spki', format: 'pem' }) }));
    assert.notEqual((await createPlan({ ...item, product: 'server', issuerPublicKeys: file })).inputFingerprint, pinned.inputFingerprint);
    await assert.rejects(createPlan({ ...item, product: 'extension', issuerPublicKeys: file }), /only to server/);
    await writeFile(file, JSON.stringify({ trial: first.privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
    await assert.rejects(createPlan({ ...item, product: 'server', issuerPublicKeys: file }));
  } finally { await cleanup(item.directory); }
});
test('source fingerprints follow product inputs and plans do not create output', async () => {
  const item = await fixture();
  try {
    const revision = await git(item.repository, ['rev-parse', 'HEAD']);
    const initial = await inputFingerprint(item.repository, revision, 'extension');
    await writeFile(join(item.repository, 'unrelated.txt'), 'two\n');
    await git(item.repository, ['add', 'unrelated.txt']); await git(item.repository, ['commit', '-qm', 'unrelated change']);
    const next = await inputFingerprint(item.repository, await git(item.repository, ['rev-parse', 'HEAD']), 'extension');
    assert.equal(initial.fingerprint, next.fingerprint);
    const plan = await createPlan({ ...item, product: 'extension', label: 'plan-test' });
    assert.equal(plan.packageVersion, '0.1.0');
    assert.equal((await readdir(item.directory)).includes('output'), false);
    await assert.rejects(createPlan({ ...item, product: 'extension', outputRoot: join(item.repository, 'dist') }), /outside/);
    await assert.rejects(createPlan({ ...item, product: 'extension', cacheRoot: item.outputRoot }), /separate/);
  } finally { await cleanup(item.directory); }
});
test('shared dependency changes invalidate the products that consume them', async () => {
  const item = await fixture();
  try {
    const products = ['desktop', 'cli', 'extension', 'server'];
    const fingerprints = async () => {
      const revision = await git(item.repository, ['rev-parse', 'HEAD']);
      return Object.fromEntries(await Promise.all(products.map(async product => [product,
        (await inputFingerprint(item.repository, revision, product)).fingerprint])));
    };
    for (const [path, affected] of [
      ['crates/crypto/src/lib.rs', ['desktop', 'cli', 'server']],
      ['apps/extension/src/passkeys.mjs', ['desktop', 'extension', 'server']],
      ['apps/extension/popup.html', ['extension']],
      ['apps/web/src/app.tsx', ['server']],
      ['LICENSE-POLICY.md', products],
    ]) {
      const before = await fingerprints();
      await mkdir(join(item.repository, path, '..'), { recursive: true });
      await writeFile(join(item.repository, path), `changed ${path}\n`);
      await git(item.repository, ['add', path]);
      await git(item.repository, ['commit', '-qm', `change ${path}`]);
      const after = await fingerprints();
      for (const product of products) assert.equal(before[product] !== after[product], affected.includes(product), `${path}: ${product}`);
    }
  } finally { await cleanup(item.directory); }
});

test('real extension release freezes committed source, reuses unchanged inputs and rejects corruption', async () => {
  const item = await fixture();
  try {
    const request = { ...item, product: 'extension', label: 'first', version: '0.2.0' };
    await writeFile(join(item.repository, 'apps/extension/src/background.mjs'), 'throw Error("uncommitted code must not be built");\n');
    await runRelease(request);
    const firstPath = join(item.outputRoot, 'extension/first/chromium');
    const first = await verifyRelease(firstPath);
    assert.equal(first.sourceDirty, false);
    assert.equal(first.reused, false);
    assert.equal(first.packageVersion, '0.2.0');
    const archive = first.files.find(file => file.name.endsWith('.zip'));
    const names = await execute('tar', ['-tf', join(firstPath, archive.name)], { capture: true, quiet: true });
    assert.equal(names.includes('types.d.mts'), false);
    assert.equal(names.includes('/test/'), false);
    const extract = join(item.directory, 'extract'); await mkdir(extract);
    await execute('tar', ['-xf', join(firstPath, archive.name), '-C', extract], { quiet: true });
    assert.match(await readFile(join(extract, '127vaults-extension/src/background.mjs'), 'utf8'), /committed/);
    assert.equal(JSON.parse(await readFile(join(extract, '127vaults-extension/manifest.json'), 'utf8')).version, '0.2.0');
    await writeFile(join(item.repository, 'unrelated.txt'), 'new unrelated code\n');
    await git(item.repository, ['add', 'unrelated.txt']); await git(item.repository, ['commit', '-qm', 'different product']);
    await runRelease({ ...request, label: 'second' });
    const second = await verifyRelease(join(item.outputRoot, 'extension/second/chromium'));
    assert.equal(second.reused, true);
    assert.equal(second.sourceRevision, first.sourceRevision);
    assert.notEqual(second.requestedSourceRevision, first.sourceRevision);
    assert.equal(second.files.find(file => file.name === archive.name).sha256, archive.sha256);
    await assert.rejects(runRelease({ ...request, label: 'second' }), /already exists/);
    const entry = JSON.parse(await readFile(join(item.cacheRoot, 'entries', (await readdir(join(item.cacheRoot, 'entries')))[0]), 'utf8'));
    await writeFile(join(entry.directory, archive.name), 'corrupted');
    await assert.rejects(runRelease({ ...request, label: 'corrupt' }), /checksum mismatch/);
    assert.equal((await readdir(join(item.outputRoot, 'extension'))).includes('corrupt'), false);
    await runRelease({ ...request, label: 'forced', force: true });
    assert.equal((await verifyRelease(join(item.outputRoot, 'extension/forced/chromium'))).reused, false);
    const index = JSON.parse(await readFile(join(item.outputRoot, 'release-index.json'), 'utf8'));
    assert.equal(index.releases.length, 3);
    await writeFile(join(firstPath, 'unexpected.key'), 'must reject extras');
    await assert.rejects(verifyRelease(firstPath), /Unexpected release content/);
  } finally { await cleanup(item.directory); }
});
test('failed checks do not publish a complete release or leave the cache lock held', async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.repository, 'apps/extension/src/background.mjs'), 'not valid JavaScript :::');
    await git(item.repository, ['add', '.']); await git(item.repository, ['commit', '-qm', 'bad source']);
    await assert.rejects(runRelease({ ...item, product: 'extension', label: 'failed' }), /failed/);
    assert.equal((await readdir(item.directory)).includes('output'), false);
    assert.equal((await readdir(item.cacheRoot)).includes('.build-lock'), false);
    const attempts = await readdir(join(item.cacheRoot, 'attempts'));
    assert.equal(JSON.parse(await readFile(join(item.cacheRoot, 'attempts', attempts[0], 'failure.json'), 'utf8')).status, 'failed');
    await writeFile(join(item.repository, 'apps/extension/src/background.mjs'), 'export const snapshotValue = "wrong-value";\n');
    await git(item.repository, ['add', '.']); await git(item.repository, ['commit', '-qm', 'failing test']);
    await assert.rejects(runRelease({ ...item, product: 'extension', label: 'test-failed' }), /failed/);
    assert.equal((await readdir(item.directory)).includes('output'), false);
  } finally { await cleanup(item.directory); }
});
test('cache locks prevent overlapping compilers and release after completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-lock-'));
  try {
    const path = join(directory, '.lock');
    const unlock = await acquireLock(path);
    await assert.rejects(acquireLock(path), /Another build/);
    await unlock();
    const next = await acquireLock(path); await next();
  } finally { await cleanup(directory); }
});
test('Windows pnpm bridge forwards command arguments without shell interpolation', async () => {
  if (process.platform !== 'win32') return;
  assert.match(await pnpm(['--version'], { capture: true, quiet: true }), /^\d+\.\d+\.\d+$/);
  const listing = JSON.parse(await pnpm(['list', '--depth', '0', '--json'], { capture: true, quiet: true }));
  assert.ok(Array.isArray(listing));
  assert.equal(await pnpm(['exec', 'node', '-p', 'process.argv[1]', 'snow 雪 space'], { capture: true, quiet: true }), 'snow 雪 space');
});
