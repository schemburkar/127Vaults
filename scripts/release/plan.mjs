import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execute } from './process.mjs';

export const products = ['desktop', 'cli', 'extension', 'server', 'installer'];
const rust = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'crates/crypto', 'crates/protocol',
  'crates/browser-fixture/Cargo.toml', 'apps/desktop/src-tauri/Cargo.toml', 'apps/cli'];
const node = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const policy = ['LICENSE.md', 'COMMERCIAL-LICENSE.md'];
export const productInputs = {
  installer: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'apps/installer', ...policy, 'docs/release/installer.md'],
  desktop: [...rust, ...node, ...policy, 'apps/desktop', 'packages/ui', 'apps/extension/src/passkeys.mjs',
    'apps/extension/src/passkeys.d.mts', 'apps/extension/install-native-host.ps1', 'apps/extension/install-native-host.sh', 'docs/release/client-install.md'],
  cli: [...rust, ...policy, 'apps/extension/install-native-host.ps1', 'apps/extension/install-native-host.sh', 'docs/release/cli-install.md'],
  extension: [...policy, 'apps/extension/package.json', 'apps/extension/manifest.json', 'apps/extension/popup.html', 'apps/extension/src', 'apps/extension/test', 'docs/release/extension-install.md'],
  server: [...rust.filter(path => path !== 'apps/cli'), 'apps/cli/Cargo.toml', 'crates/browser-fixture', ...node, ...policy, 'apps/server', 'apps/web', 'packages',
    'apps/desktop/src/item-types.ts', 'apps/desktop/src/item-browser.ts', 'apps/extension/src/passkeys.mjs',
    'server.mjs', 'deploy', 'scripts/build-fixture.mjs', 'scripts/tls.mjs', 'scripts/ops', 'docs/release/server-test-install.md', '.dockerignore'],
};
export const hash = value => createHash('sha256').update(value).digest('hex');
export function outside(repository, value, name) {
  const path = resolve(value);
  const rel = relative(resolve(repository), path);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw Error(`${name} must be outside the source checkout.`);
  return path;
}
export function labelValue(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw Error('Label must be a safe filename label (1–80 letters, numbers, dots, underscores or hyphens).');
  }
  return value;
}
export function numericVersion(value, product) {
  // A native metadata constraint, not the project's future release numbering policy.
  const pattern = product === 'extension' ? /^\d+\.\d+\.\d+(?:\.\d+)?$/ : /^\d+\.\d+\.\d+$/;
  if (!pattern.test(value) || value.split('.').some(part => String(Number(part)) !== part || Number(part) > 65535)
    || (product === 'extension' && value.split('.').every(part => Number(part) === 0))) {
    throw Error('Version must be numeric package metadata: X.Y.Z (extension also accepts X.Y.Z.W). Use -Label for names such as friend-test.');
  }
  return value;
}
export function targets(product, requested = 'native', host = process.platform, arch = process.arch) {
  if (!products.includes(product)) throw Error(product === 'web' ? 'Web assets currently ship in the server image. Choose server; independent web deployment is deferred.' : 'Choose desktop, cli, extension, server or installer.');
  if (!['native', 'windows', 'linux', 'both'].includes(requested)) throw Error('Platform must be native, windows, linux or both.');
  if (product === 'extension' || product === 'server') {
    if (requested !== 'native') throw Error(`${product} is one portable package. Omit -Platform.`);
    return [product === 'server' ? 'linux-amd64' : 'chromium'];
  }
  if (host === 'darwin' && requested === 'native') {
    if (product !== 'desktop' || !['arm64','x64'].includes(arch)) throw Error('Mac packaging currently prepares desktop only on Intel or Apple Silicon.');
    return [`macos-${arch}`];
  }
  const native = host === 'win32' ? 'windows' : host === 'linux' ? 'linux' : null;
  if (!native) throw Error('Native client packaging supports Windows and Linux only.');
  return requested === 'both' ? ['windows', 'linux'] : [requested === 'native' ? native : requested];
}
export async function git(repository, args) {
  return execute('git', ['-C', repository, ...args], { capture: true, quiet: true });
}
export async function inputFingerprint(repository, revision, product) {
  const tree = await git(repository, ['ls-tree', '-r', '-z', '--full-tree', revision, '--', ...productInputs[product]]);
  if (!tree) throw Error(`No ${product} source inputs found in the selected revision.`);
  return { fingerprint: hash(tree), entries: tree.split('\0').filter(Boolean).length };
}
async function configuredVersion(repository, revision, product) {
  if (product === 'installer') {
    const cargo = await git(repository, ['show', `${revision}:apps/installer/Cargo.toml`]);
    return /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? '0.1.0';
  }
  if (product === 'cli') {
    const cargo = await git(repository, ['show', `${revision}:Cargo.toml`]);
    const section = cargo.split('[workspace.package]')[1]?.split('\n[')[0];
    const value = /^version\s*=\s*"([^"]+)"/m.exec(section ?? '')?.[1];
    if (!value) throw Error('Workspace Cargo version is missing.');
    return value;
  }
  const path = product === 'desktop' ? 'apps/desktop/src-tauri/tauri.conf.json' : `apps/${product}/${product === 'extension' ? 'manifest.json' : 'package.json'}`;
  return JSON.parse(await git(repository, ['show', `${revision}:${path}`])).version;
}
export async function builderFingerprint() {
  const paths = ['plan.mjs', 'process.mjs', 'release.mjs', 'package.mjs', 'verify.mjs', 'verify-release.mjs', 'smoke-native-host.mjs'];
  const contents = await Promise.all(paths.map(path => readFile(resolve(import.meta.dirname, path))));
  contents.push(await readFile(resolve(import.meta.dirname, '../ops/make-server-bundle.mjs')));
  return hash(Buffer.concat(contents));
}
export async function createPlan(request) {
  const repository = resolve(request.repository ?? resolve(import.meta.dirname, '../..'));
  const product = request.product;
  const platforms = targets(product, request.platform || 'native');
  if (!['podman', 'docker'].includes(request.engine || 'podman')) throw Error('Engine must be podman or docker.');
  const ref = request.ref || 'HEAD';
  if (ref.startsWith('-')) throw Error('Ref must be a Git commit, branch or tag.');
  const revision = await git(repository, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const source = await inputFingerprint(repository, revision, product);
  let issuerPublicKeys = null;
  if (request.issuerPublicKeys) {
    if (product !== 'server') throw Error('Issuer public keys apply only to server bundles.');
    issuerPublicKeys = JSON.parse(await readFile(resolve(request.issuerPublicKeys), 'utf8'));
    if (!issuerPublicKeys || typeof issuerPublicKeys !== 'object' || Array.isArray(issuerPublicKeys)
      || Object.keys(issuerPublicKeys).length < 1 || Object.keys(issuerPublicKeys).length > 8) throw Error('Invalid issuer public-key catalogue.');
    for (const [id, pem] of Object.entries(issuerPublicKeys)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof pem !== 'string' || !pem.startsWith('-----BEGIN PUBLIC KEY-----')
        || createPublicKey(pem).asymmetricKeyType !== 'ed25519') throw Error('Invalid issuer public key.');
    }
    source.fingerprint = hash(source.fingerprint + '\0' + JSON.stringify(issuerPublicKeys));
  }
  const version = numericVersion(request.version || await configuredVersion(repository, revision, product), product);
  const label = labelValue(request.label || `${revision.slice(0, 12)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
  const outputRoot = outside(repository, request.outputRoot || resolve(repository, '../127Vaults-Releases'), 'OutputRoot');
  const cacheRoot = outside(repository, request.cacheRoot || resolve(homedir(), '.127vaults-release-cache'), 'CacheRoot');
  const cacheRelative = relative(cacheRoot, outputRoot);
  const outputRelative = relative(outputRoot, cacheRoot);
  const nested = rel => !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (nested(cacheRelative) || nested(outputRelative)) throw Error('CacheRoot and OutputRoot must be separate directories, neither nested inside the other.');
  return { product, platforms, revision, ref, label, packageVersion: version, inputFingerprint: source.fingerprint,
    inputEntries: source.entries, issuerPublicKeys, builderFingerprint: await builderFingerprint(), repository, outputRoot, cacheRoot,
    engine: request.engine || 'podman', force: Boolean(request.force || request.refreshImages), refreshImages: Boolean(request.refreshImages),
    compatibility: { api: 'v1', nativeMessaging: ['desktop', 'cli', 'extension'].includes(product) ? 1 : null,
      minimumServerVersion: null, status: 'informational; version compatibility policy is not yet defined' },
    outputs: platforms.map(platform => resolve(outputRoot, product, version, platform)),
    sourceMode: 'committed snapshot; current uncommitted changes are excluded', publish: false };
}
