import { adminFetch } from './admin-shell.mjs';
import { createDrawer, el } from './workspace-ui.mjs';
export function requestDrawer(onChange) {
  const drawer=createDrawer(); let desk,version=0;
  drawer.dialog.addEventListener('drawer-dismiss',()=>{version++;desk?.close();});
  document.addEventListener('admin-session-ended',()=>{version++;desk=null;});
  return async (row,button)=>{
    const ticket=++version;
    drawer.setTitle(row.contactName||row.email,`${row.email} · ${row.plan} · Request ${row.id.slice(-8)}`,'CUSTOMER ACCESS');
    drawer.open(button,row.id);
    try {
      if(!desk){
        drawer.body.replaceChildren(el('p','Loading request…'));
        const response=await adminFetch('/access-admin');if(ticket!==version)return;if(!response.ok)throw Error('Request details could not be loaded.');
        const html=await response.text();if(ticket!==version)return;const doc=new DOMParser().parseFromString(html,'text/html');
        const main=doc.querySelector('main'),confirmation=doc.querySelector('#confirm-action');
        if(!main||!confirmation)throw Error('Request details are unavailable.');
        drawer.body.replaceChildren(...main.childNodes,confirmation);
        drawer.body.classList.add('record-access-details');
        const {mountAccessDesk}=await import('./access-desk.mjs');if(ticket!==version)return;
        desk=mountAccessDesk(drawer.body,{embedded:true,onChange});
      }
      await desk.select(row.id);
    }catch(error){if(ticket===version){drawer.body.textContent=error.message;desk=null;}}
  };
}
