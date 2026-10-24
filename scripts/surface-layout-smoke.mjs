import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Run against local web and desktop Vite servers. Desktop IPC is synthetic;
// no credentials or mutations are sent to the real backend.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}),
  ...(process.env.VAULTS_BROWSER_CHANNEL ? { channel: process.env.VAULTS_BROWSER_CHANNEL } : {}),
});
const sizes = [{ width: 1180, height: 760 }, { width: 800, height: 560 }, { width: 390, height: 844 }];
async function snapshot(page, name) {
  if (!process.env.VAULTS_LAYOUT_SCREENSHOTS) return;
  await mkdir(process.env.VAULTS_LAYOUT_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.VAULTS_LAYOUT_SCREENSHOTS, `${name}.png`) });
}

async function checkSurface(surface) {
  const geometry = await surface.evaluate(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { fits: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      overflow: node.scrollWidth > node.clientWidth + 1, padding: style.paddingLeft,
      width: rect.width, height: rect.height };
  });
  assert(geometry.fits, `Surface leaves the viewport: ${JSON.stringify(geometry)}`);
  assert(!geometry.overflow, `Horizontal overflow: ${JSON.stringify(geometry)}`);
  return geometry;
}

try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const web = await context.newPage();
  await web.goto(process.env.VAULTS_WEB_URL || 'https://127.0.0.1:12780/');
  await web.locator('#settings').waitFor({ state: 'attached' });
  await web.setViewportSize(sizes[0]);
  const webAccess = await checkSurface(web.locator('#access'));
  assert.equal(webAccess.width, 560);
  await snapshot(web, 'web-access');
  // Representative long lists and names exercise intrinsic sizing and scrolling.
  await web.evaluate(() => {
    const vaults = Array.from({ length: 24 }, (_, i) => ({ vaultId: `fixture-${i}`, name: `A long synthetic vault name ${i}`, code: 'fixture' }));
    window.dispatchEvent(new CustomEvent('vaults:vaults', { detail: vaults }));
    window.dispatchEvent(new CustomEvent('vaults:edit-collection', { detail: { id: null, name: '', vault_ids: [] } }));
    document.querySelector('#confirm-title').textContent = 'Confirm vault action';
    document.querySelector('#confirm-detail').textContent = 'Review this change before continuing. '.repeat(12);
    document.querySelector('#sync-review-title').textContent = 'Review offline changes';
  });
  const dialogs = ['web-create-vault-dialog', 'web-collection-dialog', 'browser-enrollment-dialog', 'confirm-dialog', 'conflict-dialog', 'sync-review-dialog'];
  for (const size of sizes) {
    await web.setViewportSize(size);
    for (const id of dialogs) {
      const dialog = web.locator(`#${id}`);
      await dialog.evaluate(node => node.showModal());
      await checkSurface(dialog);
      const actions = dialog.locator('.ui-dialog-actions');
      await actions.scrollIntoViewIfNeeded();
      assert(await actions.isVisible(), `${id} actions are inaccessible`);
      if (id === 'web-create-vault-dialog' || id === 'web-collection-dialog') await snapshot(web, `web-${id}-${size.width}`);
      await dialog.evaluate(node => node.close());
    }
    const settings = web.locator('#settings');
    await settings.evaluate(node => node.showModal());
    let first;
    for (const tab of ['profile', 'devices', 'vaults', 'preferences']) {
      await web.locator(`[data-settings-view=${tab}]`).click();
      await web.waitForFunction(tab => document.querySelector('.web-settings-header h3').textContent.toLowerCase() === tab, tab);
      const geometry = await checkSurface(settings);
      first ??= geometry;
      assert.equal(geometry.height, first.height);
      assert.equal(geometry.width, first.width);
      await checkSurface(web.locator('.web-settings-body'));
    }
    await web.keyboard.press('Escape');
    assert.equal(await settings.evaluate(node => node.open), false);
    console.log(`Web dialogs and settings: ${size.width}×${size.height} passed`);
  }

  const desktop = await context.newPage();
  await desktop.addInitScript(() => {
    let next = 0;
    const callbacks = new Map();
    const vaults = Array.from({ length: 24 }, (_, i) => ({ vaultId: `fixture-${i}`, name: `A long synthetic vault name ${i}`, code: 'fixture' }));
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { callbacks.set(++next, fn); return next; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(cmd) {
        if (cmd === 'desktop_info') return { configured: true, cachedUsername: 'fixture', hasCachedSecret: true };
        if (cmd === 'unlock') return { sessionEpoch: 1, online: true, vaultId: 'fixture-0', vaults, items: [], settings: { collections: [], defaultView: null, conflict: true }, viewKind: 'single', secretRemembered: true };
        if (cmd === 'license_status' || cmd === 'license_access_status') return { mode: 'active', plan: 'synthetic', expiresAt: new Date(Date.now() + 86400000).toISOString(), enforcement: 'active' };
        if (cmd === 'replica_status') return { pending: 0, conflicts: 0 };
        if (cmd === 'item_list' || cmd === 'plugin:window|get_all_windows') return [];
        if (cmd === 'vault_settings_review') return { local: { names: vaults }, server: { names: vaults } };
        if (cmd === 'generate_secret') return 'fixture-generated-value';
        if (cmd === 'plugin:event|listen') return ++next;
        return null;
      },
    };
  });
  await desktop.goto(process.env.VAULTS_DESKTOP_URL || 'http://127.0.0.1:1421/');
  await desktop.setViewportSize(sizes[0]);
  await desktop.locator('.ui-access-card').waitFor();
  const desktopAccess = await checkSurface(desktop.locator('.ui-access-card'));
  assert.equal(desktopAccess.width, webAccess.width);
  assert.equal(desktopAccess.padding, '28px', 'Desktop access card uses the compact desktop spacing');
  await snapshot(desktop, 'desktop-access');
  await desktop.getByLabel('Master password', { exact: true }).fill('synthetic-password-long-enough');
  await desktop.getByRole('button', { name: 'Unlock encrypted replica' }).click();
  await desktop.getByRole('button', { name: 'Add collection', exact: true }).waitFor();
  for (const size of sizes.slice(0, 2)) {
    await desktop.setViewportSize(size);
    for (const trigger of ['Add vault', 'Add collection', 'Review vault settings conflict', 'Password health']) {
      if (size.width <= 850) {
        const navigation = desktop.getByRole('button', { name: 'Toggle navigation', exact: true });
        if (await navigation.getAttribute('aria-expanded') === 'false') await navigation.click();
      }
      await desktop.getByRole('button', { name: trigger, exact: true }).click();
      const dialog = desktop.locator('.ui-dialog:visible');
      await dialog.waitFor();
      await checkSurface(dialog);
      await snapshot(desktop, `desktop-${trigger.replaceAll(' ', '-')}-${size.width}`);
      await dialog.getByRole('button', { name: /^(Cancel|Close)$/ }).click();
    }
    if (size.width <= 850) {
      const navigation = desktop.getByRole('button', { name: 'Toggle navigation', exact: true });
      if (await navigation.getAttribute('aria-expanded') === 'false') await navigation.click();
    }
    const vaultMenu = desktop.locator('summary[aria-label="Actions for A long synthetic vault name 0"]');
    if (await vaultMenu.locator('..').getAttribute('open') === null) await vaultMenu.click();
    await desktop.getByRole('button', { name: 'Remove vault…', exact: true }).first().click();
    const removal = desktop.locator('.ui-dialog:visible');
    await removal.waitFor();
    await checkSurface(removal);
    await removal.getByRole('button', { name: 'Cancel', exact: true }).click();
    console.log(`Desktop dialogs: ${size.width}×${size.height} passed`);
  }
  await desktop.getByRole('button', { name: 'Add item', exact: true }).click();
  await desktop.getByRole('button', { name: 'Generate password', exact: true }).click();
  const generator = desktop.locator('dialog.ui-dialog');
  await generator.waitFor();
  for (const size of sizes.slice(0, 2)) {
    await desktop.setViewportSize(size);
    let height;
    for (const mode of ['password', 'passphrase', 'pin']) {
      await generator.getByRole('combobox').first().selectOption(mode);
      const geometry = await checkSurface(generator);
      height ??= geometry.height;
      assert.equal(geometry.height, height, 'Generator mode must not resize its dialog');
    }
    await snapshot(desktop, `desktop-generator-${size.width}`);
  }
  await desktop.keyboard.press('Escape');
  assert.equal(await generator.count(), 0);
  console.log('Shared generator layout and Escape dismissal passed');
} finally {
  await browser.close();
}
