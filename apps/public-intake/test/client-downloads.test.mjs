import test from 'node:test';
import assert from 'node:assert/strict';
import { clientArtifact, clientGrant, issueClientLink } from '../cloudflare/client-downloads.mjs';
test('client download delegation is bounded, revocable, parent-bound and contains no owner credential',async()=>{
  const now=Date.now(),row={id:'a'.repeat(64),contact:{email:'fixture@example.invalid'},trial:{state:'approved',tokenHash:'parent',expiresAt:new Date(now+10*86400000).toISOString()}};
  const store={save:async(r,value)=>{r.trial=value;}};
  const result=await issueClientLink(store,row,{CUSTOMER_ORIGIN:'https://manage.example.invalid'},now);
  assert.equal(result.scope,'client-downloads');assert.equal(Date.parse(result.expiresAt),now+7*86400000);
  const bearer=new URL(result.link).hash.split('.').at(-1);
  assert.ok(await clientGrant(row.trial,bearer,now));
  assert.ok(!await clientGrant(row.trial,bearer,now+7*86400000));
  assert.ok(!await clientGrant({...row.trial,tokenHash:'rotated'},bearer,now));
  assert.ok(!await clientGrant({...row.trial,state:'closed'},bearer,now));
  assert.ok(!row.trial.clientDownloads[0].hash.includes(bearer));
  await issueClientLink(store,row,{},now,{revoke:true});assert.ok(!await clientGrant(row.trial,bearer,now));
  assert.equal(clientArtifact({product:'server'}),false);assert.equal(clientArtifact({product:'license'}),false);
  for(const product of ['desktop','cli','extension','installer'])assert.equal(clientArtifact({product}),true);
});
