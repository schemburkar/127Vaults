// End-to-end console regression using the real admin handler and synthetic rows.
// No operator files, live database, or existing installation are read or changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { hashPassword } from '../src/admin/credentials.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'https://admin.example.test';
const password = 'disposable-admin-browser-fixture-password';
const hashed = hashPassword(password);
const operator = { username: 'localowner', role: 'owner', salt: Buffer.from(hashed.salt, 'base64url'), hash: Buffer.from(hashed.hash, 'base64url') };
const uuid = (prefix, index) => `${prefix}000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const accounts = Array.from({ length: 137 }, (_, index) => ({
  id: uuid('a1', index), tenant_id: uuid('a0', 1), username: `user${String(index).padStart(3, '0')}`,
  display_name: index === 0 ? '<img src=x onerror=alert(1)> Alice & Co' : `Person ${index}`,
  email: `user${index}@example.invalid`, server_role: index === 0 ? 'owner' : 'user', enrollment_state: index % 5 ? 'active' : 'pending',
  email_verified: index % 3 !== 0, created_at: new Date(Date.UTC(2026, 9, 10) - index * 60_000).toISOString(), device_count: 1,
}));
const devices = accounts.map((account, index) => ({ id: uuid('d1', index), account_id: account.id, username: account.username, display_name: account.display_name,
  lifecycle_status: ['active', 'revoked', 'replaced', 'pending'][index % 4], protection_class: ['unknown', 'software', 'platform', 'hardware'][index % 4],
  credential_state: index % 3 ? 'current' : 'rotation_required', created_at: account.created_at, revoked_at: index % 4 === 1 || index % 4 === 2 ? account.created_at : null,
}));
const invitations = accounts.map((account, index) => ({ id: uuid('b1', Math.floor(index / 2)), email: `invite${String(index).padStart(3, '0')}@example.invalid`,
  created_by: 'user000', status: ['pending', 'redeemed', 'expired', 'revoked'][index % 4], created_at: account.created_at,
  expires_at: new Date(Date.now() + (index % 4 === 2 ? -1 : 1) * 86400_000).toISOString(),
  redeemed_at: index % 4 === 1 ? account.created_at : null, revoked_at: index % 4 === 3 ? account.created_at : null,
}));
let now = Date.now(), available = true, countLimit = accounts.length;
const pool = { async query(sql, values = []) {
  if (!available) throw Error('Synthetic database outage');
  if (sql.includes('schema_version')) return { rows: [{ version: 6 }] };
  if (sql.includes('AS active_users')) return { rows: [{ users: accounts.length, active_users: accounts.filter(a => a.enrollment_state === 'active').length }] };
  if (sql.includes('AS devices')) return { rows: [{ devices: devices.filter(d => d.lifecycle_status === 'active').length }] };
  const isUsers = sql.includes('FROM vaults.accounts a');
  const isInvitations = sql.includes('FROM vaults.invitation_records r');
  let rows = (isUsers ? accounts : isInvitations ? invitations : devices).slice(0, countLimit);
  let index = 0;
  if (sql.includes('position(lower(')) {
    const search = values[index++].toLowerCase();
    rows = rows.filter(row => (isUsers ? [row.username, row.display_name, row.email, row.id] : isInvitations ? [row.id, row.email, row.created_by] : [row.id, row.username, row.display_name]).join(' ').toLowerCase().includes(search));
  }
  if (sql.includes('a.enrollment_state=$') || sql.includes('d.lifecycle_status=$')) { const status = values[index++]; rows = rows.filter(row => (isUsers ? row.enrollment_state : row.lifecycle_status) === status); }
  if (isInvitations && sql.includes('END=$')) { const status = values[index++]; rows = rows.filter(row => row.status === status); }
  if (sql.includes('a.server_role=$')) { const role = values[index++]; rows = rows.filter(row => row.server_role === role); }
  if (sql.includes('d.protection_class=$')) { const protection = values[index++]; rows = rows.filter(row => row.protection_class === protection); }
  if (sql.includes('d.account_id::text=$')) { const account = values[index++]; rows = rows.filter(row => row.account_id === account); }
  if (sql.startsWith('SELECT count')) return { rows: [{ total: rows.length }] };
  if (/ORDER BY [adr]\.created_at ASC/.test(sql)) rows.reverse();
  if (sql.includes('ORDER BY r.expires_at ASC')) rows.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at) || a.email.localeCompare(b.email));
  return { rows: rows.slice(values[index + 1], values[index + 1] + values[index]) };
} };
const handler = createAdminHandler({ pool, operators: [operator], origin, schemaVersion: 6, now: () => now });
const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const outputDir = process.env.VAULTS_ADMIN_SCREENSHOTS ? resolve(process.env.VAULTS_ADMIN_SCREENSHOTS) : null;
const errors = [];
try {
  browser = await chromium.launch({ channel: process.env.VAULTS_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let signoutFailure = false, holdUsers, holdOverview, userStarted, overviewStarted;
  await context.route(`${origin}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/session' && request.method() === 'DELETE' && signoutFailure) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'admin_data_unavailable' }) }); return;
    }
    if (path === '/api/admin/users' && holdUsers) { userStarted?.(); await holdUsers; }
    if (path === '/api/admin/overview' && holdOverview) { overviewStarted?.(); await holdOverview; }
    const headers = request.headers();
    if (request.method() !== 'GET') headers.origin = origin;
    const response = await fetch(base + new URL(request.url()).pathname + new URL(request.url()).search, { method: request.method(), headers, body: request.postData() ?? undefined });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const waitText = (selector, text) => page.locator(selector).filter({ hasText: text }).waitFor();
  const section = name => page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name, exact: true }).click();
  const screenshot = async name => { if (outputDir) { await mkdir(outputDir, { recursive: true }); await page.screenshot({ path: resolve(outputDir, name + '.png'), fullPage: true }); } };
  await page.goto(origin + '/admin/');
  await page.getByLabel('Operator name').fill('localowner');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitText('h1', 'Overview');
  await waitText('.card', '137');
  assert.match(await page.locator('#session-status').textContent(), /30 minutes/);
  await screenshot('overview-desktop');
  await section('Users');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  assert.equal(await page.locator('tbody tr').count(), 25);
  assert.equal(await page.locator('tbody img').count(), 0);
  await screenshot('users-desktop');
  await page.getByRole('spinbutton', { name: 'Page number', exact: true }).fill('6');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await waitText('#directory-summary', 'Showing 126–137 of 137 users');
  await page.getByRole('spinbutton', { name: 'Page number', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await waitText('.pagination', `Page ${index + 2} of 6`);
  }
  await waitText('#directory-summary', 'Showing 126–137 of 137 users');
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
  countLimit = 2;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–2 of 2 users');
  countLimit = accounts.length;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await page.getByLabel('Sort by', { exact: true }).selectOption('oldest');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  assert.match(await page.locator('tbody tr').first().textContent(), /user136/);
  await page.getByLabel('Sort by', { exact: true }).selectOption('newest');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await page.getByRole('searchbox', { name: 'Search users', exact: true }).fill('user136');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching users');
  assert.match(await page.locator('tbody').textContent(), /user136/);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await page.getByLabel('View account details for user000', { exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Full account ID').inputValue(), accounts[0].id);
  await screenshot('account-details');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('View account details for user000', { exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByLabel('View devices for user000', { exact: true }).click();
  await waitText('.account-scope', 'Alice & Co');
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching devices');
  await page.getByLabel(`View device details for ${devices[0].id}`, { exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Full device ID').inputValue(), devices[0].id);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'All accounts', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 devices');
  await page.getByLabel('Status', { exact: true }).selectOption('revoked');
  await page.getByLabel('Protection', { exact: true }).selectOption('software');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'matching devices');
  assert.equal(await page.locator('tbody tr').count(), 25);
  assert.match(await page.locator('tbody tr').first().textContent(), /Revoked.*Software/);
  await screenshot('devices-filtered');
  await page.getByRole('searchbox', { name: 'Search devices', exact: true }).fill('no-matching-device');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('.empty-state', 'No matching devices');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 devices');
  available = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitText('[role="alert"]', 'last loaded results');
  assert.equal(await page.locator('tbody tr').count(), 25);
  await screenshot('devices-outage');
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('[role="alert"]').waitFor({ state: 'hidden' });
  signoutFailure = true;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await waitText('[role="alert"]', 'Sign-out was not confirmed');
  assert.equal(await page.locator('#login-form').count(), 0);
  signoutFailure = false;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.locator('#login-form').waitFor();
  assert.equal(await page.getByLabel('Operator name').inputValue(), 'localowner');
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 devices');
  now += 31 * 60_000;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitText('[role="alert"]', 'session expired');
  assert.equal(await page.locator('tbody').count(), 0);
  now = Date.now();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 devices');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('devices-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow horizontally');
  await section('Users');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  // A skip link must stay on the selected section and move keyboard focus.
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true);
  assert.equal(new URL(page.url()).hash, '#users');
  // Reloading restores the section without storing search text in the URL.
  await page.reload();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await page.getByLabel('Rows per page', { exact: true }).selectOption('100');
  await waitText('#directory-summary', 'Showing 1–100 of 137 users');
  await page.getByLabel('Rows per page', { exact: true }).selectOption('25');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  // A delayed directory response must not overwrite another section.
  let releaseUsers;
  holdUsers = new Promise(done => { releaseUsers = done; });
  const usersRequested = new Promise(done => { userStarted = done; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await usersRequested;
  await section('Roles & ownership');
  releaseUsers(); holdUsers = null;
  await waitText('h1', 'Roles & ownership');
  await section('Users');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  // Overview and backups share a resource: completion must update either view.
  let releaseOverview;
  holdOverview = new Promise(done => { releaseOverview = done; });
  const overviewRequested = new Promise(done => { overviewStarted = done; });
  await section('Overview');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await overviewRequested;
  await section('Backups');
  releaseOverview(); holdOverview = null;
  await waitText('h2', 'Current backup status');
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  assert.match(await page.locator('main').textContent(), /Backup freshness is unknown/);
  await section('Users');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await screenshot('users-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const firstMobileDetails = page.getByLabel('View account details for user000', { exact: true });
  await firstMobileDetails.click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().width <= innerWidth), true);
  await screenshot('details-mobile');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await section('Invitations');
  await waitText('#directory-summary', 'Showing 1–25 of 137 invitation recipients');
  await screenshot('invitations-desktop');
  await page.getByRole('searchbox', { name: 'Search invitations', exact: true }).fill('invite136');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching invitation recipients');
  await page.getByLabel('View invitation details for invite136@example.invalid', { exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Full invitation ID').inputValue(), invitations[136].id);
  assert.match(await page.getByRole('dialog').textContent(), /internal record ID/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 invitation recipients');
  await page.getByLabel('Status', { exact: true }).selectOption('expired');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 34 matching invitation recipients');
  assert.ok((await page.locator('tbody .pill').allTextContents()).every(value => value === 'Expired'));
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('invitations-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, accounts: 137, pagination: true, search: true, filters: true, details: true, accountDevices: true, outageRetry: true, signoutFailure: true, expiry: true, mobile: true, screenshots: outputDir }));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
