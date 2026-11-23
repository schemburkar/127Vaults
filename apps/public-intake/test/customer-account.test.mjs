import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockSelfHostHandler } from '../src/mock-selfhost.mjs';
import { createCustomerAccountHandler } from '../src/customer-account.mjs';

test('verified customer account lists only its orders, opens one, and erases its public data', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-customer-'));
  const orderDir = join(dir, 'orders');
  const bundle = join(dir, 'bundle.tar');
  await writeFile(bundle, 'bundle');
  const orderKey = randomBytes(32);
  const origin = 'https://127vaults.example';
  let code;
  const mailer = { sendCode: async value => { code = value.code; } };
  const mock = createMockSelfHostHandler({ origin, key: orderKey, dataDir: orderDir, bundleFile: bundle,
    issuerPrivateKey: generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), mailer });
  const customer = createCustomerAccountHandler({ origin, key: randomBytes(32), orderDir,
    dataDir: join(dir, 'customers'), orderKey, mailer });
  const server = createServer((req, res) => req.url.startsWith('/api/customer/') ? customer(req, res) : mock(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie = '') => fetch(root + path, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body) });
  try {
    const order = await (await post('/api/selfhost/mock/orders', { email: 'owner@example.com',
      organization: '', plan: 'personal', consent: true, website: '' })).json();
    const other = await (await post('/api/selfhost/mock/orders', { email: 'other@example.com',
      organization: '', plan: 'personal', consent: true, website: '' })).json();
    assert.ok(order.orderId);
    assert.equal((await post('/api/customer/start', { email: 'owner@example.com', consent: true })).status, 202);
    assert.equal((await post('/api/customer/complete', { email: 'owner@example.com', code: code === '000000' ? '000001' : '000000' })).status, 403);
    const signedIn = await post('/api/customer/complete', { email: 'owner@example.com', code });
    assert.equal(signedIn.status, 200);
    const previousCookie = signedIn.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/api/customer/start', { email: 'owner@example.com', consent: true })).status, 202);
    const renewed = await post('/api/customer/complete', { email: 'owner@example.com', code });
    assert.equal(renewed.status, 200);
    const cookie = renewed.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/api/customer/open-order', { orderId: order.orderId }, previousCookie)).status, 401);
    assert.equal((await post('/api/customer/logout', {}, previousCookie)).status, 401);
    assert.equal((await post('/api/customer/erase', { confirm: 'ERASE' }, previousCookie)).status, 401);
    assert.equal((await fetch(root + '/api/customer/me')).status, 401);
    const account = await (await fetch(root + '/api/customer/me', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(account.orders.map(item => item.orderId), [order.orderId]);
    assert.equal((await post('/api/customer/open-order', { orderId: other.orderId }, cookie)).status, 404);
    const opened = await (await post('/api/customer/open-order', { orderId: order.orderId }, cookie)).json();
    assert.equal((await fetch(`${root}/api/selfhost/mock/orders/${order.orderId}`,
      { headers: { Authorization: `Bearer ${opened.accessToken}` } })).status, 200);
    assert.equal((await post('/api/customer/erase', { confirm: 'ERASE' }, cookie)).status, 200);
    assert.equal((await fetch(root + '/api/customer/me', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${root}/api/selfhost/mock/orders/${order.orderId}`,
      { headers: { Authorization: `Bearer ${opened.accessToken}` } })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
