import test from 'node:test';
import assert from 'node:assert/strict';
import {availableManageViews, accountSummary, selectManageView} from '../../customer-website/manage-state.mjs';

test('invitation and installer sessions expose only their permitted account views', () => {
  for (const scope of ['invitation', 'installer']) {
    const value = {scope, requests: []};
    assert.deepEqual(availableManageViews(value), ['overview', 'subscriptions']);
    assert.equal(selectManageView('security', value), 'overview');
    assert.equal(selectManageView('plans', value), 'overview');
    assert.equal(selectManageView('subscriptions', value), 'subscriptions');
  }
  assert.deepEqual(availableManageViews({scope:'email', cloudUnavailable:true}), ['overview','subscriptions','cloud','security','plans']);
});

test('account totals distinguish live active access, pending purchases and unavailable Cloud', () => {
  const value = {requests:[
    {state:'approved',billingStatus:'active',billingMode:'live_mode'},
    {state:'approved',billingStatus:'active',billingMode:'test_mode'},
    {state:'purchase_pending',billingStatus:'active',billingMode:'live_mode'},
    {state:'approved',billingStatus:'cancelled'},
    {state:'approved'},
  ],cloudUnavailable:true};
  assert.deepEqual(accountSummary(value), {access:5,activeSubscriptions:1,cloud:null});
  assert.equal(accountSummary({...value,cloudUnavailable:false,cloudTenants:[{}]}).cloud,1);
});

 test('customer dates use an explicit month name',async()=>{const {formatManageDate}=await import('../../customer-website/manage-state.mjs');assert.equal(formatManageDate('2027-07-12T12:00:00Z'),'12 July 2027');assert.equal(formatManageDate('invalid'),'—');assert.equal(formatManageDate(null),'—');assert.deepEqual(availableManageViews({scope:'email',cloudTenants:[]}),['overview','subscriptions','security','plans']);});
