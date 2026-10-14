// Drive the real packaged desktop DOM/React handlers through its fixture-only inspector.
// No native-command mocks or direct invoke calls are used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { openDesktopFixtureInspector } from './desktop-fixture-inspector.mjs';
const profile=process.env.VAULTS_CONFIG_DIR;
assert.ok(profile&&isAbsolute(profile),'Supply the explicit absolute fictitious desktop profile.');
const device=await readFile(join(profile,'device.conf'),'utf8');
assert.ok(device.includes('server_id=14725fef-f5b4-4cb8-afe0-77aa3d80b268\n')&&device.includes('username=owner_127\n'),'Only the internal fixture profile is accepted.');
const expectedDevice=/^device_id=(.+)$/m.exec(device)?.[1];assert.ok(expectedDevice);
const origin=process.argv[2],evidencePath=process.argv[3];
const expectedTitle=process.argv[4]||'Installed Windows UI 2026-10-13',nextTitle=process.argv[5]||'Installed Linux UI 2026-10-13';
const connection=process.argv[6]||'Online';
assert.ok(['Online','Offline'].includes(connection));
const settings=process.argv[7]==='settings';
const conflictTest=process.argv[7]==='conflict';
const settingsReview=process.argv[7]==='settings-server';
const queueCreate=process.argv[7]==='queue-create';
const onlineConsecutive=process.argv[7]==='online-consecutive';
const onlineCreate=process.argv[7]==='online-create'||onlineConsecutive;
const queueReplay=process.argv[7]==='queue-replay';
const unlockHold=process.argv[7]==='unlock-hold';
const onlineExisting=process.argv[7]==='online-repeat-existing';
const onlineVerify=process.argv[7]==='online-verify-lock';
const acknowledgementError=process.argv[7]==='acknowledgement-error';
const offlineVerify=process.argv[7]==='offline-ack-read';
const restoreTitle=process.env.VAULTS_FIXTURE_RESTORE_TITLE||null;
assert.ok(!restoreTitle||onlineExisting&&restoreTitle.startsWith('Linux packaged online '));
assert.ok(!offlineVerify||connection==='Offline'&&expectedTitle.startsWith('Linux packaged online '));
const typedRoundtrip=process.argv[7]==='typed-roundtrip';
const typedCreate=process.argv[7]==='typed-create',typedCreatedRead=process.argv[7]==='typed-created-read';
const lostResponseWrite=process.argv[7]==='lost-response-write',lostResponseReplay=process.argv[7]==='lost-response-replay';
const settingsAuth=process.argv[7]==='settings-authorization';const settingsAuthWork=process.env.VAULTS_FIXTURE_SETTINGS_AUTH_WORK;assert.ok(!settingsAuth||settingsAuthWork&&isAbsolute(settingsAuthWork)&&connection==='Online');
let lostResponse=null;
if(lostResponseWrite||lostResponseReplay){const path=process.env.VAULTS_FIXTURE_GUI_LOSS;assert.ok(path&&isAbsolute(path));lostResponse=JSON.parse(await readFile(path,'utf8'));assert.equal(lostResponse.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(lostResponse.writerDevice,expectedDevice);assert.equal(lostResponse.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.equal(lostResponse.itemId,'09313354-3b85-4d56-97b1-2f1cb16ba0a7');assert.equal(connection,'Online');assert.ok(lostResponse.lostReplyTitle.startsWith('Packaged CLI cross-OS '));}
let createdTypes=null;
if(typedCreate||typedCreatedRead){
 const path=process.env.VAULTS_FIXTURE_CREATED_TYPES;assert.ok(path&&isAbsolute(path));createdTypes=JSON.parse(await readFile(path,'utf8'));assert.equal(createdTypes.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(createdTypes.writerDevice,expectedDevice);assert.equal(createdTypes.vaultId,'66031b92-58ad-4114-b967-dcbf0541be24');assert.ok(createdTypes.title.startsWith('Linux packaged typed '));assert.equal(connection,'Online');assert.deepEqual(createdTypes.items.map(row=>row.type),['login','password','bank','card','wifi','router','ssh']);assert.ok(createdTypes.items.every(row=>row.title===createdTypes.title+' '+row.type&&row.password===(row.type==='card'?'':'fictitious-gui-typed-password')));
}
const lifecycleArchive=process.argv[7]==='lifecycle-archive',lifecycleRestore=process.argv[7]==='lifecycle-restore';
const nonoverlapEdit=process.argv[7]==='nonoverlap-edit',nonoverlapRead=['nonoverlap-read','checkpoint-read'].includes(process.argv[7]);
const multiMode=['multi-compare','multi-server','multi-local','multi-field-first'].includes(process.argv[7])?process.argv[7]:null;
let multi=null;
if(multiMode){
 const path=process.env.VAULTS_FIXTURE_MULTI_EVIDENCE;assert.ok(path&&isAbsolute(path));multi=JSON.parse(await readFile(path,'utf8'));assert.equal(multi.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(multi.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.equal(multi.writerDevice,expectedDevice);assert.equal(connection,'Online');assert.equal(multi.multiItems.length,2);
 if(multi.multiVault){assert.equal(multi['multi-multi-vault-initPassed'],true);assert.deepEqual(multi.multiItems.map(row=>row.vaultId),['ba855503-c52c-435c-8c0f-d46b6254ae51','66031b92-58ad-4114-b967-dcbf0541be24']);assert.equal(multi.multiItems[0].itemId,'09313354-3b85-4d56-97b1-2f1cb16ba0a7');assert.equal(multi.multiItems[1].itemId,multi.multiCreatedItemId);assert.match(multi.multiCreatedItemId,/^[a-f0-9-]{36}$/);}else assert.deepEqual(new Set(multi.multiItems.map(row=>row.itemId)),new Set(['09313354-3b85-4d56-97b1-2f1cb16ba0a7','ff01aefe-6754-4253-8f4c-0af9b03cd9f9']));assert.ok(multi.multiItems.every(row=>row.localTitle.startsWith('Multi-conflict local ')&&row.serverTitle.startsWith('Multi-conflict server ')));
}
let nonoverlap=null;
if(nonoverlapEdit||nonoverlapRead){
 const path=process.env.VAULTS_FIXTURE_NONOVERLAP_EVIDENCE;assert.ok(path&&isAbsolute(path));nonoverlap=JSON.parse(await readFile(path,'utf8'));assert.equal(nonoverlap.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(nonoverlap.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.equal(nonoverlap.writerDevice,expectedDevice);assert.equal(nonoverlap.itemId,'09313354-3b85-4d56-97b1-2f1cb16ba0a7');assert.equal(connection,nonoverlapEdit?'Offline':'Online');assert.ok(expectedTitle.startsWith('Packaged CLI cross-OS '));
}
let lifecycle=null;
if(lifecycleArchive||lifecycleRestore){
 const path=process.env.VAULTS_FIXTURE_LIFECYCLE_EVIDENCE;assert.ok(path&&isAbsolute(path));
 lifecycle=JSON.parse(await readFile(path,'utf8'));assert.equal(lifecycle.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(lifecycle.vaultId,'ba855503-c52c-435c-8c0f-d46b6254ae51');assert.equal(lifecycle.writerDevice,expectedDevice);assert.ok(lifecycle.vaultName.startsWith('Fixture Work '));assert.equal(connection,'Online');
 const settings=JSON.parse(await readFile(join(profile,'vault-settings.json'),'utf8'));assert.equal(settings.pending,null,'Never discard a local settings draft');
 lifecycle.code='V-'+createHash('sha256').update(lifecycle.vaultId).digest('hex').slice(0,10).toUpperCase();
}
let typedItems=null;
if(typedRoundtrip){
 const path=process.env.VAULTS_FIXTURE_TYPES_EVIDENCE;assert.ok(path&&isAbsolute(path));
 const typed=JSON.parse(await readFile(path,'utf8'));assert.equal(typed.fixtureServer,'14725fef-f5b4-4cb8-afe0-77aa3d80b268');assert.equal(typed.vaultId,'66031b92-58ad-4114-b967-dcbf0541be24');assert.equal(typed.items.length,7);
 assert.deepEqual(new Set(typed.items.map(row=>row.type)),new Set(['login','password','bank','card','wifi','router','ssh']));assert.ok(typed.items.every(row=>row.title.startsWith('Packaged CLI cross-OS ')));
 typedItems=typed.items;
}
const queueVault=process.env.VAULTS_FIXTURE_QUEUE_VAULT||null;
assert.ok(!queueVault||/^[a-f0-9-]{36}$/.test(queueVault),'Supply a canonical fixture vault ID');
assert.ok(!queueCreate||connection==='Offline','Queue creation requires an offline fixture.');
assert.ok(!onlineCreate||connection==='Online','Online creation requires a connected fixture.');
assert.ok(!(onlineExisting||onlineVerify)||connection==='Online','Online edit/restart verification requires a connected fixture.');
assert.ok(!typedRoundtrip||connection==='Online');
assert.ok(!onlineExisting||expectedTitle.startsWith('Linux packaged online '),'Only the retained synthetic GUI item is accepted.');
assert.ok(!acknowledgementError||connection==='Online'&&expectedTitle.startsWith('Linux packaged online '));
assert.ok(!queueReplay||connection==='Online','Queue replay requires a connected fixture.');
assert.ok(!settings||connection==='Online','Vault creation requires online fixture acceptance.');
const fixtureVault='Fixture Work '+Date.now(),fixtureCollection='Fixture collection '+Date.now();
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||!evidencePath)throw Error('Supply loopback inspector origin and external evidence path.');
const {evaluate,close}=await openDesktopFixtureInspector(origin);
try{
 let initialText='';for(let attempt=0;attempt<80;attempt++){initialText=await evaluate('document.body.innerText');if(initialText.includes('Unlock 127Vaults'))break;await new Promise(resolve=>setTimeout(resolve,250));}
 assert.match(initialText,/Unlock 127Vaults/);
 await evaluate(`globalThis.__fixtureUI={done:false};(async()=>{
 const checks=[],saveTrace=[];let stage='unlock';
 const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out at '+stage);};
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
 const set=(label,value)=>{const input=document.querySelector('input[aria-label="'+label+'"]');if(!input)throw Error('Missing fixture input '+label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
 try{
  set('Username','owner_127');
  if(!document.querySelector('input[aria-label="Account secret"]')){const enter=button('Enter account secret');if(!enter)throw Error('Missing explicit account-secret control');enter.click();await wait(()=>document.querySelector('input[aria-label="Account secret"]'));}
  set('Account secret','07'.repeat(32));set('Master password','fictitious password 127vaults');
  await new Promise(resolve=>setTimeout(resolve,50));button('Unlock encrypted replica').click();
  await wait(()=>document.body.innerText.includes('All items'));
  button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Profile').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes(${JSON.stringify(expectedDevice)}));const profileLines=document.querySelector('#desktop-settings-panel').innerText.split(String.fromCharCode(10)).map(line=>line.trim()).filter(Boolean);const connectionLabel=profileLines.indexOf('Connection');if(connectionLabel<0||profileLines[connectionLabel+1]!==${JSON.stringify(connection)})throw Error('Fixture connection is not '+${JSON.stringify(connection)});document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));checks.push('real GUI '+${JSON.stringify(connection)}+' unlock');checks.push('GUI device identity matches the explicit fixture profile');
  if(${JSON.stringify(settingsAuth)}){
   stage='settings authorization arm';globalThis.__fixtureUI={done:false,waitingForArm:true};await wait(()=>globalThis.__fixtureArmReady===true);button('Sync now').click();stage='settings authorization status';await wait(()=>document.querySelector('footer')?.innerText.includes('Sync failed'));button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Profile').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes('no longer authorizes'));const lines=document.querySelector('#desktop-settings-panel').innerText.split(String.fromCharCode(10)).map(line=>line.trim()).filter(Boolean);if(lines[lines.indexOf('Connection')+1]!=='Offline')throw Error('Denied GUI session still claims online');document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('actual GUI mid-session settings refusal reports offline reason and sync failure; lock clears decrypted session');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(lostResponseWrite||lostResponseReplay)}){
   const fixture=${JSON.stringify(lostResponse)};
   if(${JSON.stringify(lostResponseWrite)}){
    stage='GUI accepted reply loss';const summary=[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===fixture.ackBaseline.title);if(!summary)throw Error('Controlled lost-response item unavailable');summary.closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===fixture.ackBaseline.title&&button('Edit')&&!button('Edit').disabled);button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,fixture.lostReplyTitle);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')?.disabled&&/1 changes? waiting to sync/.test(document.body.innerText));checks.push('actual GUI accepted-reply loss preserves one durable pending save');window.confirm=message=>/discard.*unsaved/i.test(message);
   }else{
    stage='GUI receipt replay';button('Sync now').click();await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));if(document.querySelector('[aria-labelledby="conflict-title"]'))throw Error('Accepted receipt replay created a conflict');await wait(()=>[...document.querySelectorAll('button strong')].some(node=>node.textContent.trim()===fixture.newerPeerTitle));[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===fixture.newerPeerTitle).closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===fixture.newerPeerTitle&&button('Edit')&&!button('Edit').disabled);const text=document.querySelector('main').innerText;if(!text.includes('newer-peer-fixture')||text.includes('fictitious-lifecycle-password'))throw Error('GUI receipt replay lost newer peer fields or exposed secret');checks.push('actual GUI process restart/replay retires accepted request and preserves newer peer title/username with password masked');
   }
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('GUI lock clears decrypted lost-response editor/session');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(typedCreate||typedCreatedRead)}){
   const fixture=${JSON.stringify(createdTypes)};
   const setInput=async(node,value)=>{if(!node)throw Error('Missing typed creation field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));};
   const named=name=>[...document.querySelectorAll('main label')].find(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()===name)?.querySelector('input');
   for(const row of fixture.items){
    if(${JSON.stringify(typedCreate)}){
     stage='GUI typed create '+row.type;button('New item').click();await wait(()=>document.querySelector('input[data-editor-title]'));const picker=document.querySelector('main details');picker.querySelector('summary').click();[...picker.querySelectorAll('button')].find(node=>node.querySelector('strong')?.textContent.trim()===row.label).click();await wait(()=>picker.querySelector('summary')?.textContent.includes(row.label));
     await setInput(document.querySelector('input[data-editor-title]'),row.title);if(row.website)await setInput(named('Website'),row.website);if(row.username)await setInput(named('Username'),row.username);if(row.password)await setInput(named('Password'),row.password);for(const field of row.fields)await setInput(named(field.label),field.value);
     const destination=[...document.querySelectorAll('main label')].find(node=>node.textContent.includes('Destination vault'))?.querySelector('select');if(!destination)throw Error('Typed fixture must explicitly select its destination');destination.value=fixture.vaultId;destination.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===row.title);
    }else{
     stage='GUI typed peer read '+row.type;await wait(()=>[...document.querySelectorAll('button strong')].some(node=>node.textContent.trim()===row.expectedTitle));[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===row.expectedTitle).closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===row.expectedTitle&&button('Edit')&&!button('Edit').disabled);
    }
    const text=document.querySelector('main').innerText;if(!text.toLowerCase().includes(row.label.toLowerCase()))throw Error('Wrong typed presentation');for(const field of row.fields){if(field.type==='password'){if(text.includes(field.value))throw Error('Typed custom secret exposed before reveal');}else if(!text.includes(field.value))throw Error('Typed ordinary field missing');}if(row.password&&text.includes(row.password))throw Error('Typed password exposed before reveal');if(row.username&&!text.includes(row.username))throw Error('Typed username omitted');if(row.website&&!text.includes(row.website))throw Error('Typed website omitted');checks.push('actual GUI '+row.type+' '+${JSON.stringify(typedCreate?'creation':'peer edit read')}+' preserves expected fields and masks secrets');
   }
   await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(!!multiMode)}){
   const fixture=${JSON.stringify(multi)},mode=${JSON.stringify(multiMode)};
   const closeConflict=async()=>{if(document.querySelector('[aria-labelledby="conflict-title"]')){button('Cancel and keep editing').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]'));}};
   const review=async row=>{if(fixture.multiNavigate){const other=fixture.multiItems.find(candidate=>candidate.vaultId!==row.vaultId);if(!other||!button(other.vaultName))throw Error('Controlled opposite vault navigation unavailable');button(other.vaultName).click();await wait(()=>[...document.querySelectorAll('button strong')].some(node=>[other.localTitle,other.serverTitle].includes(node.textContent.trim())));}button('Review sync').click();await wait(()=>document.querySelector('[aria-labelledby="sync-review-title"]'));const article=[...document.querySelectorAll('[aria-labelledby="sync-review-title"] article')].find(node=>node.querySelector('h3')?.textContent.trim()===row.localTitle);if(!article||!article.innerText.includes(row.vaultName??fixture.vaultName))throw Error('Wrong pending item/vault in multi-review');[...article.querySelectorAll('button')].find(node=>node.textContent.trim()==='Review item and choose version').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]')?.innerText.includes(row.localTitle));};
   const compare=async row=>{button('Compare and select fields…').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"] [role="radio"]'));const text=document.querySelector('[aria-labelledby="conflict-title"]').innerText;if(!text.includes(row.localTitle)||!text.includes(row.serverTitle)||text.includes('fictitious-lifecycle-password'))throw Error('Multi-review omitted a version or revealed password');};
   if(mode==='multi-compare'){
    stage='two-conflict GUI sync';button('Sync now').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]'));await closeConflict();
    for(const row of fixture.multiItems){stage='multi GUI compare '+row.itemId;await review(row);await compare(row);await closeConflict();}
    await wait(()=>/2 changes? waiting to sync/.test(document.body.innerText));checks.push('actual GUI reviews both correct item/vault drafts and server versions with password masked; both stay queued');
   }else{
    const row=fixture.multiItems[mode==='multi-local'?1:0];stage='multi GUI selected decision';await review(row);
    if(mode==='multi-server'){button('Use server version').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&/1 changes? waiting to sync/.test(document.body.innerText)&&document.querySelector('main h2')?.textContent.trim()===row.serverTitle);checks.push('actual GUI accepts selected verified server version while other conflict stays queued');}
    else if(mode==='multi-field-first'){
     if(!fixture.multiFieldMerge||!row.localUsername?.startsWith('field-local-')||!row.serverUsername?.startsWith('field-server-'))throw Error('Only controlled field-merge fixture accepted');await compare(row);
     const field=name=>[...document.querySelectorAll('[aria-labelledby="conflict-title"] .desktop-conflict-row')].find(node=>node.querySelector('b')?.textContent.trim()===name);
     const serverTitle=field('title')?.querySelectorAll('[role="radio"]')[1];if(serverTitle?.textContent.trim()!==row.serverTitle)throw Error('Wrong server title option');serverTitle.click();await wait(()=>field('title')?.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')==='true');
     const localUsername=field('username')?.querySelectorAll('[role="radio"]')[0];if(localUsername?.textContent.trim()!==row.localUsername)throw Error('Wrong local username option');localUsername.click();await wait(()=>field('username')?.querySelectorAll('[role="radio"]')[0]?.getAttribute('aria-checked')==='true');button('Save selected fields').click();
     await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&/1 changes? waiting to sync/.test(document.body.innerText)&&document.querySelector('main h2')?.textContent.trim()===row.serverTitle&&document.querySelector('main')?.innerText.includes(row.localUsername));checks.push('actual GUI saves explicitly selected server title and local username while other conflict stays queued');
    }else{await compare(row);button('Use mine').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&document.body.innerText.includes('0 changes waiting to sync')&&document.querySelector('main h2')?.textContent.trim()===row.localTitle);checks.push('actual GUI selects remaining local version after verified comparison and empties item queue');}
   }
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('multi-conflict GUI lock clears decrypted view');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(nonoverlapEdit||nonoverlapRead)}){
   stage='nonoverlap reconnect sync';if(${JSON.stringify(nonoverlapRead)}){button('Sync now').click();await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));}
   stage='nonoverlap selected fixture';await wait(()=>[...document.querySelectorAll('button strong')].some(node=>node.textContent.trim()===${JSON.stringify(expectedTitle)}));const summary=[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===${JSON.stringify(expectedTitle)});summary.closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===${JSON.stringify(expectedTitle)}&&button('Edit')&&!button('Edit').disabled);
   if(${JSON.stringify(nonoverlapEdit)}){
    button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,${JSON.stringify(nextTitle)});title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();stage='nonoverlap durable queue';await wait(()=>!button('Save')&&document.querySelector('main h2')?.textContent.trim()===${JSON.stringify(nextTitle)}&&/1 changes? waiting to sync/.test(document.body.innerText));checks.push('actual GUI queues offline title-only edit and preserves it at lock');
   }else{
    await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));if(document.querySelector('[aria-labelledby="conflict-title"]'))throw Error('Nonoverlap unexpectedly requires conflict review');const expectedUsername=${JSON.stringify(process.env.VAULTS_FIXTURE_EXPECTED_USERNAME||null)};if(!expectedUsername||!document.querySelector('main')?.innerText.includes(expectedUsername))throw Error('Nonoverlap read omitted expected username');if(document.querySelector('main')?.innerText.includes('fictitious-lifecycle-password'))throw Error('Nonoverlap exposed masked secret');checks.push('actual GUI reconnect reads expected title and username with zero queued edits and no conflict; secret stays masked');
   }
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(lifecycleArchive||lifecycleRestore)}){
   const fixture=${JSON.stringify(lifecycle)};
   if(button('Review vault settings conflict')){
    stage='lifecycle settings review';button('Review vault settings conflict').click();await wait(()=>document.querySelector('[aria-labelledby="settings-review-title"] pre'));
    const versions=[...document.querySelectorAll('[aria-labelledby="settings-review-title"] pre')].map(node=>JSON.parse(node.innerText));if(versions.length!==2||versions[1].names[fixture.vaultId]!==fixture.vaultName)throw Error('Unexpected server fixture settings');button('Keep server').click();await wait(()=>!document.querySelector('[aria-labelledby="settings-review-title"]'));checks.push('reviewed current server settings with no local draft');
   }
   stage='lifecycle vault settings';button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Vaults').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes(fixture.code));
   const row=[...document.querySelectorAll('#desktop-settings-panel span')].find(node=>node.textContent.trim()===fixture.code)?.parentElement;if(!row||!row.innerText.includes(fixture.vaultName))throw Error('Controlled lifecycle vault row unavailable');
   if(${JSON.stringify(lifecycleArchive)}){
    stage='lifecycle archive';const remove=[...row.querySelectorAll('button')].find(node=>node.textContent.trim()==='Remove…');if(!remove||remove.disabled)throw Error('Controlled vault removal unavailable');remove.click();await wait(()=>document.querySelector('[aria-labelledby="removal-dialog-title"]'));
    const dialog=document.querySelector('[aria-labelledby="removal-dialog-title"]');if(dialog.querySelector('h2')?.textContent.trim()!=='Remove '+fixture.vaultName)throw Error('Wrong vault removal dialog');dialog.querySelectorAll('input[name="removal-choice"]')[0].click();await wait(()=>button('Archive vault'));button('Archive vault').click();await wait(()=>!document.querySelector('[aria-labelledby="removal-dialog-title"]')&&document.body.innerText.includes('Vault archived'));
    button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Vaults').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes('Archived vaults'));
    const archived=[...document.querySelectorAll('#desktop-settings-panel span')].find(node=>node.textContent.trim()===fixture.code)?.parentElement;if(!archived?.querySelector('button')||archived.querySelector('button').textContent.trim()!=='Restore')throw Error('Archived vault missing recoverable restore action');checks.push('actual GUI archives controlled vault and exposes recoverable restore action');
   }else{
    stage='lifecycle restore';const restore=[...row.querySelectorAll('button')].find(node=>node.textContent.trim()==='Restore');if(!restore||restore.disabled)throw Error('Controlled archived vault restore unavailable');restore.click();await wait(()=>document.body.innerText.includes('Archived vault restored'));document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));
    const summary=[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===fixture.ackBaseline.title);if(!summary)throw Error('Restored item missing');summary.closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===fixture.ackBaseline.title&&button('Edit')&&!button('Edit').disabled);if(document.querySelector('main')?.innerText.includes('fictitious-lifecycle-password'))throw Error('Restored GUI leaked secret');checks.push('actual GUI restores archived vault and reads original item with secret masked');
   }
   document.querySelector('button[aria-label="Close settings"]')?.click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('lifecycle GUI lock clears decrypted view');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(onlineExisting||onlineVerify||offlineVerify)}){
   const native=window.__TAURI_INTERNALS__,originalInvoke=native?.invoke;
   if(originalInvoke)native.invoke=function(command,args,...rest){if(command==='item_save')saveTrace.push({title:args?.title});return originalInvoke.call(native,command,args,...rest);};
   stage='retained GUI item';await wait(()=>[...document.querySelectorAll('button strong')].some(label=>label.textContent.trim()===${JSON.stringify(expectedTitle)}));
   [...document.querySelectorAll('button strong')].find(label=>label.textContent.trim()===${JSON.stringify(expectedTitle)}).closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===${JSON.stringify(expectedTitle)}&&button('Edit')&&!button('Edit').disabled);
   if(${JSON.stringify(onlineExisting)})for(const suffix of [' repeat one',' repeat two','']){
    stage='existing GUI repeated edit '+suffix;button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));
    const title=document.querySelector('input[data-editor-title]'),expected=suffix===''&&${JSON.stringify(restoreTitle)}?${JSON.stringify(restoreTitle)}:${JSON.stringify(expectedTitle)}+suffix;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,expected);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
    await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(expected));
   }
   await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));checks.push(${JSON.stringify(onlineExisting?'actual GUI repeats existing-item edits and restores title without adding fixtures':offlineVerify?'actual GUI offline restart retains the acknowledged item after server verification refusal':'actual GUI restarts online and reads the retained acknowledged item')});
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(typedRoundtrip)}){
   const rows=${JSON.stringify(typedItems)},labels={login:'Login',password:'Password only',bank:'Bank account',card:'Payment card',wifi:'Wi-Fi network',router:'Router',ssh:'SSH / device'};
   for(const row of rows){
    stage='typed GUI open '+row.type;const summary=[...document.querySelectorAll('button strong')].find(label=>label.textContent.trim()===row.title);if(!summary)throw Error('Missing typed fixture '+row.type);summary.closest('button').click();
    await wait(()=>document.querySelector('main h2')?.textContent.trim()===row.title&&button('Edit')&&!button('Edit').disabled);
    if(!document.querySelector('main').innerText.toLowerCase().includes(labels[row.type].toLowerCase()))throw Error('Missing type presentation '+row.type);
    for(const secret of ['fictitious-typed-password','fictitious-typed-secret','fictitious-related-secret'])if(document.querySelector('main').innerText.includes(secret))throw Error('Typed detail revealed a secret before explicit action');
    for(const expected of [row.title+' desktop reviewed',row.title]){
     stage='typed GUI save '+row.type;button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,expected);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
     await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===expected);
    }
    checks.push('actual GUI '+row.type+' detail/edit/save/restore with default secret masking');
   }
   await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(acknowledgementError)}){
   stage='acknowledgement GUI item';const summary=[...document.querySelectorAll('button strong')].find(label=>label.textContent.trim()===${JSON.stringify(expectedTitle)});if(!summary)throw Error('Missing retained acknowledgement GUI item');summary.closest('button').click();
   await wait(()=>document.querySelector('main h2')?.textContent.trim()===${JSON.stringify(expectedTitle)}&&button('Edit')&&!button('Edit').disabled);
   button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,${JSON.stringify(nextTitle)});title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
   stage='acknowledgement GUI verification failure';await wait(()=>document.body.innerText.includes('Server verification failed')&&document.querySelector('footer')?.innerText.includes('Sync failed'));
   button('Review sync').click();await wait(()=>document.querySelector('[aria-labelledby="sync-review-title"]')?.innerText.includes('server acknowledged 1 operation'));
   const review=document.querySelector('[aria-labelledby="sync-review-title"]');if(!review.innerText.includes('encrypted copy is retained')||review.innerText.includes('Review item and choose version'))throw Error('Unverified acknowledgement review is misleading or discardable');
   [...review.querySelectorAll('button')].find(button=>button.textContent.trim()==='Close').click();await wait(()=>!document.querySelector('[aria-labelledby="sync-review-title"]'));
   checks.push('actual GUI keeps verification failure visible with retained acknowledged copy and no draft-discard action');
   // This fixture's new title is already retained in the encrypted acknowledged
   // replica. Confirm closing only its redundant unsaved editor state at lock.
   window.confirm=message=>/discard.*unsaved/i.test(message);button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));
   checks.push('fixture lock clears decrypted GUI while durable acknowledgement remains');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(unlockHold)}){checks.push('actual GUI remains unlocked for the live connector handoff test');globalThis.__fixtureUI={done:true,ok:true,checks};return;}
  if(${JSON.stringify(queueCreate||onlineCreate)}) {
   const input=(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
   const create=async title=>{button('New item').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),title);await new Promise(resolve=>setTimeout(resolve,50));const password=document.querySelector('main input[type="password"]');if(password)input(password,'synthetic-ui-queue-password');const destination=[...document.querySelectorAll('main label')].find(label=>label.textContent.includes('Destination vault'))?.querySelector('select');if(destination){const value=${JSON.stringify(queueVault)}||[...destination.options].find(option=>option.value)?.value;if(!value||![...destination.options].some(option=>option.value===value))throw Error('Fixture destination vault missing');destination.value=value;destination.dispatchEvent(new Event('change',{bubbles:true}));}await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(title));};
   stage='offline GUI create';await create(${JSON.stringify(expectedTitle)});
   stage='offline GUI edit';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),${JSON.stringify(nextTitle)});await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(${JSON.stringify(nextTitle)}));
   stage='second offline GUI create';await create(${JSON.stringify(expectedTitle+' second')});
   if(${JSON.stringify(onlineConsecutive)}){
    for(const suffix of [' edited once',' edited twice']){
     stage='consecutive online GUI edit';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));
     const expected=${JSON.stringify(expectedTitle+' second')}+suffix;input(document.querySelector('input[data-editor-title]'),expected);await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
     await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(expected));
     if(document.querySelector('[aria-labelledby="conflict-title"]'))throw Error('Consecutive edit stranded in conflict review');
    }
    checks.push('actual GUI saves two consecutive existing-item edits without intermediate sync');
   }
   if(${JSON.stringify(onlineCreate)}){await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));checks.push('actual GUI saves two consecutive online creations and an edit without intermediate sync');}
   else{await wait(()=>document.body.innerText.includes('3 changes waiting to sync'));checks.push('actual GUI queues two offline creations and a chained edit');}
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(queueReplay)}) {
   stage='GUI queue replay';button('Sync now').click();await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));
   if(button('All items'))button('All items').click();
   await wait(()=>[${JSON.stringify(nextTitle)},${JSON.stringify(expectedTitle+' second')}].every(title=>[...document.querySelectorAll('button strong')].some(label=>label.textContent.trim()===title)));
   if(document.querySelector('[aria-labelledby="conflict-title"]'))throw Error('Chained creations stranded in GUI conflict review');
   checks.push('GUI restart/reconnect replays chained creations and edit with zero pending changes');button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(settingsReview)}){
   stage='settings comparison';await wait(()=>button('Review vault settings conflict'));button('Review vault settings conflict').click();await wait(()=>document.querySelector('[aria-labelledby="settings-review-title"]'));
   const versions=[...document.querySelectorAll('[aria-labelledby="settings-review-title"] pre')];if(versions.length!==2||!versions[1].innerText.includes(${JSON.stringify(expectedTitle)})||!versions[1].innerText.includes(${JSON.stringify(nextTitle)}))throw Error('Server settings comparison omitted the peer-created names');checks.push('GUI explicitly compares peer-created encrypted settings');
   stage='settings view refresh';button('Keep server').click();await wait(()=>!document.querySelector('[aria-labelledby="settings-review-title"]')&&button(${JSON.stringify(expectedTitle)})&&button(${JSON.stringify(nextTitle)}));checks.push('accepted server settings refresh vault and collection names immediately');
   button(${JSON.stringify(expectedTitle)}).click();await wait(()=>document.querySelector('.desktop-empty-state')?.innerText.includes('Add your first item'));button(${JSON.stringify(nextTitle)}).click();await wait(()=>document.querySelectorAll('[data-desktop-item]').length>0);checks.push('accepted vault and collection navigation works');
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('lock clears decrypted UI');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  if(${JSON.stringify(conflictTest)}){
   stage='conflict review';button('Sync now').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]'));
   checks.push('durable second-device queued conflict requires explicit GUI review');
   stage='conflict comparison';
   button('Compare and select fields…').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"] [role="radio"]'));
   const dialog=document.querySelector('[aria-labelledby="conflict-title"]');if(!dialog.innerText.includes(${JSON.stringify(expectedTitle)})||!dialog.innerText.includes(${JSON.stringify(nextTitle)}))throw Error('Conflict comparison omitted one fictitious title');
   if(dialog.innerText.includes('api010-fiction-secret'))throw Error('Conflict comparison exposed a password');
   checks.push('GUI compares local and server titles while masking password');
   stage='conflict resolution';const local=[...dialog.querySelectorAll('[role="radio"]')].find(el=>el.textContent.includes(${JSON.stringify(expectedTitle)}));if(!local)throw Error('Missing local title choice');local.click();await wait(()=>local.getAttribute('aria-checked')==='true');button('Save selected fields').click();
   await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&document.body.innerText.match(/0 pending|0 changes waiting to sync/)&&document.querySelector('main')?.innerText.includes(${JSON.stringify(expectedTitle)}));checks.push('explicit selected-fields resolution saves local title and clears queue');
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));if(document.querySelector('input[aria-label="Master password"]')?.value)throw Error('Lock retained master password');checks.push('lock clears decrypted UI');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  stage='cross-client item';await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes(${JSON.stringify(expectedTitle)})));const item=[...document.querySelectorAll('button')].find(el=>el.textContent.includes(${JSON.stringify(expectedTitle)}));item.click();
  await wait(()=>document.querySelector('main')?.innerText.includes('base-user'));checks.push('previous GUI edit read by installed desktop');
  stage='reveal';document.querySelector('button[aria-label="Reveal Password"]').click();
  await wait(()=>document.querySelector('main')?.innerText.includes('api010-fiction-secret'));checks.push('explicit fixture password reveal');
  document.querySelector('button[aria-label="Hide Password"]').click();await wait(()=>!document.querySelector('main')?.innerText.includes('api010-fiction-secret'));checks.push('password hidden');
  stage='edit';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));
  const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,${JSON.stringify(nextTitle)});title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
  await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(${JSON.stringify(nextTitle)}));checks.push('GUI title edit and save');
  if(${JSON.stringify(connection)}==='Online'){await wait(()=>document.body.innerText.match(/0 pending|0 changes waiting to sync/));checks.push('online save has no pending operations');}
  else {await wait(()=>/[1-9][0-9]* (?:pending|changes? waiting to sync)/.test(document.body.innerText));checks.push('offline save reports durable pending operations');}
  if(${JSON.stringify(settings)}){
   stage='vault creation';document.querySelector('button[aria-label="Add vault"]').click();await wait(()=>document.querySelector('[aria-labelledby="vault-dialog-title"] input'));
   const name=document.querySelector('[aria-labelledby="vault-dialog-title"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,${JSON.stringify(fixtureVault)});name.dispatchEvent(new Event('input',{bubbles:true}));name.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Create vault').click();
   await wait(()=>!document.querySelector('[aria-labelledby="vault-dialog-title"]')&&button(${JSON.stringify(fixtureVault)}));checks.push('GUI creates named second private vault');
   button(${JSON.stringify(fixtureVault)}).click();await wait(()=>document.querySelector('.desktop-empty-state')?.innerText.includes('Add your first item'));checks.push('new private vault has separate empty item view');
   stage='collection';button('Add collection').click();await wait(()=>document.querySelector('[aria-labelledby="collection-dialog-title"] input'));
   const collection=document.querySelector('[aria-labelledby="collection-dialog-title"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(collection,${JSON.stringify(fixtureCollection)});collection.dispatchEvent(new Event('input',{bubbles:true}));collection.dispatchEvent(new Event('change',{bubbles:true}));
   document.querySelectorAll('[aria-labelledby="collection-dialog-title"] input[type="checkbox"]').forEach(el=>el.click());await new Promise(resolve=>setTimeout(resolve,50));button('Save collection').click();
   await wait(()=>!document.querySelector('[aria-labelledby="collection-dialog-title"]')&&button(${JSON.stringify(fixtureCollection)}));button(${JSON.stringify(fixtureCollection)}).click();await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes(${JSON.stringify(nextTitle)})));checks.push('GUI collection includes selected vaults and restores combined item view');
   await wait(()=>document.body.innerText.match(/0 pending|0 changes waiting to sync/));
  }
  stage='lock';button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));
  if(document.body.innerText.includes(${JSON.stringify(nextTitle)})||document.querySelector('input[aria-label="Master password"]')?.value)throw Error('Lock retained decrypted UI state');
  checks.push('lock clears decrypted UI and password input');globalThis.__fixtureUI={done:true,ok:true,checks};
 }catch(error){globalThis.__fixtureUI={done:true,ok:false,stage,error:String(error),saveTrace,controls:{saveDisabled:button('Save')?.disabled,editDisabled:button('Edit')?.disabled,editorTitle:document.querySelector('input[data-editor-title]')?.value,detail:document.querySelector('main')?.innerText.replaceAll('api010-fiction-secret','[fixture password omitted]').slice(-3000)},diagnostic:document.body.innerText.replaceAll('api010-fiction-secret','[fixture password omitted]').slice(0,8000)};}
})();undefined`);
 let result,armed=false;for(let i=0;i<(typedRoundtrip||typedCreate||typedCreatedRead?400:160);i++){result=await evaluate('globalThis.__fixtureUI');if(settingsAuth&&result.waitingForArm&&!armed){await writeFile(join(settingsAuthWork,'arm.json'),JSON.stringify({fixtureServer:'14725fef-f5b4-4cb8-afe0-77aa3d80b268',deny:true,status:403})+'\n');armed=true;await evaluate('globalThis.__fixtureArmReady=true');}if(result.done)break;await new Promise(resolve=>setTimeout(resolve,250));}
 if(result?.ok!==true)await writeFile(evidencePath+'.failure-'+Date.now()+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 assert.equal(result?.ok,true,result?.error||'Desktop GUI fixture timed out');
 await writeFile(evidencePath,JSON.stringify({date:new Date().toISOString(),status:'passed',platform:process.platform,scope:'Real packaged desktop UI; DOM events and React handlers with actual native backend; fictitious data',checks:result.checks,...(settings?{fixtureVault,fixtureCollection}:{}),limitations:['Physical keyboard/screen-reader and OS-lock matrix remain separate.']},null,2)+'\n',{flag:'wx'});
 console.log(process.platform+' installed GUI passed: '+result.checks.join('; '));
}finally{await close();}
