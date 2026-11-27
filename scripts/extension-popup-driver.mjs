// Chrome exposes toolbar popups as CDP "other" targets, not Playwright Pages.
// Attach to that actual popup; do not replace its DOM or its Chrome APIs.
export async function attachExtensionPopup(browserSession, targetId) {
  const timeoutMs=Number(process.env.VAULTS_FIXTURE_POPUP_TIMEOUT_MS||10000);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw Error('Fixture popup timeout must be 1000–60000 ms');
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
  async function evaluate(fn, data) {
    const result=await send('Runtime.callFunctionOn',{objectId,
      functionDeclaration:String(fn),arguments:[{value:data}],returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error('Popup evaluation failed: '+result.exceptionDetails.text);
    return result.result?.value;
  }
  async function wait(check, label) {
    const until=Date.now()+timeoutMs;
    while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error('Popup condition timeout: '+label);
  }
  class Locator {
    constructor(css,first=false,text=null){this.css=css;this.onlyFirst=first;this.text=text;}
    run(action,value){
      const visible=this.css.includes(':visible'),css=this.css.replaceAll(':visible','');
      return evaluate(({css,visible,text,action,value})=>{
        const matches = [...document.querySelectorAll(css)].filter(el =>
          (!visible || el.getClientRects().length > 0) &&
          (!text || new RegExp(text.source,text.flags).test(el.textContent)));
        const el=matches[0], shown=!!el&&el.getClientRects().length>0;
        switch(action){
          case 'count': return value?Math.min(matches.length,1):matches.length;
          case 'shown': return shown;
          case 'enabled': return shown&&!el.disabled;
          case 'has-options': return !!el?.options?.length;
          case 'select':
            if(!el)throw Error('Missing source selector');
            el.value=value??el.options[0].value;
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return;
          case 'point': {
            if(!el)throw Error('Missing popup action');
            el.scrollIntoView({block:'center'});
            const rect=el.getBoundingClientRect();
            return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
          }
          default: throw Error('Unsupported popup operation');
        }
      },{css,visible,text:this.text&&{source:this.text.source,flags:this.text.flags},action,value});
    }
    first(){return new Locator(this.css,true,this.text);}
    filter({hasText}){return new Locator(this.css,this.onlyFirst,hasText);}
    async count(){return this.run('count',this.onlyFirst);}
    async waitFor({state='visible'}={}){await wait(async()=>(await this.run('shown'))===(state!=='hidden'),this.css);}
    async selectOption(value){await this.run('select',value);}
    async selectFirstOption(){await wait(()=>this.run('has-options'),'popup choices');await this.run('select');}
    async waitForEnabled(){await wait(()=>this.run('enabled'),'enabled '+this.css);}
    async click(){
      const point=await this.run('point');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
  }
  const initial=await send('Runtime.evaluate',{expression:'globalThis'});
  const objectId=initial.result.objectId;
  return {
    locator:css=>new Locator(css),
    snapshot:()=>evaluate(()=>document.body.innerText),
    isClosed:async()=>!(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.some(info=>info.targetId===targetId),
    waitForURL:url=>wait(()=>evaluate(expected=>location.href===expected,url),'popup URL'),
    waitForEvent:event=>{
      if(event!=='close')throw Error('Unsupported popup event');
      return wait(async()=>!(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.some(info=>info.targetId===targetId),'popup close');
    },
    async close(){await browserSession.send('Target.closeTarget',{targetId});},
  };
}
