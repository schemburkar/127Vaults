import { AUTH_COOKIE, AuthError, requireUnsafeRequest, strictJson } from './auth-policy.mjs';
import { DeviceLifecycleStoreError } from './device-lifecycle-pg.mjs';
import { HttpBoundaryError, readRequestBody, writeError, writeJson } from './http-boundary.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fields={request:['username','newDeviceId','newDevicePublicKey','requestSignature'],poll:['pollToken'],inspect:['code'],approval:['approvalSignature'],complete:['pollToken','possessionSignature']};
const cookie=req=>String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length+1);

export function createDeviceEnrollmentHandler(store,authenticate,origin){return async(req,res)=>{
  const path=new URL(req.url,origin).pathname;
  const v1=path==='/api/v1/device-enrollment'?{action:'request',id:null}:path==='/api/v1/device-enrollment/inspect'?{action:'inspect',id:null}:path.match(/^\/api\/v1\/device-enrollment\/([^/]+)\/(poll|approval|complete)$/);
  if(!v1)return false;
  try{
    if(req.method!=='POST'){writeError(res,405,'method_not_allowed');return true}
    if(v1){
      const action=Array.isArray(v1)?v1[2]:v1.action,id=Array.isArray(v1)?v1[1]:null;
      if(id&&!UUID.test(id))throw new DeviceLifecycleStoreError('invalid_request',400);
      const value=strictJson(req,await readRequestBody(req),fields[action]);
      if(action==='inspect'||action==='approval'){
        const token=cookie(req);if(!token)throw new AuthError();const auth=await authenticate(token);requireUnsafeRequest(req,origin,req.headers['x-127v-csrf'],auth.csrf);
        if(action==='inspect')writeJson(res,200,await store.inspectEnrollment(auth,value));
        else writeJson(res,200,await store.approveEnrollmentRequest(auth,{enrollmentId:id,...value}));
        return true;
      }
      const method={request:'requestEnrollment',poll:'pollEnrollment',complete:'completeEnrollmentRequest'}[action];
      writeJson(res,200,await store[method](id?{enrollmentId:id,...value}:value));return true;
    }
  }catch(error){const status=error instanceof AuthError?401:error instanceof DeviceLifecycleStoreError||error instanceof HttpBoundaryError?error.status:503;writeError(res,status,status===401?'authentication_required':status===429?'rate_limited':status===503?'unavailable':error.code??'invalid_request');return true}
}}
