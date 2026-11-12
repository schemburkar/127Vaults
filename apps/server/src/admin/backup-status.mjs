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
    return receipt;
  } catch {
    return null;
  } finally { await file?.close().catch(() => {}); }
}

export async function readAdminBackupStatus(directory, installationId, now) {
  const [backup, restore, attempt] = await Promise.all([
    readReceipt(directory, 'database-backup.json', installationId, now),
    readReceipt(directory, 'database-restore-rehearsal.json', installationId, now),
    readReceipt(directory, 'maintenance-attempt.json', installationId, now)
  ]);
  const lastBackupAt=backup?.completedAt??null,lastRestoreCheckAt=restore?.completedAt??null;
  const validAttempt=attempt && ['success','failed'].includes(attempt.outcome) && ['backup','restore'].includes(attempt.operation);
  const failed=validAttempt && attempt.outcome==='failed' && (!lastBackupAt || attempt.completedAt>=lastBackupAt);
  return {
    state: failed ? 'failed' : lastBackupAt ? 'recorded' : 'unknown',
    detail: failed ? 'The latest backup or restore-rehearsal attempt failed. Earlier successful backup and restore records are retained. Review the local operator logs and rerun maintenance.' : lastBackupAt ? 'A verified database backup was recorded. Confirm the backup file is still available.'
      : 'No matching verified database backup is recorded.',
    lastBackupAt, lastRestoreCheckAt,
    lastAttemptAt:validAttempt?attempt.completedAt:null,lastAttemptOutcome:validAttempt?attempt.outcome:null,
    lastAttemptOperation:validAttempt?attempt.operation:null
  };
}
