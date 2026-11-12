import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareStoreReview} from './extension-review.mjs';
test('store preparation checks actual assets and refuses unreviewed permission expansion',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'127v-store-review-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const name of ['src','popup.html','manifest.json']) await cp(new URL('../../apps/extension/'+name,import.meta.url),join(dir,name),{recursive:true});
  assert.equal((await prepareStoreReview(dir)).distribution,'prepared-not-published');
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  manifest.permissions.push('history');await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(prepareStoreReview(dir),/review/);
});
