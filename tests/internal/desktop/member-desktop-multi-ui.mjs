// Real selected Linux Desktop DOM/React handlers; no direct invoke/native mocks.
import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {openDesktopFixtureInspector} from '../support/desktop-fixture-inspector.mjs';
const [work,phase]=process.argv.slice(2),profile=process.env.VAULTS_CONFIG_DIR;
const binarySha256=process.env.VAULTS_FIXTURE_DESKTOP_SHA;assert.match(binarySha256??'',/^[a-f0-9]{64}$/);
assert.equal(process.platform,'linux');assert.ok(work&&isAbsolute(work));assert.ok(['desktop-multi-baseline','desktop-multi-offline','desktop-multi-compare','desktop-multi-server','desktop-multi-local','desktop-multi-final'].includes(phase));
assert.equal(profile,'/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a');
const json=async name=>JSON.parse(await readFile(join(work,name),'utf8'));
const fixture=await json('fixture.json'),normal=await json('web-move-candidate-normal-fixture.json'),member=await json('ownership-member.json'),linux=await json('member-cli-linux.json'),windows=await json('member-cli-windows.json');
assert.equal(fixture.serverRevision,'cbb1be02e68e484c82334cd4389dcc4b09f64cf2');assert.equal(fixture.serverId,'98027ac4-9882-42d5-812a-a18c972c299f');
const conf=await readFile(join(profile,'device.conf'),'utf8');assert.ok(conf.includes('device_id='+linux.device+'\n')&&conf.includes('username='+member.username+'\n'));assert.notEqual(linux.device,windows.device);
await assert.rejects(access(join(profile,'vault-removal.json')),error=>error.code==='ENOENT');

