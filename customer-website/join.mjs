const $=id=>document.getElementById(id);
const match=/^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(location.hash.slice(1));
const link=match?`${location.origin}/join#${match[1]}.${match[2]}`:null;
history.replaceState(null,'',location.pathname);
const steps=['Client installed','Server connection imported and verified','Vault account ready','This device approved','Vault opened successfully'];
let progress=[];
try { const saved=JSON.parse(localStorage.getItem('127v-join-progress')??'[]'); if(Array.isArray(saved)) progress=saved.filter(n=>Number.isInteger(n)&&n>=0&&n<steps.length); } catch { /* Optional local notes only. */ }
steps.forEach((text,index)=>{const row=document.createElement('li'),label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=progress.includes(index);box.onchange=()=>{progress=box.checked?[...new Set([...progress,index])]:progress.filter(v=>v!==index);try {localStorage.setItem('127v-join-progress',JSON.stringify(progress));}catch{}};label.append(box,document.createTextNode(' '+text));row.append(label);$('join-checklist').append(row);});
$('join-os').value=/Win/i.test(navigator.platform)?'windows':/Mac/i.test(navigator.platform)?'macos':'linux';
$('copy-join-link').disabled=!link;
$('copy-join-link').onclick=async()=>{try {await navigator.clipboard.writeText(link);$('join-status').textContent='Client-only link copied. It expires after seven days or when revoked by the operator.';}catch{$('join-status').textContent='Clipboard unavailable. Reopen the link from your administrator and copy its full address.';}};
let artifacts=[];
async function request(action) {
  if(!match)throw Error('Reopen the full joining link shared by your administrator.');
  const response=await fetch(`/api/trials/${match[1]}/client-${action}`,{headers:{Authorization:`Bearer ${match[2]}`},credentials:'omit',cache:'no-store'});
  if(!response.ok)throw Error('This client download link is unavailable or expired. Ask your administrator for a fresh joining link.');
  return response;
}
function render(){
  $('join-downloads').replaceChildren();
  const os=$('join-os').value;
  const choices=artifacts.filter(v=>!v.supporting&&(v.platform?.includes(os)||v.platform==='all'||v.product==='extension')).sort((a,b)=>Number(b.product==='installer')-Number(a.product==='installer'));
  if(!choices.length){$('join-downloads').textContent='No compatible client package is published for this operating system. Choose another system or ask your administrator.';return;}
  for(const asset of choices){const row=document.createElement('p'),button=document.createElement('button');button.type='button';button.className='button '+(asset.product==='installer'?'primary':'secondary');button.textContent=asset.product==='installer'?'Download recommended installer':`Download ${asset.label??asset.product}`;button.onclick=async()=>{button.disabled=true;try{const response=await request(`artifacts/${asset.id}`);const blob=await response.blob();if(blob.size!==asset.sizeBytes)throw Error('Download incomplete. Try again.');const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const hex=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');if(hex!==asset.sha256)throw Error('Download verification failed. Ask your administrator.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=asset.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('join-status').textContent='Verified download ready. Follow the installer, then continue your checklist.';}catch(e){$('join-status').textContent=e.message;}finally{button.disabled=false;}};row.append(button);$('join-downloads').append(row);}
}
$('join-os').onchange=render;
request('installer').then(r=>r.json()).then(value=>{artifacts=value.artifacts;$('join-status').textContent='Client-only access confirmed. Choose your operating system below.';render();}).catch(e=>{$('join-status').textContent=e.message;});
