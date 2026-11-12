import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { delegateClientDownloads } from '../src/client-download-delegation.mjs';
test('server delegates a limited client link without exposing its machine refresh credential',async()=>{
 const root=await mkdtemp(join(tmpdir(),'127v-delegate-')),file=join(root,'subscription.json'),token='b'.repeat(43),id='a'.repeat(64);
 try {await writeFile(file,JSON.stringify({refreshUrl:`https://manage.example.invalid/api/billing/${id}/refresh`,refreshToken:token}));
  const output=await delegateClientDownloads(file,async(url,options)=>{assert.equal(url.pathname,`/api/billing/${id}/client-link`);assert.equal(options.headers.Authorization,`Bearer ${token}`);assert.equal(options.redirect,'error');return Response.json({link:`https://manage.example.invalid/join#${id}.${'c'.repeat(43)}`,expiresAt:new Date(Date.now()+3600000).toISOString()});});
  assert.equal(output.scope,'client-downloads');assert.ok(!JSON.stringify(output).includes(token));
  await assert.rejects(delegateClientDownloads(file,async()=>Response.json({link:'https://evil.example/join',expiresAt:new Date().toISOString()})));
 }finally{await rm(root,{recursive:true,force:true});}
});
