import test from 'node:test';import assert from 'node:assert/strict';
import {matchRecords} from '../../admin-website/workspace-ui.mjs';
import {createAdminReview} from './admin-review.mjs';
test('workspace search matches all words across names and email without changing source records',()=>{
 const rows=[{name:'Jordan Patel',email:'jp@example.invalid',plan:'commercial'},{name:'Riley Chen',email:'rc@example.invalid',plan:'personal'}];
 assert.deepEqual(matchRecords(rows,'  JORDAN   commercial '),[rows[0]]);
 assert.deepEqual(matchRecords(rows,'jp@example'),[rows[0]]);
 assert.deepEqual(matchRecords(rows,'Jordan personal'),[]);
 assert.deepEqual(matchRecords(rows,''),rows);assert.equal(rows.length,2);
});
test('design review serves actual admin assets with sample data and refuses mutations',async t=>{
 const app=await createAdminReview(0);t.after(()=>app.close());
 const page=await fetch(app.origin+'/subscriptions');assert.equal(page.status,200);assert.match(await page.text(),/admin-review/);
 const rows=await (await fetch(app.origin+'/api/access-admin/requests')).json();assert.equal(rows.requests.length,26);assert.ok(rows.requests.every(row=>row.email.endsWith('@example.invalid')));
 assert.equal((await fetch(app.origin+'/api/access-admin/requests/'+rows.requests[0].id+'/approve',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(app.origin+'/api/access-admin/billing/'+rows.requests[0].id+'/checkout',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(app.origin+'/cloud-tenants/api/list',{method:'POST',body:'{}'})).status,200);
 assert.equal((await fetch(app.origin+'/cloud-tenants/api/provision',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(app.origin+'/customer-portal.mjs')).status,404);
});

test('release sizes keep verification files readable and reject unavailable sizes',async()=>{
 const {formatBytes}=await import('../../admin-website/workspace-ui.mjs');
 assert.equal(formatBytes(1024),'1.0 KB');assert.equal(formatBytes(1048576),'1.0 MB');
 assert.equal(formatBytes(0),'0 B');assert.equal(formatBytes(undefined),'Unavailable');
});

test('payment display uses the currency scale without converting currency',async()=>{
 const {formatMinorAmount}=await import('../../admin-website/workspace-ui.mjs');
 assert.equal(formatMinorAmount(235882,'INR','en-IN'),'₹2,358.82');
 assert.equal(formatMinorAmount(2358,'JPY','en-US'),'¥2,358');
 assert.equal(formatMinorAmount(undefined,'USD'),'Unavailable');
});
