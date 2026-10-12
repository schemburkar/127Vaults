import { AUTH_COOKIE, AuthError, requireUnsafeRequest } from './auth-policy.mjs';
import { AdminManagementError } from './admin/management.mjs';
import { readRequestBody, parseJsonObject, writeJson, writeError, HttpBoundaryError } from './http-boundary.mjs';

export function createOwnershipHandler(management, authenticate, origin) {
  return async (req, res) => {
    const path = new URL(req.url, origin).pathname;
    const id = path.match(/^\/api\/v1\/ownership\/requests\/([^/]+)\/accept$/)?.[1];
    if (path !== '/api/v1/ownership/requests' && !id) return false;
    try {
      if (req.method !== (id ? 'POST' : 'GET')) { writeError(res, 405, 'method_not_allowed'); return true; }
      const cookie = String(req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${AUTH_COOKIE}=`));
      if (cookie.length !== 1) throw new AuthError();
      const auth = await authenticate(cookie[0].slice(AUTH_COOKIE.length + 1));
      if (!id) writeJson(res, 200, await management.grants(auth));
      else {
        requireUnsafeRequest(req, origin, req.headers['x-127v-csrf'], auth.csrf);
        const value = parseJsonObject(req, await readRequestBody(req, 1024), ['requestId']);
        writeJson(res, 200, await management.accept(auth, { grantId: id, ...value }));
      }
    } catch (error) {
      const status = error instanceof AuthError ? 401 : error instanceof AdminManagementError || error instanceof HttpBoundaryError ? error.status : 503;
      writeError(res, status, status === 401 ? 'authentication_required' : error instanceof AdminManagementError || error instanceof HttpBoundaryError ? error.code : 'unavailable');
    }
    return true;
  };
}
