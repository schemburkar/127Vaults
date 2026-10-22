import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createCustomerAccountHandler } from '../src/customer-account.mjs';
import { createMockSelfHostHandler } from '../src/mock-selfhost.mjs';

for (const type of ['customer', 'mock-order']) {
  test(`${type} denied address cannot allocate more email limiter records`, async () => {
    const dir = await mkdtemp(join(tmpdir(), '127v-budget-'));
    const key = Buffer.alloc(32, 1), origin = 'https://dummy.invalid';
    const dataDir = join(dir, 'data');
    const bundle = join(dir, 'bundle'); await writeFile(bundle, 'dummy');
    const handler = type === 'customer'
      ? createCustomerAccountHandler({ origin, key, dataDir, orderDir: join(dir, 'orders'), orderKey: key, mailer: { async sendCode() {} } })
      : createMockSelfHostHandler({ origin, key, dataDir, bundleFile: bundle,
        issuerPrivateKey: generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), mailer: { async sendCode() {} } });
    const limit = type === 'customer' ? 20 : 30;
    try {
      for (let i = 0; i < limit + 2; i++) {
        const input = { email: `dummy${i}@example.invalid`, consent: true,
          ...(type === 'customer' ? {} : { organization: '', plan: 'personal', website: '' }) };
        const req = Readable.from([JSON.stringify(input)]);
        req.url = type === 'customer' ? '/api/customer/start' : '/api/selfhost/mock/orders';
        req.method = 'POST'; req.headers = { origin, 'content-type': 'application/json' };
        req.socket = { remoteAddress: '192.0.2.1' };
        const res = { status: 0, writeHead(value) { this.status = value; }, end() {} };
        await handler(req, res);
        assert.equal(res.status, i < limit ? (type === 'customer' ? 202 : 201) : 429);
      }
      const files = await readdir(join(dataDir, 'request-limits'));
      assert.equal(files.filter(name => name.endsWith('.json')).length, limit + 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
