// Drive the real AppImage DOM/React handlers through its fixture-only inspector.
// No native-command mocks or direct invoke calls are used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
assert.ok(!settings||connection==='Online','Vault creation requires online fixture acceptance.');
const fixtureVault='Fixture Work '+Date.now(),fixtureCollection='Fixture collection '+Date.now();
if(!origin||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||!evidencePath)throw Error('Supply loopback inspector origin and external evidence path.');
let html='';
for(let i=0;i<80;i++){
 try{html=await(await fetch(origin)).text();if(html.includes('127Vaults Desktop')&&html.includes('tauri://localhost'))break;}catch{}
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(html.includes('127Vaults Desktop')&&html.includes('tauri://localhost'),'Expected the isolated Tauri desktop target.');
const socketPath=/\/socket\/\d+\/\d+\/WebPage/.exec(html)?.[0];assert.ok(socketPath);
const ws=new WebSocket(origin.replace('http:','ws:')+socketPath);
let target,sequence=0,readyResolve;
const ready=new Promise(resolve=>readyResolve=resolve),pending=new Map();
const timer=setTimeout(()=>ws.close(),90000);
ws.addEventListener('message',event=>{
 const value=JSON.parse(event.data);
 if(value.method==='Target.targetCreated'&&value.params.targetInfo.type==='page'){target=value.params.targetInfo.targetId;readyResolve();}
 if(value.method==='Target.dispatchMessageFromTarget'){
  const message=JSON.parse(value.params.message),entry=pending.get(message.id);
  if(entry){pending.delete(message.id);clearTimeout(entry.timer);entry.resolve(message);}
 }
});
async function evaluate(expression){
 const id=++sequence,response=new Promise((resolve,reject)=>pending.set(id,{resolve,timer:setTimeout(()=>{pending.delete(id);reject(Error('Inspector command timed out'));},10000)}));
 ws.send(JSON.stringify({id:1000+id,method:'Target.sendMessageToTarget',params:{targetId:target,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}})}}));
 const result=await response;if(result.error||result.result?.wasThrown)throw Error('Desktop fixture evaluation failed');return result.result.result.value;
}
try{
 await ready;assert.match(await evaluate('document.body.innerText'),/Unlock 127Vaults/);
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
  await wait(()=>document.body.innerText.includes('All items')&&(document.body.innerText.includes(${JSON.stringify(connection)})||${JSON.stringify(conflictTest)}&&document.body.innerText.includes('Needs review')));checks.push('real GUI '+${JSON.stringify(connection)}+' unlock');
  button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Profile').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes(${JSON.stringify(expectedDevice)}));document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));checks.push('GUI device identity matches the explicit fixture profile');
  if(${JSON.stringify(conflictTest)}){
   stage='conflict review';button('Sync now').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]'));
   checks.push('durable second-device queued conflict requires explicit GUI review');
   button('Compare and select fields…').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"] [role="radio"]'));
   const dialog=document.querySelector('[aria-labelledby="conflict-title"]');if(!dialog.innerText.includes(${JSON.stringify(expectedTitle)})||!dialog.innerText.includes(${JSON.stringify(nextTitle)}))throw Error('Conflict comparison omitted one fictitious title');
   if(dialog.innerText.includes('api010-fiction-secret'))throw Error('Conflict comparison exposed a password');
   checks.push('GUI compares local and server titles while masking password');
   const local=[...dialog.querySelectorAll('[role="radio"]')].find(el=>el.textContent.includes(${JSON.stringify(expectedTitle)}));if(!local)throw Error('Missing local title choice');local.click();button('Save selected fields').click();
   await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&document.body.innerText.includes('0 pending')&&document.querySelector('main')?.innerText.includes(${JSON.stringify(expectedTitle)}));checks.push('explicit selected-fields resolution saves local title and clears queue');
   button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));if(document.querySelector('input[aria-label="Master password"]')?.value)throw Error('Lock retained master password');checks.push('lock clears decrypted UI');globalThis.__fixtureUI={done:true,ok:true,checks};return;
  }
  stage='cross-client item';await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes(${JSON.stringify(expectedTitle)})));const item=[...document.querySelectorAll('button')].find(el=>el.textContent.includes(${JSON.stringify(expectedTitle)}));item.click();
  await wait(()=>document.querySelector('main')?.innerText.includes('base-user'));checks.push('previous GUI edit read by Linux');
  stage='reveal';document.querySelector('button[aria-label="Reveal Password"]').click();
  await wait(()=>document.querySelector('main')?.innerText.includes('api010-fiction-secret'));checks.push('explicit fixture password reveal');
  document.querySelector('button[aria-label="Hide Password"]').click();await wait(()=>!document.querySelector('main')?.innerText.includes('api010-fiction-secret'));checks.push('password hidden');
  stage='edit';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));
  const title=document.querySelector('input[data-editor-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,${JSON.stringify(nextTitle)});title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
  await wait(()=>!button('Save')&&document.querySelector('main')?.innerText.includes(${JSON.stringify(nextTitle)}));checks.push('GUI title edit and save');
  if(${JSON.stringify(connection)}==='Online'){await wait(()=>document.body.innerText.includes('0 pending'));checks.push('online save has no pending operations');}
  else {await wait(()=>/[1-9][0-9]* pending/.test(document.body.innerText));checks.push('offline save reports durable pending operations');}
  if(${JSON.stringify(settings)}){
   stage='vault creation';document.querySelector('button[aria-label="Add vault"]').click();await wait(()=>document.querySelector('[aria-labelledby="vault-dialog-title"] input'));
   const name=document.querySelector('[aria-labelledby="vault-dialog-title"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,${JSON.stringify(fixtureVault)});name.dispatchEvent(new Event('input',{bubbles:true}));name.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));button('Create vault').click();
   await wait(()=>!document.querySelector('[aria-labelledby="vault-dialog-title"]')&&button(${JSON.stringify(fixtureVault)}));checks.push('GUI creates named second private vault');
   button(${JSON.stringify(fixtureVault)}).click();await wait(()=>document.querySelector('.desktop-empty-state')?.innerText.includes('Add your first item'));checks.push('new private vault has separate empty item view');
   stage='collection';button('Add collection').click();await wait(()=>document.querySelector('[aria-labelledby="collection-dialog-title"] input'));
   const collection=document.querySelector('[aria-labelledby="collection-dialog-title"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(collection,${JSON.stringify(fixtureCollection)});collection.dispatchEvent(new Event('input',{bubbles:true}));collection.dispatchEvent(new Event('change',{bubbles:true}));
   document.querySelectorAll('[aria-labelledby="collection-dialog-title"] input[type="checkbox"]').forEach(el=>el.click());await new Promise(resolve=>setTimeout(resolve,50));button('Save collection').click();
   await wait(()=>!document.querySelector('[aria-labelledby="collection-dialog-title"]')&&button(${JSON.stringify(fixtureCollection)}));button(${JSON.stringify(fixtureCollection)}).click();await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes(${JSON.stringify(nextTitle)})));checks.push('GUI collection includes selected vaults and restores combined item view');
   await wait(()=>document.body.innerText.includes('0 pending'));
  }
  stage='lock';button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));
  if(document.body.innerText.includes(${JSON.stringify(nextTitle)})||document.querySelector('input[aria-label="Master password"]')?.value)throw Error('Lock retained decrypted UI state');
  checks.push('lock clears decrypted UI and password input');globalThis.__fixtureUI={done:true,ok:true,checks};
 }catch(error){globalThis.__fixtureUI={done:true,ok:false,stage,error:String(error),diagnostic:document.body.innerText.replaceAll('api010-fiction-secret','[fixture password omitted]').slice(0,8000)};}
})();undefined`);
 let result;for(let i=0;i<160;i++){result=await evaluate('globalThis.__fixtureUI');if(result.done)break;await new Promise(resolve=>setTimeout(resolve,250));}
 if(result?.ok!==true)await writeFile(evidencePath+'.failure-'+Date.now()+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 assert.equal(result?.ok,true,result?.error||'Linux GUI fixture timed out');
 await writeFile(evidencePath,JSON.stringify({date:new Date().toISOString(),status:'passed',scope:'Real packaged Linux AppImage UI; DOM events and React handlers with actual native backend; fictitious data',checks:result.checks,...(settings?{fixtureVault,fixtureCollection}:{}),limitations:['Physical keyboard/screen-reader and OS-lock matrix remain separate.']},null,2)+'\n',{flag:'wx'});
 console.log('Linux installed GUI passed: '+result.checks.join('; '));
}finally{clearTimeout(timer);ws.close();}
