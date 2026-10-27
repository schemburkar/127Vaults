import { OnboardingError } from './onboarding.mjs';
import { AUTH_COOKIE, requireUnsafeRequest, strictJson } from './auth-policy.mjs';
import { HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from './http-boundary.mjs';

const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cookie = (req, name) => String(req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);

export function createOnboardingHandler(service, completeRegistration, configuredOrigin, authenticate = async () => { throw new OnboardingError('forbidden', 403); }, registration) {
  if (typeof completeRegistration !== 'function') throw new Error('The reviewed OPAQUE registration/device-proof completion adapter is required.');
  if (typeof configuredOrigin !== 'string' || !configuredOrigin.startsWith('https://')) throw new Error('Configured HTTPS origin is required.');
  return async function handle(req, res, suppliedAuth) {
    const url = new URL(req.url, configuredOrigin);
    const emailMatch = url.pathname.match(/^\/api\/v1\/onboarding\/invitation\/([^/]+)\/email$/);
    const completeMatch = url.pathname.match(/^\/api\/v1\/onboarding\/invitation\/([^/]+)\/complete$/);
    const v1Register = url.pathname === '/api/v1/onboarding/register';
    const v1Invitation = url.pathname === '/api/v1/onboarding/invitation';
    const v1Invitations = url.pathname === '/api/v1/invitations';
    if (!v1Register && !v1Invitation && !v1Invitations && !emailMatch && !completeMatch) return false;
    if (req.method !== 'POST') { writeError(res, 405, 'method_not_allowed'); return true; }
    try {
      const bytes = await readRequestBody(req);
      const ceremony = cookie(req, '__Host-127v-ceremony');
      if (v1Invitations) {
        const token = cookie(req, AUTH_COOKIE);
        const auth = suppliedAuth ?? await authenticate(token);
        requireUnsafeRequest(req, configuredOrigin, req.headers['x-127v-csrf'], auth.csrf);
        if (auth.role !== 'owner') throw new OnboardingError('forbidden', 403);
        const value = strictJson(req, bytes, ['emails', 'expiresInHours']);
        writeJson(res, 200, await service.createInvitation({ ownerAccountId: auth.accountId, ...value })); return true;
      }
      requireUnsafeRequest(req, configuredOrigin, req.headers['x-127v-csrf'], ceremony);
      if (v1Register) {
        const untyped = parseJsonObject(req, bytes);
        const fields = Object.keys(untyped).sort().join(',');
        if (fields === 'accountId,deviceId,email,request,token') {
          if (!registration) throw new OnboardingError('onboarding_failed', 503);
          writeJson(res, 200, await registration.start({ ...untyped, source:req.socket.remoteAddress??'unknown' })); return true;
        }
        if (fields !== 'candidate,token') throw new OnboardingError('onboarding_failed', 400);
        writeJson(res, 200, await service.bootstrapOwner({ ...untyped, candidate: await completeRegistration(untyped.candidate) })); return true;
      }
      if (v1Invitation) {
        const value = strictJson(req, bytes, ['token', 'email', 'candidate']);
        writeJson(res, 200, await service.beginInvitation({ ...value, candidate: await completeRegistration(value.candidate), source: req.socket.remoteAddress ?? 'unknown' })); return true;
      }
      if (emailMatch || completeMatch) {
        const attemptId = (emailMatch ?? completeMatch)[1];
        if (!ATTEMPT_ID.test(attemptId)) throw new OnboardingError('onboarding_failed', 400);
        const value = strictJson(req, bytes, emailMatch ? ['capability'] : ['capability', 'code']);
        const result = emailMatch ? await service.sendEmail({ attemptId, ...value }) : await service.finalizeInvitation({ attemptId, ...value });
        writeJson(res, 200, result); return true;
      }
    } catch (error) {
      const status = error instanceof OnboardingError || error instanceof HttpBoundaryError ? error.status : 400;
      const code = error instanceof OnboardingError && ['seat_limit_reached', 'license_inactive', 'license_unavailable'].includes(error.code)
        ? error.code : status === 429 ? 'rate_limited' : status === 503 ? 'email_unavailable' : 'onboarding_failed';
      writeError(res, status, code); return true;
    }
  };
}
