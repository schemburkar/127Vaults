// Disposable schema 1 -> 2 -> 3 migration exercise; never touches an existing volume.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { schemaV1Checksum, schemaChecksum } from '../../apps/server/src/schema.mjs';

const engine = process.argv.includes('--docker') ? 'docker' : 'podman';
const name = `127vaults-migrate-${randomBytes(6).toString('hex')}`;
const temp = await mkdtemp(join(tmpdir(), '127vaults-migrate-'));
const password = randomBytes(32).toString('hex');
const passwordFile = join(temp, 'postgres-password');
await writeFile(passwordFile, password, { mode: 0o600 });
let started = false;

async function run(program, argv, { output, expectFailure = false } = {}) {
  const child = spawn(program, argv, { stdio: ['ignore', output ? 'pipe' : 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  if (output) child.stdout.pipe(output, { end: false });
  else child.stdout.on('data', chunk => { out = (out + chunk).slice(-8192); });
  child.stderr.on('data', () => {});
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (output) await new Promise((done, reject) => { output.end(); output.once('finish', done); output.once('error', reject); });
  if (expectFailure ? code === 0 : code !== 0) throw Error(`${program} ${argv.slice(0, 2).join(' ')} returned unexpected status ${code}.`);
  return out.trim();
}
const psql = sql => run(engine, ['exec', name, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', sql]);
const migration = (action, expectFailure = false) => run(engine, ['run', '--rm', '--network', `container:${name}`, '-v', `${passwordFile}:/run/secrets/runtime/postgres-password:ro`,
  '-e', 'VAULTS_EXPERIMENTAL=1', '-e', 'VAULTS_DATABASE_HOST=127.0.0.1', '-e', 'VAULTS_DATABASE_PASSWORD_FILE=/run/secrets/runtime/postgres-password',
  '-e', 'VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS=1', 'localhost/127vaults-server:test', 'node', 'apps/server/src/entry.mjs', 'schema', action], { expectFailure });
try {
  await run(engine, ['run', '-d', '--name', name, '--network', 'none', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_USER=vaults', '-e', 'POSTGRES_DB=vaults_experimental', 'docker.io/library/postgres:17-bookworm']);
  started = true;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { await run(engine, ['exec', name, 'pg_isready', '-U', 'vaults', '-d', 'vaults_experimental']); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 1000)); }
  }
  if (!ready) throw Error('Disposable database did not start.');
  await run(engine, ['cp', 'apps/server/src/schema.sql', `${name}:/tmp/schema.sql`]);
  await run(engine, ['exec', name, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/schema.sql']);
  const installation = randomUUID();
  await psql(`INSERT INTO vaults.schema_version(singleton,version,checksum) VALUES(true,1,'${schemaV1Checksum}'); INSERT INTO vaults.installation(id) VALUES('${installation}');`);
  const dump = join(temp, 'before.dump');
  const key = join(temp, 'backup.key');
  const sealed = join(temp, 'before.127vbak');
  await writeFile(key, randomBytes(32), { mode: 0o600 });
  await run(engine, ['exec', name, 'pg_dump', '-U', 'vaults', '-d', 'vaults_experimental', '--format=custom', '--no-owner', '--no-acl'], { output: createWriteStream(dump, { flags: 'wx', mode: 0o600 }) });
  await run(process.execPath, ['scripts/ops/backup-envelope.mjs', 'seal', '--input', dump, '--output', sealed, '--key-file', key, '--server-id', installation, '--required-version', 'schema-1']);
  await run(process.execPath, ['scripts/ops/backup-envelope.mjs', 'verify', '--input', sealed, '--key-file', key]);
  await run(process.execPath, ['scripts/ops/server-data.mjs', 'rehearse', '--engine', engine, '--input', sealed, '--key-file', key]);
  await migration('dry-run');
  if (await psql('SELECT version FROM vaults.schema_version') !== '1') throw Error('Dry run changed the schema.');
  await migration('apply');
  if (await psql('SELECT version FROM vaults.schema_version') !== '2') throw Error('Schema 1 -> 2 failed.');
  await run(engine, ['exec', '-d', name, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-c', 'BEGIN; SELECT pg_advisory_xact_lock(127,1); SELECT pg_sleep(12); COMMIT;']);
  let locked = false;
  for (let i = 0; i < 20; i++) {
    if (Number(await psql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted")) > 0) { locked = true; break; }
    await new Promise(done => setTimeout(done, 200));
  }
  if (!locked) throw Error('Could not establish the migration lock contention fixture.');
  await migration('dry-run', true);
  if (await psql('SELECT version FROM vaults.schema_version') !== '2') throw Error('Lock contention changed the schema.');
  for (let i = 0; i < 30; i++) {
    if (Number(await psql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted")) === 0) break;
    await new Promise(done => setTimeout(done, 300));
  }
  await migration('dry-run');
  if (await psql('SELECT version FROM vaults.schema_version') !== '2') throw Error('Second dry run changed the schema.');
  await migration('apply');
  const final = await psql('SELECT version::text || \' \' || checksum FROM vaults.schema_version');
  if (final !== `3 ${schemaChecksum}`) throw Error('Schema 2 -> 3 checksum mismatch.');
  await psql("UPDATE vaults.schema_version SET checksum=repeat('0',64)");
  await run(engine, ['run', '--rm', '--network', `container:${name}`, '-v', `${passwordFile}:/run/secrets/runtime/postgres-password:ro`,
    '-e', 'VAULTS_EXPERIMENTAL=1', '-e', 'VAULTS_DATABASE_HOST=127.0.0.1', '-e', 'VAULTS_DATABASE_PASSWORD_FILE=/run/secrets/runtime/postgres-password',
    '-e', 'VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS=1', 'localhost/127vaults-server:test', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { expectFailure: true });
  console.log(`Disposable migration passed: verified encrypted pre-backup, dry runs, lock contention refusal, schema 1 -> 2 -> 3, checksum ${schemaChecksum}.`);
} finally {
  if (started) await run(engine, ['rm', '-f', name]).catch(() => {});
  const parent = resolve(tmpdir()) + sep;
  if (!resolve(temp).startsWith(parent) || !temp.split(sep).at(-1).startsWith('127vaults-migrate-')) throw Error('Unsafe temporary cleanup path.');
  await rm(temp, { recursive: true, force: true });
}
