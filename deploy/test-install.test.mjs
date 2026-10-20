import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseContainerArgs, nextSetupStep, waitForReadiness } from './test-install.mjs';

test('restore container selection is scoped by both Compose labels and refuses an invalid project', () => {
  const args = databaseContainerArgs('vaults-test-123456789abc');
  assert.ok(args.includes('label=com.docker.compose.project=vaults-test-123456789abc'));
  assert.ok(args.includes('label=com.docker.compose.service=database'));
  for (const project of [undefined, '', 'vaults-acceptance', 'vaults-test-123456789abc\nother']) assert.throws(() => databaseContainerArgs(project));
});

const ready = { bootstrapRequired: false,
  license: { mode: 'active', clockState: 'trusted', maxActiveUsers: 5 },
  seatUsage: { activeUsers: 2, reservedSeats: 1 } };

test('operator setup guidance prioritizes license and clock problems', () => {
  assert.match(nextSetupStep({ ...ready, license: { mode: 'unavailable' } }, true), /inspect the signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'locked', clockState: 'rollback_detected' } }, true), /correct the host clock/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'revoked' } }, true), /new signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'read-only' } }, true), /renew the signed license/);
  assert.match(nextSetupStep({ ...ready, license: { mode: 'missing' } }, true), /install a signed license/);
});

test('operator setup guidance covers owner, SMTP, seat capacity and ready state', () => {
  assert.match(nextSetupStep({ ...ready, bootstrapRequired: true }, true), /install bootstrap/);
  assert.match(nextSetupStep(ready, false), /configure and verify SMTP/);
  assert.match(nextSetupStep({ ...ready, seatUsage: { activeUsers: 3, reservedSeats: 2 } }, true), /higher user cap/);
  assert.match(nextSetupStep(ready, true), /invite users/);
});


test('startup waits through transient unready responses and stops after its retry budget', async () => {
  let probes = 0, pauses = 0;
  const context = { origin: 'https://100.64.0.10:12780', ca: Buffer.from('test CA'), token: 'private-token' };
  await waitForReadiness({ ...context, attempts: 3, pause: async () => { pauses++; }, probe: async options => {
    assert.equal(options.ca, context.ca); assert.equal(options.token, context.token); return ++probes === 3;
  } });
  assert.equal(probes, 3); assert.equal(pauses, 2);
  probes = 0;
  await assert.rejects(waitForReadiness({ ...context, attempts: 2, pause: async () => {}, probe: async () => { probes++; return false; } }), /verified HTTPS/);
  assert.equal(probes, 2);
});
