// Local review of the actual before/after React builds with disposable demo data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const fixture = `
const $ = id => document.getElementById(id);
const send = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const items = [
  {itemId:'email', vaultId:'private', index:{title:'Personal email',website:'https://mail.example.com',itemType:'login',favorite:true},body:{username:'alex@example.com',password:'demo-email-password',customFields:[]}},
  {itemId:'design', vaultId:'work', index:{title:'Design workspace',website:'https://design.example.com',itemType:'login',favorite:false},body:{username:'alex@studio.example',password:'demo-design-password',customFields:[{id:'team',label:'Team',type:'text',value:'Product design'}]}},
  {itemId:'hosting',vaultId:'work',index:{title:'Cloud hosting',website:'https://cloud.example.com',itemType:'login'},body:{username:'alex@studio.example',password:'demo-hosting-password',customFields:[]}},
  {itemId:'wifi',vaultId:'private',index:{title:'Home Wi-Fi',website:'',itemType:'wifi'},body:{username:'',password:'demo-wifi-password',customFields:[{id:'__127vaults_type',label:'Type',type:'metadata',value:'wifi'},{id:'ssid',label:'Network',type:'text',value:'Home network'}]}},
  {itemId:'bank',vaultId:'private',index:{title:'Everyday banking',website:'https://bank.example.com',itemType:'login'},body:{username:'alex.personal',password:'demo-bank-password',customFields:[]}}
];
let selected = null, filter = 'all';
const settings = {settings:{collections:[{id:'daily',name:'Daily essentials',vault_ids:['private','work']}],default_view:{kind:'all'}},view:{kind:'all'}};
window.__vaultsSettings = settings;
window.__vaultsSnapshot = [{vaultId:'private',name:'Personal',selected:false},{vaultId:'work',name:'Work',selected:false}];
function render() {
 const query=$('search').value.toLowerCase();
 const rows=items.filter(item=>(filter==='all'||filter==='daily'||filter==='favorites'&&item.index.favorite||item.vaultId===filter)&&item.index.title.toLowerCase().includes(query)).map(item=>({row:{itemId:item.itemId,vaultId:item.vaultId,code:'ITEM-'+item.itemId.toUpperCase(),updatedAt:1791648000000},index:item.index}));
 send('vaults:items',{items:rows,actions:[],selectedId:selected?.itemId||null,empty:'No matching items.',favoriteView:filter==='favorites'});
}
function show(item) {
 selected=item; $('item-empty').hidden=!item; $('item-view').hidden=!item; $('item-form').hidden=true;
 if(item){ $('item-empty').hidden=true; $('view-title').textContent=item.index.title;$('view-type').textContent='LOGIN';$('view-url').textContent=item.index.website;$('view-url').href=item.index.website||'#';$('view-username').textContent=item.body.username||'—';$('view-password').textContent='••••••••••••';send('vaults:view-fields',{fields:item.body.customFields,password:item.body.password}); }
 else {$('item-empty').hidden=false;send('vaults:view-fields',{fields:[],password:''});}
 send('vaults:detail-item',item);render();
}
function select(view) { filter=view; settings.view=view==='all'?{kind:'all'}:view==='daily'?{kind:'collection',id:view}:{kind:'vault',id:view};send('vaults:settings',settings);show(null);$('vault-title').textContent=view==='private'?'Personal':view==='work'?'Work':view==='daily'?'Daily essentials':view==='favorites'?'Favorites':'All items'; }
window.__vaultsActions={openItem:({row})=>show(items.find(item=>item.itemId===row.itemId)),openWorkspaceItem:tab=>show(items.find(item=>item.itemId===tab.itemId)),closeWorkspaceItem:()=>{show(null);return true;},selectVault:select,selectBrowseView:view=>select(view.kind==='all'?'all':view.id),copyField:async value=>{await navigator.clipboard.writeText(value);setTimeout(()=>navigator.clipboard.writeText('').catch(()=>{}),30000);},runAction:()=>{}};
setTimeout(()=>{
 $('entry-shell').hidden=true; $('vault').hidden=false;
 $('vault-title').textContent='All items';$('vault-state').textContent='5 items · 2 vaults';$('nav-count').textContent='5';$('session-dates').textContent='Up to date · Server sync 10:30 AM';
 send('vaults:vaults',window.__vaultsSnapshot);send('vaults:settings',settings);
 $('nav-all-items').onclick=()=>select('all');$('nav-favorites').onclick=()=>select('favorites');$('search').oninput=render;$('close-item-detail').onclick=()=>show(null);
 $('copy-username').onclick=()=>window.__vaultsActions.copyField(selected?.body.username);$('copy-password').onclick=()=>window.__vaultsActions.copyField(selected?.body.password);$('reveal-password').onclick=()=>{$('view-password').textContent=$('view-password').textContent.startsWith('•')?selected.body.password:'••••••••••••';};
 $('lock-app').onclick=()=>{send('vaults:locked');show(null);};
 show(location.port === "12890" ? items[1] : items[0]);
 if(location.search.includes('review=updated')) {
   const click = label => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()===label)?.click();
   setTimeout(()=>click('Keep in tab'),50);
   setTimeout(()=>show(items[1]),100);
   setTimeout(()=>{click('Keep in tab');if(innerWidth>800) document.querySelector('[aria-label="Collapse sidebar"]')?.click();window.__workspacePreviewReady=true;},150);
 } else window.__workspacePreviewReady=true;
},150);
`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const comparison = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>127Vaults · Web preview</title><style>body{margin:0;padding:24px;background:#080c1d;color:#f1f5f9;font:15px system-ui}h1{font-size:24px;margin:0 0 8px}p{color:#94a3b8}button,a{color:#e0bb95;background:#11162b;border:1px solid #ffffff25;border-radius:8px;padding:9px 14px;cursor:pointer;text-decoration:none;margin-right:8px}nav{margin:20px 0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{min-width:0}h2{font-size:17px}.frame{overflow:hidden;border:1px solid #ffffff22;border-radius:12px;background:#11162b;height:460px;position:relative}iframe{border:0;position:absolute;top:0;left:0;transform-origin:top left}.mobile .frame{height:844px;width:390px;max-width:100%}.mobile iframe{width:390px!important;height:844px!important;transform:none!important}@media(max-width:850px){.compare{grid-template-columns:1fr}}</style></head><body><h1>127Vaults web: existing and updated</h1><p>Actual app builds with synthetic demo items. Desktop is committed; these web changes await your confirmation.</p><nav><button onclick="mode(false)">Desktop</button><button onclick="mode(true)">Mobile</button><a href="http://127.0.0.1:12890" target="_blank">Open existing</a><a href="http://127.0.0.1:12891" target="_blank">Open updated</a></nav><div class="compare"><section class="card"><h2>Existing</h2><div class="frame"><iframe title="Existing web app" src="http://127.0.0.1:12890"></iframe></div></section><section class="card"><h2>Updated</h2><div class="frame"><iframe title="Updated web app" src="http://127.0.0.1:12891?review=updated"></iframe></div></section></div><p>Updated: collapse the sidebar, keep multiple items in tabs, or open an item in a separate window. Mobile: close details to return to items, then use Vaults to open navigation.</p><script>function scale(){document.querySelectorAll('iframe').forEach(frame=>{frame.style.width='1600px';frame.style.height='950px';frame.style.transform='scale('+frame.parentElement.clientWidth/1600+')';frame.parentElement.style.height=document.body.classList.contains('mobile')?'844px':(950*frame.parentElement.clientWidth/1600)+'px'})}function mode(mobile){document.body.classList.toggle('mobile',mobile);scale()}addEventListener('resize',scale);scale();</script></body></html>`;
for (const [port, directory] of [[12890, '.tools/item-workspace-preview/existing'], [12891, 'apps/web/dist']]) {
  const root = resolve(directory);
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/app/mvp-client.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(fixture); return; }
      const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end(); }
  }).listen(port, '127.0.0.1');
}
createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(comparison); }).listen(12889, '127.0.0.1');
console.log('Comparison http://127.0.0.1:12889 · Existing :12890 · Updated :12891');
