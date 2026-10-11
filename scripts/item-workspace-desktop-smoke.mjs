import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => {
    const items = ['Alpha', 'Beta'].map((title, i) => ({ title, itemId: `item-${i}`, vaultId: 'private', code: '', website: 'https://example.invalid', username: 'fixture-user', customFields: [] }));
    let next = 0; const callbacks = new Map(), listeners = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { const id = ++next; callbacks.set(id, fn); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(cmd, args) {
        if (cmd === 'desktop_info') return { configured: true, cachedUsername: 'fixture', hasCachedSecret: true };
        if (cmd === 'unlock') return { online: false, vaultId: 'private', vaults: [{ vaultId: 'private', name: 'Private', code: '' }], items, settings: { collections: [], defaultView: null }, viewKind: 'single', secretRemembered: true };
        if (cmd === 'item_get') return items.find(item => item.itemId === args.itemId);
        if (cmd === 'item_secret') return 'fixture-password';
        if (cmd === 'item_list') return items;
        if (cmd === 'replica_status') return { pending: 0, conflicts: 0 };
        if (cmd === 'plugin:event|listen') { listeners.set(args.event, args.handler); return ++next; }
        if (cmd === 'plugin:event|emit') { callbacks.get(listeners.get(args.event))?.({ payload: args.payload }); }
        if (cmd === 'plugin:window|get_all_windows') return [];
        if (cmd === 'plugin:webview|create_webview_window') window.__createdWindow = args.options;
        return null;
      },
    };
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1421');
  await page.getByLabel('Master password', { exact: true }).fill('fixture-password-long-enough');
  await page.getByRole('button', { name: 'Unlock encrypted replica' }).click();
  await page.getByRole('button', { name: 'Keep in tab' }).click();
  await page.locator('[data-desktop-item]').filter({ hasText: 'Beta' }).click();
  await page.getByRole('button', { name: 'Keep in tab' }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  await page.getByRole('tab', { name: 'Alpha' }).click();
  await page.locator('.desktop-detail h2').filter({ hasText: 'Alpha' }).waitFor();
  const sidebarRows = () => page.locator('.desktop-nav-content button:not(.desktop-row-menu button)').evaluateAll(nodes => nodes.map(node => ({ y: node.getBoundingClientRect().y, height: node.getBoundingClientRect().height })));
  const expandedRows = await sidebarRows();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.waitForFunction(() => Math.round(document.querySelector('.desktop-sidebar').getBoundingClientRect().width) === 72);
  assert.deepEqual(await sidebarRows(), expandedRows, 'Sidebar rows must retain vertical positions and heights');
  assert.equal(await page.locator('.desktop-nav-content').evaluate(node => getComputedStyle(node).overflowX), 'hidden');
  assert.equal(await page.locator('.desktop-sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 72);
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  assert.equal(await page.locator('.desktop-sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 72);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unsaved change');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('tab', { name: 'Beta' }).click();
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Unsaved change');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Open in window' }).click();
  const options = await page.evaluate(() => window.__createdWindow);
  assert.ok(options.url.includes('detail=item-0&vault=private'));
  assert.ok(!JSON.stringify(options).includes('fixture-password'));
  const child = await context.newPage();
  await child.goto(`http://127.0.0.1:1421/${options.url}`);
  await child.getByRole('heading', { name: 'Alpha', exact: true }).waitFor();
  await child.getByRole('button', { name: 'Reveal', exact: true }).click();
  await child.getByText('fixture-password', { exact: true }).waitFor();
  await child.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'vaults-locked' }));
  await child.getByText('Vault locked.', { exact: false }).waitFor();
  assert.equal(await child.getByText('fixture-password', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('heading', { name: 'Unlock 127Vaults' }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 0);
  console.log('Desktop workspace smoke passed: tabs, unsaved edits, independent sidebar/layout, popout routing and lock clearing.');
} finally { await browser.close(); }
