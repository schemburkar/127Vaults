// Real selected Linux Desktop DOM/React handlers; no direct invoke/native mocks.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {openDesktopFixtureInspector} from './desktop-fixture-inspector.mjs';
const [work,phase]=process.argv.slice(2),profile=process.env.VAULTS_CONFIG_DIR;
const binarySha256=process.env.VAULTS_FIXTURE_DESKTOP_SHA;assert.match(binarySha256??'',/^[a-f0-9]{64}$/);
assert.equal(process.platform,'linux');assert.ok(work&&isAbsolute(work));assert.ok(['desktop-budget-burn','desktop-budget-retry','desktop-budget-replay','desktop-budget-final'].includes(phase));
assert.ok(['desktop-budget-replay','desktop-budget-final'].includes(phase),'Partial recovery never burns or retries budget');
assert.equal(profile,'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a');
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),member=await json('ownership-member.json'),linux=await json('member-cli-linux.json'),windows=await json('member-cli-windows.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+linux.device+'\n')&&conf.includes('username='+member.username+'\n'));assert.notEqual(linux.device,windows.device);
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');
const recordName='member-desktop-budget-partial.json',hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replica=async()=>JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json'),'utf8'));
let record;if(phase==='desktop-budget-burn'){await assert.rejects(access(join(work,recordName)),error=>error.code==='ENOENT');record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,itemId:normal.destinationItem,vaultId:normal.destination,desktopDevice:linux.device,windowsDevice:windows.device,profile,binarySha256,desktopSourceRevision:'4e1e1461666a1b6c50e43eda58719996ae05aba5',phases:[]};}else{record=await json(recordName);assert.equal(record.status,'in-progress');assert.equal(record.phases.length,{'desktop-budget-retry':1,'desktop-budget-replay':0,'desktop-budget-final':2}[phase]);}
const initial=(await replica()).pending;
if(phase==='desktop-budget-replay'){
 const saved=JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json.stop-checkpoint-1792079551241'),'utf8')).pending;
 assert.equal(hash(saved),record.originalQueueSha256);assert.ok(initial.length<=saved.length);
 assert.deepEqual(initial,initial.length?saved.slice(-initial.length):[],'Only normal replay may retire an original prefix');
}else assert.equal(initial.length,0);
let inspector=await openDesktopFixtureInspector('http://127.0.0.1:12926','webkit',{commandTimeoutMs:60000}),connectedAt=Date.now();const evaluate=value=>inspector.evaluate(value);let beforeAttempt;
try{
 let text='';for(let i=0;i<80;i++){text=await evaluate('document.body.innerText');if(text.includes('Unlock 127Vaults'))break;await new Promise(r=>setTimeout(r,250));}assert.match(text,/Unlock 127Vaults/);
 await evaluate(`globalThis.__budget={done:false};(async()=>{
 const fixture=${JSON.stringify(normal)},record=${JSON.stringify(record)},phase=${JSON.stringify(phase)},checks=[];let stage='unlock';
 const wait=async predicate=>{for(let i=0;i<3600;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout at '+stage);};
 const button=text=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text);
 const input=(node,value)=>{if(!node)throw Error('Missing editor input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
 const open=async title=>{await wait(()=>[...document.querySelectorAll('button strong')].some(n=>n.textContent.trim()===title));[...document.querySelectorAll('button strong')].find(n=>n.textContent.trim()===title).closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===title&&button('Edit')&&!button('Edit').disabled);};
 const edit=async title=>{button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),title);await new Promise(r=>setTimeout(r,30));};
 try{
 input(document.querySelector('input[aria-label="Username"]'),'ownership_member');if(!document.querySelector('input[aria-label="Account secret"]')){button('Enter account secret').click();await wait(()=>document.querySelector('input[aria-label="Account secret"]'));}input(document.querySelector('input[aria-label="Account secret"]'),'07'.repeat(32));input(document.querySelector('input[aria-label="Master password"]'),'fictitious password 127vaults');await new Promise(r=>setTimeout(r,50));button('Unlock encrypted replica').click();await wait(()=>document.body.innerText.includes('All items'));
 button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Profile').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes(record.desktopDevice));const lines=document.querySelector('#desktop-settings-panel').innerText.split(String.fromCharCode(10)).map(x=>x.trim()).filter(Boolean),ci=lines.indexOf('Connection'),expected=phase==='desktop-budget-burn'||phase==='desktop-budget-retry'?'Offline':'Online';if(lines[ci+1]!==expected)throw Error('Wrong budget fixture connection');document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));checks.push('Actual '+expected+' GUI unlock and exact retained device');
 if(phase==='desktop-budget-burn'){
  await open(fixture.title);let accepted=0,lastTitle=fixture.title;
  for(let attempt=1;attempt<=505;attempt++){
   stage='offline budget save '+attempt;const title=fixture.title+' budget offline '+attempt;await edit(title);globalThis.__budget={done:false,awaitingSave:attempt,accepted,lastTitle,retryTitle:title};await wait(()=>globalThis.__allowBudgetSave===attempt);button('Save').click();
   await wait(()=>document.body.innerText.includes('Encryption session limit reached')||!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===title);
   if(document.body.innerText.includes('Encryption session limit reached')){
    if(!document.body.innerText.includes('Lock and unlock, then retry')||!document.body.innerText.includes('queued changes are preserved'))throw Error('Budget error lacks recovery/preservation guidance');
    globalThis.__budget={done:false,guardReached:true,accepted,lastTitle,retryTitle:title};await wait(()=>globalThis.__budgetGuardChecked===true);
    input(document.querySelector('input[data-editor-title]'),lastTitle);await new Promise(r=>setTimeout(r,75));button('Cancel').click();await wait(()=>!button('Save'));button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));globalThis.__budget={done:true,ok:true,accepted,lastTitle,retryTitle:title,checks:[...checks,'Real unchanged encryption budget reached by actual offline GUI saves','Actionable error and explicit Lock; original accepted queue retained']};return;
   }
   accepted++;lastTitle=title;
  }
  throw Error('Budget guard not reached within bounded attempts');
 }else if(phase==='desktop-budget-retry'){
  await open(record.lastTitle);await edit(record.retryTitle);button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===record.retryTitle);checks.push('Fresh actual GUI process retries previously refused edit successfully');
 }else if(phase==='desktop-budget-replay'){
  stage='real queued replay';button('Sync now').click();await wait(()=>document.body.innerText.includes('0 changes waiting to sync'));if(document.querySelector('[aria-labelledby="conflict-title"]'))throw Error('Sequential budget queue created conflict');await open(record.retryTitle);checks.push('Actual GUI sync replays all retained requests with zero pending/conflicts');
 }else{await open(fixture.title);checks.push('Fresh actual GUI independently reads restored original title');}
 if(phase!=='desktop-budget-burn'){const detail=document.querySelector('main').innerText;if(!detail.includes(fixture.username)||!detail.includes('web-move.invalid')||detail.includes(fixture.password))throw Error('Budget item fields/masking mismatch');button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('Actual GUI fields remain intact/masked and lock clears view');globalThis.__budget={done:true,ok:true,checks};}
 }catch(error){globalThis.__budget={done:true,ok:false,stage,error:String(error),checks};}
})();`);
 let result,lastAllowed=0,guardChecked=false;const deadline=Date.now()+480000;
 while(Date.now()<deadline){
  if(Date.now()-connectedAt>60000){inspector.close();inspector=await openDesktopFixtureInspector('http://127.0.0.1:12926','webkit',{commandTimeoutMs:60000});connectedAt=Date.now();}
  result=await evaluate('globalThis.__budget');if(result?.done)break;
  if(result?.awaitingSave&&result.awaitingSave!==lastAllowed){beforeAttempt=(await replica()).pending;assert.equal(beforeAttempt.length,result.accepted);lastAllowed=result.awaitingSave;await evaluate('globalThis.__allowBudgetSave='+lastAllowed);if(result.accepted%50===0)await writeFile(join(work,'member-desktop-budget-progress.json'),JSON.stringify({phase,accepted:result.accepted,attempt:lastAllowed,at:new Date().toISOString()})+'\n');}
  if(result?.guardReached&&!guardChecked){const after=(await replica()).pending;assert.deepEqual(after,beforeAttempt);assert.ok(result.accepted>=450&&result.accepted<=500);record.originalQueueSha256=hash(after);await writeFile(join(work,'member-desktop-budget-original-requests.json'),JSON.stringify(after)+'\n',{flag:'wx',mode:0o600});guardChecked=true;await evaluate('globalThis.__budgetGuardChecked=true');}
  await new Promise(r=>setTimeout(r,30));
 }
 if(!result?.ok){await writeFile(join(work,'member-desktop-budget-failure-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});throw Error('Actual GUI budget phase failed; queue/profile retained');}
 if(phase==='desktop-budget-burn'){assert.equal(guardChecked,true);Object.assign(record,{accepted:result.accepted,lastTitle:result.lastTitle,retryTitle:result.retryTitle,guardPreservedExactQueue:true});}
 const pending=(await replica()).pending;
 if(phase==='desktop-budget-retry'){assert.equal(pending.length,record.accepted+1);assert.equal(hash(pending.slice(0,-1)),record.originalQueueSha256);record.retryQueueSha256=hash(pending);record.freshUnlockRetryPreservedPrefix=true;await writeFile(join(work,'member-desktop-budget-retry-request.json'),JSON.stringify(pending.at(-1))+'\n',{flag:'wx',mode:0o600});}
 if(phase==='desktop-budget-replay'){assert.deepEqual(pending,[]);record.replayedAll=true;}
 if(phase==='desktop-budget-final'){assert.equal(record.nativeRestored,true);record.status='recovered-partial-run';record.budgetAcceptance='not-proven';record.baselineRestored=true;}
 record.phases.push({phase,status:'passed',device:linux.device,checks:result.checks,completedAt:new Date().toISOString()});await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Actual GUI budget phase passed: '+phase);
}finally{inspector.close();}
