// Fixture-only transports to the real packaged webview. No native mocks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

export async function openDesktopFixtureInspector(origin, transport=process.platform==='win32'?'webview2':'webkit', options={}) {
  const commandTimeoutMs=options.commandTimeoutMs??10000;
  assert.ok(Number.isInteger(commandTimeoutMs)&&commandTimeoutMs>=10000&&commandTimeoutMs<=60000);
  assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  if(transport==='webview2'){
    const {chromium}=createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE||'playwright');
    let browser;
    for(let i=0;i<80;i++){
      try{browser=await chromium.connectOverCDP(origin);break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    assert.ok(browser,'Isolated WebView2 inspector unavailable');
    const pages=browser.contexts().flatMap(context=>context.pages());
    const page=pages.find(page=>/^https?:\/\/tauri\.localhost\//.test(page.url()));
    assert.ok(page,'Expected the isolated Tauri webview');
    await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
    return {evaluate:expression=>page.evaluate(expression),close:()=>browser.close()};
  }
  assert.equal(transport,'webkit');
  let html='';
  for(let i=0;i<80;i++){
    try{html=await(await fetch(origin)).text();if(html.includes('127Vaults Desktop')&&html.includes('tauri://localhost'))break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(html.includes('127Vaults Desktop')&&html.includes('tauri://localhost'),'Expected the isolated Tauri desktop target');
  const path=/\/socket\/\d+\/\d+\/WebPage/.exec(html)?.[0];assert.ok(path);
  const ws=new WebSocket(origin.replace('http:','ws:')+path);
  let target,sequence=0,resolveReady;
  const ready=new Promise(resolve=>resolveReady=resolve),pending=new Map();
  const timer=setTimeout(()=>ws.close(),90000);
  ws.addEventListener('message',event=>{
    const value=JSON.parse(event.data);
    if(value.method==='Target.targetCreated'&&value.params.targetInfo.type==='page'){target=value.params.targetInfo.targetId;resolveReady();}
    if(value.method==='Target.dispatchMessageFromTarget'){
      const response=JSON.parse(value.params.message),item=pending.get(response.id);
      if(item){pending.delete(response.id);clearTimeout(item.timer);item.resolve(response);}
    }
  });
  await ready;
  return {
    async evaluate(expression){
      const id=++sequence;
      const response=new Promise((resolve,reject)=>pending.set(id,{resolve,timer:setTimeout(()=>{pending.delete(id);reject(Error('Inspector command timed out'));},commandTimeoutMs)}));
      ws.send(JSON.stringify({id:1000+id,method:'Target.sendMessageToTarget',params:{targetId:target,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}})}}));
      const result=await response;if(result.error||result.result?.wasThrown)throw Error('Desktop fixture evaluation failed');return result.result.result.value;
    },
    close(){clearTimeout(timer);ws.close();},
  };
}
