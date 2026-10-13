// Chrome exposes toolbar popups as CDP "other" targets, not Playwright Pages.
// Attach to that actual popup; do not replace its DOM or its Chrome APIs.
export async function attachExtensionPopup(browserSession, targetId) {
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  browserSession.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const response = JSON.parse(event.message), item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id); clearTimeout(item.timer);
    if (response.error) item.reject(Error(response.error.message)); else item.resolve(response.result);
  });
  async function send(method, params = {}) {
    const id = ++sequence;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Popup command timeout: '+method)); },10000);
      pending.set(id,{resolve,reject,timer});
    });
    await browserSession.send('Target.sendMessageToTarget', {sessionId,message:JSON.stringify({id,method,params})});
    return response;
  }
  async function evaluate(expression) {
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error('Popup evaluation failed: '+result.exceptionDetails.text);
    return result.result?.value;
  }
  async function wait(check, label) {
    const until=Date.now()+10000;
    while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error('Popup condition timeout: '+label);
  }
  class Locator {
    constructor(css,first=false,text=null){this.css=css;this.onlyFirst=first;this.text=text;}
    elements(){
      const visible=this.css.includes(':visible'),css=this.css.replaceAll(':visible','');
      return `[...document.querySelectorAll(${JSON.stringify(css)})]${visible?'.filter(el=>el.getClientRects().length>0)':''}${this.text?`.filter(el=>new RegExp(${JSON.stringify(this.text.source)},${JSON.stringify(this.text.flags)}).test(el.textContent))`:''}${this.onlyFirst?'.slice(0,1)':''}`;
    }
    first(){return new Locator(this.css,true,this.text);}
    filter({hasText}){return new Locator(this.css,this.onlyFirst,hasText);}
    async count(){return evaluate(this.elements()+'.length');}
    async waitFor({state='visible'}={}){await wait(()=>evaluate(`(()=>{const el=${this.elements()}[0];return ${state==='hidden'?'!el||el.getClientRects().length===0':'!!el&&el.getClientRects().length>0'};})()`),this.css);}
    async selectOption(value){await evaluate(`(()=>{const el=${this.elements()}[0];if(!el)throw Error('Missing source selector');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
    async selectFirstOption(){await wait(()=>evaluate(`!!${this.elements()}[0]?.options?.length`),'popup choices');const value=await evaluate(`${this.elements()}[0].options[0].value`);await this.selectOption(value);}
    async waitForEnabled(){await wait(()=>evaluate(`(()=>{const el=${this.elements()}[0];return !!el&&!el.disabled&&el.getClientRects().length>0;})()`),'enabled '+this.css);}
    async click(){
      const point=await evaluate(`(()=>{const el=${this.elements()}[0];if(!el)throw Error('Missing popup action');const rect=el.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
  }
  await send('Runtime.enable');
  return {
    locator:css=>new Locator(css),
    snapshot:()=>evaluate('document.body.innerText'),
    isClosed:async()=>!(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.some(info=>info.targetId===targetId),
    waitForURL:url=>wait(()=>evaluate(`location.href===${JSON.stringify(url)}`),'popup URL'),
    waitForEvent:event=>{
      if(event!=='close')throw Error('Unsupported popup event');
      return wait(async()=>!(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.some(info=>info.targetId===targetId),'popup close');
    },
    async close(){await browserSession.send('Target.closeTarget',{targetId});},
  };
}
