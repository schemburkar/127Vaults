// Synthetic browser verification: every request is intercepted; no provider sends.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageSite, repository } from './assets.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), '127v-review-'));
const output = join(repository, '.tools/site-checks/request-review'); await mkdir(output, { recursive: true });
const site = await stageSite('admin', join(directory, 'admin'));
const assets = new Map(await Promise.all(site.files.map(async name => [name, await readFile(join(site.directory, name))])));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const id = 'a'.repeat(64), errors = [], actions = [];
  let enabled = true, state = 'requested';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'admin.example.invalid') return route.abort();
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/access-admin/requests') return json({ automaticCustomerEmail: enabled, requestAlertsEnabled: true, permissions: {}, requests: [
      { id, email: 'requester@example.invalid', contactName: 'Synthetic Requester', organization: 'Synthetic Organization', plan: 'personal', state, requestedSeats: 3, receivedAt: new Date().toISOString(), emailState: state === 'approved' ? 'queued' : 'not_sent', customerNotifications: { signup: 'queued' } },
      { id: 'b'.repeat(64), email: 'other@example.invalid', plan: 'personal', state: 'requested', receivedAt: new Date().toISOString() },
    ] });
    if (url.pathname.startsWith(`/api/access-admin/requests/${id}/`)) {
      actions.push(url.pathname.split('/').pop());
      if (actions.at(-1) === 'approve') state = 'approved';
      return json({ state, email: 'requester@example.invalid', subject: 'Synthetic invitation', message: 'Synthetic private invitation', emailState: 'queued' });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' });
    const name = url.pathname.slice(1), file = name.includes('.') ? name : name + '.html';
    if (!assets.has(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: assets.get(file) });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://admin.example.invalid/access-admin?request=${id}`);
  await page.locator('#requests tr').first().waitFor();
  assert.equal(await page.locator('#requests tr').count(), 1, 'Deep link selects only the intended request');
  const open = async label => { await page.locator('.request-menu-trigger').click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); };
  await open('Approve');
  assert.equal(await page.locator('#confirm-submit').isDisabled(), true);
  assert.match(await page.locator('#confirm-details').textContent(), /user limit: 3/);
  assert.match(await page.locator('#confirm-email').textContent(), /requester@example.invalid/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(actions, [], 'Cancel must never call the mutation API');
  await open('Approve');
  await page.locator('#confirm-check').check();
  await page.screenshot({ path: join(output, 'approve-desktop.png'), fullPage: true });
  await page.locator('#confirm-submit').click();
  await page.locator('#invitation').waitFor();
  assert.deepEqual(actions, ['approve']);
  assert.match(await page.locator('#invitation-guidance').textContent(), /automatic/);
  assert.match(await page.locator('#requests').textContent(), /Queued — delivery not confirmed/);
  await open('Close trial access');
  assert.match(await page.locator('#confirm-details').textContent(), /installed license/);
  await page.keyboard.press('Escape'); assert.deepEqual(actions, ['approve']);
  enabled = false; state = 'requested';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.locator('#requests tr').first().waitFor();
  await open('Decline');
  assert.match(await page.locator('#confirm-email').textContent(), /off.*manually/);
  assert.equal(await page.locator('#confirm-submit').isDisabled(), true, 'Acknowledgment resets between actions');
  const rect = await page.locator('#confirm-action').boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
  await page.screenshot({ path: join(output, 'decline-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(actions, ['approve']); assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ passed: true, verifiedAt: new Date().toISOString(), realEmailsSent: 0, checks: ['request deep link', 'explicit recipient and user limit', 'acknowledgment required', 'cancel and Escape do not mutate', 'one confirmed approval', 'automatic email guidance', 'queued is not delivered', 'manual fallback guidance', 'mobile dialog'] }, null, 2));
  console.log('Request review confirmation and email workflow browser checks passed.');
} finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
