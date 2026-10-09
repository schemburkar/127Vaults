// Real Edge popup UI regression with a disposable, synthetic vault source.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://popup.example.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = await readFile(new URL(path === '/' ? '../popup.html' : '..' + path, import.meta.url), 'utf8');
    if (path === '/') body = body.replace('<script type="module" src="src/popup.mjs"></script>', '');
    await route.fulfill({ contentType: path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body });
  });
  await page.goto('https://popup.example.test/');
  const result = await page.evaluate(async () => {
    let saved = false, pending = true, approval;
    const entry = { itemId: 'item', vaultId: 'vault', vaultName: 'Private', metadata: { username: 'alice', displayName: 'Alice', rpId: 'autofill.me' }, sync: { pending: true } };
    window.chrome = {
      storage: { local: { async get() { return { passkeysAllSites: true }; } } },
      permissions: { async contains() { return true; } },
      scripting: { async getRegisteredContentScripts() { return [{ id: 'passkey-bridge-all', world: 'ISOLATED', matches: ['https://*/*'] }, { id: 'passkey-page-all', world: 'MAIN', matches: ['https://*/*'] }]; } },
      runtime: { async sendMessage(message) {
        if (message.kind === 'passkey.pending') return { requests: pending ? [{ id: 'request', operation: 'create', origin: 'https://autofill.me', options: { user: { name: 'alice' } } }] : [] };
        if (message.kind === 'passkey.choices') return { entries: [], vaults: [{ vaultId: 'vault', name: 'Private' }] };
        if (message.kind === 'passkey.approve') { approval = { ...message }; saved = true; pending = false; return { ok: true, queued: true }; }
        throw Error('Unexpected request');
      } },
    };
    const { setupPasskeyPopup } = await import('/src/popup-passkeys.mjs');
    const popup = setupPasskeyPopup({ getTab: () => ({ id: 1, url: 'https://autofill.me/form/passkeys-register.html' }), getSource: () => 'desktop', getSources: () => [{ id: 'desktop', usernameHint: 'owner', hasCachedSecret: true }], status: value => document.getElementById('status').textContent = value, listSavedPasskeys: async () => saved ? [entry] : [] });
    await popup.refresh();
    const hiddenSetup = document.getElementById('passkey-native-fields').hidden;
    document.getElementById('passkey-master').value = 'synthetic-test-password';
    await document.getElementById('passkey-approve').onclick();
    const savedText = document.getElementById('passkey-save-status').textContent;
    await popup.refreshSaved();
    const localText = document.getElementById('saved-passkey-items').textContent;
    entry.sync.pending = false;
    await popup.refreshSaved();
    return { submittedVault: approval.vaultId, hiddenSetup, savedText, localText, syncedText: document.getElementById('saved-passkey-items').textContent, visible: !document.getElementById('saved-passkeys').hidden, passwordCleared: !document.getElementById('passkey-master').value, submittedPassword: approval.masterPassword };
  });
  assert(result.hiddenSetup && result.visible && result.passwordCleared);
  assert.equal(result.submittedPassword, 'synthetic-test-password');
  assert.equal(result.submittedVault, 'vault');
  assert.match(result.savedText, /Private.*Waiting to sync/);
  assert.match(result.localText, /Alice.*Private.*Waiting to sync/);
  assert.match(result.syncedText, /Alice.*Private.*Synced/);
  // Render the complete popup, not just the ceremony panel. Passkeys must
  // contribute to the matching list, search and empty-state calculation.
  const listing = await browser.newPage({ viewport: { width: 440, height: 650 } });
  await listing.route('https://popup.example.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = await readFile(new URL(path === '/' ? '../popup.html' : '..' + path, import.meta.url), 'utf8');
    if (path === '/') body = body.replace('<script type="module" src="src/popup.mjs"></script>', '');
    await route.fulfill({ contentType: path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body });
  });
  await listing.goto('https://popup.example.test/');
  await listing.evaluate(async () => {
    const entries = ['Alice', 'Bob'].map((name, index) => ({ itemId: 'item-' + index, vaultId: 'vault', vaultName: 'Private', title: name, metadata: { username: name.toLowerCase(), displayName: name, rpId: 'autofill.me' }, sync: { pending: false } }));
    window.chrome = {
      storage: { local: { async get() { return { passkeysAllSites: true }; } } },
      permissions: { async contains() { return true; } },
      scripting: { async getRegisteredContentScripts() { return [{ id: 'passkey-bridge-all', world: 'ISOLATED', matches: ['https://*/*'] }, { id: 'passkey-page-all', world: 'MAIN', matches: ['https://*/*'] }]; } },
      tabs: { async query() { return [{ id: 1, url: 'https://autofill.me/login' }]; } },
      runtime: { async sendMessage(message) {
        if (message.kind === 'passkey.select') { window.selectedPasskey = message.itemId; return { ok: true }; }
        if (message.kind === 'passkey.pending') return { requests: [] };
        if (message.kind === 'connector.request') {
          if (message.request.action === 'sources') return { ok: true, value: { sources: [{ id: 'desktop', configured: true, active: true, online: true }] } };
          if (message.request.action === 'list') return { ok: true, value: [] };
          if (message.request.action === 'passkey.list') return { ok: true, value: entries };
        }
        throw Error('Unexpected popup request');
      } },
    };
    await import('/src/popup.mjs');
  });
  await listing.waitForFunction(() => document.querySelectorAll('#items .item').length === 2);
  assert.equal(await listing.locator('#status').textContent(), '');
  await listing.getByRole('button', { name: 'Select passkey for Bob', exact: true }).click();
  await listing.waitForFunction(() => window.selectedPasskey === 'item-1');
  await listing.locator('#search').fill('alice');
  assert.equal(await listing.locator('#items .item').count(), 1);
  await listing.locator('#search').fill('');
  await listing.screenshot({ path: 'C:/Projects/127Vaults/target/passkey-popup-review.png', fullPage: true });
  console.log('Complete Edge popup: multiple passkeys are selectable, searchable sign-in rows; no false empty-state message.');
  console.log('Edge popup: cached account setup hidden, password verified and cleared, saved credential visible, sync status refreshes.');
} finally { await browser.close(); }
