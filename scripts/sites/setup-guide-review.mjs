// Read-only, loopback-only editorial preview. No intake, account or provider APIs.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {publicAssets,readSiteAsset,repository} from './assets.mjs';
const review=new Set(['setup-guide-ste-review.html','setup-guide-ste-review.mjs']);
const types={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',json:'application/json'};
const server=createServer(async(req,res)=>{
  const port=server.address().port;
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  let name=url.pathname==='/'?'setup-guide-ste-review.html':url.pathname.slice(1);
  if(!name.includes('.')&&publicAssets.includes(name+'.html'))name+='.html';
  if(!review.has(name)&&!publicAssets.includes(name)){res.writeHead(404);res.end();return;}
  try {
    const body=review.has(name)?await readFile(join(repository,'public-website',name)):await readSiteAsset('public',name);
    res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:body);
  } catch {res.writeHead(500);res.end('Local review asset unavailable.');}
});
server.listen(0,'127.0.0.1',()=>console.log(`STE setup review: http://127.0.0.1:${server.address().port}/setup-guide-ste-review.html`));
