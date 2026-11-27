import test from 'node:test';import assert from 'node:assert/strict';
import {subscriptionActionReason as reason} from '../../admin-website/billing-actions.mjs';
const base={mode:'live_mode',offerCount:1,planId:'commercial-annual',sessionId:'cks_test',customer:{kind:'trial'}};
test('billing actions explain missing context and unsupported Personal offers',()=>{
  assert.match(reason({...base,label:'Offer subscription',customer:null}),/Choose a customer/);
  assert.match(reason({...base,label:'Offer subscription',offerCount:0}),/Personal customers subscribe through Manage/);
  assert.match(reason({...base,label:'Offer subscription',customer:{kind:'personal-purchase'}}),/cannot receive/);
  assert.equal(reason({...base,label:'Offer subscription'}),'');
});
test('read-only history remains available across modes while mutations do not',()=>{
  const customer={kind:'personal-purchase',billingStatus:'active',billingMode:'test_mode'};
  assert.equal(reason({...base,customer,label:'Show payment history'}),'');
  assert.match(reason({...base,customer,label:'Rotate server renewal credential'}),/another billing mode/);
  assert.match(reason({...base,customer,label:'Reconcile subscription'}),/another billing mode/);
  assert.match(reason({...base,customer:{...customer,billingMode:'live_mode'},label:'Recover interrupted checkout'}),/only for an interrupted checkout/);
});
test('checkout recovery needs a pending checkout and its actual session identifier',()=>{
  const customer={billingStatus:'checkout_pending',billingMode:'live_mode'};
  assert.match(reason({...base,customer,label:'Recover interrupted checkout',sessionId:''}),/session ID/);
  assert.equal(reason({...base,customer,label:'Recover interrupted checkout'}),'');
  assert.equal(reason({...base,customer,label:'Reconcile subscription',sessionId:''}),'');
});
