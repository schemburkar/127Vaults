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
      && (value.users.active_owners === undefined || integer(value.users.active_owners))
      && (value.users.sign_in_blocked === undefined || integer(value.users.sign_in_blocked))
      && (value.configuration === undefined || object(value.configuration) && integer(value.configuration.operatorCount)
        && typeof value.configuration.smtpConfigured === 'boolean' && typeof value.configuration.subscriptionRefreshConfigured === 'boolean'
        && optionalTimestamp(value.configuration.tlsExpiresAt))
      && (value.devices === undefined || object(value.devices) && ['rotationRequired', 'stale', 'unknownProtection'].every(key => integer(value.devices[key])))
      && (value.invitations === undefined || object(value.invitations) && integer(value.invitations.pending) && integer(value.invitations.expired))
      && (!value.backup || object(value.backup) && text(value.backup.state) && (value.backup.detail === undefined || text(value.backup.detail))
        && optionalTimestamp(value.backup.lastBackupAt) && optionalTimestamp(value.backup.lastRestoreCheckAt));
  }
  if (kind === 'actions') return value.suspended === true || value.reactivated === true || value.authenticationUnlocked === true || value.revoked === true
    || value.cancelled === true || ['user', 'admin'].includes(value.role) || value.acceptanceRequired === true && text(value.grantId) && timestamp(value.expiresAt)
    || text(value.invitationId) && timestamp(value.expiresAt) && integer(value.seatCount) && /^127V-I1-[A-Za-z0-9_-]{43}$/.test(value.token);
  if (kind === 'audit') return Array.isArray(value.events) && value.events.length <= 100 && value.events.every(item => object(item) && text(item.id) && text(item.actor) && text(item.action) && ['accepted', 'denied'].includes(item.outcome) && timestamp(item.createdAt));
  if (kind === 'ownership') return Array.isArray(value.grants) && value.grants.length <= 100 && value.grants.every(item => object(item) && text(item.grantId) && text(item.accountId) && text(item.username) && timestamp(item.expiresAt));
  if (!['users', 'devices', 'invitations'].includes(kind)) return false;
  if (!Array.isArray(value[kind]) || !integer(value.total) || !integer(value.page) || value.page < 1
    || !integer(value.pageSize) || value.pageSize < 1 || value.pageSize > 100 || !integer(value.pageCount)
    || value.pageCount !== Math.max(1, Math.ceil(value.total / value.pageSize)) || value.page > value.pageCount
    || typeof value.hasPrevious !== 'boolean' || typeof value.hasNext !== 'boolean' || value[kind].length > value.pageSize) return false;
  return value[kind].every(item => {
    if (!object(item) || !text(item.id) || !item.id || !text(item.status) || !timestamp(item.createdAt)) return false;
    if (kind === 'users') return text(item.username) && text(item.displayName) && text(item.email) && text(item.role)
      && integer(item.deviceCount) && typeof item.emailVerified === 'boolean' && optionalTimestamp(item.signInRetryAt)
      && (item.signInStatus === undefined || ['clear', 'locked', 'delayed'].includes(item.signInStatus));
    if (kind === 'devices') return text(item.accountId) && text(item.username) && text(item.displayName) && text(item.protection) && text(item.credentialState) && optionalTimestamp(item.revokedAt)
      && optionalTimestamp(item.lastSignInAt) && (item.activeSessions === undefined || integer(item.activeSessions));
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
    admin_not_configured: 'Operator access is not configured. On the server computer, run the installer, select Server and choose to set up local administration.',
    local_only: 'Server administration is available only on a loopback deployment. Open the console on the local server.',
    forbidden: 'The server refused this request. Reload the page to obtain a fresh session and try again.',
    admin_data_unavailable: 'The server could not read its administration data. Check the API and database, then try again.',
    network_unavailable: 'Cannot reach the server. Check your connection and that the server is running, then try again.',
    request_timeout: 'The server took too long to respond. Check the server, then try again.',
    server_unavailable: 'The server returned an unavailable or unexpected response. Check the server, then try again.',
    incompatible_response: 'The server returned data this console could not display. Reload the page and check that the console and server versions match.',
    invalid_directory_query: 'These filters could not be applied. Clear the filters and try again.',
    fresh_auth_required: 'Enter your current operator password to confirm this action.',
    last_active_owner: 'Keep at least one active owner. Ask another enrolled account to accept ownership first.',
    grant_already_pending: 'This account already has a pending ownership request.',
    grant_unavailable: 'This ownership request expired, was cancelled, or was already accepted.',
    recipient_unavailable: 'Choose an active, unsuspended account that is not already an owner.',
    owner_required: 'Complete first-owner enrollment before creating invitations.',
    request_id_reused: 'This request ID belongs to a different action. Close the dialog and start again.',
    email_already_registered: 'One of these emails already belongs to an enrolled account.',
    seat_limit_reached: 'No license seat is available for this action. Ask the operator to review capacity.',
    license_inactive: 'This installation’s license does not allow new seats or invitations.',
    admin_unavailable: 'The action could not be confirmed. Check the server and retry the same action.',
  })[error.code] ?? 'The request could not be completed. Try again.';
}
