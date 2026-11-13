// Shared customer-facing chrome. Authentication and entitlements stay with the
// existing route controllers; this module never requests or carries credentials.
document.body.classList.add('customer-portal','manage-page');
const main=document.querySelector('main');
main?.classList.add('portal-main');
let header=document.querySelector('.site-header');
if(!header){header=document.createElement('header');header.className='site-header';header.innerHTML='<div class="container header-inner"><a class="wordmark" href="/portal"><img class="brand-mark" src="brand-mark.svg" width="34" height="34" alt=""><span>127Vaults</span></a></div>';main.before(header);}
const inner=header.querySelector('.header-inner');
if(inner){
  inner.querySelector('.wordmark')?.setAttribute('href','/portal');
  for(const node of [...inner.children])if(!node.classList.contains('wordmark'))node.remove();
  const label=document.createElement('span');label.className='manage-product-label';label.textContent='Manage';
  const links=document.createElement('nav');links.className='manage-header-links';links.setAttribute('aria-label','Customer navigation');
  for(const [text,href]of [['My account','/portal'],['Setup guide','/setup-guide'],['Support','https://127vaults.com/support']]){const a=document.createElement('a');a.textContent=text;a.href=href;links.append(a);}inner.append(label,links);
}
if(!document.querySelector('.manage-footer')){
 const footer=document.createElement('footer');footer.className='manage-footer container';
 const note=document.createElement('span');note.textContent='127Vaults Manage · Your account and services';
 const links=document.createElement('div');for(const [text,href]of [['Privacy','https://127vaults.com/privacy'],['Terms','https://127vaults.com/terms'],['Support','https://127vaults.com/support']]){const a=document.createElement('a');a.textContent=text;a.href=href;links.append(a);}footer.append(note,links);document.body.append(footer);
}
if(location.pathname.startsWith('/trial')||location.pathname.startsWith('/billing')){
 const selected=new URLSearchParams(location.search).get('request');
 const back=document.querySelector('#back-to-portal')??document.createElement('a');
 back.className='manage-back';back.textContent='← Back to your account';back.href='/portal?view=subscriptions'+(/^[a-f0-9]{64}$/.test(selected??'')?'&request='+selected:'');if(!back.isConnected)main.prepend(back);
}

export function confirmManageAction(title,text){
 const trigger=document.activeElement;const dialog=document.createElement('dialog');dialog.className='manage-confirm';const heading=document.createElement('h2');heading.textContent=title;heading.id='manage-confirm-title';dialog.setAttribute('aria-labelledby',heading.id);const message=document.createElement('p');message.textContent=text;const actions=document.createElement('div');actions.className='portal-table-actions';
 return new Promise(resolve=>{let accepted=false;const cancel=document.createElement('button');cancel.type='button';cancel.className='button secondary';cancel.textContent='Keep unchanged';cancel.onclick=()=>dialog.close();const confirm=document.createElement('button');confirm.type='button';confirm.className='button primary';confirm.textContent=title;confirm.onclick=()=>{accepted=true;dialog.close();};actions.append(cancel,confirm);dialog.append(heading,message,actions);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();resolve(accepted);},{once:true});dialog.showModal();cancel.focus();});
}
