import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSetupStep } from './test-install.mjs';

const ready = { bootstrapRequired: false,
  license: { mode: 'active', clockState: 'trusted', maxActiveUsers: 5 },
  seatUsage: { activeUsers: 2, reservedSeats: 1 } };

test('operator setup guidance prioritizes license and clock problems', () => {
  assert.match(nextSetupStep({ ...ready, license: { mode: 'unavailable' } }, true), /inspect the signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'locked', clockState: 'rollback_detected' } }, true), /correct the host clock/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'revoked' } }, true), /new signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'read-only' } }, true), /renew the signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'experimental' } }, true), /install a signed test license/);
});

test('operator setup guidance covers owner, SMTP, seat capacity and ready state', () => {
  assert.match(nextSetupStep({ ...ready, bootstrapRequired: true }, true), /install bootstrap/);
  assert.match(nextSetupStep(ready, false), /configure and verify SMTP/);
  assert.match(nextSetupStep({ ...ready, seatUsage: { activeUsers: 3, reservedSeats: 2 } }, true), /higher user cap/);
  assert.match(nextSetupStep(ready, true), /invite users/);
});
