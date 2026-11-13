import test from 'node:test';
import assert from 'node:assert/strict';
import { retireTestPurchase } from './retire-test-purchase.mjs';
const contact = { email:'test@example.com' }, trial = {kind:'personal-purchase',state:'approved',tokenHash:'old',invitation:{text:'old'},billing:{mode:'test_mode',status:'active'}};
test('test purchase retirement disables access and preserves billing',()=>{
  const next=retireTestPurchase(contact,trial,contact.email);
  assert.equal(next.state,'closed');assert.equal(next.tokenHash,null);assert.equal(next.invitation,undefined);
  assert.deepEqual(next.billing,trial.billing);assert.equal(trial.state,'approved');
});
test('cleanup rejects live, foreign and activated records',()=>{
  for(const value of [{...trial,billing:{mode:'live_mode'}},{...trial,license:'signed'},{...trial,installationId:'bound'}])assert.throws(()=>retireTestPurchase(contact,value,contact.email));
  assert.throws(()=>retireTestPurchase(contact,trial,'other@example.com'));
});
