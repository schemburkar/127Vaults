import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockSelfHostHandler } from '../src/mock-selfhost.mjs';
import { verifyLicenseFile } from '../../server/src/license-status.mjs';

test('mock checkout requires an access capability and binds one signed license to one installation', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-mock-'));
  const bundle = join(dir, 'bundle.zip');
  await writeFile(bundle, 'test bundle');
  const issuerPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  let code;
  const server = createServer(createMockSelfHostHandler({ origin: 'https://127vaults.example', key: randomBytes(32),
    dataDir: join(dir, 'orders'), bundleFile: bundle, issuerPrivateKey,
    mailer: { sendCode: async value => { code = value.code; } },
    now: () => new Date('2026-10-07T00:00:00.000Z') }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/selfhost/mock`;
  const post = (url, value, token, origin = 'https://127vaults.example') => fetch(url, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(value) });
  try {
    const orderInput = { email: 'Owner@example.com', organization: '', plan: 'personal', website: '', consent: true };
    assert.equal((await post(`${root}/orders`, orderInput, null, 'https://evil.example')).status, 403);
    const created = await (await post(`${root}/orders`, orderInput)).json();
    const base = `${root}/orders/${created.orderId}`;
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/bundle`, { headers: { Authorization: `Bearer ${created.accessToken}` } })).status, 403);
    assert.equal((await post(`${base}/pay`, {}, created.accessToken)).status, 403);
    assert.equal((await post(`${base}/verify`, { code: '000000' }, created.accessToken)).status, 403);
    assert.equal((await post(`${base}/verify`, { code }, created.accessToken)).status, 200);
    assert.equal((await post(`${base}/pay`, {}, created.accessToken)).status, 400);
    assert.deepEqual(await (await post(`${base}/pay`, { commitmentYears: 1, requestedUsers: 5, termsAcknowledged: true }, created.accessToken)).json(), { state: 'mock_paid', simulated: true });
    assert.equal(await (await fetch(`${base}/bundle`, { headers: { Authorization: `Bearer ${created.accessToken}` } })).text(), 'test bundle');
    const installationId = randomUUID();
    const first = await (await post(`${base}/license`, { installationId }, created.accessToken)).json();
    const repeat = await (await post(`${base}/license`, { installationId }, created.accessToken)).json();
    assert.deepEqual(repeat, first);
    assert.equal((await post(`${base}/license`, { installationId: randomUUID() }, created.accessToken)).status, 409);
    const keys = await (await fetch(`${base}/public-keys`, { headers: { Authorization: `Bearer ${created.accessToken}` } })).json();
    assert.equal(verifyLicenseFile(JSON.stringify(first.license), keys, installationId).plan, 'personal');
    assert.equal((await post(`${base}/recover`, { email: 'other@example.com' })).status, 202);
    assert.equal((await post(`${base}/recover`, { email: 'owner@example.com' })).status, 202);
    assert.equal((await post(`${base}/recover-complete`, { email: 'owner@example.com', code: '000000' })).status, 403);
    const recovered = await (await post(`${base}/recover-complete`, { email: 'owner@example.com', code })).json();
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${created.accessToken}` } })).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${recovered.accessToken}` } })).status, 200);
    const commercial = await (await post(`${root}/orders`, { ...orderInput, email: 'team@example.com', plan: 'commercial' })).json();
    const team = `${root}/orders/${commercial.orderId}`;
    assert.equal((await post(`${team}/verify`, { code }, commercial.accessToken)).status, 200);
    assert.equal((await post(`${team}/pay`, { commitmentYears: 1, requestedUsers: 12, termsAcknowledged: true }, commercial.accessToken)).status, 400);
    assert.equal((await post(`${team}/pay`, { commitmentYears: 5, requestedUsers: 12, termsAcknowledged: true }, commercial.accessToken)).status, 200);
    const teamLicense = await (await post(`${team}/license`, { installationId: randomUUID() }, commercial.accessToken)).json();
    assert.equal(verifyLicenseFile(JSON.stringify(teamLicense.license), keys, teamLicense.installationId).maxActiveUsers, 12);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
