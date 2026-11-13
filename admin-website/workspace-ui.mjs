let sequence = 0;
export const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export const badge = (text, tone = '') => el('span', String(text)==='cli'?'CLI':String(text).replaceAll('_',' '), `workspace-badge ${tone}`);
export function identity(name, detail) {
  const box = el('div', undefined, 'record-identity');
  box.append(el('strong', name), el('small', detail)); return box;
}
export function pageActions() {
  return document.querySelector('.page-actions');
}
export function actionButton(label, work, primary = false) {
  const button = el('button', label, primary ? 'button primary' : 'desk-button'); button.type = 'button';
  button.addEventListener('click', () => work(button)); return button;
}
export function confirmOperation(title, description, trigger = document.activeElement) {
  const dialog=el('dialog',undefined,'request-confirm');
  const heading=el('h2',title), message=el('p',description), actions=el('div',undefined,'trial-actions');
  heading.id=`confirmation-${++sequence}`;dialog.setAttribute('aria-labelledby',heading.id);
  return new Promise(resolve=>{
    let accepted=false;
    const cancel=actionButton('Cancel',()=>dialog.close());
    const confirm=actionButton(title,()=>{accepted=true;dialog.close();},true);
    actions.append(cancel,confirm);dialog.append(heading,message,actions);document.body.append(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();resolve(accepted);setTimeout(()=>{if(trigger?.isConnected&&!trigger.disabled)trigger.focus();},0);},{once:true});
    dialog.showModal();cancel.focus();
  });
}
export function createDrawer() {
  const dialog = el('dialog', undefined, 'workspace-drawer license-drawer');
  const id = `drawer-${++sequence}`;
  const header = el('header', undefined, 'drawer-header');
  const heading = el('div'), eyebrow = el('span', 'RECORD DETAILS', 'drawer-eyebrow'), title = el('h2'), context = el('p');
  title.id = id; dialog.setAttribute('aria-labelledby', id); heading.append(eyebrow, title, context);
  const close = actionButton('Close', () => dialog.close()); close.setAttribute('aria-label', 'Close record details');
  header.append(heading, close);
  const actions = el('div', undefined, 'drawer-actions');
  const body = el('div', undefined, 'drawer-body license-drawer-content');
  const footer = el('footer', undefined, 'drawer-footer');
  dialog.append(header, actions, body, footer); document.body.append(dialog);
  let trigger, recordKey;
  dialog.addEventListener('close', () => {
    dialog.dispatchEvent(new Event('drawer-dismiss'));
    const replacement = [...document.querySelectorAll('[data-record-key]')].find(node => node.dataset.recordKey === recordKey);
    (trigger?.isConnected ? trigger : replacement)?.focus();
  });
  document.addEventListener('admin-session-ended', () => { if (dialog.open) dialog.close(); body.replaceChildren(); actions.replaceChildren(); footer.replaceChildren(); });
  return {dialog, body, actions, footer,
    setTitle(name, detail = '', category = 'RECORD DETAILS') { title.textContent = name; context.textContent = detail; eyebrow.textContent = category; },
    open(button, key) { trigger = button; recordKey = key; if (!dialog.open) dialog.showModal(); },
    close() { if (dialog.open) dialog.close(); },
  };
}

