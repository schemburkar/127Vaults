import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureTlsReady } from './mvp-startup.mjs';

async function fixture(t, files = []) {
  const directory = await mkdtemp(join(tmpdir(), '127vaults-startup-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('127vaults-startup-'));
    await rm(directory, { recursive: true, force: true });
  });
  const identity = join(directory, 'server identity with spaces');
  for (const file of files) {
    const path = join(identity, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `synthetic fixture: ${file}`);
  }
  return { directory, identity };
}
const required = ['live/server.crt', 'live/server.key', 'ca/ca.crt'];
const missingMessage = (directory, action) => `Local TLS files are missing in ${directory}. Run pnpm tls:init -- 127.0.0.1 "${directory}" before pnpm mvp:${action}.`;

test('TLS preflight explains missing .env configuration', async () => {
  await assert.rejects(ensureTlsReady({}, 'dev'), { message: 'VAULTS_TLS_DIR is missing from .env. Complete the TLS setup in docs/release/experimental-development.md.' });
});

for (const action of ['dev', 'start']) {
  test(`${action} reports a missing identity with a quoted recovery path and the correct command`, async t => {
    const { identity } = await fixture(t);
    await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, action), { message: missingMessage(identity, action) });
  });
}

for (const missing of required) {
  test(`TLS preflight rejects a partial identity missing ${missing} without changing its files`, async t => {
    const retained = required.filter(path => path !== missing);
    const { identity } = await fixture(t, [...retained, 'runtime/token.key', 'runtime/checkpoint.key']);
    await assert.rejects(ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev'), { message: missingMessage(identity, 'dev') });
    for (const file of [...retained, 'runtime/token.key', 'runtime/checkpoint.key']) assert.equal(await readFile(join(identity, file), 'utf8'), `synthetic fixture: ${file}`);
    await assert.rejects(readFile(join(identity, missing)), { code: 'ENOENT' });
  });
}

test('TLS preflight accepts a complete default identity', async t => {
  const { identity } = await fixture(t, required);
  await ensureTlsReady({ VAULTS_TLS_DIR: identity }, 'dev');
});

test('custom CA configuration requires that exact filename rather than falling back to ca.crt', async t => {
  const { identity } = await fixture(t, required);
  const values = { VAULTS_TLS_DIR: identity, VAULTS_CA_CERT_FILE: 'trusted-ca.crt' };
  await assert.rejects(ensureTlsReady(values, 'dev'), { message: missingMessage(identity, 'dev') });
  await writeFile(join(identity, 'ca', 'trusted-ca.crt'), 'synthetic custom CA');
  await ensureTlsReady(values, 'dev');
});

for (const args of [['start'], ['dev'], ['dev', '--check']]) {
test(`actual ${args.join(' ')} exits with the TLS error before creating runtime files or starting containers`, async t => {
  const { directory, identity } = await fixture(t, ['live/server.crt', 'ca/ca.crt']);
  await mkdir(join(directory, 'scripts'));
  for (const script of ['mvp-acceptance.mjs', 'mvp-startup.mjs']) await copyFile(new URL(script, import.meta.url), join(directory, 'scripts', script));
  await writeFile(join(directory, '.env'), `VAULTS_TLS_DIR=${identity}\n`);
  const result = spawnSync(process.execPath, ['scripts/mvp-acceptance.mjs', ...args], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(missingMessage(identity, args[0])), result.stderr);
  assert.deepEqual((await readdir(identity)).sort(), ['ca', 'live']);
  assert.equal(await readFile(join(identity, 'live', 'server.crt'), 'utf8'), 'synthetic fixture: live/server.crt');
});
}

test('launcher preflight accepts complete TLS files without starting containers or creating runtime secrets', async t => {
  const { directory, identity } = await fixture(t, required);
  await mkdir(join(directory, 'scripts'));
  for (const script of ['mvp-acceptance.mjs', 'mvp-startup.mjs']) await copyFile(new URL(script, import.meta.url), join(directory, 'scripts', script));
  await writeFile(join(directory, '.env'), `VAULTS_TLS_DIR=${identity}\n`);
  const result = spawnSync(process.execPath, ['scripts/mvp-acceptance.mjs', 'dev', '--check'], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local TLS startup files are present/);
  assert.deepEqual((await readdir(identity)).sort(), ['ca', 'live']);
});
