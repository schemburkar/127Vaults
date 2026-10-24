import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTS_BROWSER_EXECUTABLE ? { executablePath: process.env.VAULTS_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => {
    const items = Array.from({ length: 80 }, (_, i) => i === 0 ? 'Alpha' : i === 1 ? 'Beta' : `Fixture ${i}`).map((title, i) => ({ title, itemId: `item-${i}`, vaultId: 'private', code: '', website: 'https://example.invalid', username: 'fixture-user', customFields: [] }));
    let next = 0; const callbacks = new Map(), listeners = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { const id = ++next; callbacks.set(id, fn); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(cmd, args) {
        if (cmd === 'desktop_info') return { configured: true, cachedUsername: 'fixture', hasCachedSecret: true };
        if (cmd === 'unlock') return { sessionEpoch: 1, online: false, vaultId: 'private', vaults: [{ vaultId: 'private', name: 'Private', code: '' }], items, settings: { collections: [], defaultView: null }, viewKind: 'single', secretRemembered: true };
        if (cmd === 'license_status' || cmd === 'license_access_status') return { mode: 'active', plan: 'synthetic', expiresAt: new Date(Date.now() + 86400000).toISOString(), enforcement: 'active' };
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
  page.setDefaultTimeout(15000);
  await page.goto('http://127.0.0.1:1421');
  await page.getByLabel('Master password', { exact: true }).fill('fixture-password-long-enough');
  await page.getByRole('button', { name: 'Unlock encrypted replica' }).click();
  // Real wheel input must still scroll after the periodic replica refresh.
  for (const mode of ['List view', 'Grid view']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const viewport = page.locator('.desktop-items');
    assert(await viewport.evaluate(node => node.scrollHeight > node.clientHeight));
    await viewport.evaluate(node => { node.scrollTop = 0; });
    await viewport.hover();
    await page.mouse.wheel(0, 350);
    await page.waitForFunction(() => document.querySelector('.desktop-items').scrollTop > 0);
    await page.waitForTimeout(5500);
    const before = await viewport.evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, 350);
    await page.waitForFunction(before => document.querySelector('.desktop-items').scrollTop > before, before);
    assert(await viewport.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight - 31));
    assert.equal(await viewport.evaluate(node => getComputedStyle(node).overscrollBehavior), 'none');
    assert.equal(await page.locator('[data-desktop-item]').first().evaluate(node => getComputedStyle(node).overscrollBehavior), 'auto', 'Do not suppress overscroll on every descendant');
    await viewport.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await viewport.hover();
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(200);
    const end = await viewport.evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, -350);
    await page.waitForFunction(end => document.querySelector('.desktop-items').scrollTop < end, end);
    await viewport.evaluate(node => { node.scrollTop = 0; });
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 350);
    await page.waitForFunction(() => document.querySelector('.desktop-items').scrollTop > 0);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
  }
  // Exercise detail scrolling at its bottom boundary with tall synthetic content.
  const detail = page.locator('.desktop-detail');
  await detail.evaluate(node => { const probe = document.createElement('div'); probe.id = 'scroll-boundary-probe'; probe.style.height = '2400px'; node.append(probe); node.scrollTop = node.scrollHeight; });
  await detail.hover();
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(200);
  const detailEnd = await detail.evaluate(node => node.scrollTop);
  await page.mouse.wheel(0, -350);
  await page.waitForFunction(end => document.querySelector('.desktop-detail').scrollTop < end, detailEnd);
  assert.equal(await detail.evaluate(node => getComputedStyle(node).overscrollBehavior), 'none');
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
  await detail.evaluate(node => { node.querySelector('#scroll-boundary-probe').remove(); node.scrollTop = 0; });
  console.log('Long item lists scroll in both layouts after background refresh.');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.locator('.desktop-items').evaluate(node => { node.scrollTop = 0; });
  await page.getByRole('button', { name: 'Keep in tab' }).click();
  await page.locator('[data-desktop-item]').filter({ hasText: 'Beta' }).click();
  await page.getByRole('button', { name: 'Keep in tab' }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  await page.getByRole('tab', { name: 'Alpha' }).click();
  await page.locator('.desktop-detail h2').filter({ hasText: 'Alpha' }).waitFor();
  // Password Health is a persistent workspace tab alongside the real item tabs.
  await page.getByRole('button', { name: 'Password health', exact: true }).click();
  await page.getByRole('tab', { name: 'Password health', selected: true }).waitFor();
  await page.getByText('80 affected password fields.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Password health' }).count(), 0);
  assert(await page.locator('.desktop-list').isVisible());
  assert(await page.locator('.desktop-detail .password-health table').isVisible());
  await page.getByRole('button', { name: 'Short (0)', exact: true }).click();
  await page.getByText('No issues found in this category.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reused (80)', exact: true }).click();
  await page.locator('.password-health').getByRole('button', { name: 'Open saved item', exact: true }).first().click();
  await page.locator('.desktop-detail h2').filter({ hasText: 'Alpha' }).waitFor();
  assert(await page.getByRole('tab', { name: 'Password health', selected: false }).isVisible());
  await page.getByRole('tab', { name: 'Password health' }).click();
  await page.locator('.password-health table').waitFor();
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByRole('heading', { name: 'Create item', exact: true }).waitFor();
  assert.equal(await page.locator('.password-health').count(), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close tab Password health', exact: true }).click();
  await page.getByRole('tab', { name: 'Alpha' }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  console.log('Password Health keeps the item list, filters findings, returns to items, and survives tab switching.');
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
  for (const size of [{width:1180,height:760},{width:800,height:560}]) {
    await page.setViewportSize(size);
    const pane = page.locator('.desktop-detail');
    await page.locator('.desktop-title-fields summary').scrollIntoViewIfNeeded();
    const before = await pane.evaluate(node => ({height:node.scrollHeight,top:node.scrollTop}));
    await page.locator('.desktop-title-fields summary').click();
    const menu = page.locator('.ui-type-popover:popover-open');
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert(bounds.y >= 16 && bounds.y + bounds.height <= size.height - 15, 'Type menu stays inside viewport');
    assert(await menu.evaluate(node => node.scrollHeight > node.clientHeight), 'Type menu has its own scroll area');
    assert.equal(await pane.evaluate(node => node.scrollHeight), before.height, 'Type menu must not enlarge detail scroll area');
    await menu.hover(); await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => document.querySelector('.ui-type-popover:popover-open').scrollTop > 0);
    assert.equal(await pane.evaluate(node => node.scrollTop), before.top, 'Scrolling type options must not scroll details');
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'hidden'});
  }
  await page.setViewportSize({width:1600,height:900});

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
  await child.getByRole('button', { name: 'Reveal Password', exact: true }).click();
  await child.getByText('fixture-password', { exact: true }).waitFor();
  await child.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'vaults-locked' }));
  await child.getByText('Vault locked.', { exact: false }).waitFor();
  assert.equal(await child.getByText('fixture-password', { exact: true }).count(), 0);
  console.log('Original workspace checks passed; checking many tabs.');
  await child.close();
  await page.bringToFront();
  // More than ten tabs remain readable, scrollable and reachable by the menu.
  for (let index = 2; index < 14; index++) {
    await page.locator('[data-desktop-item]').filter({ hasText: new RegExp('^Fixture ' + index + 'https:') }).click();
    await page.getByRole('button', { name: 'Keep in tab', exact: true }).click();
  }
  assert.equal(await page.getByRole('tab').count(), 14);
  await page.getByLabel('Close item details', { exact: true }).click();
  assert(await page.locator('.desktop-detail').evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'Empty detail plus tabs must fit without a vertical scrollbar');
  assert(await page.locator('.desktop-items').evaluate(node => getComputedStyle(node, '::-webkit-scrollbar').width === '6px' || getComputedStyle(node).scrollbarWidth === 'thin'));
  await page.getByRole('tab', { name: 'Fixture 13', exact: true }).click();
  const strip = page.getByRole('tablist', { name: 'Open items' });
  assert.equal(await strip.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
  assert(await strip.evaluate(node => node.scrollWidth > node.clientWidth));
  const active = page.getByRole('tab', { selected: true });
  assert(await active.evaluate(node => { const tab = node.parentElement.getBoundingClientRect(), view = node.closest('[role=tablist]').getBoundingClientRect(); return tab.left >= view.left - 1 && tab.right <= view.right + 1; }));
  await strip.hover();
  const beforeWheel = await strip.evaluate(node => node.scrollLeft);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(before => document.querySelector('.item-tabs').scrollLeft < before, beforeWheel);
  await page.getByLabel('Open tabs (14)', { exact: true }).click();
  await page.getByRole('navigation', { name: 'Find an open tab' }).getByRole('button', { name: 'Alpha', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Alpha');
  await page.getByRole('tab', { name: 'Alpha', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Beta');
  await page.getByLabel('Close tab Beta', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Fixture 2');
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true });
    assert.ok((await toggle.boundingBox()).x < 50, 'Brand menu control should stay at the top left');
    await toggle.click();
    assert.equal(await page.locator('.desktop-nav-content').isVisible(), true);
    await toggle.click();
    assert.equal(await page.locator('.desktop-nav-content').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('heading', { name: 'Unlock 127Vaults' }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 0);
  console.log('Desktop workspace smoke passed: tabs, unsaved edits, independent sidebar/layout, popout routing and lock clearing.');
} finally { await browser.close(); }
