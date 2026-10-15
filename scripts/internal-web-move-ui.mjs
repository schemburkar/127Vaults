// Actual selected web move controls; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { sign, createHash } from 'node:crypto';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work, mode] = process.argv.slice(2);
assert.ok(mode === undefined || ['candidate-retry','candidate-read'].includes(mode));
const candidateRetry = ['candidate-retry','candidate-read'].includes(mode);
const candidateRead = mode === 'candidate-read';
const recordPrefix = candidateRetry ? 'web-move-candidate-normal' : 'web-move-ui';
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
const fixturePath = join(work, recordPrefix + '-fixture.json');
let record;
try { record = JSON.parse(await readFile(fixturePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (record) {
  assert.equal(record.serverId, fixture.serverId);
  assert.equal(record.accountId, metadata.accountId);
} else {
  record = { serverId: fixture.serverId, accountId: metadata.accountId, sourceName: 'Web UI move source 20261015-a', destinationName: 'Web UI move destination 20261015-a', title: 'Web UI moved login 20261015-a', username: 'synthetic-move-member', password: 'fictitious-web-move-password', website: 'https://web-move.invalid/' };
  if(candidateRetry) {
    const previous=JSON.parse(await readFile(join(work,'web-move-destination-loss-fixture.json'),'utf8'));assert.equal(previous.abortPassed,true);
    for(const key of ['source','destination','sourceItem','sourceName','destinationName','title','username','password','website'])record[key]=previous[key];
  }
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
  assert.ok(!record.movePassed || candidateRead, 'Move already completed; use the read-only peer/evidence verifiers instead of reprovisioning it');
  stage = 'unlock existing enrolled member browser';
  page = await context();
  page.setDefaultTimeout(30000);
  await page.goto(fixture.origin);
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
  await unlock(page);
  await page.locator('#settings-toggle').click();
  await page.waitForFunction(username => document.querySelector('#profile-username')?.textContent === username, metadata.username);
  if (!candidateRead) {
  for (const [kind, name] of [['source', record.sourceName], ['destination', record.destinationName]]) {
    stage = 'create or recover controlled ' + kind;
    let rows = await page.evaluate(() => window.__vaultsSnapshot);
    assert.ok(rows.length <= 2 && rows.every(row => [record.sourceName, record.destinationName].includes(row.name)), 'Never modify unrelated member vaults');
    let row = rows.find(row => row.name === name);
    if (!row) {
      assert.ok(!record[kind], 'Do not replace a previously recorded retired vault');
      await vaultSettings();
      await page.locator('#settings-create-vault').click();
      await page.locator('#web-vault-name').fill(name);
      await page.locator('#web-create-vault-submit').click();
      await page.locator('#web-create-vault-dialog').waitFor({ state: 'hidden' });
      rows = await page.evaluate(() => window.__vaultsSnapshot);
      row = rows.find(row => row.name === name);
      assert.ok(row);
    }
    if (record[kind]) assert.equal(record[kind], row.vaultId);
    record[kind] = row.vaultId;
    await save();
  }
  stage = 'create or recover source login through UI';
  await select(record.source);
  const original = page.locator('#items [data-item-id]').filter({ hasText: record.title });
  if (!await original.count()) {
    assert.ok(!record.sourceItem, 'Never recreate a recorded missing item');
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
  await original.click();
  assert.ok(!(await page.locator('#item-view').innerText()).includes(record.password));
  stage = 'move actual web vault';
  await vaultSettings();
  await page.getByLabel('Source vault', { exact: true }).selectOption(record.source);
  await page.getByLabel('Vault removal action').selectOption('move');
  await page.getByLabel('Destination vault', { exact: true }).selectOption(record.destination);
  await page.getByRole('button', { name: 'Move vault items', exact: true }).click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-cancel').click();
  assert.equal(mutations.filter(row => row.path.endsWith('/removal')).length, 0);
  await page.getByRole('button', { name: 'Move vault items', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await page.waitForFunction(id => window.__vaultsLifecycle?.retired?.some(row => row.vaultId === id && row.retirementChoice === 'move') && !window.__vaultsLifecycle.pending, record.source);
  record.movePassed = true;
  await save();
  assert.equal(await page.getByRole('button', { name: 'Restore', exact: true }).count(), 0);
  } else {
    assert.equal(record.movePassed,true);
    const names=(await readdir(work)).filter(name=>name.startsWith(recordPrefix+'-failure-')&&name.endsWith('.json')).sort();
    assert.ok(names.length);
    const failed=JSON.parse(await readFile(join(work,names.at(-1)),'utf8'));
    assert.equal(failed.stage,'read moved item through UI');
    assert.equal(mutations.length,0);
    const copies=failed.mutations.filter(row=>row.path==='/api/v1/vaults/'+record.destination+'/items');
    assert.equal(copies.length,1);assert.equal(copies[0].status,200);
    assert.ok(failed.mutations.some(row=>row.path==='/api/v1/vaults/'+record.source+'/removal'&&row.status===200));
    record.destinationItem=copies[0].itemId;record.recoveredFrom=names.at(-1);await save();
    mutations.push(...failed.mutations);
    assert.ok(await page.evaluate(id=>window.__vaultsLifecycle.retired.some(row=>row.vaultId===id),record.source));
  }
  stage = 'read moved item through UI';
  await select(record.destination);
  const copy = page.locator('#items [data-item-id]').filter({ has: page.getByText(record.title,{exact:true}) });
  await copy.waitFor();
  assert.equal(await copy.count(), 1);
  record.destinationItem = await copy.getAttribute('data-item-id');
  assert.notEqual(record.destinationItem, record.sourceItem);
  await save();
  await copy.click();
  await page.waitForFunction(title => document.querySelector('#view-title')?.textContent === title, record.title);
  const detail = await page.locator('#item-view').innerText();
  assert.ok(detail.includes(record.username));
  assert.ok(detail.includes(record.website));
  assert.ok(!detail.includes(record.password));
  await page.locator('#item-view').getByRole('button', { name: 'Reveal password', exact: true }).click();
  assert.ok((await page.locator('#item-view').innerText()).includes(record.password));
  await page.locator('#lock-app').click();
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Locked');
  assert.deepEqual(errors, []);
  await writeFile(join(work, recordPrefix + '.json'), JSON.stringify({ status: 'passed', serverId: fixture.serverId, serverRevision: fixture.serverRevision, accountId: metadata.accountId, source: record.source, destination: record.destination, sourceItem: record.sourceItem, destinationItem: record.destinationItem, mutations, checks: [candidateRetry ? 'Actual web controls move a deliberately reused active source into the existing destination' : 'Actual web controls create source/destination vaults and synthetic login', 'Move confirmation cancellation sends no removal; confirmed move retires source and clears pending journal', 'Moved source offers no archive restore; destination has exactly one newly identified copy', 'Actual UI retains ordinary fields, masks/reveals password and locks'], limits: ['Normal ordinary-web move UI only; fault injection, custom typed fields, settings retarget and other writer pairings remain separate', 'Headless Linux strict-CA HTTPS relay with service-worker bypass; physical/installed PWA acceptance separate'] }, null, 2) + '\n');
  console.log('Selected web normal move UI passed.');
} catch (error) {
  await writeFile(join(work, recordPrefix + '-failure-' + Date.now() + '.json'), JSON.stringify({ stage, error: error.message, mutations, errors, transports }, null, 2) + '\n', { flag: 'wx' });
  throw Error('Owned web move UI failed at ' + stage + '; inspect private diagnostic.');
} finally { await browser.close(); }
