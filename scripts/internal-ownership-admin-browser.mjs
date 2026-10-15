// Actual selected admin assets and API; only transport is relayed through strict-CA HTTPS.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

const [work] = process.argv.slice(2);
assert.ok(work && isAbsolute(work));
const fixture = JSON.parse(await readFile(join(work, 'fixture.json'), 'utf8'));
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.project, 'vaults-test-632a4442dfd2');
assert.equal(fixture.origin, 'https://127.0.0.1:12898');
const prior = JSON.parse(await readFile(join(work, 'ownership-evidence.json'), 'utf8'));
assert.equal(prior.status, 'passed');
const ca = await readFile('/identity/ca/ca.crt');
const { chromium } = createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/fixture/chrome/chrome', headless: true });
const errors = [], mutations = [], contexts = [];
let stage = 'sign in';
async function context() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  await context.route('**/*', async route => {
    const incoming = route.request();
    if (new URL(incoming.url()).origin !== fixture.origin) return route.abort();
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
      if (incoming.url().endsWith('/api/admin/actions')) {
        const input = JSON.parse(incoming.postData());
        mutations.push({ action: input.action, targetId: input.targetId, requestId: input.requestId, status: response.status });
      }
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['content-length', 'transfer-encoding', 'content-encoding'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch (error) { errors.push('TLS relay: ' + error.code); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function login(page, username, password) {
  await page.goto(fixture.origin + '/admin/');
  await page.getByLabel('Operator name').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'View account details for ownership_member', exact: true }).waitFor();
}
async function confirm(page, password) {
  await page.getByLabel('Confirm your operator password').fill(password);
  await page.locator('#management-submit').click();
}
try {
  const page = await context(), password = 'synthetic-ownership-owner-password';
  await login(page, 'lifecycleowner', password);
  stage = 'request ownership';
  await page.getByRole('button', { name: 'View account details for ownership_member', exact: true }).click();
  await page.getByRole('button', { name: 'Request ownership acceptance', exact: true }).click();
  await confirm(page, password);
  await page.getByText('Ownership request created.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Confirm your operator password').inputValue(), '');
  await page.locator('#management-close').click();
  stage = 'cancel ownership';
  await page.getByRole('button', { name: 'Roles & ownership', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await confirm(page, password);
  await page.getByText('Action completed.', { exact: false }).waitFor();
  await page.locator('#management-close').click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('No pending ownership requests loaded.', { exact: true }).waitFor();
  stage = 'last-owner error and retry';
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'View account details for owner_127', exact: true }).click();
  await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await confirm(page, password);
  await page.getByText('Keep at least one active owner.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Confirm your operator password').inputValue(), '');
  assert.equal(await page.locator('#management-submit').isEnabled(), true);
  await confirm(page, password);
  await page.getByText('Keep at least one active owner.', { exact: false }).waitFor();
  await page.locator('#management-close').click();
  const denials = mutations.filter(row => row.action === 'account.suspend');
  assert.equal(denials.length, 2);
  assert.ok(denials.every(row => row.status === 409));
  assert.equal(denials[0].requestId, denials[1].requestId);
  stage = 'audit and narrow layout';
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  for (const action of ['ownership.request', 'ownership.cancel', 'account.suspend']) await page.getByRole('cell', { name: action, exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  stage = 'admin operator restrictions';
  const admin = await context();
  await login(admin, 'lifecycleadmin', 'synthetic-ownership-admin-password');
  await admin.getByRole('button', { name: 'View account details for ownership_member', exact: true }).click();
  assert.equal(await admin.getByRole('button', { name: 'Request ownership acceptance', exact: true }).count(), 0);
  await admin.locator('#close-details').click();
  await admin.getByRole('button', { name: 'View account details for owner_127', exact: true }).click();
  assert.equal(await admin.getByRole('button', { name: 'Suspend account', exact: true }).count(), 0);
  assert.equal(await admin.getByRole('button', { name: 'Remove elevated role', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.equal(mutations.filter(row => row.action === 'ownership.request' && row.status === 200).length, 1);
  assert.equal(mutations.filter(row => row.action === 'ownership.cancel' && row.status === 200).length, 1);
  await writeFile(join(work, 'ownership-admin-browser.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, serverRevision: fixture.serverRevision, mutations, checks: ['Actual selected admin UI request/cancel and refreshed empty pending list', 'Friendly last-owner error; password clearing and enabled retry; same request ID on retry', 'Audit events and narrow-layout overflow check', 'Separate admin operator UI cannot request ownership or mutate owner accounts', 'No browser page errors; strict fixture-CA HTTPS for all assets and API'], limits: ['Headless Linux Chromium with strict Node TLS relay, not Windows physical browser acceptance', 'Customer acceptance UI and stale-authentication boundary remain separate'] }, null, 2) + '\n');
  console.log('Selected admin ownership browser acceptance passed.');
} catch (error) {
  await writeFile(join(work, 'ownership-admin-browser-failure.json'), JSON.stringify({ stage, error: error.message, mutations, errors }, null, 2) + '\n');
  throw Error('Owned admin browser check failed at ' + stage + '; inspect retained private diagnostic.');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
