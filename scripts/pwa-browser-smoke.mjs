// Isolated installed-app acceptance with real Rust WASM, OPAQUE, device proofs,
// IndexedDB, Cache Storage and a browser service worker. Never reads .env or a
// live database; every account/password/item here is disposable synthetic data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { AuthService } from '../apps/server/src/auth-service.mjs';
import { OpaqueAdapter, encodeBinding, authenticationContextHash } from '../apps/server/src/opaque-adapter.mjs';
import { directory, catalogue } from '../apps/server/src/private-vault.mjs';
import { createSignedCheckpoint, checkpointHash, nextOperationHead } from '../packages/sync/src/index.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const { default: init, ExperimentalEcf1Core, ExperimentalOpaqueBridge: O } = await import('../apps/web/wasm/vaults_browser_fixture.js');
await init({ module_or_path: await readFile(new URL('../apps/web/wasm/vaults_browser_fixture_bg.wasm',import.meta.url)) });
const b64 = value => Buffer.from(value).toString('base64url'), un = value => Buffer.from(value,'base64url');
const ids = value => Buffer.from(value.replaceAll('-',''),'hex');
const uuid = bytes => { const h=Buffer.from(bytes).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
const canonical = value => JSON.stringify(value,Object.keys(value).sort());
const hash = value => createHash('sha512').update(value).digest();
const publicKey = value => createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),un(value)]),format:'der',type:'spki'});
const master = 'disposable-pwa-browser-master-password', secretHex = '03'.repeat(32), username='pwa_fixture_user';
const tenantId=randomUUID(),accountId=randomUUID(),core=new ExperimentalEcf1Core(),encoder=new TextEncoder();
const template=new Uint8Array(77);template[0]=1;template.set(ids(tenantId),1);template.set(ids(accountId),17);template.set([0,0,0,1],65);template[76]=1;
const root=core.create_root(template,encoder.encode(master),un(b64(Buffer.alloc(32,3))));
let privateDirectory=b64(core.create_empty_directory(root)),settings={revision:null,envelope:null},rejectAuth=false,dropNextWrite=false,lostRepliesFor=null;
const vaults=new Map(),receipts=new Map(),devices=new Map(),attempts=new Map(),sessions=new Map(),enrollments=new Map();
const checkpoints=new Map();
const checkpointHistory=new Map(),checkpointKeys=generateKeyPairSync('ed25519'),checkpointPublicKey=checkpointKeys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
const setup=O.server_setup(),serverKey=O.server_public_key(setup),opaque=new OpaqueAdapter(O);
const approver=generateKeyPairSync('ed25519');
let origin,opaqueRecord;
function addVault(name) {
  const made=core.create_private_vault(root,un(privateDirectory)),handle=made.vault(),vaultId=uuid(handle.context().slice(33,49));
  privateDirectory=b64(made.directory());
  vaults.set(vaultId,{vaultId,envelope:b64(handle.envelope()),catalogue:b64(made.catalogue()),items:new Map(),operations:[]});
  core.release_vault(handle);handle.free();made.free();return vaultId;
}
const firstVault=addVault('Private'),secondVault=addVault('Second');
function changeItem(vaultId,itemId,index,body) {
  const row=vaults.get(vaultId),handle=core.open_private_vault(root,un(privateDirectory),ids(vaultId),un(row.envelope));
  const made=core.upsert_private_item(handle,un(row.catalogue),itemId?ids(itemId):undefined,encoder.encode(JSON.stringify(index)),encoder.encode(JSON.stringify(body)));
  const nextId=uuid(made.item());row.catalogue=b64(made.catalogue());row.items.set(nextId,{itemId:nextId,index:b64(made.index()),body:b64(made.body()),createdAt:Date.now(),updatedAt:Date.now()});
  core.release_vault(handle);handle.free();made.free();return nextId;
}
const firstItem=changeItem(firstVault,null,{title:'Offline fixture login',website:'https://example.invalid',itemType:'login',favorite:false},{username:'synthetic-user',password:'synthetic-original-password',customFields:[]});
changeItem(secondVault,null,{title:'Second vault fixture',website:'',favorite:true},{username:'second-user',password:'second-vault-secret',customFields:[]});
const store={
  async loginMaterial({deviceId}) {
    if(rejectAuth||!devices.has(deviceId))throw Error('authentication_failed');
    return{setup:Buffer.from(setup),record:opaqueRecord,binding:{installation:tenantId,account:accountId,device:deviceId,epoch:1,serverPublicKey:Buffer.from(serverKey)},descriptor:Buffer.from(root.context()),envelope:Buffer.from(root.envelope()),publicKey:un(devices.get(deviceId))};
  },
  async saveAttempt(value){attempts.set(b64(value.attempt),value)},
  async consumePasswordAttempt({attempt}){return attempts.get(b64(attempt))},
  async recordFailure(){},
  async passwordSucceeded({pending,capability,rootTag}){pending.capability=capability;pending.tag=rootTag},
  async consumeRoot({attempt,capability}){const p=attempts.get(b64(attempt));assert.ok(p.capability.equals(capability));return{descriptor:p.descriptor,envelope:p.envelope,tag:p.tag}},
  async deviceAttempt({attempt}){const p=attempts.get(b64(attempt));p.proofFields={contextHash:authenticationContextHash(p.binding),transcriptHash:hash(Buffer.concat([p.request,p.response])),installation:ids(tenantId),account:ids(accountId),device:ids(p.binding.device),epoch:1,rootHash:hash(Buffer.concat([p.descriptor,p.envelope]))};return p},
  async createSession({pending,token,csrf}){sessions.set(b64(token),{deviceId:pending.binding.device,csrf:b64(csrf)});return{expiresAt:new Date(Date.now()+3600000)}},
};
const auth=new AuthService({store,opaque});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.webmanifest':'application/manifest+json'};
const failures=[];
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin),path=url.pathname;
    const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value))};
    if(!path.startsWith('/api/')) {
      const asset=path==='/'?'index.html':path.slice(1);
      if(asset.includes('..'))return send(404,{error:'not_found'});
      const bytes=await readFile(new URL(`../apps/web/dist/${asset}`,import.meta.url));
      res.writeHead(200,{'Content-Type':types[asset.slice(asset.lastIndexOf('.'))]||'application/octet-stream','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; manifest-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(bytes);return;
    }
    let body={};if(req.method!=='GET'){const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks))}
    if(path==='/api/v1/setup')return send(200,{ownerRequired:false});
    if(path==='/api/v1/device-enrollment') {
      const transcript={deviceId:body.newDeviceId,publicKey:body.newDevicePublicKey,purpose:'enrollment-request',username:body.username};
      assert.equal(verify(null,Buffer.from(canonical(transcript)),publicKey(body.newDevicePublicKey),un(body.requestSignature)),true);
      const enrollmentId=randomUUID(),expiresAt=new Date(Date.now()+600000).toISOString(),code='ABCDEFGH',pollToken=b64(randomBytes(32));
      enrollments.set(enrollmentId,{...body,enrollmentId,expiresAt,code,pollToken,approved:false});return send(200,{enrollmentId,expiresAt,code,pollToken});
    }
    const enroll=path.match(/^\/api\/v1\/device-enrollment\/([^/]+)\/(poll|complete)$/);
    if(enroll) {
      const e=enrollments.get(enroll[1]);assert.equal(e.pollToken,body.pollToken);
      const binding={accountId,enrollmentId:e.enrollmentId,newDeviceId:e.newDeviceId,newDevicePublicKey:e.newDevicePublicKey,expiresAt:e.expiresAt};
      if(enroll[2]==='poll')return send(200,e.approved?{status:'approved',binding,approvalSignature:b64(sign(null,Buffer.from(canonical(binding)),approver.privateKey)),approverPublicKey:b64(approver.publicKey.export({format:'der',type:'spki'}).subarray(-32))}:{status:'pending'});
      assert.ok(e.approved);assert.ok(verify(null,Buffer.from(canonical({...binding,purpose:'device-possession'})),publicKey(e.newDevicePublicKey),un(body.possessionSignature)));
      devices.set(e.newDeviceId,e.newDevicePublicKey);return send(200,{deviceId:e.newDeviceId,credentialEpoch:1});
    }
    if(path==='/api/v1/auth/') {
      try {return send(200,{...await auth.start({...body,origin,source:'127.0.0.1'}),csrf:'ceremony'})}catch{return send(401,{error:'authentication_failed'})}
    }
    const login=path.match(/^\/api\/v1\/auth\/([^/]+)\/(password|device-proof)$/);
    if(login) {
      try {
        if(login[2]==='password'){const done=await auth.finishPassword({attemptId:login[1],finalization:body.finalization});return send(200,await auth.consumeRoot({attemptId:login[1],capability:done.capability}))}
        const done=await auth.finishDevice({attemptId:login[1],signature:body.signature});return send(200,{csrf:done.csrf,expiresAt:done.expiresAt},{'Set-Cookie':`fixture-session=${done.token}; HttpOnly; SameSite=Strict; Path=/`});
      }catch{return send(401,{error:'authentication_failed'})}
    }
    const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fixture-session='))?.slice(16),session=sessions.get(token);
    if(!session||rejectAuth)return send(401,{error:'authentication_required'});
    if(req.method!=='GET'&&path!=='/api/v1/session')assert.equal(req.headers['x-127v-csrf'],session.csrf);
    if(path==='/api/v1/session'){sessions.delete(token);return send(200,{loggedOut:true})}
    if(path==='/api/v1/license')return send(200,{mode:'active'});
    if(path==='/api/v1/devices')return send(200,{devices:[...devices.keys()].map(deviceId=>({deviceId,status:'active',credentialState:'current',protectionClass:'software'}))});
    if(path==='/api/v1/vault-settings') {
      if(req.method==='GET')return send(200,settings);
      if(body.revision===settings.revision&&body.envelope===settings.envelope)return send(200,{revision:body.revision});
      if(body.baseRevision!==settings.revision)return send(409,{error:'BASE_CHANGED'});
      core.decrypt_account_settings(root,un(body.envelope));settings={revision:body.revision,envelope:body.envelope};return send(200,{revision:body.revision});
    }
    if(path==='/api/v1/vaults'&&req.method==='GET')return send(200,{directory:privateDirectory,vaultEnvelopes:[...vaults.values()].map(row=>({vaultId:row.vaultId,envelope:row.envelope,retired:!!row.retired,retirementChoice:row.retirementChoice||null,retirementDestination:row.retirementDestination||null}))});
    const requestKey=body.requestId,fingerprint=JSON.stringify({path,method:req.method,body});
    if(requestKey&&receipts.has(requestKey)){assert.equal(receipts.get(requestKey).fingerprint,fingerprint);if(lostRepliesFor===requestKey){res.destroy();return}return send(200,receipts.get(requestKey).value)}
    const accept=value=>{receipts.set(requestKey,{fingerprint,value});if(dropNextWrite){dropNextWrite=false;lostRepliesFor=requestKey}if(lostRepliesFor===requestKey){res.destroy();return}send(200,value)};
    const lifecycle=path.match(/^\/api\/v1\/vaults\/([^/]+)\/(checkpoint|removal|restore)$/);
    if(lifecycle) {
      const row=vaults.get(lifecycle[1]);assert.ok(row);
      if(lifecycle[2]==='checkpoint'){
        const history=checkpointHistory.get(row.vaultId)||[];
        if(req.method==='GET') {
          const after=url.searchParams.get('after'),offset=after?history.findIndex(checkpoint=>checkpointHash(checkpoint)===after)+1:0;
          if(after&&offset===0)return send(409,{error:'checkpoint_fork'});
          const limit=Number(url.searchParams.get('limit')||100);
          return send(200,{checkpointPublicKey,checkpoints:history.slice(offset,offset+limit),hasMore:offset+limit<history.length});
        }
        let head='0'.repeat(64);for(const {operation} of row.operations)head=nextOperationHead(head,operation);
        const checkpoint=createSignedCheckpoint({tenantId,vaultId:row.vaultId,epoch:1,cursor:row.operations.length,previousCheckpointHash:history.length?checkpointHash(history.at(-1)):'0'.repeat(64),operationHeadHash:head},checkpointKeys.privateKey);
        history.push(checkpoint);checkpointHistory.set(row.vaultId,history);checkpoints.set(row.vaultId,row.operations.length);return send(200,{checkpoint});
      }
      if(body.sourceCatalogueRevision!==catalogue(un(row.catalogue)).revision)return send(409,{error:'BASE_CHANGED'});
      if(lifecycle[2]==='restore'){assert.equal(row.retirementChoice,'archive');row.retired=false;row.retirementChoice=null;return accept({restored:true})}
      assert.equal(checkpoints.get(row.vaultId),row.operations.length);
      if(body.choice==='move') {
        const dest=vaults.get(body.destinationVaultId);assert.ok(dest);assert.equal(checkpoints.get(dest.vaultId),dest.operations.length);
        assert.equal(body.destinationCatalogueRevision,catalogue(un(dest.catalogue)).revision);assert.equal(body.itemMappings.length,row.items.size);
        for(const mapping of body.itemMappings)assert.ok(row.items.has(mapping.sourceItemId)&&dest.items.has(mapping.destinationItemId));
      }
      if(settings.revision!==body.settings.baseRevision)return send(409,{error:'BASE_CHANGED'});
      core.decrypt_account_settings(root,un(body.settings.envelope));settings=body.settings;row.retired=true;row.retirementChoice=body.choice;row.retirementDestination=body.destinationVaultId;
      return accept({recoverable:true,itemCount:row.items.size});
    }
    if(path==='/api/v1/vaults'&&req.method==='POST') {
      if(body.baseDirectoryRevision!==directory(un(privateDirectory)).revision)return send(409,{error:'BASE_CHANGED'});
      const next=directory(un(body.directory)),added=next.entries.find(e=>!vaults.has(e.vault));assert.ok(added);
      const handle=core.open_private_vault(root,un(body.directory),ids(added.vault),un(body.vaultEnvelope));core.release_vault(handle);handle.free();
      privateDirectory=body.directory;vaults.set(added.vault,{vaultId:added.vault,envelope:body.vaultEnvelope,catalogue:body.catalogue,items:new Map(),operations:[]});return accept({catalogueRevision:catalogue(un(body.catalogue)).revision});
    }
    const route=path.match(/^\/api\/v1\/vaults\/([^/]+)\/(items|operations)(?:\/([^/]+))?$/);
    if(!route)return send(404,{error:'not_found'});
    const row=vaults.get(route[1]);if(!row)return send(404,{error:'NOT_FOUND'});
    if(route[2]==='operations')return send(200,{cursor:row.operations.length,operations:row.operations,hasMore:false,devicePublicKeys:Object.fromEntries(devices)});
    const revision=catalogue(un(row.catalogue)).revision;
    if(req.method==='GET') {
      if(!route[3])return send(200,{catalogue:row.catalogue,indices:[...row.items.values()].map(item=>({itemId:item.itemId,envelope:item.index,createdAt:item.createdAt,updatedAt:item.updatedAt}))});
      if(url.searchParams.get('catalogueRevision')!==revision)return send(409,{error:'BASE_CHANGED'});
      const item=row.items.get(route[3]);if(!item)return send(404,{error:'NOT_FOUND'});return send(200,{envelope:item.body,catalogueRevision:revision,itemId:item.itemId});
    }
    if(row.retired)return send(409,{error:'VAULT_RETIRED'});
    if(body.baseCatalogueRevision!==revision)return send(409,{error:'BASE_CHANGED'});
    const op=body.signedOperation,{signature,...unsigned}=op;
    assert.equal(op.deviceId,session.deviceId);assert.equal(op.tenantId,tenantId);assert.equal(op.vaultId,row.vaultId);
    assert.ok(verify(null,Buffer.from(canonical(unsigned)),publicKey(devices.get(session.deviceId)),un(signature)));
    const {opId,...unsignedBody}=unsigned;assert.equal(opId,createHash('sha256').update(canonical(unsignedBody)).digest('hex'));
    const previous=[...row.operations].reverse().find(e=>e.operation.deviceId===session.deviceId)?.operation.opId||null;
    if(op.previousDeviceOpId!==previous)return send(409,{error:'sync_conflict'});
    const handle=core.open_private_vault(root,un(privateDirectory),ids(row.vaultId),un(row.envelope));
    core.decrypt_private_part(handle,un(body.catalogue),ids(op.itemId),un(body.index),4);core.decrypt_private_part(handle,un(body.catalogue),ids(op.itemId),un(body.body),3);core.release_vault(handle);handle.free();
    row.catalogue=body.catalogue;row.items.set(op.itemId,{itemId:op.itemId,index:body.index,body:body.body,createdAt:row.items.get(op.itemId)?.createdAt||Date.now(),updatedAt:Date.now()});row.operations.push({cursor:row.operations.length+1,operation:op});
    return accept({catalogueRevision:catalogue(un(body.catalogue)).revision});
  }catch(error){failures.push(error.message);if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture_failure'}))}else res.end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
const registrationBinding=encodeBinding({origin,installation:tenantId,account:accountId,device:randomUUID(),epoch:1,attempt:randomBytes(32),serverPublicKey:Buffer.from(serverKey)});
const registration=O.client_registration_start(Buffer.alloc(32,3),encoder.encode(master));
const response=O.server_registration_start(setup,registration.message(),registrationBinding);
opaqueRecord=Buffer.from(O.server_registration_finish(O.client_registration_finish(registration.state(),Buffer.alloc(32,3),encoder.encode(master),response,registrationBinding)));
let browser;
const output=resolve(import.meta.dirname,'..','.tools/pwa-browser-check');await mkdir(output,{recursive:true});
try {
  browser=await chromium.launch({headless:true,...(process.env.VAULTS_BROWSER_EXECUTABLE?{executablePath:process.env.VAULTS_BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  await context.addInitScript(()=>{
    window.addEventListener('vaults:toast',event=>{if(event.detail.kind==='error')console.error('acceptance-error:',JSON.stringify(event.detail))});
    const original=window.matchMedia.bind(window);
    window.matchMedia=query=>query==='(display-mode: standalone)'?{...original(query),matches:true,addEventListener(){},removeEventListener(){}}:original(query);
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.text().startsWith('acceptance-error:'))console.error(message.text())});
  await page.goto(`${origin}/?pwa=1`);await page.locator('#register-browser-device').waitFor({state:'visible'});
  await page.locator('#username').fill(username);await page.locator('#register-browser-device').click();await page.locator('#browser-enrollment-code').waitFor({state:'visible'});
  assert.equal(await page.locator('#browser-enrollment-code').textContent(),'ABCDEFGH');
  await page.locator('#browser-enrollment-check').click();await page.waitForFunction(()=>document.querySelector('#browser-enrollment-status').textContent.includes('Still waiting'));
  for(const e of enrollments.values())e.approved=true;
  await page.locator('#browser-enrollment-check').click();await page.locator('#master').waitFor({state:'visible'});
  await page.locator('#secret').fill(secretHex);await page.locator('#master').fill(master);await page.locator('#login').click();await page.locator('#vault').waitFor({state:'visible',timeout:20000});
  await page.waitForFunction(async()=>{const registration=await navigator.serviceWorker.getRegistration();return !!registration?.active});
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('Up to date'));
  if (process.env.VAULTS_TEST_ITEM_WORKSPACE === '1') {
    const { exerciseItemWorkspace } = await import('./item-workspace-web-smoke.mjs');
    await exerciseItemWorkspace(page, { firstItem, firstVault, secondVault, master });
  }
  console.log('Verified device enrollment, authenticated unlock and offline shell preparation.');
  await page.evaluate(async()=>{
    const name=(await caches.keys()).find(name=>name.startsWith('127vaults-shell-')),cache=await caches.open(name);
    await cache.delete('/wasm/vaults_browser_fixture_bg.wasm');
    const registration=await navigator.serviceWorker.ready,channel=new MessageChannel();
    const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('shell repair timed out')),15000);channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve(event.data.ready)};registration.active.postMessage({type:'127vaults-check-shell'},[channel.port2])});
    if(!ready||!await cache.match('/wasm/vaults_browser_fixture_bg.wasm'))throw Error('partial shell was not repaired');
  });
  await page.evaluate(async()=>{
    const {IndexedReplicaStore}=await import('/app/pwa-replica.mjs'),store=new IndexedReplicaStore(),scope='isolated-cas-acceptance';
    await store.write(scope,{storageRevision:0});
    const results=await Promise.allSettled([store.write(scope,{storageRevision:1,writer:'first'},0),store.write(scope,{storageRevision:1,writer:'second'},0)]);
    if(results.filter(result=>result.status==='fulfilled').length!==1||results.find(result=>result.status==='rejected')?.reason.message!=='LOCAL_QUEUE_CHANGED')throw Error('local compare-and-swap failed');
  });
  await page.screenshot({path:resolve(output,'installed-mobile.png'),fullPage:true});
  const row=()=>page.locator(`[data-item-id="${firstItem}"]`);
  // Server directory ordering is by insertion here; select first explicitly.
  await page.evaluate(vaultId=>window.__vaultsActions.selectVault(vaultId),firstVault);
  await context.setOffline(true);
  await row().click();await page.locator('#edit-item').click();await page.locator('#item-password').fill('synthetic-offline-update');await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('pending change'));
  if(await page.locator('#close-item-detail').isVisible()) await page.locator('#close-item-detail').click(); await page.getByLabel('Toggle navigation').click();await page.locator('#lock-app').click();await page.locator('#master').waitFor({state:'visible'});
  await page.reload();await page.locator('#master').waitFor({state:'visible'});assert.equal(await page.locator('#legacy-secret-field').isVisible(),false);
  await page.locator('#master').fill('incorrect-disposable-password');await page.locator('#login').click();await page.waitForFunction(()=>document.querySelector('#login-status').textContent.includes('Unlock failed'));
  assert.equal(await page.locator('#vault').isVisible(),false);
  // A correct password must not make a corrupted local signed queue trusted.
  const scope=[...devices.keys()][0];
  const intact=await page.evaluate(async scope=>{const {IndexedReplicaStore}=await import('/app/pwa-replica.mjs');return new IndexedReplicaStore().read(scope)},scope);
  await page.evaluate(async({scope,intact})=>{
    const {IndexedReplicaStore}=await import('/app/pwa-replica.mjs'),changed=structuredClone(intact),operation=changed.queue[0].body.signedOperation;
    operation.signature='A'.repeat(86);for(const [path,history]of Object.entries(changed.records))if(path.endsWith('/operations'))for(const row of history.operations)if(row.operation.opId===operation.opId)row.operation.signature=operation.signature;
    changed.storageRevision++;await new IndexedReplicaStore().write(scope,changed,intact.storageRevision);
  },{scope,intact});
  await page.locator('#master').fill(master);await page.locator('#login').click();await page.waitForFunction(()=>document.querySelector('#login-status').textContent.includes('signatures'));
  assert.equal(await page.locator('#vault').isVisible(),false);
  await page.evaluate(async({scope,intact})=>{const {IndexedReplicaStore}=await import('/app/pwa-replica.mjs'),store=new IndexedReplicaStore(),current=await store.read(scope);intact.storageRevision=current.storageRevision+1;await store.write(scope,intact,current.storageRevision)},{scope,intact});
  await page.locator('#master').fill(master);await page.locator('#login').click();await page.locator('#vault').waitFor({state:'visible'});
  console.log('Verified offline restart, wrong-password rejection and password-only unlock.');
  await page.evaluate(vaultId=>window.__vaultsActions.selectVault(vaultId),firstVault);await row().click();
  if(await page.locator('#close-item-detail').isVisible()) await page.locator('#close-item-detail').click(); await page.locator('#new-item').click();await page.locator('#title').fill('Created offline fixture');await page.locator('#item-password').fill('synthetic-created-offline');await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('2 pending changes'));
  await page.evaluate(()=>window.__vaultsActions.openCollectionDialog());
  await page.locator('#web-collection-name').fill('Offline collection fixture');
  await page.locator(`#web-collection-vaults input[value="${firstVault}"]`).check();await page.locator(`#web-collection-vaults input[value="${secondVault}"]`).check();
  await page.locator('#web-collection-save').click();await page.locator('#web-collection-dialog').waitFor({state:'hidden'});
  const collectionId=await page.evaluate(()=>window.__vaultsSettings.settings.collections[0].id);
  await page.evaluate(id=>window.__vaultsActions.setDefaultView(`collection:${id}`),collectionId);
  await page.evaluate(id=>window.__vaultsActions.selectBrowseView({kind:'collection',id}),collectionId);
  assert.equal(await page.locator('[data-item-id]').count(),3);
  await page.evaluate(()=>window.__vaultsActions.selectBrowseView({kind:'all'}));assert.equal(await page.locator('[data-item-id]').count(),3);
  await page.evaluate(()=>window.__vaultsActions.openCreateVaultDialog());await page.locator('#web-vault-name').fill('Offline vault fixture');await page.locator('#web-create-vault-submit').click();await page.locator('#web-create-vault-dialog').waitFor({state:'hidden'});
  await page.screenshot({path:resolve(output,'offline-mobile.png'),fullPage:true});
  // Another device changes the original item and independently adds a vault.
  changeItem(firstVault,firstItem,{title:'Server fixture update',website:'https://example.invalid',favorite:false},{username:'synthetic-user',password:'synthetic-server-update',customFields:[]});
  addVault('Concurrent fixture');
  await context.setOffline(false);
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('Sync needs attention'),{timeout:20000});
  await page.evaluate(()=>window.__vaultsActions.runAction('reload'));await page.locator('#conflict-dialog').waitFor({state:'visible'});
  await page.locator('#conflict-keep').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('Up to date')&&!document.querySelector('#session-dates').textContent.includes('pending'),{timeout:20000});
  assert.equal(vaults.size,4);assert.ok([...vaults.get(firstVault).items.values()].length===2);
  const original=vaults.get(firstVault).items.get(firstItem),handle=core.open_private_vault(root,un(privateDirectory),ids(firstVault),un(vaults.get(firstVault).envelope));
  assert.equal(JSON.parse(new TextDecoder().decode(core.decrypt_private_part(handle,un(vaults.get(firstVault).catalogue),ids(firstItem),un(original.body),3))).password,'synthetic-offline-update');core.release_vault(handle);handle.free();
  assert.ok(JSON.parse(new TextDecoder().decode(core.decrypt_account_settings(root,un(settings.envelope)))).names);
  // Lost response after acceptance leaves the request queued; replay is idempotent.
  await page.evaluate(vaultId=>window.__vaultsActions.selectVault(vaultId),firstVault);await row().click();await page.locator('#edit-item').click();await page.locator('#item-password').fill('synthetic-lost-response-update');
  // Drop all responses for this request until local acknowledgement, including
  // automatic browser transport retries, then allow the exact durable replay.
  dropNextWrite=true;
  const before=receipts.size;await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('pending change'));
  await page.waitForFunction(()=>!document.querySelector('#reload').disabled);
  lostRepliesFor=null;
  await page.evaluate(()=>window.__vaultsActions.runAction('reload'));await page.waitForFunction(()=>!document.querySelector('#session-dates').textContent.includes('pending')&&document.querySelector('#session-dates').textContent.includes('Up to date'),{timeout:20000});
  assert.equal(receipts.size,before+1);
  assert.equal(JSON.parse(new TextDecoder().decode(core.decrypt_account_settings(root,un(settings.envelope)))).collections[0].name,'Offline collection fixture');
  // Lock while connected, then verify the saved collection opens automatically.
  if(await page.locator('#close-item-detail').isVisible()) await page.locator('#close-item-detail').click(); await page.getByLabel('Toggle navigation').click();await page.locator('#lock-app').click();await page.locator('#master').fill(master);await page.locator('#login').click();await page.locator('#vault').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#vault-title').textContent==='Offline collection fixture');
  assert.equal(await page.locator('#vault-title').textContent(),'Offline collection fixture');
  await page.evaluate(()=>window.__vaultsActions.openCollectionDialog());await page.locator('#web-collection-cancel').click();
  // Archive/restore and move are online and retain the source encrypted items.
  const archive=page.evaluate(id=>window.__vaultsActions.manageVault(id,'archive'),secondVault);
  await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.locator('#confirm-accept').click();await archive;
  assert.equal(vaults.get(secondVault).retired,true);assert.equal(vaults.get(secondVault).items.size,1);
  await page.evaluate(id=>window.__vaultsActions.manageVault(id,'restore'),secondVault);assert.equal(vaults.get(secondVault).retired,false);
  const move=page.evaluate(({source,target})=>window.__vaultsActions.manageVault(source,'move',target),{source:secondVault,target:firstVault});
  await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.locator('#confirm-accept').click();await move;
  assert.equal(vaults.get(secondVault).retirementChoice,'move');assert.equal(vaults.get(firstVault).items.size,3);assert.equal(vaults.get(secondVault).items.size,1);
  console.log('Verified collections, default view, recoverable archive/restore and vault move.');
  // Recover durable edits when a different device removes their source vault.
  const recoverySource=[...vaults.values()].find(row=>!row.retired&&row.vaultId!==firstVault&&row.vaultId!==secondVault).vaultId;
  await context.setOffline(true);await page.evaluate(id=>window.__vaultsActions.selectVault(id),recoverySource);
  if(await page.locator('#close-item-detail').isVisible()) await page.locator('#close-item-detail').click(); await page.locator('#new-item').click();await page.locator('#title').fill('Retired-vault recovery fixture');await page.locator('#item-password').fill('synthetic-recovery-password');await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('pending change'));
  vaults.get(recoverySource).retired=true;vaults.get(recoverySource).retirementChoice='archive';
  await context.setOffline(false);await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('Sync needs attention'));
  await page.evaluate(()=>window.__vaultsActions.runAction('reload'));await page.locator('#sync-review-dialog').waitFor({state:'visible'});
  await page.locator('#sync-review-later').click();await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('pending change'));
  await page.evaluate(()=>window.__vaultsActions.runAction('reload'));await page.locator('#sync-review-dialog').waitFor({state:'visible'});await page.locator('#sync-review-destination').selectOption(firstVault);await page.locator('#sync-review-mine').click();
  await page.waitForFunction(()=>document.querySelector('#session-dates').textContent.includes('Up to date')&&!document.querySelector('#session-dates').textContent.includes('pending'));
  assert.equal(vaults.get(firstVault).items.size,4);assert.equal(vaults.get(recoverySource).items.size,0);
  console.log('Verified retired-vault offline edit recovery and cancellation.');
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:resolve(output,'installed-desktop.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  rejectAuth=true;await page.locator('#lock-app').click();await page.locator('#master').fill(master);await page.locator('#login').click();await page.waitForFunction(()=>document.querySelector('#login-status').textContent.includes('Unlock failed'));assert.equal(await page.locator('#vault').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const ordinary=await browser.newContext({serviceWorkers:'allow'}),tab=await ordinary.newPage();await tab.goto(origin);await tab.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.active);await ordinary.setOffline(true);await assert.rejects(tab.reload());await ordinary.close();
  console.log(JSON.stringify({ok:true,enrollment:true,offlineReload:true,passwordOnlyUnlock:true,offlineWrites:true,multipleVaults:true,collections:true,defaultView:true,archiveRestoreMove:true,conflictReview:true,lostResponseReplay:true,signedHistoryAndCheckpoints:true,tamperedQueueRejected:true,concurrentStorageWrites:true,retiredVaultRecovery:true,ordinaryBrowserOnlineOnly:true,mobileAndDesktop:true}));
} catch (error) {
  const failedPage=browser?.contexts()[0]?.pages()[0];
  if(failedPage)console.error(await failedPage.evaluate(()=>({sync:document.querySelector('#session-dates')?.textContent,save:document.querySelector('#save')?.disabled,formHidden:document.querySelector('#item-form')?.hidden,invalid:[...document.querySelectorAll('#item-form :invalid')].map(input=>({id:input.id,type:input.type,validation:input.validationMessage})),login:document.querySelector('#login-status')?.textContent,notices:document.querySelector('[aria-label="Notifications"]')?.textContent})));
  throw error;
} finally { await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));core.lock();core.free(); }
