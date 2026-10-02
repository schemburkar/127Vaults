import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readinessToken, runtimeDatabaseConfig } from '../src/runtime-config.mjs';

async function fixture(value) {
  const directory = await mkdtemp(join(tmpdir(), '127v-config-'));
  const path = join(directory, 'secret');
  await writeFile(path, value, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return { directory, path };
}

test('file-backed credentials preserve exact accepted values', async t => {
  const secret = 'a'.repeat(64);
  const item = await fixture(`${secret}\n`);
  t.after(() => rm(item.directory, { recursive: true, force: true }));
  assert.equal(readinessToken({ VAULTS_READINESS_TOKEN_FILE: item.path }), secret);
  assert.deepEqual(runtimeDatabaseConfig({ VAULTS_DATABASE_PASSWORD_FILE: item.path }), {
    host: 'database', port: 5432, database: 'vaults_experimental', user: 'vaults', password: secret,
  });
});

test('missing, empty and malformed secret files fail without exposing content', async t => {
  assert.throws(() => readinessToken({}), /file is required/);
  const empty = await fixture('');
  const malformed = await fixture(`NOT-SECRET-${'z'.repeat(64)}`);
  t.after(() => Promise.all([empty, malformed].map(item => rm(item.directory, { recursive: true, force: true }))));
  assert.throws(() => readinessToken({ VAULTS_READINESS_TOKEN_FILE: empty.path }), /file is malformed/);
  assert.throws(() => runtimeDatabaseConfig({ VAULTS_DATABASE_PASSWORD_FILE: malformed.path }), error =>
    error.message === 'Database password file is malformed.' && !error.message.includes('NOT-SECRET'));
});

test('group/world-writable files are rejected on POSIX', { skip: process.platform === 'win32' }, async t => {
  const item = await fixture('b'.repeat(64));
  t.after(() => rm(item.directory, { recursive: true, force: true }));
  await chmod(item.path, 0o622);
  assert.throws(() => readinessToken({ VAULTS_READINESS_TOKEN_FILE: item.path }), /permissions are too broad/);
  assert.equal(readinessToken({ VAULTS_READINESS_TOKEN_FILE: item.path, VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS: '1' }), 'b'.repeat(64));
});
