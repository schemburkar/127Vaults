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
const longOperator = { ...operator, username: 'a'.repeat(64), role: 'admin' };
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
  if (sql.includes('AS devices')) {
    const active = devices.filter(d => d.lifecycle_status === 'active');
    return { rows: [{ devices: active.length, rotation_required: active.filter(d => d.credential_state === 'rotation_required').length, stale: active.filter(d => d.credential_state === 'stale').length, unknown_protection: active.filter(d => d.protection_class === 'unknown').length }] };
  }
  if (sql.includes('AS pending_invitations')) return { rows: [{ pending_invitations: invitations.filter(i => i.status === 'pending').length, expired_invitations: invitations.filter(i => i.status === 'expired').length }] };
  const isUsers = sql.includes('FROM vaults.accounts a');
  const isInvitations = sql.includes('FROM vaults.invitation_records r');
  let rows = (isUsers ? accounts : isInvitations ? invitations : devices).slice(0, countLimit);
  let index = 0;
  if (sql.includes('position(lower(')) {
    const search = values[index++].toLowerCase();
    rows = rows.filter(row => (isUsers ? [row.username, row.display_name, row.email, row.id] : isInvitations ? [row.id, row.email, row.created_by] : [row.id, row.username, row.display_name]).join(' ').toLowerCase().includes(search));
  }
  if (sql.includes('a.enrollment_state=$') || sql.includes("ELSE a.enrollment_state END)=$") || sql.includes('d.lifecycle_status=$')) { const status = values[index++]; rows = rows.filter(row => (isUsers ? row.enrollment_state : row.lifecycle_status) === status); }
  if (isInvitations && sql.includes('END=$')) { const status = values[index++]; rows = rows.filter(row => row.status === status); }
  if (sql.includes('a.server_role=$')) { const role = values[index++]; rows = rows.filter(row => row.server_role === role); }
  if (sql.includes('d.protection_class=$')) { const protection = values[index++]; rows = rows.filter(row => row.protection_class === protection); }
  if (sql.includes('d.credential_state=$')) { const credential = values[index++]; rows = rows.filter(row => row.credential_state === credential); }
  if (sql.includes('d.account_id::text=$')) { const account = values[index++]; rows = rows.filter(row => row.account_id === account); }
  if (sql.startsWith('SELECT count')) return { rows: [{ total: rows.length }] };
  if (/ORDER BY [adr]\.created_at ASC/.test(sql)) rows.reverse();
  if (sql.includes('ORDER BY r.expires_at ASC')) rows.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at) || a.email.localeCompare(b.email));
  return { rows: rows.slice(values[index + 1], values[index + 1] + values[index]) };
} };
pool.connect = async () => ({ query: (sql, values) => sql.startsWith('SELECT') ? pool.query(sql, values) : Promise.resolve({}), release() {} });
const handler = createAdminHandler({ pool, operators: [operator, longOperator], origin, schemaVersion: 6, now: () => now });
const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const outputDir = process.env.VAULTS_ADMIN_SCREENSHOTS ? resolve(process.env.VAULTS_ADMIN_SCREENSHOTS) : null;
const errors = [];
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} did not start within 10 seconds`)), 10_000); })]); }
  finally { clearTimeout(timer); }
}
try {
  browser = await chromium.launch({ channel: process.env.VAULTS_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let signoutFailure = false, malformedUsers = false, holdUsers, holdOverview, userStarted, overviewStarted;
  const intercept = async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/session' && request.method() === 'DELETE' && signoutFailure) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'admin_data_unavailable' }) }); return;
    }
    if (path === '/api/admin/users' && malformedUsers) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [{ id: null }] }) }); return;
    }
    if (path === '/api/admin/users' && holdUsers) { userStarted?.(); await holdUsers; }
    if (path === '/api/admin/overview' && holdOverview) { overviewStarted?.(); await holdOverview; }
    const headers = request.headers();
    if (request.method() !== 'GET') headers.origin = origin;
    const response = await fetch(base + new URL(request.url()).pathname + new URL(request.url()).search, { method: request.method(), headers, body: request.postData() ?? undefined });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  };
  await context.route(`${origin}/**`, intercept);
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
  await page.getByRole('button', { name: 'Review rotation', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–12 of 12 matching devices');
  assert.equal(await page.getByLabel('Credentials', { exact: true }).inputValue(), 'rotation_required');
  assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'active');
  await section('Overview');
  await page.getByRole('button', { name: 'Review expired', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 34 matching invitation recipients');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 invitation recipients');
  await section('Overview');
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
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching user');
  assert.match(await page.locator('tbody').textContent(), /user136/);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  await page.getByLabel('View account details for user000', { exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Full account ID').inputValue(), accounts[0].id);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { window.fixtureCopiedId = value; } } }));
  await page.getByRole('button', { name: 'Copy ID', exact: true }).click();
  await waitText('#copy-status', 'ID copied.');
  assert.equal(await page.evaluate(() => window.fixtureCopiedId), accounts[0].id);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { throw Error('Clipboard unavailable in fixture'); } } }));
  await page.getByRole('button', { name: 'Copy ID', exact: true }).click();
  await waitText('#copy-status', 'copy it manually');
  assert.equal(await page.getByLabel('Full account ID').evaluate(el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), true);
  await screenshot('account-details');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('View account details for user000', { exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByLabel('View devices for user000', { exact: true }).click();
  await waitText('.account-scope', 'Alice & Co');
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching device');
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
  await bounded(usersRequested, 'Users refresh');
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
  await bounded(overviewRequested, 'Overview refresh');
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
  await waitText('#directory-summary', 'Showing 1–1 of 1 matching invitation recipient');
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
  await section('Users');
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  malformedUsers = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitText('[role="alert"]', 'console and server versions match');
  assert.equal(await page.locator('tbody tr').count(), 25);
  malformedUsers = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#refresh-data').disabled);
  // An old request may finish after sign-out and a new sign-in. Its 401 must
  // never dismiss the new operator session or restore the old directory.
  let releaseOldUsers;
  holdUsers = new Promise(done => { releaseOldUsers = done; });
  const oldUsersRequested = new Promise(done => { userStarted = done; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await bounded(oldUsersRequested, 'Old-session users refresh');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.locator('#login-form').waitFor();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitText('h1', 'Users');
  holdUsers = null; releaseOldUsers();
  await waitText('#directory-summary', 'Showing 1–25 of 137 users');
  assert.equal(await page.locator('#login-form').count(), 0);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  // Check the local expiry timer independently of a failed API request.
  await page.clock.install({ time: Date.now() });
  await page.clock.fastForward(31 * 60_000);
  await waitText('[role="alert"]', 'operator session expired');
  assert.equal(await page.locator('tbody').count(), 0);
  // Sign-in errors preserve the operator name, clear the password and honor
  // the server's cooldown without repeatedly submitting blocked requests.
  now = Date.now();
  const loginContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await loginContext.route(`${origin}/**`, intercept);
  const loginPage = await loginContext.newPage();
  loginPage.on('pageerror', error => errors.push(error.message));
  await loginPage.clock.install({ time: Date.now() });
  await loginPage.goto(origin + '/admin/');
  await loginPage.getByLabel('Operator name').fill('localowner');
  await loginPage.getByLabel('Password', { exact: true }).fill('incorrect-fixture-password');
  await loginPage.getByRole('button', { name: 'Show password', exact: true }).click();
  assert.equal(await loginPage.getByLabel('Password', { exact: true }).getAttribute('type'), 'text');
  await loginPage.getByRole('button', { name: 'Hide password', exact: true }).click();
  await loginPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await loginPage.locator('[role="alert"]').filter({ hasText: 'Check your operator name and password' }).waitFor();
  assert.equal(await loginPage.getByLabel('Operator name').inputValue(), 'localowner');
  assert.equal(await loginPage.getByLabel('Password', { exact: true }).inputValue(), '');
  assert.equal(await loginPage.locator('#login-submit').isDisabled(), true);
  assert.match(await loginPage.locator('#login-submit').textContent(), /Try again in/);
  if (outputDir) await loginPage.screenshot({ path: resolve(outputDir, 'login-cooldown-mobile.png'), fullPage: true });
  now += 6000;
  await loginPage.clock.fastForward(6000);
  assert.equal(await loginPage.locator('#login-submit').isDisabled(), false);
  await loginPage.getByLabel('Password', { exact: true }).fill(password);
  await loginPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await loginPage.locator('h1').filter({ hasText: 'Overview' }).waitFor();
  await loginPage.locator('.card').filter({ hasText: '137' }).waitFor();
  assert.equal(await loginPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await loginContext.close();
  // Exercise the real request deadline; a hung request must release the UI
  // and a later retry must work without reloading or losing the session.
  now = Date.now();
  let releaseHungUsers;
  holdUsers = new Promise(done => { releaseHungUsers = done; });
  const hungUsersRequested = new Promise(done => { userStarted = done; });
  const timeoutContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await timeoutContext.route(`${origin}/**`, intercept);
  await timeoutContext.addCookies(await context.cookies());
  const timeoutPage = await timeoutContext.newPage();
  timeoutPage.on('pageerror', error => errors.push(error.message));
  await timeoutPage.goto(origin + '/admin/#users');
  await bounded(hungUsersRequested, 'Timeout fixture users request');
  assert.equal(await timeoutPage.locator('#refresh-data').isDisabled(), true);
  await timeoutPage.locator('[role="alert"]').filter({ hasText: 'took too long' }).waitFor({ timeout: 20_000 });
  assert.equal(await timeoutPage.locator('#refresh-data').isDisabled(), false);
  holdUsers = null; releaseHungUsers();
  await timeoutPage.getByRole('button', { name: 'Try again', exact: true }).click();
  await timeoutPage.locator('#directory-summary').filter({ hasText: 'Showing 1–25 of 137 users' }).waitFor();
  await timeoutContext.close();
  const narrowContext = await browser.newContext({ viewport: { width: 320, height: 740 } });
  await narrowContext.route(`${origin}/**`, intercept);
  const narrowPage = await narrowContext.newPage();
  narrowPage.on('pageerror', error => errors.push(error.message));
  await narrowPage.goto(origin + '/admin/');
  await narrowPage.getByLabel('Operator name').fill(longOperator.username);
  await narrowPage.getByLabel('Password', { exact: true }).fill(password);
  await narrowPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await narrowPage.locator('.card').filter({ hasText: '137' }).waitFor();
  const narrowFits = await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  if (!narrowFits) {
    if (outputDir) await narrowPage.screenshot({ path: resolve(outputDir, 'narrow-overflow.png'), fullPage: true });
    console.log(JSON.stringify(await narrowPage.evaluate(() => [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) })))));
  }
  assert.equal(narrowFits, true, 'Long operator names must fit at 320px');
  await narrowPage.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name: 'Users', exact: true }).click();
  await narrowPage.locator('#directory-summary').filter({ hasText: 'Showing 1–25 of 137 users' }).waitFor();
  assert.equal(await narrowPage.getByRole('table').count(), 1, 'Responsive records retain table semantics');
  assert.equal(await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await narrowPage.getByLabel('View account details for user000', { exact: true }).click();
  await narrowPage.getByRole('dialog').waitFor();
  assert.equal(await narrowPage.getByRole('dialog').evaluate(el => el.getBoundingClientRect().width <= innerWidth), true);
  await narrowContext.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, accounts: 137, pagination: true, pageJump: true, sorting: true, search: true, filters: true, details: true, accountDevices: true, invitations: true, reviewQueue: true, outageRetry: true, timeoutRetry: true, signoutFailure: true, expiry: true, staleRequestIsolation: true, clipboardFallback: true, cooldown: true, operatorRoles: ['owner', 'admin'], mobile: true, viewports: [1440, 390, 320], screenshots: outputDir }));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
