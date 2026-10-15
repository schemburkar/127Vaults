// Serve the actual static public site locally with every external API closed.
// No contact requests, email, payment, account, or published download is created.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),site=join(root,'public-website');
const output=process.env.VAULTS_TEST_OUTPUT;assert.ok(output&&isAbsolute(output));
const rel=relative(root,output);assert.ok(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Use an external evidence workspace');
const catalog=JSON.parse(await readFile(join(site,'releases.json'),'utf8'));assert.deepEqual(catalog.releases,[],'Internal check requires the retained unpublished catalogue');
await mkdir(output,{recursive:true});
const files=new Set(await readdir(site)),pages=[...files].filter(name=>name.endsWith('.html'));
const types={html:'text/html',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png'};
let writes=0;
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){writes++;res.writeHead(405);res.end();return;}
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({open:false,error:'unavailable'}));return;}
  const name=path==='/'?'index.html':path.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':types[name.split('.').at(-1)]||'application/octet-stream'});res.end(await readFile(join(site,name)));
 }catch{res.writeHead(500);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE||'playwright');let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.VAULTS_BROWSER_EXECUTABLE?{executablePath:process.env.VAULTS_BROWSER_EXECUTABLE}:{})});
 const errors=[],checks=[];
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const name of pages){
   const response=await page.goto(origin+'/'+name);assert.equal(response.status(),200);await page.waitForLoadState('networkidle');
   assert.ok((await page.locator('body').innerText()).trim().length>100);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Horizontal overflow: ${name} at ${width}`);
   const missing=await page.evaluate(()=>[...document.images].filter(image=>!image.complete||image.naturalWidth===0).map(image=>image.getAttribute('src')));assert.deepEqual(missing,[],`${name} images missing`);
   const localLinks=await page.locator('a[href]').evaluateAll(links=>links.map(link=>link.getAttribute('href')).filter(href=>href&&!href.startsWith('#')&&!/^[a-z]+:/i.test(href)&&!href.startsWith('//')));
   for(const href of localLinks){const target=new URL(href,origin+'/'+name).pathname.slice(1);assert.ok(files.has(target)||target==='',`Broken local link ${name}: ${href}`);}
   if(['index.html','get-started.html','downloads.html'].includes(name))await page.screenshot({path:join(output,name.replace('.html','')+'-'+width+'.png'),fullPage:true});
   checks.push({page:name,width,rendered:true,localLinks:true,images:true,noDocumentOverflow:true});
  }
  await page.goto(origin+'/get-started.html?plan=cloud');
  await page.waitForFunction(()=>document.querySelector('#access-status')?.textContent.includes('not accepting'));
  const button=page.locator('#waitlist-form button[type="submit"]');assert.equal(await button.isDisabled(),true);
  await page.locator('#access-seats').fill('50');
  assert.match(await page.locator('#cloud-seat-estimate').innerText(),/1,500/);assert.match(await page.locator('#cloud-seat-estimate').innerText(),/3,000/);
  await page.getByRole('radio',{name:/Personal/i}).check();assert.equal(await button.isDisabled(),true);
  await page.goto(origin+'/downloads.html');await page.waitForLoadState('networkidle');
  const downloads=await page.locator('a[href]').evaluateAll(links=>links.map(link=>link.href).filter(href=>/\.(?:exe|deb|AppImage|zip|tar(?:\.gz)?)(?:[?#]|$)/i.test(href)));assert.deepEqual(downloads,[]);
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(writes,0);
 await writeFile(join(output,'evidence.json'),JSON.stringify({status:'passed',scope:'Actual static public pages in Chromium with closed same-origin APIs; no public deployment',checks,closedWaitlist:true,cloudEstimate:true,noPublishedDownloads:true,noWrites:true,limits:['Chromium widths 1440 and 390 only; physical keyboard/screen-reader, legal/commercial and public deployment acceptance separate.']},null,2)+'\n');
 console.log(`Public site ${pages.length} pages passed at desktop/mobile widths; intake stays closed and no downloads are published.`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
