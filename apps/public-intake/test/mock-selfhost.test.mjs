import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockSelfHostHandler, pruneMockOrders } from '../src/mock-selfhost.mjs';
import { verifyLicenseFile } from '../../server/src/license-status.mjs';
import { verifyLicenseRevocationFile } from '../../server/src/license-status.mjs';

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
    const ticket = await post(`${base}/bundle-ticket`, {}, created.accessToken);
    assert.equal(ticket.status, 204);
    assert.match(ticket.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
    assert.equal(await (await fetch(`${base}/bundle`, { headers: { Cookie: ticket.headers.get('set-cookie').split(';')[0] } })).text(), 'test bundle');
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
    assert.equal((await fetch(`${base}/bundle`, { headers: { Cookie: ticket.headers.get('set-cookie').split(';')[0] } })).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${recovered.accessToken}` } })).status, 200);
    const commercial = await (await post(`${root}/orders`, { ...orderInput, email: 'team@example.com', plan: 'commercial' })).json();
    const team = `${root}/orders/${commercial.orderId}`;
    assert.equal((await post(`${team}/verify`, { code }, commercial.accessToken)).status, 200);
    assert.equal((await post(`${team}/pay`, { commitmentYears: 1, requestedUsers: 12, termsAcknowledged: true }, commercial.accessToken)).status, 400);
    assert.equal((await post(`${team}/pay`, { commitmentYears: 5, requestedUsers: 12, termsAcknowledged: true }, commercial.accessToken)).status, 200);
    const teamLicense = await (await post(`${team}/license`, { installationId: randomUUID() }, commercial.accessToken)).json();
    assert.equal(verifyLicenseFile(JSON.stringify(teamLicense.license), keys, teamLicense.installationId).maxActiveUsers, 12);
    const renewalId = randomUUID();
    const renewal = await (await post(`${team}/renew`, { requestId: renewalId, simulatedCheckoutAcknowledged: true }, commercial.accessToken)).json();
    const repeatedRenewal = await (await post(`${team}/renew`, { requestId: renewalId, simulatedCheckoutAcknowledged: true }, commercial.accessToken)).json();
    assert.deepEqual(repeatedRenewal, renewal);
    const originalPayload = verifyLicenseFile(JSON.stringify(teamLicense.license), keys, teamLicense.installationId);
    const renewedPayload = verifyLicenseFile(JSON.stringify(renewal.license), keys, teamLicense.installationId);
    assert.equal(renewedPayload.sequence, originalPayload.sequence + 1);
    assert.ok(Date.parse(renewedPayload.expiresAt) > Date.parse(originalPayload.expiresAt));
    const replacementId = randomUUID();
    const replacement = await (await post(`${team}/replace`, { installationId: replacementId,
      requestId: randomUUID(), simulatedReplacementAcknowledged: true }, commercial.accessToken)).json();
    assert.equal(verifyLicenseFile(JSON.stringify(replacement.license), keys, replacementId).sequence, 1);
    const revoked = await (await fetch(`${team}/revocation`, { headers: { Authorization: `Bearer ${commercial.accessToken}` } })).json();
    assert.equal(verifyLicenseRevocationFile(JSON.stringify(revoked.revocation), keys,
      teamLicense.installationId, renewedPayload.licenseId).installationId, teamLicense.installationId);
    assert.equal((await post(`${team}/erase`, {}, commercial.accessToken)).status, 200);
    assert.equal((await fetch(team, { headers: { Authorization: `Bearer ${commercial.accessToken}` } })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('mock order request limits survive a handler restart and old pending records are pruned', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-retention-'));
  const bundle = join(dir, 'bundle.tar');
  await writeFile(bundle, 'bundle');
  const key = randomBytes(32);
  const issuerPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const options = { origin: 'https://127vaults.example', key, dataDir: join(dir, 'orders'), bundleFile: bundle,
    issuerPrivateKey, mailer: { sendCode: async () => {} }, now: () => new Date('2026-10-07T00:00:00.000Z') };
  const order = { email: 'limit@example.com', organization: '', plan: 'personal', website: '', consent: true };
  const submit = async handler => {
    const server = createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { return await fetch(`http://127.0.0.1:${server.address().port}/api/selfhost/mock/orders`, { method: 'POST',
      headers: { Origin: options.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(order) }); }
    finally { await new Promise(resolve => server.close(resolve)); }
  };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await submit(createMockSelfHostHandler(options))).status, 201);
    assert.equal((await submit(createMockSelfHostHandler(options))).status, 429);
    assert.equal(await pruneMockOrders({ dataDir: options.dataDir, key,
      now: new Date('2026-11-07T00:00:00.000Z') }), 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
