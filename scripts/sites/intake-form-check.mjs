// All traffic is intercepted. No Turnstile validation or email is sent externally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageSite, repository } from './assets.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), '127v-intake-form-'));
const output = join(repository, '.tools/site-checks/intake-form'); await mkdir(output, { recursive: true });
const site = await stageSite('public', join(directory, 'public'));
const assets = new Map(await Promise.all(site.files.map(async name => [name, await readFile(join(site.directory, name))])));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [], posts = []; let verificationMode = 'success';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'text/javascript', body: `window.turnstile={render:(selector,options)=>{setTimeout(()=>options['${verificationMode === 'success' ? 'callback' : 'error-callback'}']('synthetic-provider-token'),0);return 'synthetic-widget'},remove:()=>{}};` });
    if (url.hostname !== 'public.example.invalid') return route.abort();
    if (url.pathname === '/api/waitlist') {
      if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"received":true}', status: 202 }); }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ open: true, protected: true, siteKey: 'synthetic-site-key', challenge: 'synthetic-challenge', challengeId: 'synthetic-id', waitMs: 15000 }) });
    }
    const name = url.pathname.slice(1), file = name.includes('.') ? name : name + '.html';
    if (!assets.has(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: assets.get(file) });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto('https://public.example.invalid/get-started');
  const button = page.getByRole('button', { name: 'Request access', exact: true }); await button.waitFor();
  await page.locator('#access-email').fill('synthetic@example.invalid'); await page.locator('[name=consent]').check();
  assert.equal(await page.locator('#access-contact-name').getAttribute('required'), '');
  await button.click(); assert.equal(posts.length, 0, 'Name is required before verification');
  await page.locator('#access-contact-name').fill('A chosen name'); await button.click();
  await page.waitForFunction(() => Boolean(window.turnstile));
  await page.clock.runFor(100); assert.equal(posts.length, 0); assert.equal(await button.isDisabled(), true);
  await page.screenshot({ path: join(output, 'waiting-mobile.png'), fullPage: true });
  await page.clock.runFor(15000);
  await page.waitForFunction(() => document.querySelector('#access-status').textContent.includes('Request received'));
  assert.equal(posts.length, 1); assert.equal(posts[0].contactName, 'A chosen name'); assert.equal(posts[0].challenge, 'synthetic-challenge'); assert.equal(posts[0].turnstileToken, 'synthetic-provider-token');
  assert.equal(await page.locator('#access-contact-name').inputValue(), '');
  verificationMode = 'error'; await page.reload();
  await page.locator('#access-contact-name').fill('Retained Name'); await page.locator('#access-email').fill('retained@example.invalid'); await page.locator('[name=consent]').check();
  await button.click(); await page.waitForFunction(() => Boolean(window.turnstile)); await page.clock.runFor(100);
  await page.waitForFunction(() => document.querySelector('#access-status').textContent.includes('could not complete verification'));
  assert.equal(posts.length, 1); assert.equal(await page.locator('#access-contact-name').inputValue(), 'Retained Name');
  assert.equal(await button.isDisabled(), false); assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ passed: true, verifiedAt: new Date().toISOString(), externalCalls: 0, checks: ['personal name required', 'no POST during wait', 'Turnstile response included', 'one successful request', 'failure retains details and permits retry', 'mobile rendering'] }, null, 2));
  console.log('Protected request form browser checks passed.');
} finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
