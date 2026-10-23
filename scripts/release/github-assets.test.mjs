import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installerAssets,attachAssets} from './github.mjs';
const revision='a'.repeat(40), bytes=Buffer.from('verified installer'), sha256=createHash('sha256').update(bytes).digest('hex');
const asset={name:'installer.zip',bytes,sha256};
const row={name:asset.name,size:bytes.length,digest:`sha256:${sha256}`,state:'uploaded'};
test('installer selection verifies source, version and archive bytes; includes two archives and checksum list',async()=>{
 const deps={verifyRelease:async directory=>{const platform=directory.endsWith('windows')?'windows':'linux';return {product:'installer',platform,packageVersion:'0.1.13',sourceRevision:revision,files:[{name:`127vaults-installer-0.1.13-${platform}-x64.${platform==='windows'?'zip':'tar.gz'}`,sizeBytes:bytes.length,sha256}]};},readFile:async()=>bytes};
 const assets=await installerAssets('output','v0.1.13',revision,deps);
 assert.equal(assets.length,3);assert.equal(assets[2].name,'127vaults-installer-0.1.13-SHA256SUMS.txt');
 assert.ok(assets[2].bytes.toString().includes(sha256+'  '+assets[0].name));
 await assert.rejects(installerAssets('output','v0.1.13','b'.repeat(40),deps),/version\/source/);
 await assert.rejects(installerAssets('output','v0.1.13',revision,{...deps,readFile:async()=>Buffer.from('corrupt')}),/changed/);
});
test('attachment preview is read-only; publishing checks returned digest and safely resumes',async()=>{
 let uploads=0;
 const api={request:async()=>[],upload:async()=>{uploads++;return row;}};
 await attachAssets({id:1},[asset],'--plan',api);assert.equal(uploads,0);
 await attachAssets({id:1},[asset],'--publish',api);assert.equal(uploads,1);
 await attachAssets({id:1},[asset],'--publish',{...api,request:async()=>[row]});assert.equal(uploads,1);
 await assert.rejects(attachAssets({id:1},[asset],'--publish',{...api,request:async()=>[{...row,digest:'different'}]}),/differs/);assert.equal(uploads,1);
 await assert.rejects(attachAssets({id:1},[asset],'--publish',{...api,upload:async()=>({...row,size:0})}),/verification failed/);
});
test('preflight rejects all conflicting names before any upload',async()=>{
 let uploads=0;
 await assert.rejects(attachAssets({id:1},[{...asset,name:'first.zip'},asset],'--publish',{request:async()=>[{...row,state:'starter'}],upload:async()=>{uploads++;}}),/differs/);
 assert.equal(uploads,0);
});
