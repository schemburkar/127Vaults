import { from64, verifyLicenseIssuer } from './crypto.mjs';

// Operator-only entitlement policy. Public requests cannot select development.
export async function developmentPolicy(input, keys, at) {
  if (Object.keys(input).join(',') === 'license') {
    const license = typeof input.license === 'string' ? input.license : JSON.stringify(input.license);
    if (!await verifyLicenseIssuer(license,keys)) throw Error('invalid_development_license');
    const payload = JSON.parse(new TextDecoder().decode(from64(JSON.parse(license).payload)));
    if (payload.plan !== 'development' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.installationId ?? '')
      || !Number.isSafeInteger(payload.maxActiveUsers) || payload.maxActiveUsers < 1 || payload.maxActiveUsers > 100
      || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
      || !Number.isFinite(Date.parse(payload.notBefore)) || Date.parse(payload.notBefore) > at
      || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= at) throw Error('invalid_development_license');
    return {kind:'development',maxUsers:payload.maxActiveUsers,license,installationId:payload.installationId,
      activatedAt:payload.issuedAt,expiresAt:payload.expiresAt,entitlementExpiresAt:payload.expiresAt};
  }
  if (Object.keys(input).sort().join(',') !== 'expiresAt,maxUsers' || !Number.isSafeInteger(input.maxUsers)
    || input.maxUsers < 1 || input.maxUsers > 100 || typeof input.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= at
    || Date.parse(input.expiresAt) > at + 3660 * 86400000) throw Error('invalid_development_policy');
  return {kind:'development',maxUsers:input.maxUsers,entitlementExpiresAt:new Date(input.expiresAt).toISOString()};
}
