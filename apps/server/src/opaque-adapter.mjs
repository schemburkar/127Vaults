import { createHash, createHmac, hkdfSync, randomBytes, verify, createPublicKey } from 'node:crypto';
import { AuthError } from './auth-policy.mjs';

const uuidBytes = value => Buffer.from(String(value).replaceAll('-', ''), 'hex');
export function encodeBinding(value) {
  const origin = Buffer.from(value.origin, 'utf8');
  const epoch = Buffer.alloc(8); epoch.writeBigUInt64BE(BigInt(value.epoch));
  const parts = [origin, uuidBytes(value.installation), uuidBytes(value.account), uuidBytes(value.device), epoch, value.attempt, value.serverPublicKey];
  if (origin.length < 1 || origin.length > 255 || parts.slice(1, 4).some(v => v.length !== 16) || value.attempt.length !== 32 || value.serverPublicKey.length !== 32) throw new AuthError(400);
  const size = Buffer.alloc(2); size.writeUInt16BE(origin.length);
  return Buffer.concat([size, ...parts]);
}
function loginContext(value) {
  const origin=Buffer.from(value.origin,'ascii'),size=Buffer.alloc(2),epoch=Buffer.alloc(8);size.writeUInt16BE(origin.length);epoch.writeBigUInt64BE(BigInt(value.epoch));
  return Buffer.concat([Buffer.from('127Vaults/login-context/1\0'),size,origin,uuidBytes(value.installation),uuidBytes(value.account),uuidBytes(value.device),epoch,value.attempt]);
}
export const authenticationContextHash = binding => createHash('sha512').update(loginContext(binding)).digest();

/** Isolates generated Node/WASM glue from HTTP and storage policy. */
export class OpaqueAdapter {
  constructor(bridge) { if (!bridge) throw new Error('OPAQUE bridge required.'); this.bridge = bridge; }
  serverLoginStart({ setup, record, request, binding }) {
    const bindingBytes = encodeBinding(binding);
    const step = this.bridge.server_login_start(setup, record ?? undefined, request, bindingBytes);
    return { state: Buffer.from(step.state()), message: Buffer.from(step.message()), bindingBytes };
  }
  serverLoginFinish({ state, finalization, binding }) { return Buffer.from(this.bridge.server_login_finish(state, finalization, encodeBinding(binding))); }
  serverRegistrationFinish(upload) { return Buffer.from(this.bridge.server_registration_finish(upload)); }
  serverRegistrationStart({setup,request,binding}) { return Buffer.from(this.bridge.server_registration_start(setup,request,encodeBinding(binding))); }
  rootResponseTag({ sessionKey, binding, request, response, finalization, descriptor, envelope }) {
    if(sessionKey.length!==64||request.length!==96||response.length!==320||finalization.length!==64||descriptor.length>4096||envelope.length>16384)throw new AuthError();
    const contextHash = authenticationContextHash(binding);
    const salt=createHash('sha512').update('127Vaults/session-salt/1\0').update(contextHash).digest();
    const key=Buffer.from(hkdfSync('sha512',sessionKey,salt,'127Vaults/root-tag-key/1',32));
    const transcript=createHash('sha512').update(request).update(response).update(finalization).digest();
    const dl=Buffer.alloc(2),el=Buffer.alloc(4);dl.writeUInt16BE(descriptor.length);el.writeUInt32BE(envelope.length);
    const tag=createHmac('sha512',key).update('127Vaults/root-response/1\0').update(contextHash).update(transcript).update(dl).update(descriptor).update(el).update(envelope).digest();key.fill(0);return tag;
  }
}

export function registrationActivationBytes(candidate, opaqueRecord) {
  return Buffer.concat([Buffer.from('127Vaults/first-device-activation/1\0'), uuidBytes(candidate.deviceId), Buffer.from(candidate.signingPublicKey, 'base64url'), createHash('sha512').update(opaqueRecord).digest(), createHash('sha512').update(Buffer.from(candidate.wrappedRootDescriptor, 'base64url')).digest(), createHash('sha512').update(Buffer.from(candidate.wrappedRootEnvelope, 'base64url')).digest(), createHash('sha512').update(Buffer.from(candidate.privateDirectory ?? '', 'base64url')).digest()]);
}
export class RegistrationAdapter {
  constructor({opaque,setup,installation,serverPublicKey,tokenKey,origin,now=()=>Date.now()}){Object.assign(this,{opaque,setup,installation,serverPublicKey,tokenKey,origin,now});}
  async start({accountId,deviceId,request}){
    const requestBytes=Buffer.from(request??'','base64url');if(requestBytes.length!==32||requestBytes.toString('base64url')!==request)throw new AuthError(400);
    if(uuidBytes(accountId).length!==16||uuidBytes(deviceId).length!==16)throw new AuthError(400);
    const attempt=randomBytes(32),expires=this.now()+120000,binding={origin:this.origin,installation:this.installation,account:accountId,device:deviceId,epoch:1,attempt,serverPublicKey:this.serverPublicKey};
    const response=await this.opaque.serverRegistrationStart({setup:this.setup,request:requestBytes,binding});
    const payload=Buffer.from(JSON.stringify({v:2,accountId,deviceId,installation:this.installation,origin:this.origin,attempt:attempt.toString('base64url'),expires}));const mac=createHmac('sha256',this.tokenKey).update('registration-artifact\0').update(payload).digest();
    return {response:response.toString('base64url'),binding:encodeBinding(binding).toString('base64url'),registrationArtifact:`${payload.toString('base64url')}.${mac.toString('base64url')}`};
  }
  verifyArtifact(candidate){const [body,tag,...rest]=String(candidate.registrationArtifact??'').split('.');if(rest.length||!body||!tag)throw new AuthError(400);const payload=Buffer.from(body,'base64url'),provided=Buffer.from(tag,'base64url'),expected=createHmac('sha256',this.tokenKey).update('registration-artifact\0').update(payload).digest();if(provided.length!==32||!provided.equals(expected))throw new AuthError(400);let value;try{value=JSON.parse(payload);}catch{throw new AuthError(400);}if(value.v!==2||value.expires<this.now()||value.accountId!==candidate.accountId||value.deviceId!==candidate.deviceId||value.installation!==this.installation||value.origin!==this.origin)throw new AuthError(400);return value;}
}
export function createRegistrationCompletion(opaque, registration) {
  return async candidate => {
    if (!candidate || typeof candidate !== 'object') throw new AuthError(400);
    registration?.verifyArtifact(candidate);
    const upload = Buffer.from(candidate.opaqueUpload ?? '', 'base64url');
    const signature = Buffer.from(candidate.activationSignature ?? '', 'base64url');
    if (upload.length !== 192 || signature.length !== 64) throw new AuthError(400);
    let record; try { record = await opaque.serverRegistrationFinish(upload); } catch { throw new AuthError(400); }
    if (record.length !== 192) throw new AuthError(400);
    const raw = Buffer.from(candidate.signingPublicKey ?? '', 'base64url');
    if (raw.length !== 32) throw new AuthError(400);
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    const completed = { ...candidate, opaqueRecord: record.toString('base64url') };
    delete completed.opaqueUpload; delete completed.activationSignature; delete completed.registrationArtifact;
    if (!verify(null, registrationActivationBytes(completed, record), publicKey, signature)) throw new AuthError(400);
    return completed;
  };
}
