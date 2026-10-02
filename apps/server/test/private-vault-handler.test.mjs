import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPrivateVaultHandler } from '../src/private-vault-handler.mjs';

const origin='https://127.0.0.1:12780',vault='10000000-0000-4000-8000-000000000001',item='20000000-0000-4000-8000-000000000001',revision='30000000-0000-4000-8000-000000000001';
function request(url){const req=Readable.from([]);req.url=url;req.method='GET';req.headers={cookie:`__Host-127v-session=${'s'.repeat(43)}`};return req}
function response(){return{status:0,value:null,writeHead(status){this.status=status},end(body){this.value=JSON.parse(body)}}}

test('v1 vault and item reads map to the encrypted store without exposing alternate revisions',async()=>{
 const calls=[],store={async list(){calls.push(['list']);return{vaultEnvelopes:[]}},async items(a,id){calls.push(['items',id]);return{indices:[]}},async body(a,v,i,r){calls.push(['body',v,i,r]);return{body:'ciphertext'}}};
 const handler=createPrivateVaultHandler(store,async()=>({tenantId:'t',accountId:'a',deviceId:'d'}),origin);
 for(const url of ['/api/v1/vaults',`/api/v1/vaults/${vault}/items`,`/api/v1/vaults/${vault}/items/${item}?catalogueRevision=${revision}`]){const res=response();assert.equal(await handler(request(url),res),true);assert.equal(res.status,200)}
 assert.deepEqual(calls,[['list'],['items',vault],['body',vault,item,revision]]);
 const unexpected=response();await handler(request(`/api/v1/vaults/${vault}/items?extra=1`),unexpected);assert.equal(unexpected.status,400);assert.deepEqual(unexpected.value,{error:'invalid_request'});
});
