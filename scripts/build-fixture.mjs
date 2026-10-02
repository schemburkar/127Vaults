import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const suffix = process.platform === 'win32' ? '.exe' : '';
const cargo = join(homedir(), '.cargo', 'bin', `cargo${suffix}`);
const generator = join(root, '.tools', 'wasm-bindgen', 'bin', `wasm-bindgen${suffix}`);
async function run(executable, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new Error('Build tool could not start. Check the Rust/wasm-bindgen installation.')));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`Build command failed (${code}).`)));
  });
}
try {
  try { await access(generator); } catch {
    throw new Error('Install the pinned generator first: cargo install wasm-bindgen-cli --version 0.2.126 --locked --root .tools/wasm-bindgen');
  }
  if (await run(generator, ['--version'], true) !== 'wasm-bindgen 0.2.126') throw new Error('Expected wasm-bindgen 0.2.126. Reinstall the pinned generator.');
  let compiler = cargo;
  try { await access(compiler); } catch { compiler = 'cargo'; }
  await run(compiler, ['build', '--locked', '-p', 'vaults-browser-fixture', '--target', 'wasm32-unknown-unknown', '--release']);
  await run(generator, ['--target', 'web', '--out-dir', 'apps/web/wasm', 'target/wasm32-unknown-unknown/release/vaults_browser_fixture.wasm']);
  console.log('Built Rust WASM fixture and disposable ECF1 bindings. Stable cryptographic formats remain disabled.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
