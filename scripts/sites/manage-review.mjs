// Local-only product review. Authentication codes and records are fictional;
// no email, payment, activation, passkey registration or installer is executed.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assetDirectory,customerAssets} from './assets.mjs';
export async function createManageReview(port=12970){
 const id='a'.repeat(64),trial='b'.repeat(64),now=Date.now(),day=86400000;
 const rows=[{id,plan:'personal',kind:'personal-purchase',state:'approved',billingStatus:'active',billingMode:'live_mode',maxUsers:5,installationId:'12345678-1234-4234-8234-123456789abc',paidThrough:new Date(now+240*day).toISOString(),createdAt:new Date(now-3*day).toISOString()},
 {id:trial,plan:'commercial',kind:'trial',state:'approved',maxUsers:10,linkExpiresAt:new Date(now+25*day).toISOString(),createdAt:new Date(now-day).toISOString()}];
 const artifacts=['windows','linux'].map((platform,i)=>({id:'review-installer-'+platform,product:'installer',platform,label:(i?'Linux':'Windows')+' / Setup installer',filename:'127vaults-installer-0.1.22-'+platform+'.zip',sizeBytes:9000000,sha256:'0'.repeat(64)}));
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  if(!['127.0.0.1:'+server.address().port,'localhost:'+server.address().port].includes(req.headers.host)){res.writeHead(403);res.end();return;}
  const url=new URL(req.url,'http://localhost'),origin='http://'+req.headers.host;
  let scope=/manage-review-session=([a-z]+)/.exec(req.headers.cookie??'')?.[1];
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const cookie=value=>res.setHeader('Set-Cookie','manage-review-session='+value+'; Path=/; HttpOnly; SameSite=Strict');
  let input={};if(req.method==='POST'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Error();}input=JSON.parse(body||'{}');}catch{return json({error:'invalid_request'},400);}}
  if(url.pathname==='/api/customer/start'&&req.method==='POST')return json({challengeId:input.email?.startsWith('new')?'review-new':'review-only',message:'Local preview: use code 123456. No email was sent.'});
  if(url.pathname==='/api/customer/complete'&&req.method==='POST'){if(input.code!=='123456')return json({error:'invalid_code'},403);cookie(input.challengeId==='review-new'?'new':'email');return json({ok:true});}
  if(url.pathname==='/api/customer/logout'&&req.method==='POST'){cookie('');return json({ok:true});}
  if(url.pathname==='/api/customer/invitation'&&req.method==='POST'){cookie('invitation');return json({ok:true});}
  if(url.pathname==='/api/customer/me'){
   if(!scope)return json({error:'access_required'},401);
   const requests=scope==='new'?[]:scope==='pending'?[{...rows[0],state:'purchase_pending',billingStatus:'checkout_pending',paidThrough:null,installationId:null}]:scope==='invitation'?[rows[1]]:rows;
   return json({scope:scope==='invitation'?'invitation':'email',email:scope==='invitation'?undefined:'alex@example.invalid',requests,canBuyPersonal:scope==='new',purchaseMode:'live_mode',cloudTenants:['invitation','new'].includes(scope)?[]:[{slug:'northwind-family',canonicalUrl:'https://cloud.127vaults.com/t/northwind-family/',state:'active',maxActiveUsers:5}]});
  }
  if(url.pathname==='/api/customer/passkeys')return scope?json({recentSignIn:true,passkeys:[]}):json({error:'access_required'},401);
  if(/^\/api\/billing\/[a-f0-9]{64}$/.test(url.pathname)&&req.method==='GET')return scope?json({status:'active',plan:'personal-annual',mode:'live_mode',paidThrough:rows[0].paidThrough,hasLicense:true,accessReady:true,hasSubscription:true,hasCustomerPortal:true,cancelAtPeriodEnd:false}):json({error:'access_required'},401);
  if(/^\/api\/trials\/[a-f0-9]{64}$/.test(url.pathname)&&req.method==='GET')return scope?json({...rows[0],personalPurchase:true,billingAvailable:true,artifacts,maxUsers:5,linkExpiresAt:new Date(now+25*day).toISOString(),publicKeys:{}}):json({error:'access_required'},401);
  if(/^\/api\/trials\/[a-f0-9]{64}\/client-installer$/.test(url.pathname))return json({artifacts});
  if(url.pathname.startsWith('/api/'))return json({error:'not_available_in_local_review'},405);
  if(req.method!=='GET')return json({error:'read_only_review'},405);
  const scenario=url.searchParams.get('review');if(!url.searchParams.has('view')){if(['email','invitation','pending','new'].includes(scenario))cookie(scenario);if(scenario==='signedout')cookie('');}
  let name=url.pathname.slice(1)||'portal';if(!name.includes('.'))name+='.html';
  if(!customerAssets.includes(name))return json({},404);
  try{const body=await readFile(resolve(assetDirectory('customer',name),name));res.writeHead(200,{'Content-Type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.html')?'text/html':'application/json'});res.end(body);}catch{json({},404);}
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=await createManageReview();console.log('Manage local review: '+app.origin+'/portal?review=signedout (fake email code: 123456)');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}
