import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createOnboardingHandler } from '../src/onboarding-handler.mjs';

const origin='https://127.0.0.1:12780',csrf='c'.repeat(43),attempt='a'.repeat(43);
function request(url,body,headers={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url=url;req.method='POST';req.headers={'content-type':'application/json',origin,cookie:`__Host-127v-ceremony=${csrf}`,'x-127v-csrf':csrf,...headers};req.socket={remoteAddress:'127.0.0.1'};return req}
function response(){return{status:0,value:null,writeHead(status){this.status=status},end(body){this.value=JSON.parse(body)}}}
async function invoke(handler,url,body,headers){const res=response();assert.equal(await handler(request(url,body,headers),res),true);return res}

test('v1 registration prepares OPAQUE and completes bootstrap through exact request variants',async()=>{
 const calls=[],service={async bootstrapOwner(value){calls.push(['bootstrap',value]);return{accountId:'account'}}},registration={async start(value){calls.push(['prepare',value]);return{registrationArtifact:'artifact'}}};
 const handler=createOnboardingHandler(service,async candidate=>({...candidate,completed:true}),origin,undefined,registration);
 const prepared=await invoke(handler,'/api/v1/onboarding/register',{accountId:'account',deviceId:'device',request:'opaque'});assert.equal(prepared.status,200);
 const completed=await invoke(handler,'/api/v1/onboarding/register',{token:'token',candidate:{username:'owner'}});assert.equal(completed.status,200);
 assert.deepEqual(calls.map(([name])=>name),['prepare','bootstrap']);assert.equal(calls[1][1].candidate.completed,true);
 const mixed=await invoke(handler,'/api/v1/onboarding/register',{token:'token',candidate:{},request:'unexpected'});assert.equal(mixed.status,400);
});

test('v1 invitation paths bind attempt IDs and owner creation requires authenticated CSRF',async()=>{
 const calls=[],service={async beginInvitation(value){calls.push(['begin',value]);return{attemptId:attempt}},async sendEmail(value){calls.push(['email',value]);return{sent:true}},async finalizeInvitation(value){calls.push(['complete',value]);return{accountId:'account'}},async createInvitation(value){calls.push(['create',value]);return{token:'token'}}};
 const auth={accountId:'owner',role:'owner',csrf};const handler=createOnboardingHandler(service,async candidate=>candidate,origin,async()=>auth);
 assert.equal((await invoke(handler,'/api/v1/onboarding/invitation',{token:'token',email:'person@example.invalid',candidate:{}})).status,200);
 assert.equal((await invoke(handler,`/api/v1/onboarding/invitation/${attempt}/email`,{capability:'cap'})).status,200);
 assert.equal((await invoke(handler,`/api/v1/onboarding/invitation/${attempt}/complete`,{capability:'cap',code:'12345678'})).status,200);
 const ownerHeaders={cookie:'__Host-127v-session=session','x-127v-csrf':csrf};
 assert.equal((await invoke(handler,'/api/v1/invitations',{emails:['person@example.invalid'],expiresInHours:24},ownerHeaders)).status,200);
 assert.deepEqual(calls.map(([name])=>name),['begin','email','complete','create']);assert.equal(calls[1][1].attemptId,attempt);assert.equal(calls[3][1].ownerAccountId,'owner');
});
