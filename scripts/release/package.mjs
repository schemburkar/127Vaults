// Native private-test packaging. Run once on each target OS; no registry or GitHub required.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
export const version = '0.1.0';
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
export async function packageExtension(output) {
  const directory = join(output, '127vaults-extension');
  await mkdir(directory);
  for (const name of ['manifest.json', 'popup.html', 'src']) {
    await cp(join(root, 'apps/extension', name), join(directory, name), { recursive: true });
  }
  await copyFile(join(root, 'docs/release/extension-install.md'), join(directory, 'README.md'));
  await archive(directory, join(output, `127vaults-extension-${version}.zip`), true);
}
async function packageDesktop(output) {
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw Error('Build desktop natively on Windows/Linux x64.');
  const windows = process.platform === 'win32';
  const suffix = windows ? '.exe' : '';
  const triple = await run('rustc', ['--print', 'host-tuple'], { capture: true });
  await run('cargo', ['build', '--release', '--locked', '-p', 'vaults-cli', '--bin', '127vaults', '--bin', '127vaults-extension-host']);
  const binaries = join(root, 'apps/desktop/src-tauri/binaries');
  await mkdir(binaries, { recursive: true });
  for (const name of ['127vaults', '127vaults-extension-host']) {
    await copyFile(join(root, 'target/release', name + suffix), join(binaries, `${name}-${triple}${suffix}`));
    if (!windows) await chmod(join(binaries, `${name}-${triple}${suffix}`), 0o755);
  }
  const config = join(output, 'tauri-package-config.json');
  await writeFile(config, JSON.stringify({ version, bundle: { active: true,
    targets: windows ? ['nsis'] : ['deb', 'appimage'],
    externalBin: ['binaries/127vaults', 'binaries/127vaults-extension-host'],
    resources: { '../../../apps/extension/install-native-host.ps1': 'install-native-host.ps1',
      '../../../apps/extension/install-native-host.sh': 'install-native-host.sh' },
    ...(windows ? { windows: { nsis: { installMode: 'currentUser' }, webviewInstallMode: { type: 'downloadBootstrapper', silent: true } } } : {})
  } }, null, 2));
  // Invoke the actual JS CLI, avoiding Windows .cmd shell interpolation of user paths.
  await run(process.execPath, [join(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', config, '--', '--locked'],
    { cwd: join(root, 'apps/desktop'), env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' } });
  const platform = windows ? 'windows-x64' : 'linux-x64';
  const portable = join(output, `127vaults-clients-${version}-${platform}`);
  await mkdir(portable);
  for (const name of ['vaults-desktop-poc', '127vaults', '127vaults-extension-host']) {
    await copyFile(join(root, 'target/release', name + suffix), join(portable, name + suffix));
    if (!windows) await chmod(join(portable, name + suffix), 0o755);
  }
  for (const name of ['install-native-host.ps1', 'install-native-host.sh']) await copyFile(join(root, 'apps/extension', name), join(portable, name));
  await copyFile(join(root, 'docs/release/client-install.md'), join(portable, 'README.md'));
  await copyFile(join(root, 'LICENSE-POLICY.md'), join(portable, 'LICENSE-POLICY.md'));
  await archive(portable, `${portable}.${windows ? 'zip' : 'tar.gz'}`, windows);
  for (const target of windows ? ['nsis'] : ['deb', 'appimage']) {
    const directory = join(root, 'target/release/bundle', target);
    const extension = { nsis: '.exe', msi: '.msi', deb: '.deb', appimage: '.AppImage' }[target];
    const candidates = (await readdir(directory)).filter(name => name.endsWith(extension) && name.includes(version));
    if (candidates.length !== 1) throw Error(`Expected one ${target} installer for ${version}, found ${candidates.length}.`);
    await copyFile(join(directory, candidates[0]), join(output, `127vaults-desktop-${version}-${platform}${extension}`));
  }
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
  await copyFile(join(root, 'LICENSE-POLICY.md'), join(output, 'LICENSE-POLICY.md'));
  await copyFile(join(root, 'scripts/release/verify.mjs'), join(output, 'verify.mjs'));
  await writeManifest(output, components);
  console.log(`Private test packages and SHA256SUMS: ${output}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
