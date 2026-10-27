import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const within = (parent, child) => { const path = relative(parent, child); return !path || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)); };

export async function upgradeInstallation({ directory, from, backupDirectory, keyFile, options = [], verify, inspect, run = execute }) {
  directory = resolve(directory); from = resolve(from); backupDirectory = resolve(backupDirectory); keyFile = resolve(keyFile);
  if (directory === from || existsSync(join(directory, '.env'))) throw Error('Upgrade requires a new extracted bundle without .env; preserve both existing installations.');
  if (within(directory, backupDirectory) || within(from, backupDirectory)) throw Error('Keep upgrade backups outside both bundles.');
  if (within(directory, keyFile) || within(from, keyFile) || within(backupDirectory, keyFile)) throw Error('Keep the backup key outside bundles and separate from the backup directory.');
  if ((await readFile(keyFile)).length !== 32) throw Error('Upgrade requires an existing protected 32-byte backup key.');
  await verify(directory); await verify(from);
  const state = await inspect(from, { args: [] });
  if (state.status !== 'pass') throw Error('Existing installation identity is incomplete; upgrade refused.');
  const original = await readFile(join(from, '.env'), 'utf8');
  const project = /^VAULTS_PROJECT=(vaults-test-[a-f0-9]{12})\r?$/m.exec(original)?.[1];
  const privateDir = /^VAULTS_TLS_DIR=(.+)\r?$/m.exec(original)?.[1]?.trim();
  if (!project || !privateDir || within(resolve(privateDir), backupDirectory)) throw Error('Invalid installation or backup location.');
  const engine = options.includes('--docker') ? 'docker' : 'podman';
  const provider = options[options.indexOf('--compose-provider') + 1];
  const settings = { windowsHide: true, timeout: 600000, maxBuffer: 1048576, cwd: directory,
    env: { ...process.env, ...(options.includes('--compose-provider') ? { PODMAN_COMPOSE_PROVIDER: provider } : {}) } };
  const command = async (program, args) => (await run(program, args, settings)).stdout.trim();
  const container = async service => {
    const ids = (await command(engine, ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${service}`, '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean);
    if (ids.length !== 1) throw Error(`Upgrade needs exactly one running ${service} container for this project.`);
    return ids[0];
  };
  const server = await container('server'), database = await container('database');
  const status = async id => JSON.parse(await command(engine, ['exec', id, 'node', 'apps/server/src/entry.mjs', 'provision', 'status']));
  const before = await status(server);
  if (![8, 9, 10].includes(before.schemaVersion) || !/^[a-f0-9-]{36}$/.test(before.installationId)) throw Error('This upgrade supports existing schema 8, 9 or 10 only. A reviewed migration is required for other schemas.');
  await mkdir(backupDirectory, { recursive: false, mode: 0o700 });
  if (process.platform === 'win32') {
    const { windowsOperatorSid } = await import(existsSync(new URL('../scripts/tls.mjs', import.meta.url)) ? '../scripts/tls.mjs' : './tls.mjs');
    await command('icacls.exe', [backupDirectory, '/inheritance:r', '/grant:r', `${windowsOperatorSid()}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  }
  let stopped = false, starting = false;
  try {
    await command(engine, ['stop', '--time', '30', server]); stopped = true;
    const operator = join(directory, 'server.mjs');
    const databaseBackup = join(backupDirectory, 'database.vaultbak');
    await command(process.execPath, [operator, 'database', 'backup', '--engine', engine, '--container', database, '--output', databaseBackup, '--key-file', keyFile]);
    await command(process.execPath, [operator, 'database', 'rehearse', '--engine', engine, '--input', databaseBackup, '--key-file', keyFile]);
    await command(process.execPath, [operator, 'identity', 'backup', '--private-dir', privateDir, '--server-id', before.installationId,
      '--output', join(backupDirectory, 'identity.vaultbak'), '--key-file', keyFile]);
    if (await readFile(join(from, '.env'), 'utf8') !== original) throw Error('Existing configuration changed during backup; upgrade refused.');
    await writeFile(join(directory, '.env'), original, { flag: 'wx', mode: 0o600 });
    await command(engine, ['load', '-i', join(directory, 'server-image.tar')]);
    const compose = ['compose', '-p', project, '-f', 'compose.test.yaml',
      ...(/^SMTP_HOST=(.+)$/m.test(original) ? ['-f', 'compose.smtp.yaml'] : [])];
    const schema = async action => JSON.parse(await command(engine, [...compose, 'run', '--rm', '--no-deps',
      'server', 'node', 'apps/server/src/entry.mjs', 'schema', action]));
    const current = await schema('status');
    if (current.version !== before.schemaVersion) throw Error('Schema changed during upgrade backup; migration refused.');
    for (let version=current.version;version<10;version++) {
      await schema('dry-run');
      // After a migration may have committed, never restart the older server automatically.
      starting = true;
      await schema('apply');
    }
    if ((await schema('status')).version !== 10) throw Error('Upgrade schema migration did not reach schema 10.');
    starting = true;
    await command(process.execPath, [operator, 'install', 'start', ...options, '--private-dir', privateDir]);
    const after = await status(await container('server'));
    if (after.installationId !== before.installationId || after.schemaVersion !== 10
      || after.seatUsage?.activeUsers !== before.seatUsage?.activeUsers || after.license?.mode !== before.license?.mode) throw Error('Upgrade identity, schema, users or license verification failed. Keep the backups and inspect the running installation.');
    await writeFile(join(backupDirectory, 'upgrade-receipt.json'), JSON.stringify({ installationId: after.installationId, project,
      schemaVersion: after.schemaVersion, completedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
    return after;
  } catch (error) {
    if (stopped && !starting) await command(engine, ['start', server]).catch(() => {});
    throw Error(`Upgrade stopped: ${error.message}. Original identity and database volume are preserved. Backups are in ${backupDirectory}.`);
  }
}
