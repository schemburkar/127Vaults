import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const output=fileURLToPath(new URL('../../../.tools/verification/extension-popup-20261027', import.meta.url));
await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:380,height:600}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://popup.example.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const file=new URL(path==='/'?'../popup.html':'..'+path,import.meta.url);
  await route.fulfill({body:await readFile(file),contentType:path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html'});
 });
 await page.addInitScript(()=>{
  window.fixtureUnlocked=false;
  window.fixtureSourcesReady=new Promise(done=>{window.releaseFixtureSources=done;});
  window.chrome={storage:{local:{async get(){return {passkeysAllSites:true};}}},permissions:{async contains(){return true;}},tabs:{async query(){return [{id:1,url:'https://example.test/login'}];}},scripting:{async getRegisteredContentScripts(){return [{id:'passkey-bridge-all',world:'ISOLATED',matches:['https://*/*']},{id:'passkey-page-all',world:'MAIN',matches:['https://*/*']}];}},runtime:{async sendMessage(message){
   if(message.kind==='passkey.pending')return {requests:[]};
   if(message.kind==='connector.request'){
    const request=message.request;window.lastConnectorAction=request.action;
    if(request.action==='sources')await window.fixtureSourcesReady;
    if(request.action==='sources')return {ok:true,value:{sources:[{id:'desktop',configured:true,active:window.fixtureUnlocked,online:true,sync:{lastVerifiedSyncAt:1793090000}}]}};
    if(request.action==='open.desktop')return {ok:true,value:{opened:true}};
    if(request.action==='list')return window.fixtureUnlocked?{ok:true,value:window.fixtureNoItems?[]:[{itemId:'fixture',title:'Example login',username:'alice',website:'https://example.test'}]}:{ok:false,error:'locked'};
    if(request.action==='passkey.list')return {ok:true,value:[]};
   }
   throw Error('Unexpected popup request');
  }}};
 });
 await page.goto('https://popup.example.test/');
 await page.locator('#loading-view').waitFor({state:'visible'});
 const loadingSource=await page.locator('#change-source').boundingBox();
 assert.equal(await page.locator('#change-source').getAttribute('title'),'Change source');
 await page.screenshot({path:join(output,'loading.png')});
 await page.evaluate(()=>window.releaseFixtureSources());
 await page.locator('#unlock-desktop').waitFor({state:'visible'});
 assert.equal(await page.locator('#source-select').isVisible(),false);
 assert.equal(await page.locator('#disable-passkeys').isVisible(),false);
 assert.equal(await page.locator('#settings').isVisible(),false);
 const lockedSource=await page.locator('#change-source').boundingBox();
 assert.equal(lockedSource.x,loadingSource.x);
 await page.screenshot({path:join(output,'locked.png')});
 await page.locator('#unlock-desktop').click();
 assert.equal(await page.evaluate(()=>window.lastConnectorAction),'open.desktop');
 await page.locator('#change-source').click();
 assert.equal(await page.locator('#source-select').isVisible(),true);
 await page.evaluate(()=>{window.fixtureUnlocked=true;});
 await page.locator('#refresh-sources').click();
 await page.locator('#items .item').waitFor({state:'visible'});
 await page.locator('#change-source').click();
 assert.equal(await page.locator('#source-badge').innerText(),'Desktop');
 assert.equal(await page.locator('#disable-passkeys').isVisible(),false);
 assert.equal(await page.locator('#source-select').isVisible(),false);
 assert.equal(await page.locator('#lock-vault').isVisible(),true);
 const lock=await page.locator('#lock-vault').boundingBox(),source=await page.locator('#change-source').boundingBox();
 assert.equal(lock.y,source.y); assert(source.x>lock.x); assert.equal(source.x,lockedSource.x);
 assert.equal(await page.locator('#loading-view').isVisible(),false);
 await page.screenshot({path:join(output,'unlocked.png')});
 await page.locator('#extension-settings>summary').click();
 assert.equal(await page.locator('#disable-passkeys').isVisible(),true);
 await page.locator('#change-source').click();
 assert.equal(await page.locator('#settings').isVisible(),true);
 await page.evaluate(()=>{window.fixtureNoItems=true;});
 await page.locator('#refresh-sources').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='No sign-ins saved for this site.');
 assert.equal((await page.locator('#change-source').boundingBox()).x,lockedSource.x);
 assert.deepEqual(errors,[]);
 console.log('Popup smoke passed: locked CTA, native open action, source disclosure, unlocked results, secondary passkey settings. Screenshots: '+output);
} finally {await browser.close();}
