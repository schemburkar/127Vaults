// Self-contained recipient entry point. No pnpm, Rust or source checkout needed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
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
export function parseOptions(args, { directory = import.meta.dirname } = {}) {
  const options = { engine: 'podman', json: false, args: [...args] };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--docker', '--json', '--tailscale', '--compose-provider', '--endpoint', '--private-dir'].includes(flag)) throw Error(`Unknown option: ${flag}. Use --help.`);
    if (seen.has(flag)) throw Error(`Duplicate option: ${flag}.`);
    seen.add(flag);
    if (flag === '--docker') { options.engine = 'docker'; continue; }
    if (flag === '--json') { options.json = true; continue; }
    if (flag === '--tailscale') { options.tailscale = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--') || /[\r\n\0]/.test(value)) throw Error(`${flag} requires a valid value.`);
    if (flag === '--compose-provider') options.provider = value;
    if (flag === '--endpoint') {
      options.endpoint = value;
      const octets = value.split('.');
      const ipv4 = octets.length === 4 && octets.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
      const [a, b] = octets.map(Number);
      if (value !== 'localhost' && value !== '127.0.0.1' && !(ipv4 && (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31))) && !(args.includes('--tailscale') && ipv4 && a === 100 && b >= 64 && b <= 127)) throw Error('Use loopback, a private IPv4 endpoint, or discovered Tailscale with --tailscale.');
    }
    if (flag === '--private-dir') {
      options.privateDir = resolve(directory, value);
      const rel = relative(resolve(directory), resolve(directory, value));
      if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))) throw Error('Private directory must be outside the bundle.');
    }
  }
  if (options.engine === 'docker' && options.provider) throw Error('--compose-provider is for Podman. Docker uses docker compose.');
  return options;
}

// Inspect metadata and file presence only: no key contents or .env values are
// included in the report, and a damaged installation is never reinitialized.
export async function inspectInstallation(directory, options) {
  let content;
  try { content = await readFile(resolve(directory, '.env'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { id: 'installation', status: 'pass', message: 'Fresh bundle; setup will create an installation identity.' };
    return { id: 'installation', status: 'fail', message: 'Existing installation configuration is unreadable.', nextStep: 'Check operator access to .env; preserve it and the existing identity.' };
  }
  try {
    const values = {};
    for (const key of ['VAULTS_PROJECT', 'VAULTS_TLS_DIR', 'VAULTS_ENDPOINT_HOST']) {
      const matches = [...content.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))];
      if (matches.length !== 1) throw Error('configuration');
      values[key] = matches[0][1].replace(/\r$/, '');
    }
    if (!/^vaults-test-[a-f0-9]{12}$/.test(values.VAULTS_PROJECT) || !isAbsolute(values.VAULTS_TLS_DIR)) throw Error('configuration');
    const tailscale = /^VAULTS_ACCESS_MODE=tailscale\r?$/m.test(content);
    parseOptions(['--endpoint', values.VAULTS_ENDPOINT_HOST, '--private-dir', values.VAULTS_TLS_DIR, ...(tailscale ? ['--tailscale'] : [])], { directory });
    if (options.tailscale && !tailscale) throw Error('Existing installation needs an explicit network migration.');
    if (tailscale) options.expectedTailnetAddress = values.VAULTS_ENDPOINT_HOST;
    if (tailscale && options.args && !options.args.includes('--tailscale')) options.args.push('--tailscale');
    if (options.endpoint && options.endpoint !== values.VAULTS_ENDPOINT_HOST) {
      return { id: 'installation', status: 'fail', message: 'Requested endpoint differs from the existing installation.', nextStep: 'Use the initialized endpoint. Changing it requires a reviewed certificate and network migration.' };
    }
    if (options.privateDir && options.privateDir !== resolve(values.VAULTS_TLS_DIR)) {
      return { id: 'installation', status: 'fail', message: 'Requested private directory differs from the existing installation.', nextStep: 'Use the existing private directory; do not create replacement keys for this database.' };
    }
    for (const name of ['ca/ca.crt', 'ca/ca.key', 'live/server.crt', 'live/server.key', 'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token']) {
      const info = await lstat(resolve(values.VAULTS_TLS_DIR, name));
      if (!info.isFile() || info.size === 0) throw Error('identity');
    }
    if (!options.privateDir && options.args) options.args.push('--private-dir', values.VAULTS_TLS_DIR);
    return { id: 'installation', status: 'pass', message: 'Existing installation configuration and required identity files are present; setup will preserve them.' };
  } catch {
    return { id: 'installation', status: 'fail', message: 'Existing installation configuration or required identity files are incomplete or invalid.', nextStep: 'Preserve .env and the private directory. Recover the matching identity from its backup; do not rerun initialization or delete the database volume.' };
  }
}

