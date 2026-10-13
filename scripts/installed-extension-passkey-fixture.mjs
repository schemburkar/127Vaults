// Real website adapter, popup approval, encrypted native persistence and ES256 assertion.
// This module is called only by the isolated synthetic-site/profile harness.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { attachExtensionPopup } from './extension-popup-driver.mjs';

export async function runInstalledPasskeyFixture({page,worker,popup,context,origin,checks}){
  await page.route(origin+'/passkeys',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Fictitious passkey ceremony</title>
  <button id="create">Create fixture passkey</button><button id="get">Use fixture passkey</button><button id="abort">Abort fixture request</button>
  <script>
  window.fixture={};
  document.querySelector('#create').onclick=()=>{fixture.error=null;navigator.credentials.create({publicKey:{challenge:new Uint8Array(32).fill(11),rp:{id:location.hostname,name:'Fictitious internal fixture'},user:{id:Uint8Array.of(1,2,3),name:'fixture-owner',displayName:'Fictitious owner'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{userVerification:'required'},attestation:'none',timeout:60000,extensions:{credProps:true}}}).then(value=>fixture.created=value.toJSON(),error=>fixture.error=String(error));};
  document.querySelector('#get').onclick=()=>{fixture.error=null;fixture.controller=new AbortController();navigator.credentials.get({publicKey:{challenge:new Uint8Array(32).fill(12),rpId:location.hostname,userVerification:'required',allowCredentials:[{type:'public-key',id:Uint8Array.from(atob(fixture.created.id.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))}],timeout:60000},signal:fixture.controller.signal}).then(value=>fixture.assertion=value.toJSON(),error=>fixture.error=String(error));};
  document.querySelector('#abort').onclick=()=>fixture.controller?.abort();
  </script>`}));
  await page.goto(origin+'/passkeys');
  let view=await popup(page);
  await view.locator('#source-select').selectOption('desktop');
  try{await view.locator('#enable-passkeys').waitFor();}catch(error){console.log('Passkey popup fixture diagnostic:',await view.snapshot());console.log('Fixture active tabs:',await worker.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true}).then(rows=>rows.map(row=>({id:row.id,url:row.url,windowId:row.windowId})))));throw error;}
  await view.locator('#enable-passkeys').click();
  console.log('Installed passkey fixture is waiting for optional HTTPS site permission.');
  let enabled=false;
  for(let i=0;i<1200;i++){
    enabled=await worker.evaluate(async()=> (await chrome.storage.local.get('passkeysAllSites')).passkeysAllSites===true&&await chrome.permissions.contains({origins:['https://*/*']}));
    if(enabled)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(enabled,'Optional HTTPS permission was not accepted in the isolated test browser');
  assert.equal(await worker.evaluate(()=>chrome.permissions.contains({origins:['https://*/*']})),true);
  checks.push('real optional HTTPS permission and installed provider enable');
  if(!await view.isClosed())await view.close();await page.reload();
  await page.waitForFunction(()=>window.__127vaultsPasskeyProvider===true);
  async function approvalPopup(){
    const session=await context.browser().newBrowserCDPSession();
    const existing=(await session.send('Target.getTargets',{filter:[{}]})).targetInfos.find(target=>target.url.endsWith('/popup.html')&&target.url.startsWith('chrome-extension://'));
    return existing?attachExtensionPopup(session,existing.targetId):popup(page);
  }
  await page.locator('#create').click();
  view=await approvalPopup();await view.locator('#source-select').selectOption('desktop');
  await view.locator('#passkey-request').waitFor();
  await view.locator('#passkey-choice').selectFirstOption();
  await view.locator('#passkey-approve').waitForEnabled();
  await view.locator('#passkey-approve').click();
  await page.waitForFunction(()=>fixture.created||fixture.error);
  assert.equal(await page.evaluate(()=>fixture.error),null,'Installed passkey registration failed');
  const created=await page.evaluate(()=>fixture.created);
  const client=JSON.parse(Buffer.from(created.response.clientDataJSON,'base64url'));
  assert.equal(client.origin,origin);assert.equal(client.type,'webauthn.create');
  assert.equal(client.challenge,Buffer.alloc(32,11).toString('base64url'));
  assert.equal(created.response.publicKeyAlgorithm,-7);
  checks.push('real website create and explicit popup approval persist before returning');
  await view.close();
  await page.locator('#get').click();view=await approvalPopup();
  await view.locator('#source-select').selectOption('desktop');await view.locator('#passkey-request').waitFor();
  await view.locator('#passkey-choice').selectFirstOption();await view.locator('#passkey-approve').waitForEnabled();await view.locator('#passkey-approve').click();
  await page.waitForFunction(()=>fixture.assertion||fixture.error);
  assert.equal(await page.evaluate(()=>fixture.error),null,'Installed passkey assertion failed');
  const assertion=await page.evaluate(()=>fixture.assertion),auth=Buffer.from(assertion.response.authenticatorData,'base64url'),data=Buffer.from(assertion.response.clientDataJSON,'base64url');
  assert.equal(assertion.id,created.id);assert.equal(JSON.parse(data).challenge,Buffer.alloc(32,12).toString('base64url'));
  assert.ok(auth.subarray(0,32).equals(createHash('sha256').update(new URL(origin).hostname).digest()));
  assert.equal(auth[32],0x0d);
  const key=createPublicKey({key:Buffer.from(created.response.publicKey,'base64url'),format:'der',type:'spki'});
  assert.ok(verify('sha256',Buffer.concat([auth,createHash('sha256').update(data).digest()]),key,Buffer.from(assertion.response.signature,'base64url')));
  checks.push('real installed provider assertion verifies ES256, challenge, RP and verification flags');
  await view.close();
  await page.evaluate(()=>{fixture.assertion=null;});await page.locator('#get').click();
  view=await approvalPopup();await view.locator('#passkey-cancel').click();await page.waitForFunction(()=>!!fixture.error);
  assert.ok((await page.evaluate(()=>fixture.error)).includes('NotAllowedError'));checks.push('explicit popup cancellation rejects website ceremony');
  await view.locator('#disable-passkeys').click();await view.locator('#status').filter({hasText:/passkeys disabled/i}).waitFor();
  assert.equal(await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts().then(rows=>rows.filter(row=>/^passkey-/.test(row.id)).length)),0);
  checks.push('provider disable removes registered scripts');await view.close();
}
