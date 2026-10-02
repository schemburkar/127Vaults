import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./backup-envelope.mjs', import.meta.url));
function run(args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }

test('seals, verifies, and opens an authenticated backup', () => {
  const dir = mkdtempSync(join(tmpdir(), '127vaults-backup-'));
  const input = join(dir, 'database.dump'); const archive = join(dir, 'database.127vbak');
  const output = join(dir, 'restored.dump'); const key = join(dir, 'backup.key');
  writeFileSync(input, Buffer.from('deterministic pg_dump fixture\n')); writeFileSync(key, Buffer.alloc(32, 7));
  assert.equal(run(['seal', '--input', input, '--output', archive, '--key-file', key, '--server-id', 'test']).status, 0);
  assert.equal(run(['verify', '--input', archive, '--key-file', key]).status, 0);
  assert.equal(run(['open', '--input', archive, '--output', output, '--key-file', key]).status, 0);
  assert.deepEqual(readFileSync(output), readFileSync(input));
});

test('rejects tampering and refuses output overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), '127vaults-backup-'));
  const input = join(dir, 'database.dump'); const archive = join(dir, 'database.127vbak'); const key = join(dir, 'backup.key');
  writeFileSync(input, 'fixture'); writeFileSync(key, Buffer.alloc(32, 9));
  assert.equal(run(['seal', '--input', input, '--output', archive, '--key-file', key]).status, 0);
  const changed = readFileSync(archive); changed[changed.length - 17] ^= 1; writeFileSync(archive, changed);
  assert.notEqual(run(['verify', '--input', archive, '--key-file', key]).status, 0);
  assert.notEqual(run(['open', '--input', archive, '--output', input, '--key-file', key]).status, 0);
});