// Probe output may contain host configuration. Keep it internal and never include
// engine stdout/stderr in diagnostics. A hung provider must not strand doctor.
export function probe(program, args, { timeoutMs = 15000, cwd, env } = {}) {
  return new Promise(done => {
    let output = '';
    let settled = false;
    let timer;
    let timedOut = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...result, output: output.trim() });
    };
    const child = spawn(program, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-65536); });
    child.stderr.resume();
    child.on('error', error => finish({ ok: false, reason: error.code === 'ENOENT' ? 'missing' : 'launch' }));
    child.on('close', code => { if (!timedOut) finish({ ok: code === 0, reason: code === 0 ? undefined : 'exit' }); });
    timer = setTimeout(async () => {
      timedOut = true;
      // Compose wrappers start a provider process. Killing only the wrapper
      // leaves the provider (and its socket connection) running after doctor.
      if (process.platform === 'win32' && child.pid) {
        await new Promise(resolveStop => {
          const killer = spawn(resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          const deadline = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolveStop(); }, 1500);
          const stopped = () => { clearTimeout(deadline); resolveStop(); };
          killer.on('error', () => { child.kill('SIGKILL'); stopped(); });
          killer.on('close', stopped);
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });
}

async function discoverTailnet() {
  const module = existsSync(resolve(import.meta.dirname, 'lib/private-network.mjs'))
    ? new URL('./lib/private-network.mjs', import.meta.url) : new URL('./private-network.mjs', import.meta.url);
  return (await import(module)).discoverTailscale();
}

export async function diagnose(args, { directory = import.meta.dirname, platform = process.platform, nodeVersion = process.versions.node, runProbe = probe, verifyBundle = verify, inspectState = inspectInstallation, discoverTailscale = discoverTailnet } = {}) {
  const options = parseOptions(args, { directory });
  const checks = [];
  const add = (id, status, message, nextStep) => checks.push({ id, status, message, ...(nextStep ? { nextStep } : {}) });
  try {
    await verifyBundle(directory);
    add('bundle', 'pass', 'All manifest checksums match.');
  } catch {
    add('bundle', 'fail', 'Bundle is incomplete, unreadable, or does not match its manifest.', 'Obtain a fresh complete bundle through the trusted operator channel; do not edit the manifest to bypass verification.');
  }
  const nodeOk = Number(nodeVersion.split('.')[0]) === 24;
  add('node', nodeOk ? 'pass' : 'fail', `Node.js ${nodeVersion}${nodeOk ? ' is supported.' : ' is unsupported.'}`, nodeOk ? undefined : 'Install Node.js 24 from https://nodejs.org/en/download and rerun doctor.');
  if (inspectState) checks.push(await inspectState(directory, options));
  if (options.args.includes('--tailscale')) {
    try {
      const address = await discoverTailscale();
      const expected = options.endpoint || options.expectedTailnetAddress;
      if (expected && expected !== address) throw Error('Tailscale identity mismatch');
      add('tailscale', 'pass', 'The native Tailscale client is online with the expected server identity.');
    } catch {
      add('tailscale', 'fail', 'Tailscale is unavailable, signed out, or does not match the configured endpoint.',
        'Install/sign in to Tailscale, verify this node address, and rerun doctor. Existing installation identity and network configuration are preserved.');
    }
  }
  const engine = options.engine;
  const version = await runProbe(engine, ['--version'], { cwd: directory });
  add('engine', version.ok ? 'pass' : 'fail', version.ok ? `${engine} executable is available.` : `${engine} executable check failed (${version.reason}).`, version.ok ? undefined : `Install ${engine} and make its executable available on PATH; rerun doctor.`);
  if (version.ok) {
    const info = await runProbe(engine, ['info'], { cwd: directory });
    add('connection', info.ok ? 'pass' : 'fail', info.ok ? `${engine} engine is reachable.` : `${engine} engine connection failed (${info.reason}).`, info.ok ? undefined : engine === 'podman' && platform === 'win32' ? 'Start the intended Podman machine with podman machine start; check podman system connection list and rerun doctor.' : engine === 'docker' ? 'Start Docker Desktop or the Docker daemon and verify this operator can run docker info.' : 'Verify this operator can run podman info; check the rootless runtime and configured connection.');
  } else add('connection', 'skip', 'Engine connection requires an available executable.');
  if (!checks.some(check => check.id === 'compose')) {
    if (options.provider || version.ok) {
      const env = options.provider ? { ...process.env, PODMAN_COMPOSE_PROVIDER: options.provider } : undefined;
      let compose = await runProbe(engine, ['compose', 'version'], { cwd: directory, env });
      if (compose.ok) compose = await runProbe(engine, ['compose', 'ls', '--format', 'json'], { cwd: directory, env });
      if (compose.ok) {
        const help = await runProbe(engine, ['compose', 'up', '--help'], { cwd: directory, env });
        compose = help.ok && help.output?.includes('--no-build') ? help : { ok: false, reason: 'unsupported Compose up command' };
      }
      add('compose', compose.ok ? 'pass' : 'fail', compose.ok ? 'Compose provider can reach the selected engine.' : `Compose provider or engine connection check failed (${compose.reason}).`, compose.ok ? undefined : engine === 'docker' ? 'Install the Docker Compose plugin and verify docker compose ls --format json.' : 'Set up native Compose in Podman Desktop and verify podman compose ls --format json; use --compose-provider <full executable path> to select its native Compose binary. Python is not required.' + (platform === 'win32' ? ' If podman info works but Compose hangs, inspect podman machine inspect and select that machine\'s PodmanPipe with a session-local DOCKER_HOST; do not select an unrelated Docker or Podman machine.' : ''));
    } else add('compose', 'skip', 'Compose discovery requires an available engine executable.');
  }
  return { format: 1, ready: checks.every(check => check.status === 'pass'), engine, checks, args: options.args };
}

export function renderDiagnosis(report) {
  return report.checks.map(check => `${check.status.toUpperCase()} ${check.id}: ${check.message}${check.nextStep ? `\n  Next: ${check.nextStep}` : ''}`).join('\n') +
    `\n${report.ready ? 'Prerequisites are ready. CA trust, firewall, backups and target-host acceptance still require operator verification.' : 'Prerequisites are not ready. Resolve failed checks and rerun doctor; no installation changes were made.'}`;
}

export async function prerequisites(args, dependencies) {
  const report = await diagnose(args, dependencies);
  if (!report.ready) throw Error(renderDiagnosis(report));
  return report.args;
}

async function run(program, args, cwd) {
  const child = spawn(program, args, { cwd, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (code !== 0) throw Error('Operator command failed; inspect the diagnostic above. Installation data was preserved.');
}

export async function main(args, dependencies = {}) {
  const directory = dependencies.directory ?? import.meta.dirname;
  const log = dependencies.log ?? console.log;
  const [action = 'help', ...options] = args;
  if (action === 'help' || action === '--help') {
    log('127Vaults private test server\nUse: install.ps1 / bash install.sh <command> [options]\nCommands: verify, doctor, setup, start, status, bootstrap, stop, upgrade\nOptions: --docker, --compose-provider <path>, --endpoint <private IPv4>, --private-dir <path>, --tailscale\nupgrade requires --from <old bundle>, --backup-dir <new backup directory>, --backup-key-file <key path>.\ndoctor --json emits a redacted prerequisite report. Each external probe has a 15-second deadline.\nsetup creates a fresh identity, loads images and starts the server. Existing .env is preserved.');
    return 0;
  }
  if (action === 'upgrade') {
    const values = {}, rest = [];
    for (let i = 0; i < options.length; i++) {
      if (['--from', '--backup-dir', '--backup-key-file'].includes(options[i])) {
        const flag = options[i], value = options[++i];
        if (values[flag] || !value || value.startsWith('--')) throw Error('Upgrade requires unique --from, --backup-dir and --backup-key-file paths.');
        values[flag] = value;
      } else rest.push(options[i]);
    }
    if (!values['--from'] || !values['--backup-dir'] || !values['--backup-key-file']) throw Error('Upgrade requires --from, --backup-dir and --backup-key-file.');
    if (rest.some(flag => ['--endpoint', '--private-dir', '--tailscale', '--json'].includes(flag))) throw Error('Upgrade preserves the existing network and identity. Configure network changes separately after verification.');
    parseOptions(rest, {directory});
    await prerequisites(rest, {...dependencies, directory, inspectState: null});
    const module = existsSync(resolve(directory, 'lib/upgrade.mjs')) ? new URL('./lib/upgrade.mjs', import.meta.url) : new URL('./upgrade.mjs', import.meta.url);
    const {upgradeInstallation} = await import(module);
    await upgradeInstallation({directory,from:values['--from'],backupDirectory:values['--backup-dir'],keyFile:values['--backup-key-file'],options:rest,verify,inspect:inspectInstallation});
    log('Upgrade verified. Existing identity, users, license and database volume preserved. Verify an authenticated client sync before removing the prior bundle.');
    return 0;
  }
  if (!['verify', 'doctor', 'setup', 'start', 'status', 'bootstrap', 'stop'].includes(action)) throw Error('Unknown command. Use --help.');
  const parsed = parseOptions(options, { directory });
  if (parsed.json && action !== 'doctor') throw Error('--json is supported only for doctor.');
  if (action === 'doctor') {
    const report = await diagnose(options, { ...dependencies, directory });
    const { args: _args, ...publicReport } = report;
    log(parsed.json ? JSON.stringify(publicReport, null, 2) : renderDiagnosis(report));
    return report.ready ? 0 : 1;
  }
  if (action === 'verify') {
    await (dependencies.verifyBundle ?? verify)(directory);
    log('Bundle checksums verified.');
    return 0;
  }
  const resolvedOptions = await prerequisites(options, { ...dependencies, directory,
    ...(!['setup', 'start'].includes(action) ? { inspectState: null } : {}) });
  log('Bundle checksums and prerequisites verified.');
  const operator = command => (dependencies.runOperator ?? run)(process.execPath, ['server.mjs', 'install', command, ...resolvedOptions], directory);
  if (action === 'setup') {
    if (!existsSync(resolve(directory, '.env'))) await operator('init');
    await operator('start');
    await operator('status');
    log('Trust the generated CA certificate after confirming its fingerprint. Use install bootstrap for the first-owner code.');
  } else await operator(action);
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(`Installer: ${error.message}`); process.exitCode = 1; });
}
