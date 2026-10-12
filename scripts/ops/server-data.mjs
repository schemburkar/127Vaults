// Operator backup and isolated restore rehearsal. No shell interpolation and no
// mutation of the source database. All plaintext temporary files stay in a
// newly created private directory and are removed in finally.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const operator = resolve(process.cwd(), 'server.mjs');
export const supportedBackupSchema = value => /^[1-7]$/.test(String(value));
export async function runServerData(argv) {
const args = [...argv];
const action = args.shift();
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || !args[i + 1] || options[args[i]]) throw Error('Invalid arguments.');
  options[args[i]] = args[i + 1];
}
if (!['keygen', 'backup', 'rehearse'].includes(action)) throw Error('Use keygen, backup or rehearse.');
const engine = options['--engine'] ?? 'podman';
if (!['podman', 'docker'].includes(engine)) throw Error('Engine must be podman or docker.');
if (action === 'keygen') {
  if (!options['--output']) throw Error('Keygen requires --output.');
  await writeFile(options['--output'], randomBytes(32), { flag: 'wx', mode: 0o600 });
  console.log('Created a 32-byte backup key. Protect and copy it separately from the backup.');
  return;
}
if (!options['--key-file']) throw Error('--key-file is required.');
if (action === 'backup' && (!options['--container'] || !options['--output'])) throw Error('Backup requires --container and --output.');
if (action === 'rehearse' && !options['--input']) throw Error('Rehearsal requires --input.');

async function run(program, argv, { output, input, timeout = 120000 } = {}) {
  const child = spawn(program, argv, { stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill(), timeout);
  if (input) input.pipe(child.stdin);
  if (output) child.stdout.pipe(output, { end: false });
  else child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  clearTimeout(timer);
  if (output) await new Promise((done, reject) => { output.end(); output.once('finish', done); output.once('error', reject); });
  if (code !== 0) throw Error(`${program} operation failed (${code}); check the container and operator logs. ${stderr.includes('permission denied') ? 'Permission denied.' : ''}`);
  return stdout.trim();
}
async function cleanTemporary(directory) {
  const parent = resolve(tmpdir()) + sep;
  const target = resolve(directory);
  if (!target.startsWith(parent) || !target.split(sep).at(-1).startsWith('127vaults-ops-')) throw Error('Unsafe temporary cleanup path.');
  await rm(target, { recursive: true, force: true });
}
const temporary = await mkdtemp(join(tmpdir(), '127vaults-ops-'));
await chmod(temporary, 0o700).catch(() => {});
let rehearsalContainer;
try {
  const dump = join(temporary, 'database.dump');
  if (action === 'backup') {
    if (existsSync(options['--output'])) throw Error('Backup output already exists.');
    const source = options['--container'];
    const installation = await run(engine, ['exec', source, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', 'SELECT id FROM vaults.installation WHERE singleton=true']);
    const schema = await run(engine, ['exec', source, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', 'SELECT version FROM vaults.schema_version WHERE singleton=true']);
    if (!/^[0-9a-f-]{36}$/.test(installation) || !supportedBackupSchema(schema)) throw Error('Source installation or schema is not a supported database.');
    await run(engine, ['exec', source, 'pg_dump', '-U', 'vaults', '-d', 'vaults_experimental', '--format=custom', '--no-owner', '--no-acl'], { output: createWriteStream(dump, { flags: 'wx', mode: 0o600 }), timeout: 600000 });
    await run(process.execPath, [operator, 'envelope', 'seal', '--input', dump, '--output', options['--output'], '--key-file', options['--key-file'], '--database', 'vaults_experimental', '--server-id', installation, '--required-version', `schema-${schema}`]);
    await run(process.execPath, [operator, 'envelope', 'verify', '--input', options['--output'], '--key-file', options['--key-file']]);
    console.log('Encrypted backup created and authenticated. Rehearse restoration before relying on it.');
  } else {
    const metadata = JSON.parse(await run(process.execPath, [operator, 'envelope', 'open', '--input', options['--input'], '--output', dump, '--key-file', options['--key-file']]));
    if (metadata.database !== 'vaults_experimental' || !/^schema-[1-7]$/.test(metadata.requiredVersion) || !/^[0-9a-f-]{36}$/.test(metadata.serverId)) throw Error('Backup identity or schema is not supported for rehearsal.');
    const name = `127vaults-rehearse-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(32).toString('hex');
    rehearsalContainer = name;
    await run(engine, ['run', '-d', '--name', name, '--network', 'none', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=vaults_experimental', 'postgres:17-bookworm'], { timeout: 120000 });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { await run(engine, ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'vaults_experimental'], { timeout: 5000 }); ready = true; break; }
      catch { await new Promise(done => setTimeout(done, 1000)); }
    }
    if (!ready) throw Error('Isolated PostgreSQL did not become ready.');
    const empty = await run(engine, ['exec', name, 'psql', '-U', 'postgres', '-d', 'vaults_experimental', '-At', '-c', "SELECT to_regclass('vaults.schema_version') IS NULL"]);
    if (empty !== 't') throw Error('Restore target is not empty.');
    await run(engine, ['cp', dump, `${name}:/tmp/database.dump`]);
    await run(engine, ['exec', name, 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-U', 'postgres', '-d', 'vaults_experimental', '/tmp/database.dump'], { timeout: 600000 });
    const state = await run(engine, ['exec', name, 'psql', '-U', 'postgres', '-d', 'vaults_experimental', '-At', '-c', "SELECT i.id::text || ' ' || s.version::text || ' ' || (SELECT count(*) FROM vaults.accounts)::text || ' ' || (SELECT count(*) FROM vaults.private_items)::text FROM vaults.installation i CROSS JOIN vaults.schema_version s"]);
    if (!/^[0-9a-f-]{36} [1-7] [0-9]+ [0-9]+$/.test(state) || !state.startsWith(`${metadata.serverId} ${metadata.requiredVersion.slice(-1)} `)) throw Error('Restored database invariants failed.');
    console.log(`Isolated restore passed: installation, schema, accounts and encrypted item counts = ${state}`);
  }
} finally {
  if (rehearsalContainer) await run(engine, ['rm', '-f', rehearsalContainer]).catch(() => {});
  await cleanTemporary(temporary);
}
}
