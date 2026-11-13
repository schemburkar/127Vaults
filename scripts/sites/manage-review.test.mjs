import test from 'node:test';
import assert from 'node:assert/strict';
import {createManageReview} from './manage-review.mjs';

test('Manage review isolates fictional sessions and blocks consequential operations', async t => {
  const app=await createManageReview(0);t.after(()=>app.close());
  const get=(path,cookie)=>fetch(app.origin+path,{headers:cookie?{Cookie:cookie}:{}});
  const scenario=await get('/portal?review=invitation');
  const cookie=scenario.headers.get('set-cookie').split(';')[0];
  const value=await (await get('/api/customer/me',cookie)).json();
  assert.equal(value.scope,'invitation');assert.equal(value.requests.length,1);
  assert.deepEqual(value.cloudTenants,[]);
  assert.equal((await get('/api/customer/me')).status,401);
  assert.equal((await fetch(app.origin+'/api/billing/'+ 'a'.repeat(64)+'/cancel',{method:'POST',headers:{Cookie:cookie},body:'{}'})).status,405);
  const reload=await get('/portal?review=signedout&view=subscriptions',cookie);
  assert.equal(reload.headers.get('set-cookie'),null);
  const post=(path,body)=>fetch(app.origin+path,{method:'POST',body:JSON.stringify(body)});
  const challenge=await (await post('/api/customer/start',{email:'new@example.invalid'})).json();
  const complete=await post('/api/customer/complete',{challengeId:challenge.challengeId,code:'123456'});
  const fresh=await (await get('/api/customer/me',complete.headers.get('set-cookie').split(';')[0])).json();
  assert.equal(fresh.canBuyPersonal,true);assert.deepEqual(fresh.requests,[]);
});
