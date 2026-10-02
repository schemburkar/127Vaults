// Encrypted backup of the server installation identity, separate from PostgreSQL.
// Restore creates a NEW directory only; it never overwrites a live identity.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const operator = resolve(process.cwd(), 'server.mjs');
export async function runIdentityBackup(argv) {
const action = argv[0];
const args = argv.slice(1);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || !args[i + 1] || options[args[i]]) throw Error('Invalid arguments.');
  options[args[i]] = args[i + 1];
}
if (!['backup', 'restore'].includes(action) || !options['--key-file']) throw Error('Use backup or restore with --key-file.');
const identityFiles = [
  'ca/ca.key', 'ca/ca.crt', 'ca/index.txt', 'ca/serial',
  'live/server.key', 'live/server.crt',
  'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token'
];
const optionalFiles = ['runtime/smtp-password'];

async function run(argv) {
  const child = spawn(process.execPath, [operator, 'envelope', ...argv], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
  child.stderr.on('data', () => {});
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (code !== 0) throw Error('Identity envelope operation failed.');
  return JSON.parse(output);
}
async function readRegular(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('Identity contains an unsupported file.');
  return (await readFile(path)).toString('base64');
}
const temporary = await mkdtemp(join(tmpdir(), '127vaults-identity-'));
try {
  const plain = join(temporary, 'identity.json');
  if (action === 'backup') {
    const source = resolve(options['--private-dir'] ?? '');
    const output = options['--output'];
    const serverId = options['--server-id'];
    if (!options['--private-dir'] || !output || existsSync(output) || !/^[0-9a-f-]{36}$/.test(serverId ?? '')) throw Error('Backup needs a private directory, new output and installation UUID.');
    const files = {};
    for (const name of identityFiles) files[name] = await readRegular(join(source, name));
    for (const name of optionalFiles) if (existsSync(join(source, name))) files[name] = await readRegular(join(source, name));
    const certs = await readdir(join(source, 'ca', 'newcerts'));
    for (const name of certs) {
      if (!/^[0-9A-Fa-f]+\.pem$/.test(name)) throw Error('Unexpected CA archive file.');
      files[`ca/newcerts/${name}`] = await readRegular(join(source, 'ca', 'newcerts', name));
    }
    await writeFile(plain, JSON.stringify({ format: 1, serverId, files }), { flag: 'wx', mode: 0o600 });
    await run(['seal', '--input', plain, '--output', output, '--key-file', options['--key-file'], '--database', 'identity', '--server-id', serverId, '--required-version', 'identity-1']);
    await run(['verify', '--input', output, '--key-file', options['--key-file']]);
    console.log('Encrypted installation identity backup created and authenticated. Store it separately from the database backup.');
  } else {
    const input = options['--input'], destination = options['--output-dir'];
    if (!input || !destination || existsSync(destination)) throw Error('Restore requires an input and a new output directory.');
    const header = await run(['open', '--input', input, '--output', plain, '--key-file', options['--key-file']]);
    if (header.database !== 'identity' || header.requiredVersion !== 'identity-1' || !/^[0-9a-f-]{36}$/.test(header.serverId)) throw Error('Unsupported identity backup.');
    const parsed = JSON.parse(await readFile(plain, 'utf8'));
    if (parsed.format !== 1 || parsed.serverId !== header.serverId || !parsed.files || typeof parsed.files !== 'object') throw Error('Identity backup context mismatch.');
    if (options['--server-id'] && options['--server-id'] !== header.serverId) throw Error('Identity and database installation IDs differ.');
    const names = Object.keys(parsed.files);
    if (identityFiles.some(name => !names.includes(name)) || names.some(name => !identityFiles.includes(name) && !optionalFiles.includes(name) && !/^ca\/newcerts\/[0-9A-Fa-f]+\.pem$/.test(name))) throw Error('Identity backup file set is invalid.');
    const intended = resolve(destination);
    if (intended !== destination && process.platform === 'win32') throw Error('Restore destination must be an absolute path.');
    await mkdir(intended, { recursive: false, mode: 0o700 });
    try {
      if (process.platform === 'win32') {
        const operator = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
        if (!operator) throw Error('Cannot identify the restore operator.');
        const acl = spawnSync('icacls', [intended, '/inheritance:r', '/grant:r', `${operator}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C'], { stdio: 'ignore', windowsHide: true });
        if (acl.error || acl.status !== 0) throw Error('Could not restrict the restore directory ACL.');
      }
      for (const dir of ['ca', 'ca/newcerts', 'live', 'runtime', 'output']) await mkdir(join(intended, dir), { recursive: true, mode: 0o700 });
      for (const name of names) {
        if (typeof parsed.files[name] !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.files[name])) throw Error('Malformed identity file.');
        await writeFile(join(intended, name), Buffer.from(parsed.files[name], 'base64'), { flag: 'wx', mode: name.endsWith('.crt') ? 0o644 : 0o600 });
      }
      await writeFile(join(intended, 'installation-id'), `${header.serverId}\n`, { flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') await chmod(intended, 0o700);
    } catch (error) { if (resolve(intended) === intended) await rm(intended, { recursive: true, force: true }); throw error; }
    console.log(`Installation identity restored to a new directory for ${header.serverId}. Restrict host ACLs before mounting it.`);
  }
} finally {
  const parent = resolve(tmpdir()) + sep;
  const path = resolve(temporary);
  if (!path.startsWith(parent) || !path.split(sep).at(-1).startsWith('127vaults-identity-')) throw Error('Unsafe temporary cleanup path.');
  await rm(path, { recursive: true, force: true });
}
}
