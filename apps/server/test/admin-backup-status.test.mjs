import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readAdminBackupStatus } from '../src/admin/backup-status.mjs';

test('backup status reports only bounded receipts from this installation', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-admin-backup-status-'));
  t.after(async () => {
    await Promise.all(['database-backup.json', 'database-restore-rehearsal.json'].map(name => unlink(join(directory, name)).catch(() => {})));
    await rmdir(directory);
  });
  const installationId = '18f5b79a-6cab-4ae2-8f2e-2f42b88a38bc';
  const now = new Date('2026-10-12T00:00:00.000Z');
  const receipt = { version: 1, installationId, schemaVersion: 10, completedAt: '2026-10-10T00:00:00.000Z' };
  const write = (name, value) => writeFile(join(directory, name), JSON.stringify(value));
  await write('database-backup.json', receipt);
  await write('database-restore-rehearsal.json', { ...receipt, installationId: 'different' });
  const status = await readAdminBackupStatus(directory, installationId, now);
  assert.equal(status.state, 'recorded');
  assert.equal(status.lastBackupAt, receipt.completedAt);
  assert.equal(status.lastRestoreCheckAt, null);
  await write('database-backup.json', { ...receipt, padding: 'x'.repeat(513) });
  await write('database-restore-rehearsal.json', { ...receipt, completedAt: '2026-10-13T00:00:00.000Z' });
  assert.equal((await readAdminBackupStatus(directory, installationId, now)).state, 'unknown');
  assert.equal((await readAdminBackupStatus(directory, installationId, now)).lastRestoreCheckAt, null);
});
