// Drive the real packaged desktop DOM/React handlers through its fixture-only inspector.
// No native-command mocks or direct invoke calls are used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
const onlineCreate=process.argv[7]==='online-create';
const queueReplay=process.argv[7]==='queue-replay';
const unlockHold=process.argv[7]==='unlock-hold';
const queueVault=process.env.VAULTS_FIXTURE_QUEUE_VAULT||null;
assert.ok(!queueVault||/^[a-f0-9-]{36}$/.test(queueVault),'Supply a canonical fixture vault ID');
assert.ok(!queueCreate||connection==='Offline','Queue creation requires an offline fixture.');
assert.ok(!onlineCreate||connection==='Online','Online creation requires a connected fixture.');
assert.ok(!queueReplay||connection==='Online','Queue replay requires a connected fixture.');
assert.ok(!settings||connection==='Online','Vault creation requires online fixture acceptance.');
const fixtureVault='Fixture Work '+Date.now(),fixtureCollection='Fixture collection '+Date.now();
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||!evidencePath)throw Error('Supply loopback inspector origin and external evidence path.');
const {evaluate,close}=await openDesktopFixtureInspector(origin);
try{
 assert.match(await evaluate('document.body.innerText'),/Unlock 127Vaults/);
 await evaluate(`globalThis.__fixtureUI={done:false};(async()=>{
 const checks=[];let stage='unlock';
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
  if(${JSON.stringify(unlockHold)}){checks.push('actual GUI remains unlocked for the live connector handoff test');globalThis.__fixtureUI={done:true,ok:true,checks};return;}
  if(${JSON.stringify(queueCreate||onlineCreate)}) {
   const input=(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
   const create=async title=>{button('New item').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),title);await new Promise(resolve=>setTimeout(resolve,50));const password=document.querySelector('main input[type="password"]');if(password)input(password,'synthetic-ui-queue-password');const destination=[...document.querySelectorAll('main label')].find(label=>label.textContent.includes('Destination vault'))?.querySelector('select');if(destination){const value=${JSON.stringify(queueVault)}||[...destination.options].find(option=>option.value)?.value;if(!value||![...destination.options].some(option=>option.value===value))throw Error('Fixture destination vault missing');destination.value=value;destination.dispatchEvent(new Event('change',{bubbles:true}));}await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(title));};
   stage='offline GUI create';await create(${JSON.stringify(expectedTitle)});
   stage='offline GUI edit';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),${JSON.stringify(nextTitle)});await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main')?.innerText.includes(${JSON.stringify(nextTitle)}));
   stage='second offline GUI create';await create(${JSON.stringify(expectedTitle+' second')});
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
 }catch(error){globalThis.__fixtureUI={done:true,ok:false,stage,error:String(error),diagnostic:document.body.innerText.replaceAll('api010-fiction-secret','[fixture password omitted]').slice(0,8000)};}
})();undefined`);
 let result;for(let i=0;i<160;i++){result=await evaluate('globalThis.__fixtureUI');if(result.done)break;await new Promise(resolve=>setTimeout(resolve,250));}
 if(result?.ok!==true)await writeFile(evidencePath+'.failure-'+Date.now()+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 assert.equal(result?.ok,true,result?.error||'Desktop GUI fixture timed out');
 await writeFile(evidencePath,JSON.stringify({date:new Date().toISOString(),status:'passed',platform:process.platform,scope:'Real packaged desktop UI; DOM events and React handlers with actual native backend; fictitious data',checks:result.checks,...(settings?{fixtureVault,fixtureCollection}:{}),limitations:['Physical keyboard/screen-reader and OS-lock matrix remain separate.']},null,2)+'\n',{flag:'wx'});
 console.log(process.platform+' installed GUI passed: '+result.checks.join('; '));
}finally{await close();}
