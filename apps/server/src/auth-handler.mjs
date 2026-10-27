import { requestSource } from './relay-ingress.mjs';
import { randomBytes } from 'node:crypto';
import { AUTH_COOKIE, AuthError, clearSessionCookie, requireUnsafeRequest, sessionCookie, strictJson } from './auth-policy.mjs';
import { readRequestBody, writeError, writeJson } from './http-boundary.mjs';

const CEREMONY_COOKIE = '__Host-127v-ceremony';
const AUTH_ID = '[A-Za-z0-9_-]{43}';

function cookie(req, name) {
  const matches = String(req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

const ceremonyCookie = csrf => `${CEREMONY_COOKIE}=${csrf}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=120`;

/** HTTP-only orchestration. AuthService owns protocol verification and atomic storage. */
export function createAuthHandler(service, configuredOrigin) {
  if (!service || typeof configuredOrigin !== 'string' || !configuredOrigin.startsWith('https://')) throw new Error('Reviewed authentication service and HTTPS origin are required.');
  return async function handle(req, res) {
    const url = new URL(req.url, configuredOrigin);
    const passwordMatch = url.pathname.match(new RegExp(`^/api/v1/auth/(${AUTH_ID})/password$`));
    const deviceMatch = url.pathname.match(new RegExp(`^/api/v1/auth/(${AUTH_ID})/device-proof$`));
    const v1Start = url.pathname === '/api/v1/auth/';
    const v1Session = url.pathname === '/api/v1/session';
    const v1Ceremony = url.pathname === '/api/v1/ceremony';
    if (!v1Start && !v1Session && !v1Ceremony && !passwordMatch && !deviceMatch) return false;
    const reply = (status, value, headers = {}) => writeJson(res, status, value, headers);
    try {
      if (v1Ceremony) {
        if (req.method !== 'GET') { writeError(res, 405, 'method_not_allowed'); return true; }
        const csrf = randomBytes(32).toString('base64url');
        reply(200, { csrf }, { 'Set-Cookie': ceremonyCookie(csrf) }); return true;
      }
      if (v1Start) {
        if (req.method !== 'POST') { writeError(res, 405, 'method_not_allowed'); return true; }
        if (req.headers.origin !== configuredOrigin) throw new AuthError(403);
        const value = strictJson(req, await readRequestBody(req), ['username', 'deviceId', 'request']);
        const csrf = randomBytes(32).toString('base64url');
        const result = await service.start({ ...value, origin: configuredOrigin, source: requestSource(req) });
        reply(200, { ...result, csrf }, { 'Set-Cookie': ceremonyCookie(csrf) }); return true;
      }
      if (passwordMatch) {
        if (req.method !== 'POST') { writeError(res, 405, 'method_not_allowed'); return true; }
        requireUnsafeRequest(req, configuredOrigin, req.headers['x-127v-csrf'], cookie(req, CEREMONY_COOKIE));
        const value = strictJson(req, await readRequestBody(req), ['finalization']);
        const password = await service.finishPassword({ attemptId: passwordMatch[1], ...value });
        reply(200, await service.consumeRoot({ attemptId: passwordMatch[1], capability: password.capability })); return true;
      }
      if (deviceMatch) {
        if (req.method !== 'POST') { writeError(res, 405, 'method_not_allowed'); return true; }
        requireUnsafeRequest(req, configuredOrigin, req.headers['x-127v-csrf'], cookie(req, CEREMONY_COOKIE));
        const value = strictJson(req, await readRequestBody(req), ['signature']);
        const result = await service.finishDevice({ attemptId: deviceMatch[1], ...value });
        reply(200, { csrf: result.csrf, expiresAt: result.expiresAt }, { 'Set-Cookie': sessionCookie(result.token) }); return true;
      }
      if (v1Session) {
        if (req.method !== 'DELETE') { writeError(res, 405, 'method_not_allowed'); return true; }
        const token = cookie(req, AUTH_COOKIE); if (!token) throw new AuthError();
        const auth = await service.authenticate(token);
        requireUnsafeRequest(req, configuredOrigin, req.headers['x-127v-csrf'], auth.csrf);
        await service.logout(token);
        reply(200, { loggedOut: true }, { 'Set-Cookie': clearSessionCookie() }); return true;
      }

    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      const headers = error instanceof AuthError && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
      writeError(res, status, status === 429 ? 'rate_limited' : 'authentication_failed', headers); return true;
    }
  };
}
