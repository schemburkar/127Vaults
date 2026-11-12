import { readFile } from 'node:fs/promises';
export async function delegateClientDownloads(configFile,fetcher=fetch) {
  if(!configFile)throw Error('Client downloads are not configured');
  const config=JSON.parse(await readFile(configFile,'utf8'));
  const url=new URL(config.refreshUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^\/api\/billing\/[a-f0-9]{64}\/refresh$/.test(url.pathname)||!/^[A-Za-z0-9_-]{43}$/.test(config.refreshToken))throw Error('Invalid subscription configuration');
  url.pathname=url.pathname.replace(/refresh$/,'client-link');
  const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${config.refreshToken}`,'Content-Type':'application/json'},body:'{}'});
  if(!response.ok)throw Error('Client download delegation unavailable');
  const result=await response.json(), link=new URL(result.link);
  if(link.origin!==url.origin||link.username||link.password||link.search||link.pathname!=='/join'||!/^#[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(link.hash)||!Number.isFinite(Date.parse(result.expiresAt)))throw Error('Invalid client download delegation');
  return {link:link.href,expiresAt:result.expiresAt,scope:'client-downloads'};
}
