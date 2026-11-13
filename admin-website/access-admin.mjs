import {adminReady,adminFetch} from './admin-shell.mjs';
import {loadRequests} from './request-data.mjs';
import {createDataView,identity,badge,actionButton,el} from './workspace-ui.mjs';
import {requestDrawer} from './request-drawer.mjs';
const host=el('div');document.getElementById('inbox').before(host);
for(const id of ['inbox','customer-email-status','desk-status','invitation','confirm-action'])document.getElementById(id).hidden=true;
const open=requestDrawer(refresh);
const grid=createDataView(host,{
  title:'Requests',defaultSort:{key:'receivedAt',direction:-1},searchLabel:'Search requests by customer, email or organization',
  searchText:row=>[row.email,row.contactName,row.organization,row.plan,row.state,row.id].join(' '),
  views:[{id:'inbox',label:'Inbox',test:r=>!r.archivedAt},{id:'pending',label:'Needs review',test:r=>r.state==='requested'&&!r.archivedAt},{id:'approved',label:'Approved',test:r=>r.state==='approved'&&!r.archivedAt},{id:'archived',label:'Archived',test:r=>Boolean(r.archivedAt)}],
  columns:[{key:'email',label:'Customer',render:r=>identity(r.contactName||r.email,r.contactName?r.email:r.organization||'Individual customer')},
    {key:'plan',label:'Plan',render:r=>badge(r.plan)},
    {key:'state',label:'Status',render:r=>badge(r.state==='requested'?'Needs review':r.state,r.state==='approved'?'success':'')},
    {key:'receivedAt',label:'Requested',render:r=>new Date(r.receivedAt).toLocaleDateString()},
    {key:'maxUsers',label:'Users',render:r=>r.maxUsers??r.requestedSeats??'—'},
    {key:'emailState',label:'Invitation',render:r=>r.canPreviewInvitation?(Date.parse(r.linkExpiresAt)>Date.now()?'Link valid':'Link expired'):'Not issued'}],
  onOpen:open,toolbarActions:[actionButton('Refresh',refresh),actionButton('Export',async()=>{const response=await adminFetch('/api/access-admin/requests');if(!response.ok)return;const url=URL.createObjectURL(await response.blob());const a=el('a');a.href=url;a.download='127vaults-access-requests.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})]
});
async function refresh(){try{const data=await loadRequests(adminFetch);grid.setRows(data.requests);return data;}catch(error){host.prepend(el('p',error.message,'workspace-error'));}}
adminReady.then(async ready=>{if(!ready)return;const data=await refresh();const id=new URLSearchParams(location.search).get('request');const row=data?.requests.find(r=>r.id===id);if(row)open(row);});
