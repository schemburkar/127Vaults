// Actual customer UI, enrollment and ownership; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { sign } from 'node:crypto';
import { ownershipClient } from './ownership-client.mjs';

const [work, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === '--stale-auth');
const staleAuth = mode === '--stale-auth';
const evidenceName = staleAuth ? 'ownership-customer-stale' : 'ownership-customer-browser';
assert.ok(work && isAbsolute(work));
const fixture = JSON.parse(await readFile(join(work, 'fixture.json'), 'utf8'));
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.project, 'vaults-test-632a4442dfd2');
assert.equal(fixture.origin, 'https://127.0.0.1:12898');
const prior = JSON.parse(await readFile(join(work, 'ownership-evidence.json'), 'utf8'));
assert.equal(prior.status, 'passed');
const ca = await readFile('/identity/ca/ca.crt');
const { chromium } = createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launchPersistentContext(join(work, 'ownership-customer-profile'), { executablePath: '/fixture/chrome/chrome', headless: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const errors = [], mutations = [], transports = [];
let stage = 'sign in';
async function context() {
  const context = browser;
  await context.route('**/*', async route => {
    const incoming = route.request();
    if (new URL(incoming.url()).origin !== fixture.origin) { errors.push('Off-origin: ' + new URL(incoming.url()).origin + new URL(incoming.url()).pathname); return route.abort(); }
    try {
      const response = await new Promise((resolve, reject) => {
        const req = request(incoming.url(), { method: incoming.method(), ca, timeout: 15000, headers: incoming.headers() }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(Error('Owned TLS relay timed out')));
        req.end(incoming.postDataBuffer());
      });
      transports.push({ path: new URL(incoming.url()).pathname, status: response.status });
      if (/\/api\/v1\/ownership\/requests\/[^/]+\/accept$/.test(incoming.url())) {
        const input = JSON.parse(incoming.postData());
        mutations.push({ action: 'ownership.accept', requestId: input.requestId, status: response.status, ...(response.status !== 200 ? { error: JSON.parse(response.body).error } : {}) });
      }
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['content-length', 'transfer-encoding', 'content-encoding'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch (error) { errors.push('TLS relay: ' + error.code); await route.abort(); }
  });
  const page = await context.newPage();
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.setBypassServiceWorker', { bypass: true });
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
const client = await ownershipClient(work, '/identity');
const metadata = JSON.parse(await readFile(join(work, 'ownership-member.json'), 'utf8'));
assert.equal(metadata.serverId, fixture.serverId);
assert.equal(metadata.fixtureSigningSeed, 10);
const member = new client.Account(metadata.accountId, metadata.deviceId, metadata.username, 10);
const operator = await client.operator('lifecycleowner', 'synthetic-ownership-owner-password');
let grant, accepted = false, elapsedMs;
async function unlock(page) {
  if (await page.locator('#login-next').isVisible()) {
    await page.locator('#username').fill(metadata.username);
    await page.locator('#login-next').click();
  }
  if (await page.locator('#secret').isVisible()) await page.locator('#secret').fill('07'.repeat(32));
  await page.locator('#master').fill('fictitious password 127vaults');
  await page.locator('#login').click();
  await page.waitForFunction(() => document.querySelector('#vault')?.hidden === false && document.querySelector('#state')?.textContent.startsWith('Unlocked'), null, { timeout: 60000 });
  await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
}
try {
  await member.login();
  stage = 'real browser enrollment';
  const page = await context();
  await page.goto(fixture.origin);
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
  if (await page.locator('#login-next').isVisible()) {
    await page.locator('#username').fill(metadata.username);
    await page.locator('#login-next').click();
  }
  await page.waitForFunction(() => document.querySelector('#register-browser-device')?.checkVisibility() || document.querySelector('#master')?.checkVisibility());
  if (await page.locator('#register-browser-device').isVisible()) {
    await page.locator('#register-browser-device').click();
    await page.locator('#browser-enrollment-code').waitFor({ state: 'visible' });
    const code = (await page.locator('#browser-enrollment-code').textContent()).trim();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    const binding = (await member.call('/api/v1/device-enrollment/inspect', { body: { code } })).value;
    assert.equal(binding.accountId, metadata.accountId);
    const approvalSignature = sign(null, Buffer.from(JSON.stringify(binding, Object.keys(binding).sort())), member.key).toString('base64url');
    await member.call('/api/v1/device-enrollment/' + binding.enrollmentId + '/approval', { body: { approvalSignature } });
    await page.locator('#browser-enrollment-check').click();
    await page.locator('#browser-enrollment-dialog').waitFor({ state: 'hidden' });
    await writeFile(join(work, 'ownership-customer-device.json'), JSON.stringify({ serverId: fixture.serverId, accountId: metadata.accountId, deviceId: binding.newDeviceId, enrollment: 'Actual browser-generated nonextractable key and signed approval/possession completion' }, null, 2) + '\n');
    console.log('Customer browser enrollment completed through signed approval and possession proof.');
  }
  stage = 'unlock and display grant';
  grant = await client.action(operator, 'ownership.request', { targetId: metadata.accountId });
  await unlock(page);
  const authenticatedAt = Date.now();
  // Use visible settings controls, not direct action invocations or seeded keys.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#settings').getByRole('button', { name: 'Devices', exact: true }).click();
  const accept = page.getByRole('button', { name: /^Accept ownership · expires / });
  await accept.waitFor();
  assert.equal(await accept.count(), 1);
  stage = 'cancel customer confirmation';
  await accept.click();
  await page.getByRole('heading', { name: 'Accept server ownership?', exact: true }).waitFor();
  await page.locator('#confirm-cancel').click();
  assert.equal(mutations.length, 0);
  await accept.waitFor();
  if (staleAuth) {
    stage = 'real elapsed browser session aging';
    console.log('Real customer browser session unlocked; aging beyond five minutes without reauthentication.');
    while (Date.now() - authenticatedAt < 310000) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, 310000 - (Date.now() - authenticatedAt))));
      // Harmless visible activity avoids the separate inactivity lock. Refresh
      // uses the same session; it never creates a fresh authentication ceremony.
      await page.locator('#reload-devices').click();
      console.log('Owned browser stale-auth wait: ' + Math.floor((Date.now() - authenticatedAt) / 1000) + ' seconds.');
    }
    elapsedMs = Date.now() - authenticatedAt;
    stage = 'stale customer acceptance guidance';
    await accept.click();
    await page.locator('#confirm-accept').click();
    await page.getByText('Lock and unlock again, then accept this request within five minutes.', { exact: true }).waitFor();
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].status, 403);
    assert.equal(mutations[0].error, 'fresh_auth_required');
    assert.equal(await page.locator('#vault').isVisible(), true);
    await accept.waitFor();
    await page.locator('#close-settings').click();
    await page.locator('#lock-app').click();
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
    await unlock(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#settings').getByRole('button', { name: 'Devices', exact: true }).click();
    await accept.waitFor();
  }
  stage = 'accept customer confirmation';
  await accept.click();
  await page.locator('#confirm-accept').click();
  await page.waitForFunction(() => document.querySelector('#vault')?.hidden === true && document.querySelector('#state')?.textContent === 'Locked');
  assert.equal(mutations.length, staleAuth ? 2 : 1);
  assert.equal(mutations.at(-1).status, 200);
  accepted = true;
  await page.getByText('Ownership accepted', { exact: true }).waitFor();
  stage = 'fresh unlock after ownership';
  await unlock(page);
  assert.equal(await page.getByRole('button', { name: /^Accept ownership · expires / }).count(), 0);
  const vaults = await page.evaluate(() => window.__vaultsSnapshot);
  assert.ok(Array.isArray(vaults));
  assert.equal(vaults.length, 0);
  await page.locator('#lock-app').click();
  await page.waitForFunction(() => document.querySelector('#vault')?.hidden === true && document.querySelector('#state')?.textContent === 'Locked');
  assert.deepEqual(errors, []);
  const checks = ['Real browser-generated device enrollment approved by original member device; no key/session seeding', 'Real browser OPAQUE unlock displays ownership request under Settings/Devices', 'Cancelling confirmation sends no acceptance; confirming sends one successful request and locks the client', 'Fresh unlock succeeds and clears accepted request; private vault directory remains empty; final lock'];
  if (staleAuth) checks.push('Real aged session receives fresh_auth_required and exact lock/unlock guidance without losing the request; visible lock/unlock recovers successful acceptance');
  await writeFile(join(work, evidenceName + '.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, serverRevision: fixture.serverRevision, mutations, ...(staleAuth ? { elapsedMs } : {}), checks, limits: ['Headless Linux ordinary web browser with strict-CA HTTPS relay and service-worker bypass; physical PWA install/update and Windows acceptance separate', ...(!staleAuth ? ['Stale-authentication server boundary has separate real elapsed-time evidence; stale UI toast not exercised here'] : [])] }, null, 2) + '\n');
  console.log('Selected customer ownership browser acceptance passed.');
} catch (error) {
  await writeFile(join(work, 'ownership-customer-browser-failure-' + Date.now() + '.json'), JSON.stringify({ stage, error: error.message, mutations, errors, transports }, null, 2) + '\n', { flag: 'wx' });
  throw Error('Owned customer browser check failed at ' + stage + '; inspect private retained diagnostic.');
} finally {
  if (grant) {
    if (accepted || mutations.some(row => row.status === 200)) await client.action(operator, 'role.set', { targetId: metadata.accountId, role: 'user' });
    else await client.action(operator, 'ownership.cancel', { targetId: grant.grantId });
    const accounts = await client.http('/api/admin/users', { headers: { cookie: operator.cookie } });
    assert.equal(accounts.status, 200);
    assert.equal(accounts.value.users.find(row => row.id === metadata.accountId)?.role, 'user');
    assert.equal(accounts.value.users.find(row => row.id === '11111111-1111-4111-8111-111111111111')?.role, 'owner');
    await writeFile(join(work, staleAuth ? 'ownership-customer-stale-cleanup.json' : 'ownership-customer-cleanup.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, memberRole: 'user', originalRole: 'owner' }, null, 2) + '\n');
  }
  await browser.close();
}
