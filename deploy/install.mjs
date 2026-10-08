// Self-contained recipient entry point. No pnpm, Rust or source checkout needed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verify(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') throw Error('Invalid bundle manifest.');
  const required = ['server-image.tar', 'postgres-image.tar', 'openssl-image.tar', 'server.mjs', 'lib/test-install.mjs', 'compose.test.yaml', 'install.mjs', 'install.ps1', 'install.sh'];
  for (const name of required) if (!Object.hasOwn(manifest.files, name)) throw Error(`Missing required manifest entry: ${name}`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^(?:lib\/)?[A-Za-z0-9.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid bundle manifest entry.');
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(resolve(directory, name))) digest.update(bytes);
    if (digest.digest('hex') !== expected) throw Error(`Bundle checksum mismatch: ${name}`);
  }
}
function run(program, args, capture = false) {
  const result = spawnSync(program, args, { windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error(`${program} is unavailable or failed. Install prerequisites; see README.md.`);
  return result.stdout?.trim();
}
export function prerequisites(args) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node.js 24 is required: https://nodejs.org/en/download');
  const engine = args.includes('--docker') ? 'docker' : 'podman';
  run(engine, ['info'], true);
  const providerIndex = args.indexOf('--compose-provider');
  if (providerIndex >= 0 && !args[providerIndex + 1]) throw Error('--compose-provider requires a path.');
  if (engine === 'podman' && providerIndex < 0 && process.platform === 'win32') {
    const candidates = run('where.exe', ['podman-compose'], true).split(/\r?\n/);
    const provider = candidates.find(path => path.endsWith('.exe'));
    if (!provider) throw Error('Install podman-compose and pass --compose-provider <full executable path>.');
    args.push('--compose-provider', provider);
  }
  const provider = args[args.indexOf('--compose-provider') + 1];
  if (args.includes('--compose-provider')) run(provider, ['--version'], true);
  else run(engine, ['compose', 'version'], true);
  return args;
}
export async function main(args) {
  process.chdir(import.meta.dirname);
  const [action = 'help', ...options] = args;
  if (action === 'help' || action === '--help') {
    console.log('127Vaults private test server\nUse: install.ps1 / bash install.sh <command> [options]\nCommands: verify, doctor, setup, start, status, bootstrap, stop\nOptions: --docker, --compose-provider <path>, --endpoint <private IPv4>, --private-dir <path>\nsetup creates a fresh identity, loads images and starts the server. Existing .env is preserved.');
    return;
  }
  if (!['verify', 'doctor', 'setup', 'start', 'status', 'bootstrap', 'stop'].includes(action)) throw Error('Unknown command. Use --help.');
  await verify(import.meta.dirname);
  console.log('Bundle checksums verified.');
  if (action === 'verify') return;
  prerequisites(options);
  if (action === 'doctor') { console.log('Node 24, container engine and Compose are ready.'); return; }
  const operator = command => run(process.execPath, ['server.mjs', 'install', command, ...options]);
  if (action === 'setup') {
    if (!existsSync('.env')) operator('init');
    operator('start');
    operator('status');
    console.log('Trust the generated CA certificate after confirming its fingerprint. Use install bootstrap for the first-owner code.');
  } else operator(action);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`Installer: ${error.message}`); process.exitCode = 1; });
}
