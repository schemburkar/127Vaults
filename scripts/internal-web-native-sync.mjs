import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve,join,isAbsolute,relative,sep} from 'node:path';
const work=process.argv[2];assert.ok(work&&isAbsolute(work),'Explicit absolute fixture workspace required');
const checkout=resolve(import.meta.dirname,'..'),rel=relative(checkout,work);
assert.ok(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Fixture workspace must be outside the checkout');
const enrollment=JSON.parse(await readFile(join(work,'enrolled-browser.json'),'utf8'));
assert.equal(enrollment.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(enrollment.verifiedHTTPS,true);
const {chromium}=createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE||'playwright');
const origin='https://127.0.0.1:12892';
const offline=process.argv[3]==='--offline';
assert.ok(!process.argv[3]||offline,'Optional mode is --offline');
const browser=await chromium.launchPersistentContext(join(work,'browser-profile'),{executablePath:process.env.VAULTS_CHROME_PATH||'/fixture/chrome/chrome',headless:true,viewport:{width:1440,height:1000}});
if(offline)await browser.addInitScript(()=>{
 const original=window.matchMedia.bind(window);
 window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};
});
let page,stage='login';
try{
 await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page=browser.pages()[0]||await browser.newPage();await page.goto(origin);
 await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked'&&document.querySelector('#register-browser-device')?.hidden);
 if(await page.locator('#login-next').isVisible()){await page.locator('#username').fill('owner_127');await page.locator('#login-next').click();}
 if(await page.locator('#secret').isVisible())await page.locator('#secret').fill('07'.repeat(32));
 await page.locator('#master').fill('fictitious password 127vaults');await page.locator('#login').click();
 await page.waitForFunction(()=>window.__vaultsExtensionActions?.status?.().locked===false,null,{timeout:60000});
 stage='select empty fixture vault';const target=await page.evaluate(()=>window.__vaultsSnapshot.find(row=>row.vaultId==='66031b92-58ad-4114-b967-dcbf0541be24'));assert.ok(target);await page.getByRole('button',{name:target.name,exact:true}).first().click();
 await page.waitForFunction(()=>window.__vaultsSnapshot?.some(row=>row.selected&&row.vaultId==='66031b92-58ad-4114-b967-dcbf0541be24'));
 if(offline){await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await browser.setOffline(true);}
 stage='create web item';const title='Web-native fixture '+randomUUID();
 await page.locator('#new-item').click();await page.locator('#title').fill(title);await page.locator('#url').fill('https://web-native.invalid');await page.locator('#item-username').fill('web-fixture-user');await page.locator('#item-password').fill('fictitious-web-native-password');await page.locator('#save').click();
 await page.locator('#item-form').waitFor({state:'hidden'});
 const row=page.locator('#items [data-item-id]').filter({hasText:title});await row.waitFor();
 const itemId=await row.getAttribute('data-item-id');assert.match(itemId,/^[a-f0-9-]{36}$/);
 const evidence={fixtureServer:'14725fef-f5b4-4cb8-afe0-77aa3d80b268',vaultId:'66031b92-58ad-4114-b967-dcbf0541be24',itemId,title,expectedPeerTitle:title+' native edit',verifiedHTTPS:true,webCreatePassed:true};
 if(offline){
  await page.waitForFunction(()=>document.querySelector('#session-dates')?.textContent.includes('pending change'));
  evidence.offlineQueued=true;evidence.installedModeEmulated=true;
  stage='replay offline creation';await browser.setOffline(false);await page.locator('#reload').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates')?.textContent.includes('Up to date')&&!document.querySelector('#session-dates')?.textContent.includes('pending'),null,{timeout:60000});
  evidence.offlineReplayPassed=true;
 }
 await writeFile(join(work,'web-native.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Real packaged web UI created an encrypted item; waiting for native peer edit.');
 stage='wait for native peer';let edited=false;for(let i=0;i<240;i++){try{edited=JSON.parse(await readFile(join(work,'native-peer-edited.json'),'utf8')).itemId===itemId;}catch{}if(edited)break;await new Promise(resolve=>setTimeout(resolve,1000));}assert.ok(edited,'Native peer edit not received');
 stage='read native edit';await page.locator('#reload').click();const changed=page.locator('#items [data-item-id]').filter({hasText:evidence.expectedPeerTitle});await changed.waitFor({timeout:60000});await changed.click();
 await page.waitForFunction(expected=>document.querySelector('#view-title')?.textContent===expected,evidence.expectedPeerTitle);
 assert.equal((await page.locator('#view-username').innerText()).trim(),'native-fixture-user');assert.ok(!(await page.locator('#view-password').innerText()).includes('fictitious-web-native-password'));
 Object.assign(evidence,JSON.parse(await readFile(join(work,'web-native.json'),'utf8')));evidence.webReverseReadPassed=true;evidence.date=new Date().toISOString();await writeFile(join(work,'web-native.json'),JSON.stringify(evidence,null,2)+'\n');
 await writeFile(join(work,`web-native-${itemId}.json`),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 await page.locator('#lock-app').click();await page.waitForFunction(()=>window.__vaultsExtensionActions.status().locked===true);
 console.log('Packaged web UI read the native peer edit with password masking, then locked.');
}catch(error){if(page)await writeFile(join(work,'web-roundtrip-failure.json'),JSON.stringify({stage,error:String(error),body:await page.locator('body').innerText()},null,2));throw error;}
finally{await browser.close();}




