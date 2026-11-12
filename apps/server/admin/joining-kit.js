import { requestAdmin } from './api.js';
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function validJoiningLink(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&u.pathname==='/join'&&/^#[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(u.hash);}catch{return false;}
}
export function joiningMessage(invitation,downloads) {
  return `You are invited to our private 127Vaults server.\n\n1. Open your account invitation in a browser that trusts our server: ${invitation}\n2. Install the client for your computer: ${downloads||'Ask me for the protected client download link.'}\n3. In Desktop choose Import server connection and select the attached .127vaults-server file. Check the server name and address.\n4. Register Desktop with your vault username and approve its code in your web vault on an already trusted device.\n\nYour account invitation, client download link and connection file have different purposes. Never send your account secret or master password to anyone.`;
}
export function appendJoiningKit(output,session,invitation) {
  const section=node('section'),title=node('h3','Share the joining kit'),description=node('p','Send the account invitation, protected client download link and public connection file through your trusted channel. No purchaser credentials are shared.');
  const download=node('button','Download server connection file');download.type='button';download.className='button primary';
  const fetchLink=node('button','Create client-only download link');fetchLink.type='button';fetchLink.className='button';
  const label=node('label','Client download link (or paste one created in Manage)');label.className='field';
  const field=node('input');field.type='url';field.placeholder='https://manage.127vaults.com/join#…';label.append(field);
  const copy=node('button','Copy complete joining instructions');copy.type='button';copy.className='button';
  const status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const preview=node('textarea');preview.readOnly=true;preview.rows=10;preview.setAttribute('aria-label','Joining instructions');
  const update=()=>{preview.value=joiningMessage(invitation,validJoiningLink(field.value)?field.value:'');};field.oninput=update;update();
  download.onclick=async()=>{download.disabled=true;try{const value=await requestAdmin('server-connection');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download='127vaults.127vaults-server';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Attach this public connection file to your message.';}catch{status.textContent='Connection export unavailable. Check this server’s public CA configuration.';}finally{download.disabled=false;}};
  fetchLink.onclick=async()=>{fetchLink.disabled=true;try{const result=await requestAdmin('client-downloads',{method:'POST',headers:{'Content-Type':'application/json','X-127v-admin-csrf':session.csrf},body:'{}'});field.value=result.link;update();status.textContent='Client-only access expires '+new Date(result.expiresAt).toLocaleString()+'.';}catch{status.textContent='This installation has no automatic client-download delegation. In Manage, choose Share client downloads for your approved order, then paste that client-only link here.';}finally{fetchLink.disabled=false;}};
  copy.onclick=async()=>{if(field.value&&!validJoiningLink(field.value)){status.textContent='Use a client-only /join link, not a purchaser setup or billing link.';return;}update();try{await navigator.clipboard.writeText(preview.value);status.textContent='Joining instructions copied. Attach the connection file separately.';}catch{preview.focus();preview.select();status.textContent='Copy the selected instructions.';}};
  section.append(title,description,download,fetchLink,label,copy,status,preview);output.append(section);
}
