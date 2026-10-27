import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LicenseClock } from '../src/license-clock.mjs';

test('clock high-water survives restart and detects backward wall-clock steps', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-clock-'));
  const path = join(dir, 'clock.json');
  let wall = Date.parse('2026-10-07T12:00:00.000Z');
  let mono = 1000;
  const clock = new LicenseClock(path, { wallNow: () => wall, monotonicNow: () => mono });
  try {
    assert.equal((await clock.observe()).clockState, 'trusted');
    wall += 60_000; mono += 60_000;
    assert.equal((await clock.observe()).clockState, 'trusted');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).lastObservedMs, wall);
    wall -= 5 * 60_000; mono += 60_000;
    const rolled = await clock.observe();
    assert.equal(rolled.clockState, 'rollback_detected');
    assert.ok(rolled.now.getTime() > wall);
    const restarted = new LicenseClock(path, { wallNow: () => wall, monotonicNow: () => 1 });
    assert.equal((await restarted.observe()).clockState, 'rollback_detected');
    wall = rolled.now.getTime() + 1000;
    assert.equal((await restarted.observe()).clockState, 'trusted');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed clock state fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-clock-'));
  const path = join(dir, 'clock.json');
  try {
    await writeFile(path, '{broken');
    await assert.rejects(new LicenseClock(path).observe(), /license_clock_unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('long-running VM elapsed-time drift and resume cannot manufacture future clock observations', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-clock-drift-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'clock.json');
  let wall = Date.parse('2026-10-27T00:00:00Z'), mono = 0;
  // Supply the former monotonic dependency to reproduce the old failure.
  const clock = new LicenseClock(path, { wallNow: () => wall, monotonicNow: () => mono });
  await clock.observe();
  for (let hour = 0; hour < 72; hour++) {
    wall += 3600_000;
    mono += 3600_000 + 180_000;
    const result = await clock.observe();
    assert.equal(result.clockState, 'trusted');
    assert.equal(result.now.getTime(), wall);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).lastObservedMs, wall);
  }
  mono += 86400_000;
  assert.equal((await clock.observe()).clockState, 'trusted');
  assert.equal((await new LicenseClock(path, { wallNow: () => wall }).observe()).clockState, 'trusted');
  wall -= 5 * 60_000;
  assert.equal((await clock.observe()).clockState, 'rollback_detected');
  assert.equal((await new LicenseClock(path, { wallNow: () => wall }).observe()).clockState, 'rollback_detected');
});