// Keep the original select as the form value; replace its presentation with a
// searchable combobox. All text is inserted as text, including provider labels.
export function enhanceSelect(select, { placeholder = 'Search options…', describe = () => '' } = {}) {
  if (select.dataset.enhanced) return;
  select.dataset.enhanced = 'true'; select.hidden = true;
  const wrapper = el('div', undefined, 'rich-lookup');
  const input = el('input'); input.type = 'text'; input.placeholder = placeholder; input.autocomplete = 'off';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || placeholder);
  const list = el('div', undefined, 'lookup-results'); list.id = `lookup-${++sequence}`; list.hidden = true; list.setAttribute('role', 'listbox'); list.setAttribute('popover','manual');
  input.setAttribute('aria-controls', list.id);
  const marker = el('span', '⌄', 'lookup-caret'); marker.setAttribute('aria-hidden', 'true');
  wrapper.append(input, marker, list); select.after(wrapper);
  let active = -1, options = [];
  const selectedText = () => select.selectedOptions[0]?.value ? select.selectedOptions[0].textContent : '';
  const close = () => { if(list.matches(':popover-open'))list.hidePopover(); list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const choose = option => { select.value = option.value; input.value = option.textContent; close(); select.dispatchEvent(new Event('change', {bubbles:true})); input.focus(); };
  function render(query = '') {
    list.replaceChildren(); active = -1;
    options = [...select.options].filter(option => option.value && !option.disabled && `${option.textContent} ${describe(option)}`.toLowerCase().includes(query.toLowerCase()));
    for (const [index, option] of options.entries()) {
      const item = el('button', undefined, 'lookup-option'); item.type = 'button'; item.tabIndex = -1;
      item.id = `${list.id}-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.value === select.value));
      item.append(el('strong', option.textContent)); const detail = describe(option); if (detail) item.append(el('small', detail));
      item.addEventListener('mousedown', event => event.preventDefault()); item.addEventListener('click', () => choose(option)); list.append(item);
    }
    if (!options.length) list.append(el('p', 'No matches. Try another name or email.', 'lookup-empty'));
    list.hidden = false; if(!list.matches(':popover-open'))list.showPopover();
    const rect=input.getBoundingClientRect(),below=innerHeight-rect.bottom-12,above=rect.top-12;
    const height=Math.min(280,Math.max(below,above));list.style.left=rect.left+'px';list.style.width=rect.width+'px';list.style.maxHeight=height+'px';list.style.top=(below<180&&above>below?Math.max(8,rect.top-Math.min(height,list.scrollHeight)-6):rect.bottom+6)+'px';
    input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('focus', () => render());
  input.addEventListener('click',()=>{if(list.hidden)render();});
  input.addEventListener('input', () => { if (select.value) { select.value = ''; select.dispatchEvent(new Event('change', {bubbles:true})); } render(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = selectedText(); close(); }
    if (['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault(); if (list.hidden) render(); if (!options.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      [...list.children].forEach((node,index) => node.classList.toggle('lookup-active', index === active));
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`); list.children[active]?.scrollIntoView({block:'nearest'});
    }
    if (event.key === 'Enter' && !list.hidden) { event.preventDefault(); if (options[active]) choose(options[active]); }
    if (event.key === 'Tab') { input.value = selectedText(); close(); }
  });
  document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
  wrapper.closest('dialog')?.addEventListener('close',close);
  input.addEventListener('blur', () => { input.value = selectedText(); close(); });
  select.addEventListener('change', () => { if (document.activeElement !== input) input.value = selectedText(); });
  new MutationObserver(() => { input.value = selectedText(); input.disabled = select.disabled; }).observe(select, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  input.value = selectedText(); input.disabled = select.disabled;
  return { input, refresh() { input.value = selectedText(); close(); } };
}

export function matchRecords(rows, query, text = row => Object.values(row).filter(value => typeof value !== 'object').join(' ')) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => words.every(word => text(row).toLocaleLowerCase().includes(word)));
}

