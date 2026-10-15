// Actual selected web move controls; strict-CA HTTPS transport only.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { request } from 'node:https';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {attachExtensionPopup} from './extension-popup-driver.mjs';

const [work] = process.argv.slice(2);
assert.ok(work && isAbsolute(work));
const fixture = JSON.parse(await readFile(join(work, 'fixture.json'), 'utf8'));
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.project, 'vaults-test-632a4442dfd2');
assert.equal(fixture.origin, 'https://127.0.0.1:12898');
const prior = JSON.parse(await readFile(join(work, 'ownership-evidence.json'), 'utf8'));
assert.equal(prior.status, 'passed');
const ca = await readFile('/identity/ca/ca.crt');
const { chromium } = createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launchPersistentContext(join(work, 'ownership-customer-profile'), { executablePath: '/fixture/chrome/chrome', headless: true, serviceWorkers: 'allow', ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+join(work,'extension-selected/127vaults-extension'),'--load-extension='+join(work,'extension-selected/127vaults-extension')], viewport: { width: 1440, height: 1000 } });
const errors = [], mutations = [], transports = [];
let stage = 'sign in';
async function context() {
  const context = browser;
  await context.route('https://**/*', async route => {
    const incoming = route.request();
    if(new URL(incoming.url()).origin==='https://web-move.invalid')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fictitious extension target</title><form><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form><script>window.submits=0;document.addEventListener("submit",e=>{e.preventDefault();window.submits++});</script>'});
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
const normal=JSON.parse(await readFile(join(work,'web-move-candidate-normal-fixture.json'),'utf8')),member=JSON.parse(await readFile(join(work,'ownership-member.json'),'utf8'));
const packageRecord=JSON.parse(await readFile(join(work,'extension-selected-package.json'),'utf8'));
assert.equal(packageRecord.sourceRevision,'07fdca56a281f786b18c639347d86c631bc64585');assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');
let view,worker,page;
try{
  page=await context();page.setDefaultTimeout(30000);await page.goto(fixture.origin);
  await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');
  if(await page.locator('#login-next').isVisible()){await page.locator('#username').fill(member.username);await page.locator('#login-next').click();}
  if(await page.locator('#secret').isVisible())await page.locator('#secret').fill('07'.repeat(32));
  await page.locator('#master').fill('fictitious password 127vaults');await page.locator('#login').click();
  await page.waitForFunction(()=>document.querySelector('#vault')?.hidden===false&&document.querySelector('#state')?.textContent.startsWith('Unlocked'),null,{timeout:60000});
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
  worker=browser.serviceWorkers().find(row=>row.url().startsWith('chrome-extension://'))||await browser.waitForEvent('serviceworker',{predicate:row=>row.url().startsWith('chrome-extension://')});
  const extensionId=new URL(worker.url()).host;
  const permissionsBefore=await worker.evaluate(()=>chrome.permissions.getAll());
  assert.equal(await worker.evaluate(()=>chrome.permissions.contains({origins:['https://127.0.0.1/*']})),false,'Do not reuse a browser with an existing fixture host grant');
  // Public configuration only: model a retained vault address after its grant is absent.
  await worker.evaluate(origin=>chrome.storage.local.set({vaultOrigin:origin}),fixture.origin);
  const target=await browser.newPage();await target.goto('https://web-move.invalid/login');await target.bringToFront();
  const session=await browser.browser().newBrowserCDPSession();
  const tabs=(await session.send('Target.getTargets',{filter:[{type:'tab'}]})).targetInfos.filter(row=>row.type==='tab'&&row.url===target.url());assert.equal(tabs.length,1);
  const before=(await session.send('Target.getTargets',{filter:[{}]})).targetInfos.map(row=>row.targetId);
  await session.send('Extensions.triggerAction',{id:extensionId,targetId:tabs[0].targetId});
  let popup;for(let attempt=0;attempt<100;attempt++){popup=(await session.send('Target.getTargets',{filter:[{}]})).targetInfos.find(row=>!before.includes(row.targetId)&&(row.type==='other'||row.type==='page'&&row.url.startsWith('chrome-extension://'+extensionId+'/')));if(popup)break;await new Promise(resolve=>setTimeout(resolve,50));}assert.ok(popup);
  view=await attachExtensionPopup(session,popup.targetId);await view.waitForURL('chrome-extension://'+extensionId+'/popup.html');
  await view.locator('#source-select').waitFor();await view.locator('#source-select').selectOption('web');
  await view.locator('#status').filter({hasText:/Connect your vault web address/}).waitFor();
  assert.equal(await view.locator('#items .item').count(),0);await view.locator('#results').waitFor({state:'hidden'});await view.locator('#setup').waitFor();
  assert.ok(!(await view.snapshot()).includes(normal.password));
  assert.equal(await target.locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);assert.equal(await target.evaluate(()=>window.submits),0);
  assert.deepEqual(await worker.evaluate(()=>chrome.permissions.getAll()),permissionsBefore);
  assert.equal(await page.locator('#state').textContent().then(value=>value.startsWith('Unlocked')),true);
  await view.close();view=null;await page.locator('#lock-app').click();await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked');
  assert.equal(mutations.length,0);assert.deepEqual(errors,[]);
  await writeFile(join(work,'extension-web-permission-refusal.json'),JSON.stringify({status:'passed',serverId:fixture.serverId,serverRevision:fixture.serverRevision,extensionSourceRevision:packageRecord.sourceRevision,archiveSha256:packageRecord.archiveSha256,extensionId,browserVersion:browser.browser().version(),permissionsBefore,permissionsAfter:await worker.evaluate(()=>chrome.permissions.getAll()),checks:['Selected immutable extension loaded as actual MV3 worker/action popup','Real selected web app OPAQUE unlock with retained genuinely enrolled member browser','Configured exact vault origin without host permission refuses source results despite unlocked app','No credentials/results/field fill/submit; no permission grant or vault mutation','Original permission set preserved and actual app locked'],limits:['Negative missing-permission case only; affirmative real web-source fill/lock/reconnect still pending authorization','Public vaultOrigin test setting written directly; no browser permission API or source bridge mocked','Headless Linux isolated browser; no native host registration or Windows GUI operation']},null,2)+'\n');
  console.log('Selected extension refuses unpermitted actual unlocked web source.');
}catch(error){await writeFile(join(work,'extension-web-refusal-failure-'+Date.now()+'.json'),JSON.stringify({error:error.message,errors,mutations,popup:view?await view.snapshot().catch(()=>null):null},null,2)+'\n',{flag:'wx'});throw Error('Extension web permission refusal failed; private diagnostic retained');}
finally{if(page)await page.locator('#lock-app').click({timeout:1000}).catch(()=>{});await browser.close();}
