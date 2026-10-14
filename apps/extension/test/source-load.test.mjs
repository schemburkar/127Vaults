import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/popup.mjs',import.meta.url),'utf8');
function harness(){
 const elements=Object.fromEntries(['results','native-unlock','lock-vault','source-select','source-state','open-vault','setup'].map(id=>[id,{hidden:false,value:'desktop'}]));
 const requests=[],messages=[];
 const context=vm.createContext({$:id=>elements[id],selectedSource:null,sourceLoadRevision:0,localSources:[{id:'desktop',active:true},{id:'cli',active:true}],vaultOrigin:null,items:[],savedPasskeyEntries:[],targetTab:{id:1,url:'https://fixture.invalid'},originOf:value=>value,sourceStatus:row=>row.id,errorMessage:error=>error.message,licenseNotice:()=>'',renderItems:()=>{},passkeys:{refreshSaved:async()=>{}},status:value=>messages.push(value),native:request=>new Promise((resolve,reject)=>requests.push({...request,resolve,reject}))});
 vm.runInContext(source.slice(source.indexOf('async function loadSelectedSource()'),source.indexOf('async function refresh()')),context);
 return {context,elements,requests,messages};
}
test('a late previous-source result cannot replace the selected source items',async()=>{
 const h=harness();const first=vm.runInContext('loadSelectedSource()',h.context);h.elements['source-select'].value='cli';const second=vm.runInContext('loadSelectedSource()',h.context);
 h.requests[1].resolve([{title:'CLI fixture'}]);await second;h.requests[0].resolve([{title:'Desktop fixture'}]);await first;
 assert.equal(vm.runInContext('selectedSource',h.context),'cli');assert.equal(vm.runInContext('items[0].title',h.context),'CLI fixture');
});
test('a previous source failing late cannot show an error for the working source',async()=>{
 const h=harness();const first=vm.runInContext('loadSelectedSource()',h.context);h.elements['source-select'].value='cli';const second=vm.runInContext('loadSelectedSource()',h.context);
 h.requests[1].resolve([{title:'CLI fixture'}]);await second;h.requests[0].reject(Error('old source locked'));await first;
 assert.equal(h.messages.length,0);assert.equal(vm.runInContext('items[0].title',h.context),'CLI fixture');
});

