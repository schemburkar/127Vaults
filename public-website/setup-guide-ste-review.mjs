// Local editorial preview only. Production uses setup-guide.mjs.
const root=document.getElementById('setup-checklist');
const panels=[...root.querySelectorAll('[data-setup-step]')];
const key='127vaults.setup-ste-review.v1';
let step=0;
try {const saved=JSON.parse(localStorage.getItem(key));if(Number.isInteger(saved)&&saved>=0&&saved<panels.length)step=saved;} catch { /* Optional local review position. */ }
const back=root.querySelector('#setup-back'),next=root.querySelector('#setup-next'),finished=root.querySelector('#setup-finished');
function render(focus=false) {
  panels.forEach((panel,index)=>{panel.hidden=index!==step;});
  root.querySelector('#setup-progress').textContent=`Step ${step+1} of ${panels.length}`;
  root.querySelectorAll('[data-step-link]').forEach(link=>{if(link.dataset.stepLink===panels[step].id)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');});
  back.disabled=step===0;next.textContent=step===panels.length-1?'Finish':'Next';
  if(focus)panels[step].querySelector('h2').focus();
  try {localStorage.setItem(key,JSON.stringify(step));} catch { /* Optional local review position. */ }
}
function navigate(hash,focus=true) {
  const target=document.getElementById(hash.replace(/^#/,'')),panel=target?.closest('[data-setup-step]');
  const index=panels.indexOf(panel);if(index<0)return;
  step=index;finished.hidden=true;render(focus);
  if(target!==panel) {target.scrollIntoView({block:'start'});target.closest('details')?.setAttribute('open','');}
}
root.querySelector('.setup-navigation').hidden=false;
root.querySelectorAll('[data-step-link],[data-go-step]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();history.replaceState(null,'',link.hash);navigate(link.hash);}));
back.onclick=()=>{if(step>0){step--;finished.hidden=true;render(true);}};
next.onclick=()=>{if(step<panels.length-1){step++;finished.hidden=true;render(true);}else finished.hidden=false;};
root.querySelector('#setup-reset').onclick=()=>{step=0;finished.hidden=true;history.replaceState(null,'',location.pathname);render(true);};
root.querySelectorAll('pre').forEach(block=>{const button=document.createElement('button');button.type='button';button.className='setup-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy command');button.onclick=async()=>{try{await navigator.clipboard.writeText(block.querySelector('code').textContent);button.textContent='Copied';}catch{const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(block.querySelector('code'));selection.removeAllRanges();selection.addRange(range);button.textContent='Select and copy';}};block.append(button);});
render();if(location.hash)navigate(location.hash,false);
window.addEventListener('hashchange',()=>navigate(location.hash));
