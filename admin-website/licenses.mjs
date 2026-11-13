import {adminReady,adminFetch} from './admin-shell.mjs';
import {loadRequests} from './request-data.mjs';
import {createDataView,identity,badge,actionButton,el} from './workspace-ui.mjs';
import {requestDrawer} from './request-drawer.mjs';
const host=document.getElementById('inbox'),open=requestDrawer(refresh);
const grid=createDataView(host,{title:'Licenses',searchLabel:'Search licenses by customer or installation ID',searchText:r=>[r.email,r.contactName,r.installationId,r.plan].join(' '),
  views:[{id:'all',label:'All installations',test:()=>true},{id:'current',label:'Within expiry',test:r=>Date.parse(r.expiresAt)>Date.now()},{id:'expired',label:'Expired',test:r=>Date.parse(r.expiresAt)<=Date.now()}],
  columns:[{key:'email',label:'Customer',render:r=>identity(r.contactName||r.email,r.contactName?r.email:'Self-hosted installation')},
    {key:'plan',label:'Plan',render:r=>badge(r.plan)},{key:'maxUsers',label:'User limit'},
    {key:'installationId',label:'Installation',render:r=>{const code=el('code',r.installationId.slice(0,8)+'…'+r.installationId.slice(-6));code.title=r.installationId;return code;}},
    {key:'expiresAt',label:'License expiry',render:r=>r.expiresAt?new Date(r.expiresAt).toLocaleDateString():'Unavailable'},
    {key:'state',label:'Status',render:r=>badge(r.state==='closed'?'Access closed':!r.expiresAt?'Expiry unavailable':Date.parse(r.expiresAt)<=Date.now()?'Expired':'Within expiry',r.state==='closed'?'':Date.parse(r.expiresAt)>Date.now()?'success':'warning')}],
  toolbarActions:[actionButton('Refresh',refresh)],onOpen:open,empty:'No activated server licenses. Approvals and invitations are managed in Access requests.'});
async function refresh(){try{const data=await loadRequests(adminFetch);grid.setRows(data.requests.filter(r=>r.installationId));}catch(error){host.prepend(el('p',error.message,'workspace-error'));}}
adminReady.then(ready=>{if(ready)return refresh();});
