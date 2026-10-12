import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOperators, verifyPassword } from '../../apps/server/src/admin/credentials.mjs';

const root = resolve(import.meta.dirname, '../..');
const password = 'synthetic-internal-admin-password';
function operator(directory, args, withPassword = true) {
  const env = { ...process.env };
  delete env.VAULTS_ADMIN_SETUP_PASSWORD;
  if (withPassword) env.VAULTS_ADMIN_SETUP_PASSWORD = password;
  return spawnSync(process.execPath, ['server.mjs', ...args], { cwd: directory, env, windowsHide: true, encoding: 'utf8' });
}

test('extracted server can initialize its admin owner without source or dependencies and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-admin-release-'));
  try {
    await mkdir(join(directory, 'lib'));
    await copyFile(join(root, 'server.mjs'), join(directory, 'server.mjs'));
    await copyFile(join(root, 'apps/server/src/admin/credentials.mjs'), join(directory, 'lib/admin-credentials.mjs'));
    await writeFile(join(directory, 'manifest.json'), '{}');
    const path = join(directory, 'admin-operators.json');
    assert.equal(operator(directory, ['admin', 'init', 'localowner', path], false).status, 1);
    const created = operator(directory, ['admin', 'init', 'localowner', path]);
    assert.equal(created.status, 0, created.stderr);
    const bytes = await readFile(path, 'utf8');
    assert.ok(!bytes.includes(password));
    assert.ok(!created.stdout.includes(password));
    const operators = loadOperators(path);
    assert.equal(operators[0].role, 'owner');
    assert.equal(verifyPassword(operators[0], password), true);
    assert.equal(verifyPassword(operators[0], 'incorrect'), false);
    assert.equal(operator(directory, ['admin', 'init', 'replacement', path]).status, 1);
    assert.equal(await readFile(path, 'utf8'), bytes);
    const compose = await readFile(join(root, 'deploy/compose.test.yaml'), 'utf8');
    assert.match(compose, /VAULTS_ADMIN_OPERATORS_FILE: \/run\/secrets\/runtime\/admin-operators\.json/);
    const bundle = await readFile(join(root, 'scripts/ops/make-server-bundle.mjs'), 'utf8');
    assert.match(bundle, /\['apps\/server\/src\/admin\/credentials\.mjs', 'lib\/admin-credentials\.mjs'\]/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('encrypted identity backup preserves optional admin operators and older identities remain compatible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-admin-identity-'));
  const serverId = '10000000-0000-4000-8000-000000000001';
  try {
    const identity = join(directory, 'identity');
    for (const name of ['ca/newcerts', 'live', 'runtime']) await mkdir(join(identity, name), { recursive: true });
    for (const name of ['ca/ca.key', 'ca/ca.crt', 'ca/index.txt', 'ca/serial', 'live/server.key', 'live/server.crt', 'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token']) {
      await writeFile(join(identity, name), 'synthetic-identity-fixture');
    }
    const created = operator(root, ['admin', 'init', 'localowner', join(identity, 'runtime/admin-operators.json')]);
    assert.equal(created.status, 0, created.stderr);
    const key = join(directory, 'key');
    await writeFile(key, Buffer.alloc(32, 5));
    for (const includeAdmin of [true, false]) {
      if (!includeAdmin) await rm(join(identity, 'runtime/admin-operators.json'));
      const backup = join(directory, `identity-${includeAdmin}.127vbak`);
      const result = operator(root, ['identity', 'backup', '--private-dir', identity, '--output', backup, '--key-file', key, '--server-id', serverId], false);
      assert.equal(result.status, 0, result.stderr);
      const restored = join(directory, `restored-${includeAdmin}`);
      const restore = operator(root, ['identity', 'restore', '--input', backup, '--output-dir', restored, '--key-file', key, '--server-id', serverId], false);
      assert.equal(restore.status, 0, restore.stderr);
      const operators = loadOperators(join(restored, 'runtime/admin-operators.json'));
      assert.equal(operators.length, includeAdmin ? 1 : 0);
      if (includeAdmin) assert.equal(verifyPassword(operators[0], password), true);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
