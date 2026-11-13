// Read-only, loopback-only design review. Never uses real customer records,
// production credentials, payment providers, email transports or Cloud commands.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assetDirectory,adminAssets} from './assets.mjs';
const day=86400000;
export function reviewRecords(now=Date.now()) {
  const names=['Avery Morgan','Jordan Patel','Sam Rivera','Riley Chen','Alex Taylor','Casey Williams','Robin Shah','Jamie Parker'];
  const companies=['Northwind Studio','Cedar Systems','Fieldwork Design','Orbit Workshop','Individual customer','Aster Research'];
  return Array.from({length:26},(_,i)=>{
    const approved=i%4!==0, subscribed=approved&&i%3!==0, installed=approved&&i%5!==0;
    return {id:(i+1).toString(16).padStart(64,'0'),contactName:names[i%names.length],email:names[i%names.length].toLowerCase().replaceAll(' ','.')+(i>7?i:'')+'@example.invalid',organization:companies[i%companies.length],plan:i%3===0?'commercial':'personal',state:approved?'approved':'requested',receivedAt:new Date(now-(i+1)*day).toISOString(),requestedSeats:i%3===0?25:5,maxUsers:approved?(i%3===0?25:5):undefined,canPreviewInvitation:approved,canSendEmail:approved&&i%2===0,canResendEmail:approved&&i%2!==0,emailState:approved?'queued':'not_sent',emailAttemptedAt:new Date(now-2*day).toISOString(),linkExpiresAt:new Date(now+(i%7===0?-2:20)*day).toISOString(),installationId:installed?`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`:undefined,expiresAt:installed?new Date(now+(i%7===0?-4:160)*day).toISOString():undefined,billingStatus:subscribed?(i%8===3?'past_due':'active'):null,billingPaidThrough:subscribed?new Date(now+160*day).toISOString():null,billingMode:i===25||i%9===0?'test_mode':'live_mode',kind:subscribed?'personal-purchase':'trial',archivedAt:null};
  });
}
export async function createAdminReview(port=12969) {
  const rows=reviewRecords(),now=Date.now();
  const coupons=Array.from({length:7},(_,i)=>({id:'dsc_review_'+i,code:['WELCOME20','NORTHWIND25','TEAM50','FRIENDS10','ANNUAL15','EARLYACCESS','PARTNER30'][i],type:'percentage',amount:[2000,2500,5000,1000,1500,10000,3000][i],expiresAt:new Date(now+(i===4?-3:40+i)*day).toISOString(),used:i*3,usageLimit:50,cycles:12,plans:[i%2?'commercial-annual':'personal-annual'],status:i===4?'Expired':'Available'}));
  const tenants=Array.from({length:9},(_,i)=>({slug:['northwind','cedar-family','river-house','aster-team','orbit-workshop','maple-home','pine-studio','lake-family','fieldwork'][i],canonicalUrl:'https://cloud.example.invalid/t/'+['northwind','cedar-family','river-house','aster-team','orbit-workshop','maple-home','pine-studio','lake-family','fieldwork'][i],region:i%2?'Asia Pacific':'Europe',controlOwnerEmail:'owner'+i+'@example.invalid',state:i===4?'suspended':i===2?'prepared':'active',readyToActivate:i===2,activeUsers:i%4+1,reservedSeats:0,maxActiveUsers:5}));
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    const host=req.headers.host;if(![...['127.0.0.1','localhost'].map(name=>name+':'+server.address().port)].includes(host)){res.writeHead(403);res.end();return;}
    const url=new URL(req.url,'http://localhost');
    const json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(req.method==='POST'&&url.pathname==='/cloud-tenants/api/list')return json(tenants);
    if(req.method!=='GET')return json({error:'read_only_design_review'},405);
    if(url.pathname==='/api/access-admin/requests')return json({requests:rows,permissions:{approveDevelopment:false},emailEnabled:true,emailDryRun:true,automaticCustomerEmail:false});
    const invitation=/^\/api\/access-admin\/requests\/([a-f0-9]{64})\/invitation$/.exec(url.pathname);
    if(invitation){const row=rows.find(r=>r.id===invitation[1]);return row?json({...row,subject:'Your private 127Vaults setup link',message:'Sample invitation for design review only.\n\nhttps://manage.example.invalid/trial?open=1#sample-link\n\nThis is sample data, not a working setup credential.'}):json({},404);}
    if(url.pathname==='/api/access-admin/billing/plans')return json({mode:'live_mode',plans:[{id:'personal-annual',plan:'personal',maxUsers:5},{id:'commercial-annual',plan:'commercial',maxUsers:25},{id:'commercial-team',plan:'commercial',maxUsers:50}]});
    if(url.pathname==='/api/access-admin/billing/coupons')return json({mode:'live_mode',page:1,hasMore:false,coupons});
    if(url.pathname==='/api/access-admin/billing/health')return json({pendingEvents:0});
    const billing=/^\/api\/access-admin\/billing\/([a-f0-9]{64})(\/payments)?$/.exec(url.pathname);
    if(billing){const row=rows.find(r=>r.id===billing[1]);if(!row)return json({},404);return json(billing[2]?{events:[]}:{mode:row.billingMode,status:row.billingStatus,paidThrough:row.expiresAt,hasSubscription:Boolean(row.billingStatus)});}
    if(url.pathname==='/api/access-admin/customer-mail')return json({messages:[{id:'review-message',to:'avery.morgan@example.invalid',subject:'Your 127Vaults sign-in code',text:'Sample sign-in message for design review. This code does not authenticate anywhere.',expiresAt:new Date(Date.now()+9*60000).toISOString()}]});
    if(url.pathname==='/api/access-admin/releases')return json({sourceRevision:'abc1234def5678abc1234def5678abc1234def5678',artifacts:['Windows setup installer','Linux setup installer','Windows Desktop','Linux Desktop','Server bundle','Browser extension','CLI for Windows','SHA-256 checksums'].map((label,i)=>({id:'review-file-'+i,label,filename:['127vaults-installer-0.1.22-windows-x64.zip','127vaults-installer-0.1.22-linux-x64.tar.gz','127vaults-desktop-0.1.22-windows.zip','127vaults-desktop-0.1.22-linux.tar.gz','127vaults-server-0.1.22.tar.gz','127vaults-extension-0.1.22.zip','127vaults-cli-0.1.22-windows.zip','SHA256SUMS'][i],product:['installer','installer','desktop','desktop','server','extension','cli','verification'][i],platform:['Windows','Linux','Windows','Linux','Linux containers','Cross-platform','Windows','Cross-platform'][i],sizeBytes:[9e6,8e6,26e6,31e6,800e6,2e6,7e6,1024][i],sha256:'a'.repeat(64),supporting:i===7}))});
    if(url.pathname.startsWith('/api/'))return json({error:'not_available_in_review'},404);
    const route=url.pathname==='/'?'access-admin':url.pathname.slice(1);
    const name=route.includes('.')?route:route+'.html';
    if(!adminAssets.includes(name))return json({},404);
    try{let bytes=await readFile(resolve(assetDirectory('admin',name),name));if(name.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="admin-review" content="sample-data">'));
      const type=name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.html')?'text/html':'application/json';res.writeHead(200,{'Content-Type':type});res.end(bytes);
    }catch{json({},404);}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=await createAdminReview();console.log('Read-only admin design review: '+app.origin+'/access-admin');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}
