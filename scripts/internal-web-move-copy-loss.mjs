// Actual selected web move controls; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { sign, createHash } from 'node:crypto';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work, phase, kind = 'copy'] = process.argv.slice(2);
assert.ok(['loss','resume'].includes(phase));
assert.ok(['copy', 'finalization'].includes(kind));
let dropAcceptedReply = phase === 'loss';
assert.ok(work && isAbsolute(work));
const fixture = JSON.parse(await readFile(join(work, 'fixture.json'), 'utf8'));
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.project, 'vaults-test-632a4442dfd2');
assert.equal(fixture.origin, 'https://127.0.0.1:12898');
const prior = JSON.parse(await readFile(join(work, 'ownership-evidence.json'), 'utf8'));
assert.equal(prior.status, 'passed');
const ca = await readFile('/identity/ca/ca.crt');
const { chromium } = createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launchPersistentContext(join(work, 'ownership-customer-profile'), { executablePath: '/fixture/chrome/chrome', headless: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const errors = [], mutations = [], transports = [];
let stage = 'sign in';
async function context() {
  const context = browser;
  await context.route('**/*', async route => {
    const incoming = route.request();
    if (new URL(incoming.url()).origin !== fixture.origin) { errors.push('Off-origin: ' + new URL(incoming.url()).origin + new URL(incoming.url()).pathname); return route.abort(); }
    try {
      const response = await new Promise((resolve, reject) => {
        const req = request(incoming.url(), { method: incoming.method(), ca, timeout: 15000, headers: incoming.headers() }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(Error('Owned TLS relay timed out')));
        req.end(incoming.postDataBuffer());
      });
      transports.push({ path: new URL(incoming.url()).pathname, status: response.status });
      if (incoming.method() === 'POST' && /\/api\/v1\/vaults\/[^/]+\/(items|removal|checkpoint)$/.test(new URL(incoming.url()).pathname)) {
        const input = JSON.parse(incoming.postData());
        mutations.push({ path: new URL(incoming.url()).pathname, requestId: input.requestId, itemId: input.itemId, sha256: createHash('sha256').update(incoming.postDataBuffer()).digest('hex'), status: response.status });
      }
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !['content-length', 'transfer-encoding', 'content-encoding'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]));
      const faultPath = '/api/v1/vaults/' + (kind === 'copy' ? record.destination + '/items' : record.source + '/removal');
      if (dropAcceptedReply && incoming.method() === 'POST' && new URL(incoming.url()).pathname === faultPath && response.status === 200) { dropAcceptedReply = false; mutations.at(-1).replyDropped = true; await route.abort('failed'); return; }
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch (error) { errors.push('TLS relay: ' + error.code); await route.abort(); }
  });
  const page = await context.newPage();
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.setBypassServiceWorker', { bypass: true });
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
const client = await ownershipClient(work, '/identity');
const metadata = JSON.parse(await readFile(join(work, 'ownership-member.json'), 'utf8'));
assert.equal(metadata.serverId, fixture.serverId);
assert.equal(metadata.fixtureSigningSeed, 10);
const member = new client.Account(metadata.accountId, metadata.deviceId, metadata.username, 10);
const operator = await client.operator('lifecycleowner', 'synthetic-ownership-owner-password');
let grant, accepted = false, elapsedMs;
async function unlock(page) {
  if (await page.locator('#login-next').isVisible()) {
    await page.locator('#username').fill(metadata.username);
    await page.locator('#login-next').click();
  }
  if (await page.locator('#secret').isVisible()) await page.locator('#secret').fill('07'.repeat(32));
  await page.locator('#master').fill('fictitious password 127vaults');
  await page.locator('#login').click();
  await page.waitForFunction(() => document.querySelector('#vault')?.hidden === false && document.querySelector('#state')?.textContent.startsWith('Unlocked'), null, { timeout: 60000 });
  await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
}
const fixturePath = join(work, 'web-move-' + kind + '-loss-fixture.json');
let record;
try { record = JSON.parse(await readFile(fixturePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (record) {
  assert.equal(record.serverId, fixture.serverId);
  assert.equal(record.accountId, metadata.accountId);
} else {
  record = { serverId: fixture.serverId, accountId: metadata.accountId, sourceName: 'Web UI ' + kind + '-loss source 20261015-a', destinationName: 'Web UI move destination 20261015-a', title: 'Web UI ' + kind + '-loss login 20261015-a', username: 'synthetic-move-member', password: 'fictitious-web-move-password', website: 'https://web-move.invalid/' };
  await writeFile(fixturePath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
}
const save = () => writeFile(fixturePath, JSON.stringify(record, null, 2) + '\n');
let page;
async function vaultSettings() {
  if (!await page.locator('#settings').isVisible()) await page.locator('#settings-toggle').click();
  await page.locator('[data-settings-view="vaults"]').click();
}
async function closeSettings() {
  if (await page.locator('#settings').isVisible()) await page.locator('#close-settings').click();
}
async function select(id) {
  await closeSettings();
  const row = await page.evaluate(id => window.__vaultsSnapshot.find(row => row.vaultId === id), id);
  assert.ok(row);
  await page.getByRole('button', { name: row.name, exact: true }).first().click();
  await page.waitForFunction(id => window.__vaultsSnapshot.some(row => row.vaultId === id && row.selected), id);
}
try {
  assert.ok(!record.movePassed, 'Completed reply-loss case must be verified without resubmitting it');
  stage = 'unlock retained browser profile';
  page = await context();
  page.setDefaultTimeout(30000);
  await page.goto(fixture.origin);
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
  await unlock(page);
  if (phase === 'loss') {
    assert.ok(!record.lossPassed, 'Do not inject another loss into the retained case');
    const baseline = JSON.parse(await readFile(join(work, 'web-move-ui-fixture.json'), 'utf8'));
    assert.equal(baseline.movePassed, true);
    record.destination = baseline.destination;
    stage = 'create controlled new source';
    let rows = await page.evaluate(() => window.__vaultsSnapshot);
    assert.ok(rows.length <= 2 && rows.every(row => row.vaultId === record.destination || row.name === record.sourceName));
    let source = rows.find(row => row.name === record.sourceName);
    if (!source) {
      assert.ok(!record.source, 'Never replace a recorded source');
      await vaultSettings();
      await page.locator('#settings-create-vault').click();
      await page.locator('#web-vault-name').fill(record.sourceName);
      await page.locator('#web-create-vault-submit').click();
      await page.locator('#web-create-vault-dialog').waitFor({ state: 'hidden' });
      rows = await page.evaluate(() => window.__vaultsSnapshot);
      source = rows.find(row => row.name === record.sourceName);
      assert.ok(source);
    }
    record.source = source.vaultId;
    await save();
    await select(record.source);
    const original = page.locator('#items [data-item-id]').filter({ hasText: record.title });
    if (!await original.count()) {
      assert.ok(!record.sourceItem);
      await page.locator('#new-item').click();
      await page.locator('#title').fill(record.title);
      await page.locator('#url').fill(record.website);
      await page.locator('#item-username').fill(record.username);
      await page.locator('#item-password').fill(record.password);
      await page.locator('#save').click();
      await page.locator('#item-form').waitFor({ state: 'hidden' });
      await original.waitFor();
    }
    record.sourceItem = await original.getAttribute('data-item-id');
    await save();
    stage = 'lose accepted ' + kind + ' response';
    await vaultSettings();
    await page.getByLabel('Source vault', { exact: true }).selectOption(record.source);
    await page.getByLabel('Vault removal action').selectOption('move');
    await page.getByLabel('Destination vault', { exact: true }).selectOption(record.destination);
    await page.getByRole('button', { name: 'Move vault items', exact: true }).click();
    await page.locator('#confirm-accept').click();
    await page.getByText('Vault action needs attention', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
    record.journal = await page.evaluate(() => window.__vaultsLifecycle.pending);
    assert.equal(record.journal.source, record.source);
    assert.equal(record.journal.destination, record.destination);
    if (kind === 'copy') {
      assert.equal(record.journal.pendingCopy.sourceItemId, record.sourceItem);
      assert.equal(record.journal.request, null);
      record.destinationItem = record.journal.pendingCopy.destinationItemId;
    } else {
      assert.equal(record.journal.pendingCopy, null);
      assert.ok(record.journal.request);
      assert.equal(record.journal.mappings.length, 1);
      assert.equal(record.journal.mappings[0].sourceItemId, record.sourceItem);
      record.destinationItem = record.journal.mappings[0].destinationItemId;
      assert.ok(await page.evaluate(id => window.__vaultsLifecycle.retired.some(row => row.vaultId === id), record.source));
    }
    const copies = mutations.filter(row => row.path === '/api/v1/vaults/' + record.destination + '/items');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].status, 200);
    const accepted = kind === 'copy' ? copies : mutations.filter(row => row.path === '/api/v1/vaults/' + record.source + '/removal');
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].replyDropped, true);
    assert.equal(accepted[0].status, 200);
    const request = kind === 'copy' ? record.journal.pendingCopy.payload : record.journal.request;
    assert.equal(accepted[0].requestId, request.requestId);
    assert.equal(accepted[0].sha256, createHash('sha256').update(JSON.stringify(request)).digest('hex'));
    record.lossPassed = true;
    await save();
  } else {
    stage = 'verify exact journal after full browser restart';
    assert.equal(record.lossPassed, true);
    assert.deepEqual(await page.evaluate(() => window.__vaultsLifecycle.pending), record.journal);
    await vaultSettings();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForFunction(id => window.__vaultsLifecycle?.retired?.some(row => row.vaultId === id && row.retirementChoice === 'move') && !window.__vaultsLifecycle.pending, record.source);
    const copies = mutations.filter(row => row.path === '/api/v1/vaults/' + record.destination + '/items');
    assert.equal(copies.length, kind === 'copy' ? 1 : 0);
    const replay = kind === 'copy' ? copies : mutations.filter(row => row.path === '/api/v1/vaults/' + record.source + '/removal');
    assert.equal(replay.length, 1);
    assert.equal(replay[0].status, 200);
    const request = kind === 'copy' ? record.journal.pendingCopy.payload : record.journal.request;
    assert.equal(replay[0].requestId, request.requestId);
    assert.equal(replay[0].sha256, createHash('sha256').update(JSON.stringify(request)).digest('hex'));
    stage = 'read unique resumed copy';
    await select(record.destination);
    const copy = page.locator('#items [data-item-id]').filter({ hasText: record.title });
    await copy.waitFor();
    assert.equal(await copy.count(), 1);
    assert.equal(await copy.getAttribute('data-item-id'), record.destinationItem);
    await copy.click();
    await page.waitForFunction(title => document.querySelector('#view-title')?.textContent === title, record.title);
    const detail = await page.locator('#item-view').innerText();
    assert.ok(detail.includes(record.username) && detail.includes(record.website));
    assert.ok(!detail.includes(record.password));
    await page.locator('#item-view').getByRole('button', { name: 'Reveal password', exact: true }).click();
    assert.ok((await page.locator('#item-view').innerText()).includes(record.password));
    await page.locator('#lock-app').click();
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
    record.movePassed = true;
    await save();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(work, 'web-move-' + kind + '-' + phase + '.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, serverRevision: fixture.serverRevision, phase, kind, source: record.source, destination: record.destination, sourceItem: record.sourceItem, destinationItem: record.destinationItem, mutations, checks: phase === 'loss' ? ['Actual successful TLS ' + kind + ' response discarded; real UI offers Resume', 'Durable pending journal reserves exact destination ID/request ID/encrypted request hash', 'Browser process closes with pending journal retained'] : ['Full browser process restart and real unlock preserve exact journal', 'Visible Resume replays identical request ID/body hash and obtains receipt without duplicate copies', 'One reserved copy retains fields, masked/revealed password and final lock'], limits: ['Ordinary web with strict-CA relay and service-worker bypass; physical PWA separate', 'Accepted ' + kind + ' loss only; source/destination changes and other peer/writer pairings separate'] }, null, 2) + '\n');
  console.log('Selected web ' + kind + ' reply-loss ' + phase + ' passed.');
} catch (error) {
  await writeFile(join(work, 'web-move-' + kind + '-' + phase + '-failure-' + Date.now() + '.json'), JSON.stringify({ stage, error: error.message, mutations, errors, transports }, null, 2) + '\n', { flag: 'wx' });
  throw Error('Owned web ' + kind + '-loss ' + phase + ' failed at ' + stage + '; inspect retained diagnostic.');
} finally { await browser.close(); }
