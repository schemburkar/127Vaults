import { AUTH_COOKIE, AuthError, requireUnsafeRequest, strictJson } from './auth-policy.mjs';
import { HttpBoundaryError, readRequestBody, writeError, writeJson } from './http-boundary.mjs';
import { SyncProtocolError } from '../../../packages/sync/src/index.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cookie=req=>{const all=String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${AUTH_COOKIE}=`));const v=all.length===1?all[0].slice(AUTH_COOKIE.length+1):'';return /^[A-Za-z0-9_-]{43}$/.test(v)?v:null;};

export function operation(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new SyncProtocolError('invalid_request');const required=['protocolVersion','tenantId','vaultId','deviceId','epoch','causalBase','previousDeviceOpId','kind','itemId','payloadHash','opId','signature'];const allowed=new Set([...required,'clientTime']);if(required.some(k=>!(k in value))||Object.keys(value).some(k=>!allowed.has(k)))throw new SyncProtocolError('invalid_request');if(![value.tenantId,value.vaultId,value.deviceId,value.itemId].every(x=>typeof x==='string'&&UUID.test(x))||!Number.isSafeInteger(value.epoch)||value.epoch<1||!Number.isSafeInteger(value.causalBase)||value.causalBase<0||!(value.previousDeviceOpId===null||typeof value.previousDeviceOpId==='string'&&/^[0-9a-f]{64}$/.test(value.previousDeviceOpId))||typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature)||Buffer.from(value.signature,'base64url').toString('base64url')!==value.signature)throw new SyncProtocolError('invalid_request');if(value.clientTime!==undefined&&(typeof value.clientTime!=='string'||new Date(value.clientTime).toISOString()!==value.clientTime))throw new SyncProtocolError('invalid_request');return value;}

export function createSignedSyncHandler(store,authenticate,origin,{checkpointPublicKey}={}){
  if(!store||typeof authenticate!=='function'||typeof origin!=='string'||!origin.startsWith('https://'))throw new Error('Sync store, authentication, and HTTPS origin are required.');
  return async(req,res)=>{
    const url=new URL(req.url,origin),match=url.pathname.match(/^\/api\/v1\/vaults\/([0-9a-f-]+)\/(operations|checkpoint)$/);
    if(!match)return false;
    try{
      const vaultId=UUID.test(match[1])?match[1]:(()=>{throw new SyncProtocolError('invalid_request')})(),resource=match[2],session=cookie(req);
      if(!session)throw new AuthError();const auth=await authenticate(session);
      if(req.method==='GET'){
        if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new SyncProtocolError('forbidden');
        if(resource==='operations'){
          if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k)))throw new SyncProtocolError('invalid_request');
          const cursor=url.searchParams.has('cursor')?Number(url.searchParams.get('cursor')):0,limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):100;
          writeJson(res,200,await store.fetch(auth,{vaultId,cursor,limit}));return true;
        }
        if(url.searchParams.has('history')) {
          if(url.searchParams.get('history')!=='1'||[...url.searchParams.keys()].some(key=>!['history','after','limit'].includes(key)))throw new SyncProtocolError('invalid_request');
          const after=url.searchParams.get('after'),limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):100;
          writeJson(res,200,{...await store.checkpointHistory(auth,vaultId,{after,limit}),checkpointPublicKey});return true;
        }
        if([...url.searchParams.keys()].length)throw new SyncProtocolError('invalid_request');
        writeJson(res,200,{checkpoint:await store.latestCheckpoint(auth,vaultId),checkpointPublicKey});return true;
      }
      if(req.method!=='POST'){writeError(res,405,'method_not_allowed');return true}
      requireUnsafeRequest(req,origin,req.headers['x-127v-csrf'],auth.csrf);
      const bytes=await readRequestBody(req,32*1024);
      if(resource==='operations'){const value=strictJson(req,bytes,['operation']);writeJson(res,200,await store.append(auth,operation(value.operation)));return true}
      strictJson(req,bytes,[]);writeJson(res,200,{checkpoint:await store.createCheckpoint(auth,vaultId)});return true;
    }catch(error){
      const status=error instanceof AuthError?error.status:error instanceof HttpBoundaryError?error.status:error?.code==='not_found'?404:error?.code==='vault_frozen'?423:['forbidden','wrong_tenant','wrong_vault','wrong_device','wrong_epoch','stale_credential'].includes(error?.code)?403:['device_fork','causal_base_ahead','operation_id_reused'].includes(error?.code)?409:error instanceof SyncProtocolError||error instanceof TypeError||error instanceof RangeError?400:503;
      const code=status===401?'authentication_required':status===503?'unavailable':status===404?'not_found':status===423?'vault_frozen':status===409?'sync_conflict':status===413?'too_large':status===403?'forbidden':'invalid_request';writeError(res,status,code);return true;
    }
  };
}
