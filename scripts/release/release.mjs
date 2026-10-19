import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, open, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPlan, git, hash } from './plan.mjs';
import { execute, pnpm } from './process.mjs';
import { copyLicenses, packageCli, packageDesktop, packageExtension, packageInstaller } from './package.mjs';
import { runMakeBundle } from '../ops/make-server-bundle.mjs';
import { fileHash, verifyRelease } from './verify-release.mjs';

const controller = resolve(import.meta.dirname, '../..');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
export function within(parent, path) {
  const rel = relative(resolve(parent), resolve(path));
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}
export async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`Another build may hold ${path}. Inspect that lock and confirm its process has stopped before removing it.`);
    throw error;
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, host: process.platform, startedAt: new Date().toISOString() }) + '\n');
  return async () => { await handle.close(); await unlink(path); };
}
export async function snapshot(plan, attempt) {
  const source = join(attempt, 'source');
  const archive = join(attempt, 'source.tar');
  await mkdir(source);
  await git(plan.repository, ['archive', '--format=tar', `--output=${archive}`, plan.revision]);
  await execute('tar', ['-xf', archive, '-C', source]);
  // Each build gets fresh committed files. Only compiler/store caches are shared.
  if (plan.product !== 'extension') {
    const target = join(plan.cacheRoot, 'rust-target');
    await mkdir(target, { recursive: true });
    if (await exists(join(source, 'target'))) throw Error('The committed snapshot unexpectedly contains target/.');
    await symlink(target, join(source, 'target'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  if (plan.product === 'server') {
    const generator = join(plan.repository, '.tools/wasm-bindgen');
    await access(generator);
    await mkdir(join(source, '.tools'));
    await symlink(generator, join(source, '.tools/wasm-bindgen'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return source;
}
export async function doctor(plan) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Release tooling requires Node.js 24.');
  if (process.arch !== 'x64' && plan.product !== 'extension' && !(process.platform === 'darwin' && plan.product === 'desktop' && process.arch === 'arm64')) throw Error('This build requires x64, or Apple Silicon for Mac desktop.');
  const versions = { node: process.version, git: await execute('git', ['--version'], { capture: true, quiet: true }), platform: process.platform, architecture: process.arch };
  await execute('tar', ['--version'], { capture: true, quiet: true });
  if (process.platform !== 'win32' && plan.product === 'extension') await execute('zip', ['-v'], { capture: true, quiet: true });
  if (plan.product !== 'extension') {
    versions.rust = await execute('rustc', ['--version'], { cwd: plan.repository, capture: true, quiet: true });
    versions.cargo = await execute('cargo', ['--version'], { cwd: plan.repository, capture: true, quiet: true });
  }
  if (['desktop', 'server'].includes(plan.product)) {
    versions.pnpm = await pnpm(['--version'], { capture: true, quiet: true });
    const rootPackage = JSON.parse(await git(plan.repository, ['show', `${plan.revision}:package.json`]));
    if (`pnpm@${versions.pnpm}` !== rootPackage.packageManager) throw Error(`Expected ${rootPackage.packageManager}; found pnpm@${versions.pnpm}.`);
  }
  if (plan.product === 'desktop' && process.platform === 'linux') {
    await execute('pkg-config', ['--exists', 'gtk+-3.0', 'webkit2gtk-4.1', 'openssl', 'libsecret-1', 'dbus-1'], { capture: true, quiet: true });
    await access('/usr/bin/xdg-open', constants.X_OK);
  }
  if (plan.product === 'server') {
    versions.containerEngine = await execute(plan.engine, ['--version'], { capture: true, quiet: true });
    await execute(plan.engine, ['info'], { capture: true, quiet: true });
    const architecture = await execute(plan.engine, plan.engine === 'podman' ? ['info', '--format', '{{.Host.Arch}}'] : ['info', '--format', '{{.Architecture}}'], { capture: true, quiet: true });
    if (!['amd64', 'x86_64'].includes(architecture)) throw Error('The server bundle currently requires a Linux amd64 container engine.');
    const binary = join(plan.repository, '.tools/wasm-bindgen/bin', process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen');
    versions.wasmBindgen = await execute(binary, ['--version'], { capture: true, quiet: true });
    if (versions.wasmBindgen !== 'wasm-bindgen 0.2.126') throw Error('Install the pinned wasm-bindgen 0.2.126 generator.');
  }
  return versions;
}
async function testFiles(source, directory) {
  const entries = await readdir(join(source, directory));
  return entries.filter(name => name.endsWith('.test.mjs')).sort().map(name => join(source, directory, name));
}
export async function gates(plan, source) {
  const checks = [];
  const record = async (name, action) => {
    console.log(`Checking ${name}...`);
    await action();
    checks.push({ name, status: 'passed' });
  };
  if (plan.product === 'installer') {
    await record('Rust installer tests', () => execute('cargo', ['test', '--locked', '-p', 'vaults-installer'], { cwd: source }));
    await record('Rust installer lint', () => execute('cargo', ['clippy', '--locked', '-p', 'vaults-installer', '--all-targets', '--', '-D', 'warnings'], { cwd: source }));
  }
  if (['desktop', 'server'].includes(plan.product)) {
    await record('locked workspace dependencies', () => pnpm(['install', '--frozen-lockfile', '--store-dir', join(plan.cacheRoot, 'pnpm-store')], { cwd: source }));
  }
  if (plan.product === 'extension') {
    const directory = join(source, 'apps/extension/src');
    const scripts = (await readdir(directory)).filter(name => /\.(mjs|js)$/.test(name));
    await record('extension runtime syntax', async () => { for (const name of scripts) await execute(process.execPath, ['--check', join(directory, name)], { quiet: true }); });
    await record('extension tests', async () => execute(process.execPath, ['--test', ...await testFiles(source, 'apps/extension/test')], { cwd: source }));
  }
  if (['desktop', 'cli'].includes(plan.product)) {
    if (plan.product === 'desktop') {
      await record('desktop types and native check', () => pnpm(['--filter', '@127vaults/desktop', 'check'], { cwd: source }));
      await record('desktop tests', async () => execute(process.execPath, ['--test', ...await testFiles(source, 'apps/desktop/test')], { cwd: source }));
    }
    await record('Rust client library tests', () => execute('cargo', ['test', '--locked', '-p', 'vaults-cli', '--lib'], { cwd: source }));
  }
  if (plan.product === 'server') {
    await record('fresh browser and Node WASM bindings', () => execute(process.execPath, ['scripts/build-fixture.mjs'], { cwd: source }));
    for (const product of ['server', 'web']) {
      await record(`${product} checks`, () => pnpm(['--filter', `@127vaults/${product}`, 'check'], { cwd: source }));
      await record(`${product} tests`, () => pnpm(['--filter', `@127vaults/${product}`, 'test'], { cwd: source }));
    }
    await record('installer and operational tests', async () => execute(process.execPath, ['--test',
      ...await testFiles(source, 'deploy'), ...await testFiles(source, 'scripts/ops')], { cwd: source }));
  }
  return checks;
}
async function writeRelease(directory, metadata) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw Error(`Unexpected staged release entry: ${name}`);
    files.push({ name, sizeBytes: info.size, sha256: await fileHash(path) });
  }
  await writeFile(join(directory, 'SHA256SUMS'), files.map(file => `${file.sha256}  ${file.name}\n`).join(''), { flag: 'wx' });
  await writeFile(join(directory, 'release.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', channel: 'private-test', signed: false,
    ...metadata, files }, null, 2) + '\n', { flag: 'wx' });
  return verifyRelease(directory);
}
async function build(plan, platform, attempt) {
  const toolchain = await doctor(plan);
  const source = await snapshot(plan, attempt);
  const checks = await gates(plan, source);
  const stage = join(attempt, 'stage');
  const payload = join(attempt, 'payload');
  await mkdir(stage); await mkdir(payload);
  const options = { root: source, version: plan.packageVersion, minimal: true };
  if (plan.product === 'extension') await packageExtension(stage, options);
  if (plan.product === 'desktop') await packageDesktop(stage, options);
  if (plan.product === 'cli') await packageCli(stage, options);
  if (plan.product === 'installer') await packageInstaller(stage, options);
  if (plan.product === 'installer') {
    const binary = join(source, 'target/release', process.platform === 'win32' ? '127vaults-install.exe' : '127vaults-install');
    await execute(binary, ['--help'], { capture: true, quiet: true });
    if (await execute(binary, ['--version'], { capture: true, quiet: true }) !== `127vaults-install ${plan.packageVersion}`) throw Error('Installer executable version differs from release metadata.');
    checks.push({ name: 'installer startup and independent version', status: 'passed' });
  }
  if (plan.product === 'server') {
    const issuerFile = join(attempt, 'issuer-keys.json');
    if (plan.issuerPublicKeys) await writeFile(issuerFile, JSON.stringify(plan.issuerPublicKeys, null, 2) + '\n', { flag: 'wx' });
    await runMakeBundle([join(stage, `127vaults-server-${plan.packageVersion}-linux-amd64`),
      ...(plan.issuerPublicKeys ? ['--issuer-public-keys', issuerFile] : []), ...(plan.engine === 'docker' ? ['--docker'] : [])],
      { checkout: source, provenance: { revision: plan.revision, sourceDirty: false },
        image: `localhost/127vaults-server:release-${plan.inputFingerprint.slice(0, 16)}`, refreshImages: plan.refreshImages });
  }
  for (const name of await readdir(stage)) if (/\.(?:zip|tar|gz|exe|deb|AppImage|dmg)$/.test(name)) {
    const info = await lstat(join(stage, name));
    if (info.isFile()) await copyFile(join(stage, name), join(payload, name));
  }
  const documentation = { desktop: 'client-install', cli: 'cli-install', extension: 'extension-install', server: 'server-test-install', installer: 'installer' }[plan.product];
  await copyFile(join(source, `docs/release/${documentation}.md`), join(payload, 'README.md'));
  await copyLicenses(source, payload);
  await copyFile(join(import.meta.dirname, 'verify-release.mjs'), join(payload, 'verify-release.mjs'));
  if (['desktop', 'cli'].includes(plan.product)) {
    const host = join(source, 'target/release', process.platform === 'win32' ? '127vaults-extension-host.exe' : '127vaults-extension-host');
    await execute(process.execPath, [join(import.meta.dirname, 'smoke-native-host.mjs'), host]);
    checks.push({ name: 'packaged native-host framed discovery', status: 'passed' });
    const cli = join(source, 'target/release', process.platform === 'win32' ? '127vaults.exe' : '127vaults');
    await execute(cli, ['--help'], { capture: true, quiet: true });
    const cliVersion = await execute(cli, ['--version'], { capture: true, quiet: true });
    if (cliVersion !== `127vaults ${plan.packageVersion}`) throw Error(`Packaged CLI reports ${cliVersion}; expected ${plan.packageVersion}.`);
    checks.push({ name: 'CLI startup', status: 'passed' });
  }
  await writeRelease(payload, { product: plan.product, platform, label: plan.label, packageVersion: plan.packageVersion,
    sourceRevision: plan.revision, sourceDirty: false, inputFingerprint: plan.inputFingerprint, builderFingerprint: plan.builderFingerprint,
    builtAt: new Date().toISOString(), toolchain, checks, compatibility: plan.compatibility,
    ...(plan.issuerPublicKeys ? { issuerPublicKeys: plan.issuerPublicKeys } : {}),
    limitations: ['Unsigned private-test artifacts; publisher signing remains pending.', ...(plan.product === 'server' ? ['Native Linux server and Docker clean-host installation are not yet accepted. Web assets ship in this server image.'] : [])] });
  return payload;
}
async function deliver(plan, platform, payload, reused) {
  const cached = await verifyRelease(payload);
  const output = join(plan.outputRoot, plan.product, plan.label, platform);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Immutable: never merge into or overwrite an earlier release.
  for (const file of cached.files) await copyFile(join(payload, file.name), join(output, file.name));
  await copyFile(join(payload, 'SHA256SUMS'), join(output, 'SHA256SUMS'));
  const manifest = { ...cached, label: plan.label, requestedSourceRevision: plan.revision,
    preparedAt: new Date().toISOString(), reused, cachedFromLabel: reused ? cached.label : null };
  await writeFile(join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await verifyRelease(output);
  const unlock = await acquireLock(join(plan.outputRoot, '.catalog-lock'));
  try {
    const path = join(plan.outputRoot, 'release-index.json');
    const index = await exists(path) ? JSON.parse(await readFile(path, 'utf8')) : { schemaVersion: 1, releases: [] };
    if (index.schemaVersion !== 1 || !Array.isArray(index.releases)) throw Error('Invalid release index.');
    index.releases.push({ product: plan.product, platform, label: plan.label, packageVersion: plan.packageVersion,
      sourceRevision: manifest.sourceRevision, requestedSourceRevision: plan.revision, inputFingerprint: plan.inputFingerprint,
      directory: relative(plan.outputRoot, output).replaceAll('\\', '/'), reused, preparedAt: manifest.preparedAt });
    await atomicJson(path, index);
  } finally { await unlock(); }
  console.log(`Ready: ${output}${reused ? ' (verified cached artifact)' : ''}`);
  return output;
}
export async function nativeRelease(plan, platform) {
  await mkdir(plan.cacheRoot, { recursive: true });
  const unlock = await acquireLock(join(plan.cacheRoot, '.build-lock'));
  let attempt;
  try {
    const key = hash(JSON.stringify({ product: plan.product, platform, version: plan.packageVersion,
      inputs: plan.inputFingerprint, builder: plan.builderFingerprint, node: process.version, engine: plan.product === 'server' ? plan.engine : null }));
    const pointer = join(plan.cacheRoot, 'entries', `${key}.json`);
    if (!plan.force && await exists(pointer)) {
      const entry = JSON.parse(await readFile(pointer, 'utf8'));
      if (!within(join(plan.cacheRoot, 'artifacts'), entry.directory)) throw Error('Invalid artifact cache path.');
      const manifest = await verifyRelease(entry.directory);
      if (manifest.inputFingerprint !== plan.inputFingerprint || manifest.builderFingerprint !== plan.builderFingerprint
        || manifest.product !== plan.product || manifest.platform !== platform || manifest.packageVersion !== plan.packageVersion) throw Error('Artifact cache metadata does not match this build.');
      return await deliver(plan, platform, entry.directory, true);
    }
    attempt = join(plan.cacheRoot, 'attempts', `${key.slice(0, 12)}-${randomUUID()}`);
    await mkdir(attempt, { recursive: true });
    await atomicJson(join(attempt, 'plan.json'), plan);
    const payload = await build(plan, platform, attempt);
    const cache = join(plan.cacheRoot, 'artifacts', `${key}-${randomUUID()}`);
    await mkdir(dirname(cache), { recursive: true });
    await rename(payload, cache);
    await atomicJson(pointer, { directory: cache });
    return await deliver(plan, platform, cache, false);
  } catch (error) {
    if (attempt) await atomicJson(join(attempt, 'failure.json'), { status: 'failed', message: error.message, time: new Date().toISOString() });
    throw error;
  } finally { await unlock(); }
}
function wslArgs(request) {
  return ['-d', request.wslDistro || 'Ubuntu-24.04', ...(request.wslUser ? ['-u', request.wslUser] : [])];
}
async function linuxWorker(request, plan) {
  const args = wslArgs(request);
  const toLinux = path => execute('wsl.exe', [...args, '--exec', 'wslpath', '-a', '-u', path.replaceAll('\\', '/')], { capture: true, quiet: true });
  const repository = await toLinux(plan.repository);
  const script = await toLinux(join(import.meta.dirname, 'release.mjs'));
  const outputRoot = await toLinux(plan.outputRoot);
  const childRequest = { ...request, repository, outputRoot, cacheRoot: request.linuxCacheRoot || null,
    platform: 'linux', ref: plan.revision, label: plan.label, version: plan.packageVersion, worker: true };
  // bash only loads the user's toolchain PATH; positional arguments are forwarded literally.
  await execute('wsl.exe', [...args, '--exec', 'bash', '-lc', 'exec "$@"', 'vaults-release', 'node', script, '--request'],
    { input: JSON.stringify(childRequest) });
}
export async function runRelease(request) {
  if (request.help || (!request.product && !request.verify)) {
    console.log('release.ps1 desktop|cli|extension|server|installer [-Platform native|windows|linux|both] [-Label name] [-Version numeric] [-Ref commit]\n  -Plan: show inputs/output without building; -Doctor: check prerequisites\n  -Force: rebuild even if verified cache exists; -RefreshBaseImages: force server rebuild with fresh bases\n  -Verify <directory>: verify a prepared release\n  -OutputRoot / -CacheRoot: separate external directories\n  -WslDistro / -WslUser / -LinuxCacheRoot: Linux worker selection\nOnly local private-test preparation. No publishing, pushing or fixed release version convention.');
    return;
  }
  if (request.verify) { const result = await verifyRelease(resolve(request.verify)); console.log(`Verified ${result.product}/${result.platform}.`); return; }
  const plan = await createPlan(request);
  if (request.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  for (const platform of plan.platforms) {
    if (await exists(join(plan.outputRoot, plan.product, plan.label, platform)) && !request.doctor) throw Error('That release output already exists. Choose a new -Label; completed releases are immutable.');
  }
  console.log(`Preparing ${plan.product} from committed ${plan.revision}. Uncommitted checkout changes are excluded.`);
  for (const platform of plan.platforms) {
    if (platform === 'linux' && process.platform === 'win32') { await linuxWorker(request, plan); continue; }
    if (platform === 'windows' && process.platform !== 'win32') throw Error('Windows builds require a Windows host; run release.ps1 there.');
    if (request.doctor) console.log(JSON.stringify(await doctor(plan), null, 2));
    else await nativeRelease(plan, platform);
  }
}
async function readRequest() {
  if (process.argv[2] === '--request') {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    return JSON.parse(input.replace(/^\uFEFF/, ''));
  }
  if (process.argv[2] === '--config' && process.argv[3]) return JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
  if (process.argv[2] === '--help' || !process.argv[2]) return { help: true };
  throw Error('Use release.ps1, or node scripts/release/release.mjs --config <request.json>.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readRequest().then(runRelease).catch(error => { console.error(`Release: ${error.message}`); process.exitCode = 1; });
}
