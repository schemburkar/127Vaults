import { token, hash, equal } from './crypto.mjs';
import { paidPersonalAccess, reject } from './dodo.mjs';
export const clientArtifact = asset => ['desktop','cli','extension','installer'].includes(asset.product);
export function clientAccess(record, now) {
  return record?.state === 'approved' && !record.revocation && !record.billing?.suspended
    && (!record.expiresAt || Date.parse(record.expiresAt)>now)
    && (record.kind!=='personal-purchase' || paidPersonalAccess(record,now));
}
export async function clientGrant(record, bearer, now) {
  if (!clientAccess(record,now) || !bearer) return false;
  const digest=await hash(bearer);
  for (const grant of record.clientDownloads??[]) {
    if (grant.until>now && grant.parent===record.tokenHash && await equal(digest,grant.hash)) return true;
  }
  return false;
}
export async function issueClientLink(store,row,env,now,{revoke=false}={}) {
  if (!row?.contact || !clientAccess(row.trial,now)) reject(409,'client_downloads_unavailable');
  if (revoke) { await store.save(row,{...row.trial,clientDownloads:[]}); return {revoked:true}; }
  const value=token(), until=Math.min(now+7*86400000,row.trial.expiresAt?Date.parse(row.trial.expiresAt):Infinity);
  const grants=(row.trial.clientDownloads??[]).filter(v=>v.until>now&&v.parent===row.trial.tokenHash).slice(-9);
  await store.save(row,{...row.trial,clientDownloads:[...grants,{hash:await hash(value),until,parent:row.trial.tokenHash}]});
  return {link:`${env.CUSTOMER_ORIGIN??env.PUBLIC_INTAKE_ORIGIN}/join#${row.id}.${value}`,expiresAt:new Date(until).toISOString(),scope:'client-downloads'};
}
