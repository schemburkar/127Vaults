import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A local CLI gate, shared by Windows and Linux. No server, profile or keyring
// is required by default. --os-store tests disposable real OS credentials. Installers and public releases still use release-set.ps1.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const osStore = args.includes('--os-store');
if (osStore) args.splice(args.indexOf('--os-store'), 1);
if (args.length && (args.length !== 2 || args[0] !== '--receipt')) {
  throw Error('Usage: node scripts/check-cli.mjs [--os-store] [--receipt PATH]');
}
const checks = [];
function run(command, commandArgs, expected = 0, contains = []) {
  const start = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.status !== expected || contains.some(text => !output.includes(text))) {
    throw Error(`CLI check failed: ${command} ${commandArgs.join(' ')}`);
  }
  checks.push({ command: [command, ...commandArgs], exitCode: result.status, durationMs: Date.now() - start,
    outputSha256: createHash('sha256').update(output).digest('hex') });
  return output;
}
const revision = run('git', ['rev-parse', 'HEAD']).trim();
run('cargo', ['fmt', '--check']);
run('cargo', ['clippy', '--locked', '-p', 'vaults-cli', '--all-targets', '--', '-D', 'warnings']);
const testOutput = run('cargo', ['test', '--locked', '-p', 'vaults-cli', '--', '--show-output']);
run('cargo', ['test', '--locked', '-p', 'vaults-crypto', 'credential_rotation']);
if (osStore) run('cargo', ['test', '--locked', '-p', 'vaults-cli', '--lib', 'os_store_', '--', '--ignored']);
run('cargo', ['build', '--locked', '-p', 'vaults-cli', '--bin', '127vaults']);
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const binary = join(target, 'debug', process.platform === 'win32' ? '127vaults.exe' : '127vaults');
run(binary, ['login', '--help'], 0, ['--remember-secret', '--no-remembered-secret']);
run(binary, ['account-secret', '--help'], 0, ['status', 'forget']);
run(binary, ['credential', '--help'], 0, ['rotate-password', 'rotate-account-secret', 'resume', 'abort', 'recover-device']);
run(binary, ['vault', 'list', '--help'], 0, ['--format', '--width', 'json', 'table']);
run(binary, ['item', 'list', '--help'], 0, ['--search', '--favorites', '--type', '--all', '--format']);
run(binary, ['item', 'list', '--format', 'json', '--width', '40'], 2, ['--width requires --format table']);
run(binary, ['item', 'list', '--format', 'table', '--width', '23'], 2, ['invalid value']);
const files = ['Cargo.lock', 'apps/cli/Cargo.toml', 'apps/cli/src/lib.rs', 'apps/cli/src/client.rs',
  'apps/cli/src/client/transport.rs', 'apps/cli/src/client/removal.rs', 'apps/cli/src/client/credential_rotation.rs',
  'apps/cli/src/agent.rs', 'apps/cli/src/main.rs', 'apps/cli/src/credentials.rs', 'apps/cli/src/remembered_secret.rs',
  'apps/cli/src/sync_transport.rs', 'crates/crypto/src/ecf1.rs', 'scripts/cli-credential-wire-check.mjs',
  'apps/cli/src/list_output.rs', 'apps/cli/src/device_transport_tests.rs', 'scripts/check-cli.mjs'];
const receipt = { version: 1, checkedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
  sourceBaseRevision: revision, sourceFiles: Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])), checks, passed: true };
if (args.length) {
  const destination = resolve(args[1]);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
  const preview = testOutput.match(/CLI_PREVIEW_BEGIN\r?\n([\s\S]*?)\r?\nCLI_PREVIEW_END/);
  if (!preview) throw Error('CLI preview was missing from test output');
  writeFileSync(`${destination}.preview.txt`, `${preview[1]}\n`);
  console.log(`CLI verification receipt: ${destination}`);
}
console.log('CLI checks passed.');
