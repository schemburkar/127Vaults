import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runtimeDatabaseConfig } from '../../apps/server/src/runtime-config.mjs';
import { runEnvelope } from './backup-envelope.mjs';

const run = promisify(execFile);
const operator = fileURLToPath(new URL('../../apps/server/internal-cloud/cli.mjs', import.meta.url));
const keys = [
  ['token.key', 'VAULTS_TOKEN_KEY_FILE'], ['checkpoint.key', 'VAULTS_CHECKPOINT_KEY_FILE']
];

async function backup(env, output) {
  if (process.platform === 'win32' || env.VAULTS_INTERNAL_CLOUD_OPERATIONS !== '1' ||
      !env.VAULTS_DATABASE_HOST || !env.VAULTS_DATABASE_USER || !env.VAULTS_DATABASE_NAME ||
      env.VAULTS_DATABASE_NAME === 'vaults_experimental' || !output || !isAbsolute(output) ||
      !isAbsolute(env.VAULTS_CLOUD_BACKUP_KEY_FILE ?? '') || !isAbsolute(env.VAULTS_CLOUD_BACKUP_SCRATCH ?? '')) {
    throw new Error('Use the Cloud deployment host with a dedicated database, absolute output, private scratch and backup key file.');
  }
  const scratch = await lstat(env.VAULTS_CLOUD_BACKUP_SCRATCH);
  if (!scratch.isDirectory() || (scratch.mode & 0o077) !== 0 || scratch.uid !== process.getuid()) {
    throw new Error('Cloud backup scratch must be a private directory owned by the deployment operator.');
  }
  const database = runtimeDatabaseConfig(env);
  await run(process.execPath, [operator, 'verify'], { env, timeout: 30000 });
  const directory = await mkdtemp(join(env.VAULTS_CLOUD_BACKUP_SCRATCH, 'cloud-backup-'));
  const dump = join(directory, 'database.dump');
  const archive = join(directory, 'backup.tar');
  try {
    for (const [name, variable] of keys) {
      const source = env[variable];
      if (!source || !isAbsolute(source)) throw new Error('Cloud backup key paths must be absolute.');
      const info = await lstat(source);
      if (!info.isFile() || info.size !== 32) throw new Error('Cloud runtime keys must be regular 32-byte files.');
      await copyFile(source, join(directory, name));
    }
    await run('pg_dump', ['--no-password', '--format=custom', '--file', dump], {
      env: { PATH: env.PATH, PGHOST: database.host, PGPORT: String(database.port), PGUSER: database.user,
        PGDATABASE: database.database, PGPASSWORD: database.password, PGSSLMODE: env.PGSSLMODE ?? 'verify-full',
        ...(env.VAULTS_CLOUD_DATABASE_CA_FILE ? { PGSSLROOTCERT: env.VAULTS_CLOUD_DATABASE_CA_FILE } : {}) }, timeout: 600000
    });
    await run('tar', ['-cf', archive, '-C', directory, 'database.dump', ...keys.map(([name]) => name)], { timeout: 600000 });
    const key = ['--key-file', env.VAULTS_CLOUD_BACKUP_KEY_FILE];
    await runEnvelope(['seal', '--input', archive, '--output', output, ...key, '--database', database.database,
      '--server-id', 'cloud-global', '--required-version', 'cloud-pilot-1']);
    await runEnvelope(['verify', '--input', output, ...key]);
  } finally {
    for (const file of [dump, archive, ...keys.map(([name]) => join(directory, name))]) {
      await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await rmdir(directory);
  }
}

try {
  const [destination, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Provide one absolute backup output path or --scheduled.');
  let output = destination;
  if (destination === '--scheduled') {
    const directory = process.env.VAULTS_CLOUD_BACKUP_OUTPUT_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error('Scheduled Cloud backups require an absolute output directory.');
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
      throw new Error('Scheduled Cloud backup output must be a private directory owned by the backup operator.');
    }
    output = join(directory, `cloud-global-${new Date().toISOString().replaceAll(':', '-')}.vbak`);
  }
  await backup(process.env, output);
} catch (error) {
  // Child process errors can contain database configuration and private paths.
  console.error(error.cmd ? 'Cloud backup subprocess failed.' : error.message);
  process.exitCode = 1;
}