export function createDataView(host, { title, columns, searchLabel, searchText, views = [], onOpen, empty = 'No records yet.', toolbarActions = [], defaultSort = {} }) {
  let initialized = false, rows = [], view = views[0]?.id, query = '', page = 0, sortKey = defaultSort.key??'', direction = defaultSort.direction??1;
  const size = 12;
  const root = el('section', undefined, 'data-view'), tabs = el('div', undefined, 'view-tabs'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label', `${title} views`);
  const toolbar = el('div', undefined, 'grid-toolbar'), search = el('input'); search.type='search'; search.placeholder=searchLabel; search.setAttribute('aria-label',searchLabel);
  const searchWrap=el('label',undefined,'grid-search'); searchWrap.append(el('span','⌕'),search);
  const tools=el('div',undefined,'grid-tools'); const clear=actionButton('Clear search',()=>{query='';search.value='';page=0;render();search.focus();});tools.append(clear,...toolbarActions); toolbar.append(searchWrap,tools);
  const result = el('p',undefined,'grid-result'); result.setAttribute('role','status');
  const wrap=el('div',undefined,'request-table-wrap'), table=el('table',undefined,'request-table workspace-table');
  const thead=el('thead'), header=el('tr'), body=el('tbody');
  for(const column of columns) {
    const th=el('th'); th.scope='col';
    const button=actionButton(column.label,()=>{direction=sortKey===column.key?-direction:1;sortKey=column.key;page=0;render();});
    button.className='column-sort'; th.append(button); th.dataset.key=column.key;header.append(th);
  }
  const th=el('th','Actions','grid-actions-heading');th.scope='col';header.append(th);thead.append(header);table.append(thead,body);wrap.append(table);
  const footer=el('footer',undefined,'grid-footer'), range=el('span'), paging=el('div');
  const previous=actionButton('Previous',()=>{page--;render();}), next=actionButton('Next',()=>{page++;render();});paging.append(previous,next);footer.append(range,paging);
  root.append(tabs,toolbar,result,wrap,footer);host.replaceChildren(root);
  function render() {
    clear.hidden=!query;
    tabs.replaceChildren();
    for(const item of views) {const count=rows.filter(item.test).length;const button=actionButton(`${item.label}  ${count}`,()=>{view=item.id;page=0;render();});button.setAttribute('aria-pressed',String(view===item.id));tabs.append(button);}
    const selected=views.find(item=>item.id===view);let filtered=matchRecords(selected?rows.filter(selected.test):rows,query,searchText);
    if(sortKey) {const column=columns.find(item=>item.key===sortKey); filtered=[...filtered].sort((a,b)=>String(column.value?.(a)??a[sortKey]??'').localeCompare(String(column.value?.(b)??b[sortKey]??''),undefined,{numeric:true})*direction);}
    page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1)));
    body.replaceChildren();
    for(const row of filtered.slice(page*size,(page+1)*size)) {
      const tr=el('tr'); for(const column of columns) {const td=el('td');const value=column.render?column.render(row):row[column.key]??'—';value instanceof Node?td.append(value):td.textContent=String(value);tr.append(td);}
      const td=el('td',undefined,'grid-row-actions');const open=actionButton('Open →',button=>onOpen(row,button));open.setAttribute('aria-label',`Open ${row.email??row.to??row.slug??row.code??row.label??row.id}`);open.dataset.recordKey=row.id??row.slug;td.append(open);tr.append(td);body.append(tr);
    }
    if(!filtered.length){const tr=el('tr'),td=el('td',!initialized?'Loading records…':query?'No matching records. Clear your search or change the view.':empty,'grid-empty');td.colSpan=columns.length+1;tr.append(td);body.append(tr);}
    const countTitle=filtered.length===1?title.toLowerCase().replace(/s$/,''):title.toLowerCase();
    result.textContent=!initialized?'Loading records…':query?`${filtered.length} matching ${countTitle} · Searching for “${query}”`:`${filtered.length} ${countTitle} · ${selected?.label??'All records'}`;
    range.textContent=filtered.length?`${page*size+1}–${Math.min((page+1)*size,filtered.length)} of ${filtered.length}`:'0 records';
    previous.disabled=page===0;next.disabled=(page+1)*size>=filtered.length;
    for(const node of header.children)if(node.dataset.key)node.setAttribute('aria-sort',node.dataset.key===sortKey?(direction===1?'ascending':'descending'):'none');
  }
  search.addEventListener('input',()=>{query=search.value;page=0;render();});
  render();return {setRows(value){initialized=true;rows=value;render();},root};
}

export function formatBytes(value) {
  if(!Number.isFinite(value)||value<0)return 'Unavailable';
  if(value<1024)return value+' B';
  if(value<1048576)return (value/1024).toFixed(1)+' KB';
  if(value<1073741824)return (value/1048576).toFixed(1)+' MB';
  return (value/1073741824).toFixed(1)+' GB';
}

export function formatMinorAmount(amount,currency,locale) {
  if(!Number.isSafeInteger(amount))return 'Unavailable';
  if(!/^[A-Z]{3}$/.test(currency??''))return amount+' minor units (currency unavailable)';
  try{const format=new Intl.NumberFormat(locale,{style:'currency',currency});return format.format(amount/10**format.resolvedOptions().maximumFractionDigits);}catch{return amount+' '+currency+' minor units';}
}
