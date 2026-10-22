import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withFileLock } from '../src/durable-limit.mjs';

test('an old but live file lock cannot be stolen or allow a stale write after closure', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-lock-'));
  const lock = join(dir, 'record.lock');
  let enter, release, state = 'approved', secondEntered = false;
  const entered = new Promise(resolve => { enter = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  const first = withFileLock(lock, async () => {
    const original = state;
    enter(); await paused;
    state = original;
  });
  try {
    await entered;
    const old = new Date(Date.now() - 120000);
    await utimes(lock, old, old);
    await assert.rejects(withFileLock(lock, async () => {
      secondEntered = true; state = 'closed';
    }), /record is busy/);
    assert.equal(secondEntered, false);
    assert.ok((await stat(lock)).isDirectory());
    release(); await first;
    await withFileLock(lock, async () => { state = 'closed'; });
    assert.equal(state, 'closed');
  } finally {
    release(); await first;
    await rm(dir, { recursive: true, force: true });
  }
});

test('exceptions release the lock and allow a later operation', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-lock-'));
  const lock = join(dir, 'record.lock');
  try {
    await assert.rejects(withFileLock(lock, () => { throw Error('dummy failure'); }), /dummy failure/);
    assert.equal(await withFileLock(lock, async () => 'next operation'), 'next operation');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
