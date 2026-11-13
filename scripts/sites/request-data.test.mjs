import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRequests, billingModeLabel } from '../../admin-website/request-data.mjs';
test('admin rows retain test billing mode and read only billing-linked records', async () => {
  const calls=[];
  const result=await loadRequests(async path => { calls.push(path); return {ok:true,json:async()=>path==='/api/access-admin/requests'?{requests:[{id:'test',billingStatus:'active'},{id:'pending',state:'requested'}]}:{mode:'test_mode'}}; });
  assert.equal(billingModeLabel(result.requests[0]),'Dodo test mode');
  assert.equal(billingModeLabel(result.requests[1]),'Billing mode unverified');
  assert.deepEqual(calls,['/api/access-admin/requests','/api/access-admin/billing/test']);
});
test('unavailable billing details are shown as unverified instead of live', async () => {
  const result=await loadRequests(async path=>({ok:path==='/api/access-admin/requests',json:async()=>({requests:[{id:'x',billingStatus:'active'}]})}));
  assert.equal(billingModeLabel(result.requests[0]),'Billing mode unverified');
});
