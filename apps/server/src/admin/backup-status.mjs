import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

async function readReceipt(directory, filename, installationId, now) {
  let file;
  try {
    file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) return null;
    const bytes = Buffer.alloc(513);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead > 512) return null;
    const receipt = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (receipt.version !== 1 || receipt.installationId !== installationId || !Number.isSafeInteger(receipt.schemaVersion)
        || receipt.schemaVersion < 1 || typeof receipt.completedAt !== 'string') return null;
    const completed = new Date(receipt.completedAt);
    if (!Number.isFinite(completed.getTime()) || completed.toISOString() !== receipt.completedAt || completed > now) return null;
    return receipt.completedAt;
  } catch {
    return null;
  } finally { await file?.close().catch(() => {}); }
}

export async function readAdminBackupStatus(directory, installationId, now) {
  const [lastBackupAt, lastRestoreCheckAt] = await Promise.all([
    readReceipt(directory, 'database-backup.json', installationId, now),
    readReceipt(directory, 'database-restore-rehearsal.json', installationId, now)
  ]);
  return {
    state: lastBackupAt ? 'recorded' : 'unknown',
    detail: lastBackupAt ? 'A verified database backup was recorded. Confirm the backup file is still available.'
      : 'No matching verified database backup is recorded.',
    lastBackupAt, lastRestoreCheckAt
  };
}
