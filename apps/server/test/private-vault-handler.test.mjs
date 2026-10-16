import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { createSignedOperation } from '../../../packages/sync/src/index.mjs';
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

test('item deletion requires exact catalogue proposal, same-origin CSRF and a signed operation', async () => {
 const calls=[],auth={csrf:'csrf'},payload={requestId:revision,baseCatalogueRevision:revision,catalogue:Buffer.from('catalogue').toString('base64url'),signedOperation:createSignedOperation({tenantId:vault,vaultId:vault,itemId:item,deviceId:item,epoch:1,causalBase:0,kind:'item.delete',payloadHash:'a'.repeat(64)},generateKeyPairSync('ed25519').privateKey)};
 const handler=createPrivateVaultHandler({async mutate(value){calls.push(value);return{catalogueRevision:revision}}},async()=>auth,origin);
 const make=(body,csrf='csrf')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url=`/api/v1/vaults/${vault}/items/${item}`;req.method='DELETE';req.headers={cookie:`__Host-127v-session=${'s'.repeat(43)}`,origin,'x-127v-csrf':csrf,'content-type':'application/json'};return req};
 const ok=response();await handler(make(payload),ok);assert.equal(ok.status,200);assert.equal(calls[0].action,'item.delete');assert.equal(calls[0].item,item);assert.equal(calls[0].index,undefined);assert.equal(calls[0].signedOperation.kind,'item.delete');
 for(const body of [{...payload,index:'extra'},{...payload,signedOperation:null}]){const res=response();await handler(make(body),res);assert.equal(res.status,400)}
 const denied=response();await handler(make(payload,'incorrect'),denied);assert.notEqual(denied.status,200);assert.equal(calls.length,1);
});
