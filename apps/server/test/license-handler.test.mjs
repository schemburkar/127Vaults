import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AUTH_COOKIE } from '../src/auth-policy.mjs';
import { createLicenseHandler } from '../src/license-handler.mjs';

test('authenticated license status reports seat use without disclosing installation identity', async () => {
  const installationId = randomUUID();
  const pool = { query: async sql => sql.includes('FROM vaults.installation')
    ? { rows: [{ id: installationId }] }
    : { rows: [{ active_users: 2, reserved_seats: 1 }] } };
  const handler = createLicenseHandler({ pool, authenticate: async () => ({}), origin: 'https://127.0.0.1:12780' });
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/v1/license`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { cookie: `${AUTH_COOKIE}=${'A'.repeat(43)}` } });
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.mode, 'missing');
    assert.equal(status.activeUsers, 2);
    assert.equal(status.reservedSeats, 1);
    assert.equal(status.seatsAvailable, null);
    assert.ok(!JSON.stringify(status).includes(installationId));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
