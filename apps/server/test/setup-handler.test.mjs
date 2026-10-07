import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSetupHandler } from '../src/setup-handler.mjs';

test('setup status guides first owner without disclosing account or bootstrap material', async () => {
  let ownerExists = false;
  const installationId = randomUUID();
  const pool = { query: async () => ({ rows: [{ id: installationId, owner_exists: ownerExists }] }) };
  const handler = createSetupHandler({ pool, origin: 'https://127.0.0.1:12780', smtpConfigured: false });
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/v1/setup`;
  try {
    const first = await (await fetch(url)).json();
    assert.deepEqual(first, { ownerRequired: true, licenseMode: 'experimental',
      licenseEnforcement: 'disabled', licenseClockState: 'not_applicable', smtpConfigured: false });
    assert.ok(!JSON.stringify(first).includes(installationId));
    ownerExists = true;
    assert.equal((await (await fetch(url)).json()).ownerRequired, false);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
