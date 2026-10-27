import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryRecord } from './recover-development-clock.mjs';

test('development clock recovery requires a signed active entitlement and independently matching clocks', () => {
  const now = Date.parse('2026-10-27T05:00:00Z');
  const previous = { version: 1, lastObservedMs: now + 3 * 3600_000 };
  const status = { plan: 'development', mode: 'active' };
  assert.deepEqual(recoveryRecord(previous, now, now, now, status), { version: 1, lastObservedMs: now });
  for (const invalid of [{ ...status, plan: 'trial' }, { ...status, mode: 'expired' }]) assert.throws(() => recoveryRecord(previous, now, now, now, invalid));
  for (const reference of [NaN, now - 180_000]) assert.throws(() => recoveryRecord(previous, now, reference, now, status));
  assert.throws(() => recoveryRecord(previous, now, now, now - 180_000, status));
  for (const lastObservedMs of [now, now + 2 * 86400_000, NaN]) assert.throws(() => recoveryRecord({ version: 1, lastObservedMs }, now, now, now, status));
  assert.throws(() => recoveryRecord({ version: 2, lastObservedMs: previous.lastObservedMs }, now, now, now, status));
});
