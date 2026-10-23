// Load the verified extension archive in a disposable browser profile. Native
// requests from its popup are synthetic; never use an operator's connector/profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyRelease } from '../../../scripts/release/verify-release.mjs';
import { execute } from '../../../scripts/release/process.mjs';
import { outside } from '../../../scripts/release/plan.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--release' || args[2] !== '--work') throw Error('Use --release <verified extension release> --work <new external folder>.');
const release = resolve(args[1]), work = outside(resolve(import.meta.dirname, '../../..'), args[3], 'Extension startup work');
const manifest = await verifyRelease(release);
assert.equal(manifest.product, 'extension');
const archive = manifest.files.filter(file => file.name.endsWith('.zip'));
assert.equal(archive.length, 1);
await mkdir(work);
await execute('tar', ['-xf', join(release, archive[0].name), '-C', work]);
const extension = join(work, '127vaults-extension');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const context = await chromium.launchPersistentContext(join(work, 'browser-profile'), {
  headless: true, channel: 'chromium',
  ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}),
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).hostname;
  await context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => message?.kind === 'connector.request'
      ? Promise.resolve({ ok: true, value: { version: 1, sources: [] } })
      : original(message, ...args);
  });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.trim());
  const result = await page.evaluate(async () => {
    const module = await import(chrome.runtime.getURL('src/passkeys.mjs'));
    const origin = 'https://synthetic.example.test';
    const made = await module.createPasskey({ challenge: module.encode(new Uint8Array(32).fill(3)), rp: { id: 'synthetic.example.test' }, user: { id: 'AQ', name: 'synthetic', displayName: 'Synthetic' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] }, origin, true);
    const parsed = module.readMetadata(module.passkeyFields(made.metadata, made.privateKey));
    const assertion = await module.assertPasskey(parsed, made.privateKey, { challenge: module.encode(new Uint8Array(32).fill(4)) }, origin, true);
    return { metadata: parsed.username, sameCredential: assertion.id === made.metadata.credentialId };
  });
  assert.deepEqual(result, { metadata: 'synthetic', sameCredential: true });

  assert.equal(await page.locator('#source-select').count(), 1);
  assert.deepEqual(errors, []);
  await writeFile(join(work, 'evidence.json'), JSON.stringify({ status: 'passed', sourceRevision: manifest.sourceRevision, packageVersion: manifest.packageVersion, backgroundStarted: true, packagedTransitiveImports: true, passkeyCreateAndAssert: true, popupStarted: true, nativeConnector: 'synthetic; tested separately' }, null, 2) + '\n');
  console.log('Packaged extension background, passkey module graph and popup started.');
} finally { await context.close(); }
