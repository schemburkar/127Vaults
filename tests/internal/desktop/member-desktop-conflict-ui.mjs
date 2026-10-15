// Real selected Linux Desktop DOM/React handlers; no direct invoke/native mocks.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {openDesktopFixtureInspector} from '../support/desktop-fixture-inspector.mjs';
const [work,phase]=process.argv.slice(2),profile=process.env.VAULTS_CONFIG_DIR;
const binarySha256=process.env.VAULTS_FIXTURE_DESKTOP_SHA;assert.match(binarySha256??'',/^[a-f0-9]{64}$/);
assert.equal(process.platform,'linux');assert.ok(work&&isAbsolute(work));assert.ok(['desktop-offline','desktop-compare','desktop-merge','desktop-conflict-final'].includes(phase));
assert.equal(profile,'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a');
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),member=await json('ownership-member.json'),linux=await json('member-cli-linux.json'),windows=await json('member-cli-windows.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+linux.device+'\n')&&conf.includes('username='+member.username+'\n'));assert.notEqual(linux.device,windows.device);
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');

const recordName='member-desktop-conflict.json';let record;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replica=async()=>JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json'),'utf8'));
if(phase==='desktop-offline'){
  await assert.rejects(access(join(work,recordName)),error=>error.code==='ENOENT');
  record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,itemId:normal.destinationItem,vaultId:normal.destination,desktopDevice:linux.device,windowsDevice:windows.device,profile,binarySha256,desktopSourceRevision:'4e1e1461666a1b6c50e43eda58719996ae05aba5',localTitle:normal.title+' Desktop offline overlap',serverTitle:normal.title+' Windows peer overlap',localUsername:'desktop-local-member-20261015-a',serverUsername:'desktop-peer-member-20261015-a',phases:[]};
}else{record=await json(recordName);assert.equal(record.status,'in-progress');assert.equal(record.phases.length,{'desktop-compare':2,'desktop-merge':3,'desktop-conflict-final':5}[phase]);}
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json')){
 const pending=JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending;
 if(['desktop-compare','desktop-merge'].includes(phase)&&name===normal.destination+'.json'){assert.equal(pending.length,1);assert.equal(fingerprint(pending),record.pendingSha256);}else assert.equal(pending.length,0);
}
const {evaluate,close}=await openDesktopFixtureInspector('http://127.0.0.1:12926');
try{
  let text='';for(let attempt=0;attempt<80;attempt++){text=await evaluate('document.body.innerText');if(text.includes('Unlock 127Vaults'))break;await new Promise(resolve=>setTimeout(resolve,250));}assert.match(text,/Unlock 127Vaults/);
  await evaluate(`globalThis.__memberDesktop={done:false};(async()=>{
    const fixture=${JSON.stringify(normal)},expectedDevice=${JSON.stringify(linux.device)},phase=${JSON.stringify(phase)},conflict=${JSON.stringify(record)};
    const checks=[];let stage='unlock';
    const wait=async predicate=>{for(let i=0;i<600;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out at '+stage);};
    const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
    const input=(node,value)=>{if(!node)throw Error('Missing actual editor input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
    try{
      input(document.querySelector('input[aria-label="Username"]'),'ownership_member');
      if(!document.querySelector('input[aria-label="Account secret"]')){button('Enter account secret').click();await wait(()=>document.querySelector('input[aria-label="Account secret"]'));}
      input(document.querySelector('input[aria-label="Account secret"]'),'07'.repeat(32));input(document.querySelector('input[aria-label="Master password"]'),'fictitious password 127vaults');
      await new Promise(resolve=>setTimeout(resolve,50));button('Unlock encrypted replica').click();await wait(()=>document.body.innerText.includes('All items'));
      button('Settings').click();await wait(()=>document.querySelector('[aria-labelledby="desktop-settings-title"]'));button('Profile').click();await wait(()=>document.querySelector('#desktop-settings-panel')?.innerText.includes(expectedDevice));
      const lines=document.querySelector('#desktop-settings-panel').innerText.split(String.fromCharCode(10)).map(x=>x.trim()).filter(Boolean),connection=lines.indexOf('Connection');if(connection<0||lines[connection+1]!==${JSON.stringify(phase==='desktop-offline'?'Offline':'Online')})throw Error('Member Desktop connection mismatch');
      document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));checks.push('Actual member GUI unlock, exact enrolled device and expected '+${JSON.stringify(phase==='desktop-offline'?'Offline':'Online')}+' connection');
      if(['desktop-compare','desktop-merge'].includes(phase)){
        stage='actual GUI conflict';if(!document.querySelector('[aria-labelledby="conflict-title"]')){button('Sync now').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]'));}
        if(!document.querySelector('[aria-labelledby="conflict-title"]').innerText.includes(conflict.localTitle))throw Error('Wrong pending item in conflict');
        button('Compare and select fields…').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"] [role="radio"]'));
        const dialog=document.querySelector('[aria-labelledby="conflict-title"]');for(const expected of [conflict.localTitle,conflict.serverTitle,conflict.localUsername,conflict.serverUsername])if(!dialog.innerText.includes(expected))throw Error('Comparison omitted controlled field');if(dialog.innerText.includes(fixture.password))throw Error('Comparison exposed password');checks.push('Actual GUI verified comparison displays both overlapping versions with password masked');
        if(phase==='desktop-compare'){
          button('Cancel and keep editing').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]'));await wait(()=>/1 changes? waiting to sync/.test(document.body.innerText));checks.push('Explicit comparison cancel retains queued edit for review');
        }else{
          const field=name=>[...dialog.querySelectorAll('.desktop-conflict-row')].find(node=>node.querySelector('b')?.textContent.trim()===name);
          const server=field('title')?.querySelectorAll('[role="radio"]')[1],local=field('username')?.querySelectorAll('[role="radio"]')[0];if(server?.textContent.trim()!==conflict.serverTitle||local?.textContent.trim()!==conflict.localUsername)throw Error('Incorrect merge options');server.click();await wait(()=>field('title')?.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')==='true');local.click();await wait(()=>field('username')?.querySelectorAll('[role="radio"]')[0]?.getAttribute('aria-checked')==='true');button('Save selected fields').click();
          await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&document.body.innerText.includes('0 changes waiting to sync')&&document.querySelector('main h2')?.textContent.trim()===conflict.serverTitle&&document.querySelector('main').innerText.includes(conflict.localUsername));checks.push('Actual GUI saves explicit server title and local username; queue settles');
        }
        button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('Actual GUI conflict phase locks');globalThis.__memberDesktop={done:true,ok:true,checks};return;
      }
      stage='open moved login';await wait(()=>[...document.querySelectorAll('button strong')].some(node=>node.textContent.trim()===fixture.title));const summaries=[...document.querySelectorAll('button strong')].filter(node=>node.textContent.trim()===fixture.title);if(summaries.length!==1)throw Error('Ambiguous controlled moved login');summaries[0].closest('button').click();
      await wait(()=>document.querySelector('main h2')?.textContent.trim()===fixture.title&&button('Edit')&&!button('Edit').disabled);
      const detail=document.querySelector('main').innerText;if(!detail.includes(fixture.username)||!detail.includes('web-move.invalid')||detail.includes(fixture.password))throw Error('Member detail fields/masking mismatch');checks.push('Actual GUI independently reads web-created moved login fields with password masked');
      stage='reveal and remask';const reveal=[...document.querySelectorAll('main button')].find(node=>node.getAttribute('aria-label')?.toLowerCase()==='reveal password');if(!reveal)throw Error('Missing reveal password');reveal.click();await wait(()=>document.querySelector('main').innerText.includes(fixture.password));const hide=[...document.querySelectorAll('main button')].find(node=>node.getAttribute('aria-label')?.toLowerCase()==='hide password');if(!hide)throw Error('Missing hide password');hide.click();await wait(()=>!document.querySelector('main').innerText.includes(fixture.password));checks.push('Actual GUI explicitly reveals/remasks password without clipboard action');
      if(phase==='desktop-offline'){
        stage='edit moved login';button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),conflict.localTitle);const username=[...document.querySelectorAll('main label')].find(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()==='Username')?.querySelector('input');input(username,conflict.localUsername);await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();
        await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===conflict.localTitle);checks.push('Actual offline GUI Edit/Save queues changed title and username');
      }else checks.push('Fresh Desktop process independently reads native-restored baseline');
      await wait(()=>phase==='desktop-offline'?/1 changes? waiting to sync/.test(document.body.innerText):document.body.innerText.includes('0 changes waiting to sync'));checks.push(phase==='desktop-offline'?'Actual offline GUI shows one durable queued edit':'Actual GUI ends with zero item changes waiting to sync');
      button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('Actual GUI locks and clears unlocked view');globalThis.__memberDesktop={done:true,ok:true,checks};
    }catch(error){globalThis.__memberDesktop={done:true,ok:false,stage,error:String(error),checks};}
  })();`);
  let result;for(let attempt=0;attempt<280;attempt++){result=await evaluate('globalThis.__memberDesktop');if(result?.done)break;await new Promise(resolve=>setTimeout(resolve,250));}
  if(!result?.ok){await writeFile(join(work,'member-desktop-conflict-failure-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});throw Error('Actual member Desktop phase failed; private diagnostic retained');}
  if(phase==='desktop-offline'){const pending=(await replica()).pending;assert.equal(pending.length,1);assert.equal(pending[0].operation.itemId,normal.destinationItem);record.operationId=pending[0].operation.opId;record.pendingSha256=fingerprint(pending);await writeFile(join(work,'member-desktop-conflict-original-request.json'),JSON.stringify(pending,null,2)+'\n',{flag:'wx',mode:0o600});}
  if(phase==='desktop-compare'){assert.equal(fingerprint((await replica()).pending),record.pendingSha256);record.comparisonPreservedExactRequest=true;}
  if(phase==='desktop-merge'){assert.deepEqual((await replica()).pending,[]);record.explicitGuiMerge=true;}
  record.phases.push({phase,status:'passed',device:linux.device,checks:result.checks,completedAt:new Date().toISOString()});
  if(phase==='desktop-conflict-final'){record.status='passed';record.baselineRestored=true;}
  await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Actual Linux Desktop member phase passed: '+phase);
}finally{close();}
