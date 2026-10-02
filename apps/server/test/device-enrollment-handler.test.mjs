import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDeviceEnrollmentHandler } from '../src/device-enrollment-handler.mjs';

const origin='https://127.0.0.1:12780';
function v1(path,value,headers={}){const req=Readable.from([Buffer.from(JSON.stringify(value))]);req.url=path;req.method='POST';req.headers={'content-type':'application/json',...headers};return req}
function response(){return{status:0,body:null,writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}}}

test('v1 enrollment resolves inspection by code and binds later actions to the path ID',async()=>{
 const id='10000000-0000-4000-8000-000000000001',calls=[],auth={tenantId:'t',accountId:'a',deviceId:'d',csrf:'csrf'};
 const store={async requestEnrollment(v){calls.push(['request',v]);return{enrollmentId:id}},async pollEnrollment(v){calls.push(['poll',v]);return{status:'pending'}},async inspectEnrollment(a,v){calls.push(['inspect',v]);return{enrollmentId:id}},async approveEnrollmentRequest(a,v){calls.push(['approval',v]);return{approved:true}},async completeEnrollmentRequest(v){calls.push(['complete',v]);return{deviceId:'d'}}};
 const handler=createDeviceEnrollmentHandler(store,async()=>auth,origin),trusted={cookie:'__Host-127v-session=token',origin,'x-127v-csrf':'csrf'};
 for(const [path,value,headers] of [['/api/v1/device-enrollment',{username:'owner_127',newDeviceId:'d',newDevicePublicKey:'k',requestSignature:'s'},{}],[`/api/v1/device-enrollment/${id}/poll`,{pollToken:'p'},{}],['/api/v1/device-enrollment/inspect',{code:'ABCDEFGH'},trusted],[`/api/v1/device-enrollment/${id}/approval`,{approvalSignature:'s'},trusted],[`/api/v1/device-enrollment/${id}/complete`,{pollToken:'p',possessionSignature:'s'},{}]]){const res=response();assert.equal(await handler(v1(path,value,headers),res),true);assert.equal(res.status,200)}
 assert.deepEqual(calls.map(([name])=>name),['request','poll','inspect','approval','complete']);assert.deepEqual(calls[2][1],{code:'ABCDEFGH'});for(const [name,value] of [calls[1],...calls.slice(3)])assert.equal(value.enrollmentId,id,name);
});
