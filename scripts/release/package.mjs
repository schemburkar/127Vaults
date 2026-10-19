// Native private-test packaging. Run once on each target OS; no registry or GitHub required.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
export const version = '0.1.0';
export const licenseFiles = ['LICENSE.md', 'COMMERCIAL-LICENSE.md'];
export async function copyLicenses(source, destination) {
  for (const name of licenseFiles) await copyFile(join(source, name), join(destination, name));
}
export function macSigningReady(env = process.env) {
  return Boolean(env.APPLE_SIGNING_IDENTITY && env.APPLE_SIGNING_IDENTITY !== '-' &&
    ((env.APPLE_ID && env.APPLE_PASSWORD && env.APPLE_TEAM_ID) || (env.APPLE_API_ISSUER && env.APPLE_API_KEY && env.APPLE_API_KEY_PATH)));
}
export async function run(program, args, options = {}) {
  console.log(`> ${program} ${args.join(' ')}`);
  const child = spawn(program, args, { cwd: root, windowsHide: true,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', ...options });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (code !== 0) throw Error(`${program} failed (${code}). No successful release manifest was written.`);
  return output.trim();
}
export async function sha256(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
export function outputDirectory(value) {
  if (!value) throw Error('Supply --out <new directory outside the checkout>.');
  const output = resolve(value);
  const rel = relative(root, output);
  if (!rel || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))) {
    throw Error('Output must be outside the checkout.');
  }
  return output;
}
export async function archive(directory, filename, zip = false) {
  if (zip && process.platform === 'win32') {
    // bsdtar on Windows supports ZIP; filenames are passed directly, never through a shell.
    await run('tar', ['-a', '-cf', filename, '-C', dirname(directory), directory.split(/[\\/]/).at(-1)]);
  } else if (zip) {
    await run('zip', ['-qr', filename, directory.split('/').at(-1)], { cwd: dirname(directory) });
  } else {
    await run('tar', ['-czf', filename, '-C', dirname(directory), directory.split(/[\\/]/).at(-1)]);
  }
}
export async function packageExtension(output, options = {}) {
  const sourceRoot = options.root ?? root;
  const packageVersion = options.version ?? version;
  const directory = join(output, '127vaults-extension');
  await mkdir(directory);
  for (const name of ['manifest.json', 'popup.html', 'src']) {
    await cp(join(sourceRoot, 'apps/extension', name), join(directory, name), { recursive: true,
      filter: path => !/\.d\.(?:ts|mts)$/.test(path) });
  }
  if (options.version) {
    const manifestPath = join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = packageVersion;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  await copyFile(join(sourceRoot, 'docs/release/extension-install.md'), join(directory, 'README.md'));
  await copyLicenses(sourceRoot, directory);
  await archive(directory, join(output, `127vaults-extension-${packageVersion}.zip`), true);
}
export async function packageDesktop(output, options = {}) {
  const sourceRoot = options.root ?? root;
  const packageVersion = options.version ?? version;
  const buildEnvironment = { ...process.env, ...(options.version ? { VAULTS_PACKAGE_VERSION: options.version } : {}) };
  const execute = (program, args, settings = {}) => run(program, args, { cwd: sourceRoot, env: buildEnvironment, ...settings });
  const mac = process.platform === 'darwin';
  if (!['win32', 'linux', 'darwin'].includes(process.platform) || (!mac && process.arch !== 'x64') || !['x64', 'arm64'].includes(process.arch)) throw Error('Build desktop natively on Windows/Linux x64 or a Mac with Intel/Apple Silicon.');
  if (mac && !macSigningReady()) throw Error('Mac distribution requires a Developer ID signing identity and Apple notarization credentials. Compile checks can run without publishing packages.');
  const windows = process.platform === 'win32';
  const suffix = windows ? '.exe' : '';
  const triple = await execute('rustc', ['--print', 'host-tuple'], { capture: true });
  await execute('cargo', ['build', '--release', '--locked', '-p', 'vaults-cli', '--bin', '127vaults', '--bin', '127vaults-extension-host']);
  const binaries = join(sourceRoot, 'apps/desktop/src-tauri/binaries');
  await mkdir(binaries, { recursive: true });
  for (const name of ['127vaults', '127vaults-extension-host']) {
    await copyFile(join(sourceRoot, 'target/release', name + suffix), join(binaries, `${name}-${triple}${suffix}`));
    if (!windows) await chmod(join(binaries, `${name}-${triple}${suffix}`), 0o755);
  }
  const config = join(output, 'tauri-package-config.json');
  await writeFile(config, JSON.stringify({ version: packageVersion, bundle: { active: true,
    targets: windows ? ['nsis'] : mac ? ['dmg'] : ['deb', 'appimage'],
    ...(mac ? { macOS: { minimumSystemVersion: '13.0', hardenedRuntime: true } } : {}),
    externalBin: ['binaries/127vaults', 'binaries/127vaults-extension-host'],
    resources: { ...Object.fromEntries(licenseFiles.map(name => [`../../../${name}`, name])), ...(options.minimal ? { [`../../../apps/extension/install-native-host.${windows ? 'ps1' : 'sh'}`]: `install-native-host.${windows ? 'ps1' : 'sh'}` }
      : { '../../../apps/extension/install-native-host.ps1': 'install-native-host.ps1', '../../../apps/extension/install-native-host.sh': 'install-native-host.sh' }) },
    ...(windows ? { windows: { nsis: { installMode: 'currentUser', installerHooks: join(sourceRoot, 'apps/desktop/src-tauri/installer-hooks.nsh') }, webviewInstallMode: { type: 'downloadBootstrapper', silent: true } } } : {})
  } }, null, 2));
  // Invoke the actual JS CLI, avoiding Windows .cmd shell interpolation of user paths.
  await execute(process.execPath, [join(sourceRoot, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', config, '--', '--locked'],
    { cwd: join(sourceRoot, 'apps/desktop'), env: { ...buildEnvironment, APPIMAGE_EXTRACT_AND_RUN: '1' } });
  const platform = windows ? 'windows-x64' : mac ? `macos-${process.arch}` : 'linux-x64';
  if (!options.minimal && !mac) {
  const portable = join(output, `127vaults-clients-${packageVersion}-${platform}`);
  await mkdir(portable);
  for (const name of ['vaults-desktop-poc', '127vaults', '127vaults-extension-host']) {
    await copyFile(join(sourceRoot, 'target/release', name + suffix), join(portable, name + suffix));
    if (!windows) await chmod(join(portable, name + suffix), 0o755);
  }
  for (const name of ['install-native-host.ps1', 'install-native-host.sh']) await copyFile(join(sourceRoot, 'apps/extension', name), join(portable, name));
  await copyFile(join(sourceRoot, 'docs/release/client-install.md'), join(portable, 'README.md'));
  await copyLicenses(sourceRoot, portable);
  await archive(portable, `${portable}.${windows ? 'zip' : 'tar.gz'}`, windows);
  }
  for (const target of windows ? ['nsis'] : mac ? ['dmg'] : ['deb', 'appimage']) {
    const directory = join(sourceRoot, 'target/release/bundle', target);
    const extension = { nsis: '.exe', msi: '.msi', deb: '.deb', appimage: '.AppImage', dmg: '.dmg' }[target];
    const candidates = (await readdir(directory)).filter(name => name.endsWith(extension) && name.includes(`_${packageVersion}_`));
    if (candidates.length !== 1) throw Error(`Expected one ${target} installer for ${packageVersion}, found ${candidates.length}.`);
    await copyFile(join(directory, candidates[0]), join(output, `127vaults-desktop-${packageVersion}-${platform}${extension}`));
  }
}
export async function packageInstaller(output, options = {}) {
  const sourceRoot = options.root ?? root;
  const configured = /^version\s*=\s*"([^"]+)"/m.exec(await readFile(join(sourceRoot, 'apps/installer/Cargo.toml'), 'utf8'))?.[1];
  const packageVersion = options.version ?? configured;
  if (!configured || packageVersion !== configured) throw Error('Installer package version must match its Cargo version.');
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw Error('Installer packages require Windows/Linux x64.');
  await run('cargo', ['build', '--release', '--locked', '-p', 'vaults-installer'], { cwd: sourceRoot });
  const filename = `127vaults-install${process.platform === 'win32' ? '.exe' : ''}`;
  // Linux has no filename suffix; wrap both platforms uniformly for catalogue delivery.
  const directory = join(output, `127vaults-installer-${packageVersion}-${process.platform === 'win32' ? 'windows' : 'linux'}-x64`);
  await mkdir(directory);
  await copyFile(join(sourceRoot, 'target/release', filename), join(directory, filename));
  if (process.platform !== 'win32') await chmod(join(directory, filename), 0o755);
  await copyFile(join(sourceRoot, 'docs/release/installer.md'), join(directory, 'README.md'));
  await copyLicenses(sourceRoot, directory);
  await archive(directory, `${directory}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`, process.platform === 'win32');
}

export async function packageCli(output, options = {}) {
  const sourceRoot = options.root ?? root;
  const packageVersion = options.version ?? version;
  const windows = process.platform === 'win32';
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw Error('CLI packages require Windows/Linux x64.');
  await run('cargo', ['build', '--release', '--locked', '-p', 'vaults-cli', '--bin', '127vaults', '--bin', '127vaults-extension-host'],
    { cwd: sourceRoot, env: { ...process.env, ...(options.version ? { VAULTS_PACKAGE_VERSION: options.version } : {}) } });
  const directory = join(output, `127vaults-cli-${packageVersion}-${windows ? 'windows' : 'linux'}-x64`);
  await mkdir(directory);
  for (const name of ['127vaults', '127vaults-extension-host']) {
    const filename = name + (windows ? '.exe' : '');
    await copyFile(join(sourceRoot, 'target/release', filename), join(directory, filename));
    if (!windows) await chmod(join(directory, filename), 0o755);
  }
  const registration = `install-native-host.${windows ? 'ps1' : 'sh'}`;
  await copyFile(join(sourceRoot, 'apps/extension', registration), join(directory, registration));
  await copyFile(join(sourceRoot, 'docs/release/cli-install.md'), join(directory, 'README.md'));
  await copyLicenses(sourceRoot, directory);
  await archive(directory, `${directory}.${windows ? 'zip' : 'tar.gz'}`, windows);
}
export async function writeManifest(output, components) {
  const files = [];
  for (const name of (await readdir(output)).sort()) {
    const path = join(output, name);
    if (!(await stat(path)).isFile() || ['manifest.json', 'SHA256SUMS', 'tauri-package-config.json'].includes(name)) continue;
    files.push({ name, sizeBytes: (await stat(path)).size, sha256: await sha256(path) });
  }
  const revision = await run('git', ['rev-parse', 'HEAD'], { capture: true });
  const dirty = await run('git', ['status', '--porcelain'], { capture: true });
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, version,
    channel: 'private-test', signed: false, createdAt: new Date().toISOString(), revision,
    sourceDirty: Boolean(dirty), platform: `${process.platform}-${process.arch}`, components, files }, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(output, 'SHA256SUMS'), files.map(file => `${file.sha256}  ${file.name}\n`).join(''), { flag: 'wx' });
}
export async function main(args) {
  if (args.includes('--help')) {
    console.log('node scripts/release/package.mjs --out <new external directory> [--components server,desktop,extension] [--docker]\nRun desktop builds on each native OS. Default: all components.');
    return;
  }
  const value = flag => args[args.indexOf(flag) + 1];
  const output = outputDirectory(args.includes('--out') ? value('--out') : null);
  const components = (args.includes('--components') ? value('--components') : 'server,desktop,extension').split(',');
  if (components.some(name => !['server', 'desktop', 'extension'].includes(name)) || new Set(components).size !== components.length) throw Error('Invalid components.');
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  if (components.includes('desktop')) await packageDesktop(output);
  if (components.includes('extension')) await packageExtension(output);
  if (components.includes('server')) {
    await run(process.execPath, ['server.mjs', 'bundle', join(output, `127vaults-server-${version}-linux-amd64`), ...(args.includes('--docker') ? ['--docker'] : [])]);
  }
  await copyFile(join(root, 'docs/release/local-packaging.md'), join(output, 'README.md'));
  await copyLicenses(root, output);
  await copyFile(join(root, 'scripts/release/verify.mjs'), join(output, 'verify.mjs'));
  await writeManifest(output, components);
  console.log(`Private test packages and SHA256SUMS: ${output}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
