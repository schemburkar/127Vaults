import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudSeatEstimate } from './cloud-pricing.mjs';

test('Cloud estimate shows annual payment and full two-year commitment', () => {
  assert.deepEqual(cloudSeatEstimate(1), { annualUsd: 30, twoYearUsd: 60 });
  assert.deepEqual(cloudSeatEstimate(10), { annualUsd: 300, twoYearUsd: 600 });
  for (const seats of [0, 1001, 1.5, '10']) assert.equal(cloudSeatEstimate(seats), null);
});
