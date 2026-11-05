import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupWithRetry } from './site-backup.mjs';

test('backup retries provider internal errors but never treats a failure as a successful backup', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-backup-retry-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const diagnosticFile = join(directory, 'private-error.log'); await writeFile(diagnosticFile, 'Synthetic internal error [code: 7500]');
  let calls = 0; const delays = [], failure = Object.assign(Error('Synthetic backup failure'), { diagnosticFile });
  await backupWithRetry({}, { backup: async () => { if (++calls < 3) throw failure; }, delay: async ms => { delays.push(ms); } });
  assert.equal(calls, 3); assert.deepEqual(delays, [10000, 20000]);
  calls = 0;
  await assert.rejects(backupWithRetry({}, { backup: async () => { calls++; throw failure; }, delay: async () => {} }), /Synthetic backup failure/);
  assert.equal(calls, 3);
  await writeFile(diagnosticFile, 'Synthetic authentication failure [code: 10000]'); calls = 0;
  await assert.rejects(backupWithRetry({}, { backup: async () => { calls++; throw failure; }, delay: async () => { throw Error('Must not retry'); } }), /Synthetic backup failure/);
  assert.equal(calls, 1);
});
