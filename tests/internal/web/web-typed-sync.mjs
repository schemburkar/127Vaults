import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve,join,isAbsolute,relative,sep} from 'node:path';
const work=process.argv[2];assert.ok(work&&isAbsolute(work),'Explicit absolute fixture workspace required');
const checkout=resolve(import.meta.dirname,'../../..'),rel=relative(checkout,work);
assert.ok(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Fixture workspace must be outside the checkout');
const enrollment=JSON.parse(await readFile(join(work,'enrolled-browser.json'),'utf8'));
assert.equal(enrollment.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(enrollment.verifiedHTTPS,true);
const {chromium}=createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE||'playwright');
const origin='https://127.0.0.1:12892';
const guiCreatedRead=process.argv[3]==='--gui-created-read';assert.ok(!process.argv[3]||guiCreatedRead,'Optional mode is --gui-created-read');
const browser=await chromium.launchPersistentContext(join(work,'browser-profile'),{executablePath:process.env.VAULTS_CHROME_PATH||'/fixture/chrome/chrome',headless:true,viewport:{width:1440,height:1000}});
let page,stage='login';
try{
 await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page=browser.pages()[0]||await browser.newPage();await page.goto(origin);
 await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='Locked'&&document.querySelector('#register-browser-device')?.hidden);
 if(await page.locator('#login-next').isVisible()){await page.locator('#username').fill('owner_127');await page.locator('#login-next').click();}
 if(await page.locator('#secret').isVisible())await page.locator('#secret').fill('07'.repeat(32));
 await page.locator('#master').fill('fictitious password 127vaults');await page.locator('#login').click();
 await page.waitForFunction(()=>window.__vaultsExtensionActions?.status?.().locked===false,null,{timeout:60000});
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 stage='select empty fixture vault';const target=await page.evaluate(()=>window.__vaultsSnapshot.find(row=>row.vaultId==='66031b92-58ad-4114-b967-dcbf0541be24'));assert.ok(target);await page.getByRole('button',{name:target.name,exact:true}).first().click();
 await page.waitForFunction(()=>window.__vaultsSnapshot?.some(row=>row.selected&&row.vaultId==='66031b92-58ad-4114-b967-dcbf0541be24'));
 const evidence=JSON.parse(await readFile(join(work,'types-native.json'),'utf8'));assert.equal(evidence.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(evidence.items.length,7);
 if(guiCreatedRead){
  assert.ok(evidence.title.startsWith('Linux packaged typed '));assert.equal(evidence['gui-types-restorePassed'],true);assert.equal(evidence.vaultId,'66031b92-58ad-4114-b967-dcbf0541be24');assert.deepEqual(evidence.items.map(row=>row.type),['login','password','bank','card','wifi','router','ssh']);
  const checks=[];
  for(const item of evidence.items){stage='desktop-created web read '+item.type;assert.match(item.itemId,/^[a-f0-9-]{36}$/);const row=page.locator('#items [data-item-id="'+item.itemId+'"]');await row.waitFor();await row.click();await page.waitForFunction(title=>document.querySelector('#view-title')?.textContent===title,item.title);const detail=await page.locator('#item-view').innerText();
   assert.equal((await page.locator('#view-type').innerText()).trim(),item.label.toUpperCase());for(const field of item.fields){if(field.type==='password')assert.ok(!detail.includes(field.value),'Web must mask '+field.id);else assert.ok(detail.includes(field.value),'Web must retain '+field.id);}if(item.password)assert.ok(!detail.includes(item.password));if(item.username)assert.ok(detail.includes(item.username));if(item.website)assert.ok(detail.includes(item.website));checks.push('actual web reads Desktop-created '+item.type+' type/fields and masks standard/custom secrets');
  }
  await page.locator('#lock-app').click();await page.waitForFunction(()=>window.__vaultsExtensionActions.status().locked===true);await writeFile(join(work,'web-gui-created-read.json'),JSON.stringify({status:'passed',fixtureServer:enrollment.fixtureServer,checks,scope:'Actual packaged HTTPS/PostgreSQL web DOM; seven original Desktop-created IDs'},null,2)+'\n',{flag:'wx'});console.log('Packaged web reads all seven Desktop-created types with expected fields and masked secrets.');
 }else{
 for(const item of evidence.items){
  stage='read '+item.type;
  const row=page.locator('#items [data-item-id]').filter({hasText:item.title});await row.waitFor();assert.equal(await row.getAttribute('data-item-id'),item.itemId);await row.click();
  await page.waitForFunction(titles=>titles.includes(document.querySelector('#view-title')?.textContent),[item.title,item.expectedTitle]);
  await page.locator('#view-custom-fields').getByText('fixture ordinary field',{exact:true}).waitFor({state:'visible'});
  const detail=await page.locator('#item-view').innerText();assert.ok(detail.includes('fixture ordinary field'));assert.ok(!detail.includes('fictitious-typed-secret')&&!detail.includes('fictitious-related-secret'));
  stage='edit '+item.type;await page.locator('#edit-item').click();await page.locator('#title').fill(item.expectedTitle);await page.locator('#save').click();
  await page.locator('#item-form').waitFor({state:'hidden'});await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
  await page.locator('#items [data-item-id]').filter({hasText:item.expectedTitle}).waitFor();item.webReadAndEditPassed=true;
 }
 evidence.webTypesReadAndEditPassed=true;evidence.date=new Date().toISOString();await writeFile(join(work,'types-native.json'),JSON.stringify(evidence,null,2)+'\n');
 await page.locator('#lock-app').click();await page.waitForFunction(()=>window.__vaultsExtensionActions.status().locked===true);
 console.log('Packaged web UI read and edited all seven enabled item types with masked secrets.');
 }
}catch(error){if(page)await writeFile(join(work,'types-web-failure.json'),JSON.stringify({stage,error:String(error),body:await page.locator('body').innerText()},null,2));throw error;}
finally{await browser.close();}
