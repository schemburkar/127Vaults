// Actual selected web move controls; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { sign, createHash } from 'node:crypto';
import { ownershipClient } from './internal-ownership-client.mjs';

const [work, phase] = process.argv.slice(2);
assert.ok(['web-write','web-recover','web-final'].includes(phase));
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
      if (incoming.method() === 'POST' && /\/api\/v1\/vaults\/[^/]+\/(items|operations|removal|checkpoint)$/.test(new URL(incoming.url()).pathname)) {
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
const normal=JSON.parse(await readFile(join(work,'web-move-candidate-normal-fixture.json'),'utf8'));
const member=JSON.parse(await readFile(join(work,'ownership-member.json'),'utf8'));
const device=JSON.parse(await readFile(join(work,'ownership-customer-device.json'),'utf8'));
const windows=JSON.parse(await readFile(join(work,'member-cli-windows.json'),'utf8'));
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
const path=join(work,'member-web-native-writes.json');let record;
if(phase==='web-write'||phase==='web-recover'){
  await assert.rejects(readFile(path),error=>error.code==='ENOENT');
  assert.equal(JSON.parse(await readFile(join(work,'member-cross-os-writes.json'),'utf8')).baselineRestored,true);
  record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,browserDevice:device.deviceId,windowsDevice:windows.device,itemId:normal.destinationItem,vaultId:normal.destination,webTitle:normal.title+' selected web member edit',phases:[]};
  if(phase==='web-recover'){
    const names=(await readdir(work)).filter(name=>name.startsWith('member-web-native-failure-')&&name.endsWith('.json')).sort();assert.equal(names.length,1);
    const failed=JSON.parse(await readFile(join(work,names[0]),'utf8'));assert.equal(failed.phase,'web-write');assert.deepEqual(failed.errors,[]);assert.ok(failed.error.includes('0 !== 1'));
    const accepted=failed.transports.filter(row=>row.path==='/api/v1/vaults/'+normal.destination+'/operations');assert.equal(accepted.length,1);assert.equal(accepted[0].status,200);
    record.webWrite={...accepted[0],recoveredFrom:names[0],limits:'Initial helper observed actual HTTP response but did not capture operation request ID/hash'};
  }
}else{
  record=JSON.parse(await readFile(path,'utf8'));assert.equal(record.status,'in-progress');assert.equal(record.nativeRestored,true);assert.equal(record.phases.length,2);
}
try{
  const page=await context();page.setDefaultTimeout(30000);await page.goto(fixture.origin);
  await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');
  if(await page.locator('#login-next').isVisible()){await page.locator('#username').fill(member.username);await page.locator('#login-next').click();}
  if(await page.locator('#secret').isVisible())await page.locator('#secret').fill('07'.repeat(32));
  await page.locator('#master').fill('fictitious password 127vaults');await page.locator('#login').click();
  await page.waitForFunction(()=>document.querySelector('#vault')?.hidden===false&&document.querySelector('#state')?.textContent.startsWith('Unlocked'),null,{timeout:60000});
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
  const vault=await page.evaluate(id=>window.__vaultsSnapshot.find(row=>row.vaultId===id),normal.destination);assert.ok(vault);
  await page.getByRole('button',{name:vault.name,exact:true}).first().click();
  await page.waitForFunction(id=>window.__vaultsSnapshot.some(row=>row.vaultId===id&&row.selected),normal.destination);
  const item=page.locator('#items [data-item-id="'+normal.destinationItem+'"]');await item.click();
  await page.waitForFunction(title=>document.querySelector('#view-title')?.textContent===title,phase==='web-recover'?record.webTitle:normal.title);
  let detail=await page.locator('#item-view').innerText();assert.ok(detail.includes(normal.username)&&detail.includes(normal.website)&&!detail.includes(normal.password));
  if(phase==='web-write'){
    await page.locator('#edit-item').click();await page.locator('#title').fill(record.webTitle);await page.locator('#save').click();
    await page.locator('#item-form').waitFor({state:'hidden'});await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
    await page.waitForFunction(title=>document.querySelector('#view-title')?.textContent===title,record.webTitle);
    const writes=mutations.filter(row=>row.path==='/api/v1/vaults/'+normal.destination+'/operations');assert.equal(writes.length,1);assert.equal(writes[0].status,200);record.webWrite=writes[0];
  }else assert.equal(mutations.length,0);
  await page.locator('#item-view').getByRole('button',{name:'Reveal password',exact:true}).click();assert.ok((await page.locator('#item-view').innerText()).includes(normal.password));
  assert.equal(await page.locator('#items [data-item-id]').count(),6);
  assert.ok(await page.evaluate(id=>window.__vaultsLifecycle.retired.some(row=>row.vaultId===id),normal.source));
  await page.locator('#lock-app').click();await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');assert.deepEqual(errors,[]);
  record.phases.push({phase:phase==='web-recover'?'web-write':phase,status:'passed',device:device.deviceId,completedAt:new Date().toISOString(),mutations,...(phase==='web-recover'?{recoveredByRead:true}: {})});
  if(phase==='web-final'){record.status='passed';record.baselineRestored=true;}
  await writeFile(path,JSON.stringify(record,null,2)+'\n');console.log('Actual member web phase passed: '+phase);
}catch(error){await writeFile(join(work,'member-web-native-failure-'+Date.now()+'.json'),JSON.stringify({phase,error:error.message,errors,mutations,transports},null,2)+'\n',{flag:'wx'});throw Error('Web/native member phase failed; private diagnostic retained');}
finally{await browser.close();}