const recordName='member-desktop-multi.json';let record;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replica=async()=>JSON.parse(await readFile(join(profile,'replicas',normal.destination+'.json'),'utf8'));
const phases=['desktop-multi-baseline','desktop-multi-offline','windows-multi-peer','desktop-multi-compare','desktop-multi-server','desktop-multi-local','windows-multi-restore','desktop-multi-final'];
if(phase==='desktop-multi-baseline'){
  await assert.rejects(access(join(work,recordName)),error=>error.code==='ENOENT');const previous=await json('web-move-destination-loss-fixture.json');assert.equal(previous.destination,normal.destination);assert.notEqual(previous.destinationItem,normal.destinationItem);
  const rows=[{itemId:normal.destinationItem,title:normal.title,username:normal.username,website:normal.website},{itemId:previous.destinationItem,title:previous.changedTitle,username:previous.username,website:previous.website}].map((row,index)=>({...row,localTitle:'Desktop multi local '+index+' '+row.title,serverTitle:'Desktop multi server '+index+' '+row.title,localUsername:'desktop-multi-local-'+index,serverUsername:'desktop-multi-peer-'+index}));
  record={status:'in-progress',serverId:fixture.serverId,serverRevision:fixture.serverRevision,vaultId:normal.destination,desktopDevice:linux.device,windowsDevice:windows.device,profile,binarySha256,desktopSourceRevision:'4e1e1461666a1b6c50e43eda58719996ae05aba5',rows,phases:[]};
}else{record=await json(recordName);assert.equal(record.status,'in-progress');assert.equal(record.phases.length,phases.indexOf(phase));}
const expectedPending=['desktop-multi-compare','desktop-multi-server'].includes(phase)?2:phase==='desktop-multi-local'?1:0;
for(const name of await readdir(join(profile,'replicas')))if(name.endsWith('.json')){const pending=JSON.parse(await readFile(join(profile,'replicas',name),'utf8')).pending;assert.equal(pending.length,name===normal.destination+'.json'?expectedPending:0);if(expectedPending&&name===normal.destination+'.json')assert.equal(fingerprint(pending),expectedPending===2?record.queueSha256:record.requests[1].sha256);}
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
      const lines=document.querySelector('#desktop-settings-panel').innerText.split(String.fromCharCode(10)).map(x=>x.trim()).filter(Boolean),connection=lines.indexOf('Connection');if(connection<0||lines[connection+1]!==${JSON.stringify(phase==='desktop-multi-offline'?'Offline':'Online')})throw Error('Member Desktop connection mismatch');
      document.querySelector('button[aria-label="Close settings"]').click();await wait(()=>!document.querySelector('[aria-labelledby="desktop-settings-title"]'));checks.push('Actual member GUI unlock, exact enrolled device and expected '+${JSON.stringify(phase==='desktop-offline'?'Offline':'Online')}+' connection');
      const rows=conflict.rows;
      const open=async row=>{const summary=[...document.querySelectorAll('button strong')].find(node=>node.textContent.trim()===row.title);if(!summary)throw Error('Missing controlled multi item');summary.closest('button').click();await wait(()=>document.querySelector('main h2')?.textContent.trim()===row.title&&button('Edit')&&!button('Edit').disabled);};
      const review=async row=>{if(document.querySelector('[aria-labelledby="conflict-title"]')){button('Cancel and keep editing').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]'));}button('Review sync').click();await wait(()=>document.querySelector('[aria-labelledby="sync-review-title"]'));const article=[...document.querySelectorAll('[aria-labelledby="sync-review-title"] article')].find(node=>node.querySelector('h3')?.textContent.trim()===row.localTitle);if(!article||!article.innerText.includes(fixture.destinationName))throw Error('Wrong pending item/vault in review');const action=[...article.querySelectorAll('button')].find(node=>node.textContent.trim()==='Review item and choose version');if(!action)throw Error('Missing item review action');action.click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]')?.innerText.includes(row.localTitle));};
      const compare=async row=>{button('Compare and select fields…').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"] [role="radio"]'));const text=document.querySelector('[aria-labelledby="conflict-title"]').innerText;for(const value of [row.localTitle,row.serverTitle,row.localUsername,row.serverUsername])if(!text.includes(value))throw Error('Multi comparison omitted expected version');if(text.includes(fixture.password))throw Error('Comparison exposed password');};
      if(['desktop-multi-compare','desktop-multi-server','desktop-multi-local'].includes(phase)){
        stage='multi sync review';if(phase==='desktop-multi-compare'){if(!document.querySelector('[aria-labelledby="conflict-title"]')){button('Sync now').click();await wait(()=>document.querySelector('[aria-labelledby="conflict-title"]'));}for(const row of rows){await review(row);await compare(row);button('Cancel and keep editing').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]'));}await wait(()=>/2 changes? waiting to sync/.test(document.body.innerText));checks.push('Actual GUI independently compares both correct pending items/vault and cancels; passwords masked');}
        else if(phase==='desktop-multi-server'){await review(rows[0]);await compare(rows[0]);button('Use server version').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&/1 changes? waiting to sync/.test(document.body.innerText)&&document.querySelector('main h2')?.textContent.trim()===rows[0].serverTitle);checks.push('Actual GUI selects first server version while second request remains queued');}
        else{await review(rows[1]);await compare(rows[1]);button('Use mine').click();await wait(()=>!document.querySelector('[aria-labelledby="conflict-title"]')&&document.body.innerText.includes('0 changes waiting to sync')&&document.querySelector('main h2')?.textContent.trim()===rows[1].localTitle);checks.push('Actual GUI explicitly keeps second local version and settles queue');}
      }else{
        for(const row of rows){stage='multi item read/edit '+row.itemId;await open(row);const detail=document.querySelector('main').innerText;if(!detail.includes(row.username)||!detail.includes('web-move.invalid')||detail.includes(fixture.password))throw Error('Multi ordinary fields/masking mismatch');
          const reveal=[...document.querySelectorAll('main button')].find(node=>node.getAttribute('aria-label')?.toLowerCase()==='reveal password');if(!reveal)throw Error('Missing reveal');reveal.click();await wait(()=>document.querySelector('main').innerText.includes(fixture.password));[...document.querySelectorAll('main button')].find(node=>node.getAttribute('aria-label')?.toLowerCase()==='hide password').click();await wait(()=>!document.querySelector('main').innerText.includes(fixture.password));
          if(phase==='desktop-multi-offline'){button('Edit').click();await wait(()=>document.querySelector('input[data-editor-title]'));input(document.querySelector('input[data-editor-title]'),row.localTitle);const username=[...document.querySelectorAll('main label')].find(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()==='Username')?.querySelector('input');input(username,row.localUsername);await new Promise(resolve=>setTimeout(resolve,50));button('Save').click();await wait(()=>!button('Save')&&button('Edit')&&!button('Edit').disabled&&document.querySelector('main h2')?.textContent.trim()===row.localTitle);}
        }
        await wait(()=>phase==='desktop-multi-offline'?/2 changes? waiting to sync/.test(document.body.innerText):document.body.innerText.includes('0 changes waiting to sync'));checks.push(phase==='desktop-multi-offline'?'Actual offline GUI saves two independent queued edits':'Actual GUI reads both exact baseline items with explicit reveal/remask and zero queue');
      }
      button('Lock').click();await wait(()=>document.body.innerText.includes('Unlock 127Vaults'));checks.push('Actual multi-item GUI phase locks');globalThis.__memberDesktop={done:true,ok:true,checks};
    }catch(error){globalThis.__memberDesktop={done:true,ok:false,stage,error:String(error),checks};}
  })();`);
  let result;for(let attempt=0;attempt<280;attempt++){result=await evaluate('globalThis.__memberDesktop');if(result?.done)break;await new Promise(resolve=>setTimeout(resolve,250));}
  if(!result?.ok){await writeFile(join(work,'member-desktop-multi-failure-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});throw Error('Actual member Desktop multi phase failed; private diagnostic retained');}
  const pending=(await replica()).pending;
  if(phase==='desktop-multi-offline'){assert.equal(pending.length,2);assert.deepEqual(pending.map(row=>row.operation.itemId),record.rows.map(row=>row.itemId));record.queueSha256=fingerprint(pending);record.requests=pending.map(row=>({operationId:row.operation.opId,itemId:row.operation.itemId,sha256:fingerprint([row])}));await writeFile(join(work,'member-desktop-multi-original-requests.json'),JSON.stringify(pending,null,2)+'\n',{flag:'wx',mode:0o600});}
  if(phase==='desktop-multi-compare'){assert.equal(fingerprint(pending),record.queueSha256);record.comparisonPreservedBoth=true;}
  if(phase==='desktop-multi-server'){assert.equal(pending.length,1);assert.equal(fingerprint(pending),record.requests[1].sha256);record.serverChoicePreservedSibling=true;}
  if(phase==='desktop-multi-local'){assert.deepEqual(pending,[]);record.independentLocalChoice=true;}
  record.phases.push({phase,status:'passed',device:linux.device,checks:result.checks,completedAt:new Date().toISOString()});
  if(phase==='desktop-multi-final'){assert.equal(record.nativeRestored,true);record.status='passed';record.baselineRestored=true;}
  await writeFile(join(work,recordName),JSON.stringify(record,null,2)+'\n');console.log('Actual Linux Desktop multi phase passed: '+phase);
}finally{close();}
