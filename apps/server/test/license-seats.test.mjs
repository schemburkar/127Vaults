import test from 'node:test';
import assert from 'node:assert/strict';
import { readSeatUsage, requireLicenseSeats } from '../src/license-seats.mjs';

const now = new Date('2026-10-07T00:00:00.000Z');
const client = (active, reserved) => ({ query: async (sql, values) => {
  assert.match(sql, /revoked_at IS NULL/);
  assert.deepEqual(values, ['installation', now]);
  return { rows: [{ active_users: active, reserved_seats: reserved }] };
} });

test('live invitation reservations count against a signed license cap', async () => {
  assert.deepEqual(await readSeatUsage(client(2, 1), 'installation', now), { activeUsers: 2, reservedSeats: 1 });
  const entitlement = async () => ({ mode: 'active', maxActiveUsers: 5 });
  await requireLicenseSeats(client(2, 1), 'installation', 2, now, entitlement);
  await assert.rejects(requireLicenseSeats(client(2, 2), 'installation', 2, now, entitlement),
    error => error.code === 'seat_limit_reached' && error.status === 409);
  await requireLicenseSeats(client(2, 3), 'installation', 0, now, entitlement);
});

test('grace and invalid license block new users while experimental installs remain available', async () => {
  await assert.rejects(requireLicenseSeats(client(1, 0), 'installation', 1, now,
    async () => ({ mode: 'read-only', maxActiveUsers: 5 })), error => error.code === 'license_inactive');
  await assert.rejects(requireLicenseSeats(client(1, 0), 'installation', 1, now,
    async () => { throw Error('invalid_license'); }), error => error.code === 'license_unavailable');
  await requireLicenseSeats({ query: () => { throw Error('unexpected query'); } }, 'installation', 10, now,
    async () => ({ mode: 'experimental' }));
});
