// Build a local controlled form; no website account or credential service.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
const output=resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Supply a new external fixture output file.');
const repository=resolve(import.meta.dirname,'..'),rel=relative(repository,output);
if(!rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`))throw Error('Fixture must be outside the checkout.');
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {build}=await import(pathToFileURL(require.resolve('vite')));
const directory=await mkdtemp(join(tmpdir(),'127vaults-react-form-')),entry=join(directory,'form.mjs');
try{
 await writeFile(entry,`import React from 'react';import {createRoot} from 'react-dom/client';
 function Form(){const [username,setUsername]=React.useState(''),[password,setPassword]=React.useState(''),[tick,setTick]=React.useState(0);return React.createElement('form',null,
 React.createElement('input',{name:'username',autoComplete:'username',value:username,onChange:event=>setUsername(event.target.value)}),
 React.createElement('input',{name:'password',type:'password',autoComplete:'current-password',value:password,onChange:event=>setPassword(event.target.value)}),
 React.createElement('button',{id:'rerender',type:'button',onClick:()=>setTick(tick+1)},'Rerender '+tick));}
 createRoot(document.querySelector('#controlled')).render(React.createElement(Form));`);
 const result=await build({configFile:false,root:resolve(repository,'apps/web'),logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:[{find:/^react$/,replacement:require.resolve('react')},{find:/^react-dom\/client$/,replacement:require.resolve('react-dom/client')}]},build:{write:false,minify:true,lib:{entry,formats:['iife'],name:'FictitiousControlledForm'}}});
 const bundle=(Array.isArray(result)?result[0]:result).output.find(file=>file.type==='chunk');
 await writeFile(output,bundle.code,{flag:'wx'});
 console.log('Synthetic React controlled-form fixture built.');
}finally{await unlink(entry);await rmdir(directory);}
