import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/app.tsx',import.meta.url),'utf8');
const open=source.slice(source.indexOf('  const openItem ='),source.indexOf('  const prepareMerge ='));
const begin=source.slice(source.indexOf('  const beginDraft ='),source.indexOf('  const beginEditing ='));
const edit=source.slice(source.indexOf('  const beginEditing ='),source.indexOf('  const cancelEditing ='));
const duplicate=source.slice(source.indexOf('  const duplicateItem ='),source.indexOf('  useEffect(',source.indexOf('  const duplicateItem =')));
for(const handler of ['beginEditing','beginNewItem','duplicateItem'])test(`late item load cannot overwrite ${handler} draft`,async()=>{
 let finish;const original={itemId:'fixture-item',title:'Reviewed item',website:'',username:'fixture',password:'synthetic',customFields:[]};
 const context=vm.createContext({selected:original,saving:false,editing:false,activeVaults:[{vaultId:'fixture-vault'}],viewMode:'single',vaultId:'fixture-vault',openRequest:{current:0},Set,structuredClone,
  confirmDiscard:()=>true,completeRelatedFields:fields=>fields,setItemType:fields=>fields,setFavorite:fields=>fields,
  loadItem:()=>new Promise(resolve=>{finish=resolve;}),setStatus:()=>{},
 });
 for(const name of ['setSelected','setEditing','setVaultId','setItemVaultId','setRevealed','setEditOriginal','setExpandedRelatedId'])context[name]=value=>{context[name.slice(3,4).toLowerCase()+name.slice(4)]=value;};
 const compiled=ts.transpileModule(open+begin+edit+duplicate+`\nglobalThis.open=openItem;globalThis.begin=${handler};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInContext(compiled,context);
 const pending=context.open({itemId:'fixture-item',vaultId:'fixture-vault'});context.begin();
 const draft=context.selected;assert.equal(context.editing,true);
 finish({...original,title:'Late server copy'});await pending;
 assert.equal(context.selected,draft);assert.equal(context.editing,true);
});
