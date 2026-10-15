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
const phase=process.argv[3];assert.ok(['archive','restore'].includes(phase));
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
 const fixture=JSON.parse(await readFile(join(work,'native-evidence.json'),'utf8'));assert.equal(fixture.fixtureServer,enrollment.fixtureServer);assert.equal(fixture.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.ok(fixture.vaultName.startsWith('Fixture Work '));
 const checks=[];
 stage='vault settings';await page.locator('#settings-toggle').click();await page.locator('#settings').waitFor({state:'visible'});await page.locator('[data-settings-view="vaults"]').click();
 if(phase==='archive'){
  stage='archive controlled vault';await page.getByLabel('Source vault',{exact:true}).selectOption(fixture.vaultId);await page.getByLabel('Vault removal action').selectOption('archive');await page.getByRole('button',{name:'Archive vault',exact:true}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});
  assert.ok((await page.locator('#confirm-dialog').innerText()).includes('Archive this vault?'));await page.locator('#confirm-accept').click();
  await page.waitForFunction(id=>window.__vaultsLifecycle?.retired?.some(row=>row.vaultId===id&&row.retirementChoice==='archive'),fixture.vaultId);
  const row=page.locator('#settings-vaults div').filter({has:page.locator('span',{hasText:fixture.vaultName})}).filter({has:page.getByRole('button',{name:'Restore',exact:true})}).last();await row.getByRole('button',{name:'Restore',exact:true}).waitFor();checks.push('actual packaged web settings archives exact fixture vault and offers restore');
 }else{
  stage='restore controlled vault';const row=page.locator('#settings-vaults div').filter({has:page.locator('span',{hasText:fixture.vaultName})}).filter({has:page.getByRole('button',{name:'Restore',exact:true})}).last();await row.getByRole('button',{name:'Restore',exact:true}).click();
  await page.waitForFunction(id=>window.__vaultsSnapshot?.some(row=>row.vaultId===id),fixture.vaultId);await page.locator('#close-settings').click();
  const target=await page.evaluate(id=>window.__vaultsSnapshot.find(row=>row.vaultId===id),fixture.vaultId);assert.equal(target.name,fixture.vaultName);await page.getByRole('button',{name:target.name,exact:true}).first().click();await page.waitForFunction(id=>window.__vaultsSnapshot.some(row=>row.selected&&row.vaultId===id),fixture.vaultId);
  const item=page.locator('#items [data-item-id="'+fixture.itemId+'"]');await item.waitFor();await item.click();await page.waitForFunction(title=>document.querySelector('#view-title')?.textContent===title,fixture.ackBaseline.title);assert.ok(!(await page.locator('#item-view').innerText()).includes('fictitious-lifecycle-password'));checks.push('actual packaged web settings restores exact fixture vault and reads original item masked');
 }
 if(await page.locator('#settings').isVisible())await page.locator('#close-settings').click();await page.locator('#lock-app').click();await page.waitForFunction(()=>window.__vaultsExtensionActions.status().locked===true);checks.push('web lock clears decrypted session');
 await writeFile(join(work,'web-'+phase+'.json'),JSON.stringify({status:'passed',fixtureServer:fixture.fixtureServer,checks,scope:'Real packaged HTTPS/PostgreSQL web; actual DOM/React handlers; controlled synthetic archive/restore'},null,2)+'\n',{flag:'wx'});console.log('Packaged web '+phase+' passed.');
}catch(error){if(page)await writeFile(join(work,'web-'+process.argv[3]+'-failure-'+Date.now()+'.json'),JSON.stringify({stage,error:String(error),body:await page.locator('body').innerText()},null,2));throw error;}
finally{await browser.close();}