import test from 'node:test';
import assert from 'node:assert/strict';
import {accountInvitation} from '../src/onboarding.mjs';
test('account invitations stay on the pinned server and tenant and retain capabilities only in the fragment',()=>{
  const token='127V-I1-'+'a'.repeat(43),server='https://cloud.example.test/t/family/?register=1';
  assert.equal(accountInvitation('https://cloud.example.test/t/family/#memberInvite='+token,server),'https://cloud.example.test/t/family/#memberInvite='+token);
  for(const url of ['https://other.example.test/t/family/','https://cloud.example.test/t/other/','https://user@cloud.example.test/t/family/','http://cloud.example.test/t/family/','https://cloud.example.test/t/family/?token=not-in-query'])assert.throws(()=>accountInvitation(url+'#memberInvite='+token,server));
  assert.throws(()=>accountInvitation('https://cloud.example.test/t/family/#memberInvite=invalid',server));
});
