export class ApiError extends Error {
  constructor(code, status = 0, retryAfter = 0) { super(code); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => text(value) && Number.isFinite(new Date(value).getTime());
const optionalTimestamp = value => value === null || value === undefined || timestamp(value);

export function validResponse(path, method, value) {
  if (!object(value)) return false;
  const kind = path.split('?')[0];
  if (kind === 'session') {
    if (method === 'DELETE') return value.signedOut === true;
    return text(value.username) && ['owner', 'admin'].includes(value.role) && text(value.csrf) && /^[A-Za-z0-9_-]{43}$/.test(value.csrf) && timestamp(value.expiresAt);
  }
  if (kind === 'overview') {
    return text(value.status) && timestamp(value.checkedAt) && integer(value.schemaVersion) && integer(value.expectedSchemaVersion)
      && object(value.users) && integer(value.users.users) && integer(value.users.active_users) && integer(value.activeDevices)
      && (!value.backup || object(value.backup) && text(value.backup.state) && (value.backup.detail === undefined || text(value.backup.detail)));
  }
  if (!['users', 'devices', 'invitations'].includes(kind)) return false;
  if (!Array.isArray(value[kind]) || !integer(value.total) || !integer(value.page) || value.page < 1
    || !integer(value.pageSize) || value.pageSize < 1 || value.pageSize > 100 || !integer(value.pageCount)
    || value.pageCount !== Math.max(1, Math.ceil(value.total / value.pageSize)) || value.page > value.pageCount
    || typeof value.hasPrevious !== 'boolean' || typeof value.hasNext !== 'boolean' || value[kind].length > value.pageSize) return false;
  return value[kind].every(item => {
    if (!object(item) || !text(item.id) || !item.id || !text(item.status) || !timestamp(item.createdAt)) return false;
    if (kind === 'users') return text(item.username) && text(item.displayName) && text(item.email) && text(item.role) && integer(item.deviceCount) && typeof item.emailVerified === 'boolean';
    if (kind === 'devices') return text(item.accountId) && text(item.username) && text(item.displayName) && text(item.protection) && text(item.credentialState) && optionalTimestamp(item.revokedAt);
    return text(item.email) && text(item.createdBy) && timestamp(item.expiresAt) && optionalTimestamp(item.revokedAt) && optionalTimestamp(item.redeemedAt);
  });
}

export async function requestAdmin(path, options = {}, fetcher = globalThis.fetch) {
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response;
  try { response = await fetcher(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, signal }); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? 'request_timeout' : 'network_unavailable');
  }
  let result;
  try { result = await response.json(); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? 'request_timeout' : 'server_unavailable', response.status);
  }
  if (!response.ok) {
    const seconds = Number(response.headers.get('Retry-After'));
    const retryAfter = Number.isInteger(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 0;
    throw new ApiError(result?.error || 'request_failed', response.status, retryAfter);
  }
  if (!validResponse(path, options.method || 'GET', result)) throw new ApiError('incompatible_response', response.status);
  return result;
}

export function errorMessage(error) {
  if (error.code === 'rate_limited' && error.retryAfter) return 'Too many sign-in attempts. Try again when the short wait ends.';
  return ({
    invalid_credentials: 'Check your operator name and password.',
    rate_limited: 'Too many sign-in attempts. Wait a minute, then try again.',
    admin_not_configured: 'Operator access is not configured. Create the local operator file and restart the server using the administration runbook.',
    local_only: 'Server administration is available only on a loopback deployment. Open the console on the local server.',
    forbidden: 'The server refused this request. Reload the page to obtain a fresh session and try again.',
    admin_data_unavailable: 'The server could not read its administration data. Check the API and database, then try again.',
    network_unavailable: 'Cannot reach the server. Check your connection and that the server is running, then try again.',
    request_timeout: 'The server took too long to respond. Check the server, then try again.',
    server_unavailable: 'The server returned an unavailable or unexpected response. Check the server, then try again.',
    incompatible_response: 'The server returned data this console could not display. Reload the page and check that the console and server versions match.',
    invalid_directory_query: 'These filters could not be applied. Clear the filters and try again.',
  })[error.code] ?? 'The request could not be completed. Try again.';
}
