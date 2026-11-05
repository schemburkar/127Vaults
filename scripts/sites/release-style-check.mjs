// Render the real staged pages with synthetic API data and no external network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageSite, repository } from './assets.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const temporary = await mkdtemp(join(tmpdir(), '127v-release-style-'));
const output = join(repository, '.tools/site-checks/release-style'); await mkdir(output, { recursive: true });
const source = 'a'.repeat(40), hash = 'b'.repeat(64);
const artifacts = [
  ['installer-windows', 'installer', 'windows', 'installer.zip'], ['installer-linux', 'installer', 'linux', 'installer.tar.gz'],
  ['server', 'server', 'linux', 'server.tar'], ['cli-windows', 'cli', 'windows', 'cli.zip'],
  ['extension', 'extension', 'chromium', 'extension.zip'], ['checksums', 'checksums', 'all', 'SHA256SUMS.txt', true],
].map(([id, product, platform, filename, supporting]) => ({ id, product, platform, filename, supporting: Boolean(supporting), label: `${product} / ${platform}`, sha256: hash, sizeBytes: 1048576 }));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}) });
try {
  const sites = {};
  for (const surface of ['admin', 'customer']) {
    const site = await stageSite(surface, join(temporary, surface));
    sites[surface] = new Map(await Promise.all(site.files.map(async file => [file, await readFile(join(site.directory, file))])));
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), surface = url.hostname === 'admin.example.invalid' ? 'admin' : url.hostname === 'manage.example.invalid' ? 'customer' : null;
    if (!surface) return route.abort();
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/access-admin/requests') return json({ requests: [] });
    if (url.pathname === '/api/access-admin/releases') return json({ sourceRevision: source, artifacts });
    if (url.pathname.startsWith('/api/access-admin/releases/artifacts/')) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="review-fixture.zip"' }, body: 'synthetic review download' });
    }
    if (url.pathname === '/api/customer/invitation') return json({ signedIn: true });
    if (/^\/api\/trials\/[a-f0-9]{64}$/.test(url.pathname)) return json({ sourceRevision: source, artifacts, state: 'approved', maxUsers: 2, linkExpiresAt: '2099-01-01T00:00:00Z' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' });
    const path = url.pathname.slice(1) || 'index';
    const file = path.includes('.') ? path : path + '.html', bytes = sites[surface].get(file);
    if (!bytes) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: bytes });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://admin.example.invalid/releases');
  await page.locator('.trial-installer-card').first().waitFor();
  assert.equal(await page.locator('.trial-installer-card').count(), 2);
  assert.equal(await page.locator('#release-artifacts table').count(), 1);
  assert.equal(await page.locator('.trial-supporting').getAttribute('open'), null);
  assert.equal(await page.locator('#release-artifacts tbody.trial-os-group').count(), 0);
  assert.equal(await page.locator('#release-artifacts .trial-os-group').count(), 3);
  await page.screenshot({ path: join(output, 'admin-table.png'), fullPage: true });
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  assert.equal(await page.locator('#release-artifacts .trial-artifact').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Card view', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Windows setup installer' }).click();
  assert.equal((await downloaded).url(), 'https://admin.example.invalid/api/access-admin/releases/artifacts/installer-windows');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The mobile page must not overflow horizontally');
  await page.screenshot({ path: join(output, 'admin-mobile.png'), fullPage: true });
  await page.goto(`https://manage.example.invalid/trial#${'c'.repeat(64)}.${'D'.repeat(43)}`);
  await page.locator('.trial-installer-card').first().waitFor();
  assert.equal(await page.locator('.trial-installer-card').count(), 2);
  assert.equal(await page.locator('#trial-artifacts table').count(), 1);
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  assert.equal(await page.locator('#trial-artifacts .trial-artifact').count(), 3);
  assert.deepEqual(errors, []);
  await context.close();
  await writeFile(join(output, 'verification.json'), JSON.stringify({ passed: true, verifiedAt: new Date().toISOString(), checks: ['admin installer cards', 'grouped table and card toggle', 'collapsed supporting files', 'admin-only download URL', 'mobile width', 'customer invitation rendering preserved', 'no browser errors'] }, null, 2));
  console.log('Admin and invitation download styling passed browser checks.');
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
