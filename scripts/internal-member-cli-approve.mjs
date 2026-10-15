// Actual customer UI, enrollment and ownership; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === '--linux');
const enrollmentPrefix = mode === '--linux' ? 'member-cli-linux' : 'member-cli';
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
const enrollment = JSON.parse(await readFile(join(work,enrollmentPrefix+'-enrollment-request.json'),'utf8'));
assert.equal(enrollment.serverId,fixture.serverId);
const member = JSON.parse(await readFile(join(work,'ownership-member.json'),'utf8'));
let inspected=false;
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
      if(new URL(incoming.url()).pathname === '/api/v1/device-enrollment/inspect') {
        assert.equal(response.status,200);const binding=JSON.parse(response.body);assert.equal(binding.accountId,member.accountId);assert.equal(binding.newDeviceId,enrollment.device);assert.equal(createHash('sha256').update(Buffer.from(binding.newDevicePublicKey,'base64url')).digest('hex'),enrollment.fingerprint);inspected=true;
      }
      transports.push({ path: new URL(incoming.url()).pathname, status: response.status });
      if (/\/api\/v1\/ownership\/requests\/[^/]+\/accept$/.test(incoming.url())) {
        const input = JSON.parse(incoming.postData());
        mutations.push({ action: 'ownership.accept', requestId: input.requestId, status: response.status, ...(response.status !== 200 ? { error: JSON.parse(response.body).error } : {}) });
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
try {
  const page=await context();
  page.setDefaultTimeout(30000);
  await page.goto(fixture.origin);
  await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');
  if(await page.locator('#login-next').isVisible()){await page.locator('#username').fill(member.username);await page.locator('#login-next').click();}
  if(await page.locator('#secret').isVisible())await page.locator('#secret').fill('07'.repeat(32));
  await page.locator('#master').fill('fictitious password 127vaults');await page.locator('#login').click();
  await page.waitForFunction(()=>document.querySelector('#vault')?.hidden===false&&document.querySelector('#state')?.textContent.startsWith('Unlocked'),null,{timeout:60000});
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
  await page.locator('#settings-toggle').click();await page.locator('[data-settings-view="devices"]').click();
  await page.locator('#show-device-registration').click();
  await page.locator('#enrollment-request').fill(enrollment.code);
  await page.locator('#begin-enrollment').click();
  await page.waitForFunction(prefix=>document.querySelector('#enrollment-status')?.textContent.includes('Approved CLI device '+prefix),enrollment.device.slice(0,8));
  assert.equal(inspected,true);assert.equal(await page.locator('#enrollment-request').inputValue(),'');
  await page.locator('#close-settings').click();await page.locator('#lock-app').click();
  await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');
  assert.deepEqual(errors,[]);
  await writeFile(join(work,enrollmentPrefix+'-web-approval.json'),JSON.stringify({status:'passed',serverId:fixture.serverId,serverRevision:fixture.serverRevision,accountId:member.accountId,device:enrollment.device,fingerprint:enrollment.fingerprint,checks:['Actual member browser OPAQUE unlock and Settings/Devices registration controls','Actual inspection binding matches member, full CLI device UUID and public-key fingerprint before delivery to app','Browser signs approval, clears code and locks; no key/session seeding'],limits:['Automated binding comparison through strict-CA transport; human comparison/physical browser acceptance separate']},null,2)+'\n');
  console.log('Actual member web UI approved the exact packaged CLI enrollment.');
}catch(error){await writeFile(join(work,enrollmentPrefix+'-web-approval-failure-'+Date.now()+'.json'),JSON.stringify({error:error.message,inspected,errors},null,2)+'\n',{flag:'wx'});throw Error('Member CLI web approval failed; private diagnostic retained.');}
finally{await browser.close();}
