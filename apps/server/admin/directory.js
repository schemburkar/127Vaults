import { directoryStatus } from './directory-presentation.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const date = value => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not available';
};
export const label = value => ({ rotation_required: 'Rotation required', unknown: 'Unknown', recorded: 'Recorded', current: 'Current', replaced: 'Replaced', stale: 'Stale', platform: 'Platform', software: 'Software', hardware: 'Hardware', online: 'Online' })[value] ?? directoryStatus(value).label;
export function badge(value) {
  const tone = ['online', 'current', 'hardware', 'platform'].includes(value) ? 'good' : ['unknown', 'rotation_required', 'stale'].includes(value) ? 'warn' : directoryStatus(value).tone;
  return `<span class="pill ${tone}">${escapeHtml(label(value))}</span>`;
}
export function newDirectory() {
  return { data: null, error: '', loading: false, checkedAt: null, request: 0, controller: null, filters: { q: '', status: '', role: '', signIn: '', protection: '', credential: '', sort: 'newest', pageSize: 25, accountId: '' }, page: 1, accountName: '' };
}
export function directoryQuery(kind, directory) {
  const params = new URLSearchParams({ page: String(directory.page), pageSize: String(directory.filters.pageSize), sort: directory.filters.sort || 'newest' });
  for (const key of kind === 'users' ? ['q', 'status', 'role', 'signIn'] : kind === 'devices' ? ['q', 'status', 'protection', 'credential', 'accountId'] : ['q', 'status']) {
    if (directory.filters[key]) params.set(key, directory.filters[key]);
  }
  return params.toString();
}
const options = (values, selected) => values.map(([value, text]) => `<option value="${value}" ${String(selected) === value ? 'selected' : ''}>${text}</option>`).join('');
const signInLabel = status => ({ clear: 'No authentication lock', locked: 'Sign-in locked', delayed: 'Sign-in temporarily delayed' })[status] ?? 'Unavailable';
const sortNames = { newest: 'Newest first', oldest: 'Oldest first', username: 'Username A–Z', account: 'Account A–Z', expires: 'Expires soonest', email: 'Recipient A–Z' };
function sortControl(kind, directory) {
  const values = kind === 'users' ? ['newest', 'oldest', 'username'] : kind === 'devices' ? ['newest', 'oldest', 'account'] : ['newest', 'oldest', 'expires', 'email'];
  return `<label class="field">Sort by<select name="sort" aria-label="Sort by" ${directory.loading ? 'disabled' : ''}>${options(values.map(value => [value, sortNames[value]]), directory.filters.sort)}</select></label>`;
}
function topPagination(data, loading) {
  if (!data || !(data.pageCount > 1)) return '';
  return `<div class="pagination pagination-top"><form id="page-jump" class="page-jump" aria-label="Go to a directory page"><label>Page<input name="page" type="number" min="1" max="${data.pageCount}" required value="${data.page}" aria-label="Page number" ${loading ? 'disabled' : ''}></label><span class="muted">of ${data.pageCount}</span><button class="button compact" type="submit" ${loading ? 'disabled' : ''}>Go</button></form><div><button type="button" class="button compact" data-page-change="-1" ${loading || !data.hasPrevious ? 'disabled' : ''} aria-label="Previous page">←</button><button type="button" class="button compact" data-page-change="1" ${loading || !data.hasNext ? 'disabled' : ''} aria-label="Next page">→</button></div></div>`;
}
export function directoryView(kind, directory) {
  if (kind === 'invitations') return invitationsView(directory);
  const isUsers = kind === 'users';
  const { data, filters, loading, error } = directory;
  const items = data?.[kind] ?? [];
  const disabled = loading ? 'disabled' : '';
  const filtered = Boolean(filters.q || filters.status || (isUsers ? filters.role || filters.signIn : filters.protection || filters.credential || filters.accountId));
  const resultName = data?.total === 1 ? isUsers ? 'user' : 'device' : kind;
  const summary = data ? data.total ? `Showing ${(data.page - 1) * data.pageSize + 1}–${(data.page - 1) * data.pageSize + items.length} of ${data.total} ${filtered ? 'matching ' : ''}${resultName}` : `0 ${filtered ? 'matching ' : ''}${kind}` : 'No results loaded';
  return `<p class="muted">${isUsers ? 'Find accounts and inspect their active devices.' : 'Inspect device status and protection across server accounts.'} This directory is read only.</p>
    <section class="panel directory" aria-labelledby="directory-title">
      <div class="panel-head"><h2 id="directory-title">${isUsers ? 'Account directory' : 'Device inventory'}</h2><span class="pill">Read only</span></div>
      ${!isUsers && filters.accountId ? `<div class="account-scope"><span>Devices for <strong>${escapeHtml(directory.accountName || filters.accountId)}</strong></span><button class="button compact" type="button" id="clear-account">All accounts</button></div>` : ''}
      <form id="directory-filters" class="filters" role="search" aria-label="Search ${kind}">
        <label class="field search-field">Search ${kind}<input id="directory-search" name="q" type="search" maxlength="120" value="${escapeHtml(filters.q)}" placeholder="${isUsers ? 'Name, username, email or account ID' : 'Device ID, username or account name'}" ${disabled}></label>
        <label class="field">Status<select name="status" aria-label="Status" ${disabled}>${options([['', 'All statuses'], ...((isUsers ? ['active', 'pending', 'suspended'] : ['active', 'pending', 'revoked', 'replaced']).map(value => [value, label(value)]))], filters.status)}</select></label>
        <label class="field">${isUsers ? 'Role' : 'Protection'}<select name="${isUsers ? 'role' : 'protection'}" aria-label="${isUsers ? 'Role' : 'Protection'}" ${disabled}>${options([['', isUsers ? 'All roles' : 'All protection'], ...(isUsers ? ['owner', 'admin', 'user'] : ['unknown', 'software', 'platform', 'hardware']).map(value => [value, label(value)])], isUsers ? filters.role : filters.protection)}</select></label>
        ${isUsers ? `<label class="field">Sign-in<select name="signIn" aria-label="Sign-in" ${disabled}>${options([['', 'Any sign-in state'], ['blocked', 'Locked or delayed'], ['locked', 'Locked'], ['delayed', 'Temporarily delayed']], filters.signIn)}</select></label>` : ''}
        ${!isUsers ? `<label class="field">Credentials<select name="credential" aria-label="Credentials" ${disabled}>${options([['', 'All credentials'], ...['current', 'rotation_required', 'stale'].map(value => [value, label(value)])], filters.credential)}</select></label>` : ''}
        ${sortControl(kind, directory)}
        <div class="filter-actions"><button class="button primary" type="submit" ${disabled}>Search</button><button class="button" type="button" id="clear-filters" ${disabled || !filtered ? 'disabled' : ''}>Clear</button></div>
      </form>
      <div class="results-bar"><p id="directory-summary" class="muted" role="status" tabindex="-1">${loading ? 'Loading ' + kind + '…' : escapeHtml(summary)}</p><label class="page-size">Rows per page<select id="page-size" aria-label="Rows per page" ${disabled}>${options([['25', '25'], ['50', '50'], ['100', '100']], filters.pageSize)}</select></label></div>
      ${topPagination(data, loading)}
      ${error ? `<div class="notice error" role="alert"><p>${escapeHtml(error)}</p>${data ? '<p>These are the last loaded results; they may be out of date.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}
      <div class="table-wrap" tabindex="0" role="region" aria-label="${isUsers ? 'Account' : 'Device'} results" aria-busy="${loading}">
        <table><caption class="sr-only">${escapeHtml(summary)}. ${escapeHtml(sortNames[filters.sort] || sortNames.newest)}.</caption><thead><tr>${(isUsers ? ['Account', 'Server role', 'Status', 'Active devices', 'Created', 'Details'] : ['Device', 'Account', 'Status', 'Protection', 'Added', 'Details']).map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>
        ${items.map((item, index) => isUsers ? `<tr><td data-label="Account" class="identity-cell"><span class="name">${escapeHtml(item.displayName || item.username)}</span><span class="sub">${escapeHtml(item.username)}</span><span class="sub">${escapeHtml(item.email)}</span></td><td data-label="Server role">${badge(item.role)}</td><td data-label="Status">${badge(item.status)}${['locked', 'delayed'].includes(item.signInStatus) ? `<span class="sub">${signInLabel(item.signInStatus)}</span>` : ''}<span class="sub">Email ${item.emailVerified ? 'verified' : 'unverified'}</span></td><td data-label="Active devices"><button type="button" class="text-button" data-account="${index}" ${disabled} aria-label="View devices for ${escapeHtml(item.username)}">${escapeHtml(item.deviceCount)} active <span aria-hidden="true">↗</span></button></td><td data-label="Created">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button type="button" class="button compact" data-details="${index}" ${disabled} aria-label="View account details for ${escapeHtml(item.username)}">View</button></td></tr>`
          : `<tr><td data-label="Device" class="identity-cell"><span class="name mono" title="${escapeHtml(item.id)}">${escapeHtml(item.id.slice(0, 8))}…</span><span class="sub">Credentials: ${escapeHtml(label(item.credentialState))}</span></td><td data-label="Account"><span class="name">${escapeHtml(item.displayName || item.username)}</span><span class="sub">${escapeHtml(item.username)}</span></td><td data-label="Status">${badge(item.status)}</td><td data-label="Protection">${badge(item.protection)}</td><td data-label="Added">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button type="button" class="button compact" data-details="${index}" ${disabled} aria-label="View device details for ${escapeHtml(item.id)}">View</button></td></tr>`).join('')}
        ${!items.length ? `<tr><td colspan="6"><div class="empty-state"><h3>${loading ? 'Loading ' + kind + '…' : error ? 'Results are unavailable' : filtered ? 'No matching ' + kind : isUsers ? 'No accounts yet' : 'No devices yet'}</h3><p>${loading ? 'Fetching the latest directory from your server.' : error ? 'Try again when your server is reachable.' : filtered ? 'Try a different search or clear the filters.' : isUsers ? 'Accounts appear after vault-account enrollment.' : 'Enrolled devices will appear here.'}</p></div></td></tr>` : ''}
        </tbody></table>
      </div>
      ${data ? `<div class="pagination" aria-label="${kind} pagination"><span class="muted">Page ${data.page} of ${data.pageCount}</span><div><button class="button" type="button" id="previous-page" data-page-change="-1" ${loading || !data.hasPrevious ? 'disabled' : ''}>Previous</button><button class="button" type="button" id="next-page" data-page-change="1" ${loading || !data.hasNext ? 'disabled' : ''}>Next</button></div></div><p class="footnote">Last loaded ${escapeHtml(date(directory.checkedAt))}. ${escapeHtml(sortNames[filters.sort] || sortNames.newest)}.</p>` : ''}
    </section>`;
}

export function reviewQueue(overview) {
  const entries = [];
  const add = (count, title, detail, kind, action, filters, tone = 'warn') => {
    if (!Number.isInteger(count) || count <= 0) return;
    entries.push(`<li><div><h3><span class="pill ${tone}">${count}</span> ${title}</h3><p class="muted">${detail}</p></div><button type="button" class="button" data-inspect="${kind}" ${Object.entries(filters).map(([key, value]) => `data-${key}="${value}"`).join(' ')}>${action}</button></li>`);
  };
  add(overview.users?.sign_in_blocked, 'Accounts with sign-in restrictions', 'Review temporary delays and authentication locks after failed attempts.', 'users', 'Review sign-in restrictions', { 'sign-in': 'blocked' });
  add(overview.invitations?.pending, 'Pending invitation recipients', 'These recipients have a valid invitation but have not completed enrollment.', 'invitations', 'Review pending', { status: 'pending' }, '');
  add(overview.invitations?.expired, 'Expired invitation recipients', 'These recipients did not enroll before their invitation expired.', 'invitations', 'Review expired', { status: 'expired' });
  add(overview.devices?.rotationRequired, 'Devices needing credential rotation', 'Active devices report that their credentials need to be rotated.', 'devices', 'Review rotation', { status: 'active', credential: 'rotation_required' });
  add(overview.devices?.stale, 'Devices with stale credentials', 'Inspect these active devices and their credential state in the account workflow.', 'devices', 'Review credentials', { status: 'active', credential: 'stale' });
  add(overview.devices?.unknownProtection, 'Devices with unclassified protection', 'Protection has not been classified for these active devices. Unknown does not confirm device protection.', 'devices', 'Review protection', { status: 'active', protection: 'unknown' }, '');
  if (overview.backup?.state === 'unknown') entries.push('<li><div><h3><span class="pill warn">Unknown</span> Backup freshness</h3><p class="muted">Verify backup logs and your last restore rehearsal in the operator runbook.</p></div><button type="button" class="button" data-section="backups">Review backups</button></li>');
  if (!overview.invitations || !overview.devices) entries.push('<li><div><h3><span class="pill warn">Unknown</span> Review counts unavailable</h3><p class="muted">This check did not include invitation and device review counts. Refresh after the server is updated.</p></div></li>');
  return `<section class="panel"><h2>Review queue</h2><p class="muted">Follow up on invitations, device credentials and backup visibility. Inspection here is read only.</p>${entries.length ? `<ul class="review-list">${entries.join('')}</ul>` : '<p class="muted">No invitation or device follow-ups are reported in this check.</p>'}</section>`;
}

export function detailsView(kind, item) {
  if (kind === 'invitations') return invitationDetails(item);
  const isUsers = kind === 'users';
  const fields = isUsers
    ? [['Display name', item.displayName], ['Username', item.username], ['Email', item.email], ['Email verification', item.emailVerified ? 'Verified' : 'Unverified'], ['Server role', label(item.role)], ['Account status', label(item.status)], ['Sign-in', signInLabel(item.signInStatus)], ...(item.signInRetryAt ? [['Retry after', date(item.signInRetryAt)]] : []), ['Active devices', item.deviceCount], ['Created', date(item.createdAt)]]
    : [['Account', item.displayName || item.username], ['Username', item.username], ['Account ID', item.accountId], ['Device status', label(item.status)], ['Credential state', label(item.credentialState)], ['Protection', label(item.protection)], ['Added', date(item.createdAt)], ['Revoked / replaced', item.revokedAt ? date(item.revokedAt) : ['revoked', 'replaced'].includes(item.status) ? 'Not available' : 'Not revoked']];
  return `<dialog id="details-dialog" aria-labelledby="details-title"><div class="dialog-head"><div><p class="eyebrow">${isUsers ? 'Account' : 'Device'} details</p><h2 id="details-title">${escapeHtml(isUsers ? item.displayName || item.username : 'Device ' + item.id.slice(0, 8))}</h2></div><button class="button compact" id="close-details" type="button" autofocus>Close</button></div><dl class="details-list">${fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value ?? 'Not available')}</dd></div>`).join('')}</dl><label class="field">${isUsers ? 'Account' : 'Device'} ID<input class="mono" readonly value="${escapeHtml(item.id)}" aria-label="Full ${isUsers ? 'account' : 'device'} ID"></label><button class="button" id="copy-id" type="button">Copy ID</button><p id="copy-status" class="footnote" role="status"></p>${isUsers ? '<button class="button primary" id="details-devices" type="button">View devices</button>' : '<p class="footnote">Protection is reported metadata; unknown means it has not been classified. Revocation and device reports are not available in this console.</p>'}</dialog>`;
}

function invitationsView(directory) {
  const { data, filters, loading, error } = directory;
  const items = data?.invitations ?? [];
  const disabled = loading ? 'disabled' : '';
  const filtered = Boolean(filters.q || filters.status);
  const summary = data ? data.total ? `Showing ${(data.page - 1) * data.pageSize + 1}–${(data.page - 1) * data.pageSize + items.length} of ${data.total} ${filtered ? 'matching ' : ''}invitation ${data.total === 1 ? 'recipient' : 'recipients'}` : `0 ${filtered ? 'matching ' : ''}invitation recipients` : 'No results loaded';
  return `<p class="muted">Track enrollment invitations without exposing activation links or tokens. Each row is one recipient; an invitation may cover several recipients.</p>
    <section class="panel directory" aria-labelledby="directory-title"><div class="panel-head"><h2 id="directory-title">Invitation recipients</h2><span class="pill">Read only</span></div>
      <form id="directory-filters" class="filters" role="search" aria-label="Search invitations"><label class="field search-field">Search invitations<input id="directory-search" name="q" type="search" maxlength="120" value="${escapeHtml(filters.q)}" placeholder="Recipient email, inviter or invitation ID" ${disabled}></label><label class="field">Status<select name="status" aria-label="Status" ${disabled}>${options([['', 'All statuses'], ...['pending', 'expired', 'revoked', 'redeemed'].map(value => [value, label(value)])], filters.status)}</select></label>${sortControl('invitations', directory)}<div class="filter-actions"><button class="button primary" type="submit" ${disabled}>Search</button><button class="button" type="button" id="clear-filters" ${loading || !filtered ? 'disabled' : ''}>Clear</button></div></form>
      <div class="results-bar"><p id="directory-summary" class="muted" role="status" tabindex="-1">${loading ? 'Loading invitations…' : escapeHtml(summary)}</p><label class="page-size">Rows per page<select id="page-size" aria-label="Rows per page" ${disabled}>${options([['25', '25'], ['50', '50'], ['100', '100']], filters.pageSize)}</select></label></div>
      ${topPagination(data, loading)}
      ${error ? `<div class="notice error" role="alert"><p>${escapeHtml(error)}</p>${data ? '<p>These are the last loaded results; they may be out of date.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}
      <div class="table-wrap" tabindex="0" role="region" aria-label="Invitation results" aria-busy="${loading}"><table><caption class="sr-only">${escapeHtml(summary)}. ${escapeHtml(sortNames[filters.sort] || sortNames.newest)}.</caption><thead><tr>${['Recipient', 'Status', 'Invited by', 'Expires', 'Created', 'Details'].map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>${items.map((item, index) => `<tr><td data-label="Recipient" class="identity-cell"><span class="name">${escapeHtml(item.email)}</span><span class="sub mono">${escapeHtml(item.id.slice(0, 8))}…</span></td><td data-label="Status">${badge(item.status)}</td><td data-label="Invited by">${escapeHtml(item.createdBy)}</td><td data-label="Expires">${escapeHtml(date(item.expiresAt))}</td><td data-label="Created">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button class="button compact" type="button" data-details="${index}" ${disabled} aria-label="View invitation details for ${escapeHtml(item.email)}">View</button></td></tr>`).join('')}${!items.length ? `<tr><td colspan="6"><div class="empty-state"><h3>${loading ? 'Loading invitations…' : error ? 'Results are unavailable' : filtered ? 'No matching invitations' : 'No invitations yet'}</h3><p>${loading ? 'Fetching invitation recipients from your server.' : error ? 'Try again when your server is reachable.' : filtered ? 'Try a different search or clear the filters.' : 'Recipients appear after invitations are created through the owner onboarding workflow.'}</p></div></td></tr>` : ''}</tbody></table></div>
      ${data ? `<div class="pagination" aria-label="invitations pagination"><span class="muted">Page ${data.page} of ${data.pageCount}</span><div><button class="button" type="button" id="previous-page" data-page-change="-1" ${loading || !data.hasPrevious ? 'disabled' : ''}>Previous</button><button class="button" type="button" id="next-page" data-page-change="1" ${loading || !data.hasNext ? 'disabled' : ''}>Next</button></div></div><p class="footnote">Last loaded ${escapeHtml(date(directory.checkedAt))}. ${escapeHtml(sortNames[filters.sort] || sortNames.newest)}. Refresh to update expiration status.</p>` : ''}
      <p class="footnote">Pending means the recipient has not redeemed a currently valid invitation. Redeemed recipients stay redeemed when the remaining invitation expires or is revoked. Create invitations through the existing owner onboarding workflow. Resend and revocation controls are not available in this console.</p>
    </section>`;
}

function invitationDetails(item) {
  const fields = [['Recipient email', item.email], ['Status', label(item.status)], ['Invited by', item.createdBy], ['Created', date(item.createdAt)], ['Expires', date(item.expiresAt)], ['Redeemed', item.redeemedAt ? date(item.redeemedAt) : 'Not redeemed'], ['Revoked', item.revokedAt ? date(item.revokedAt) : 'Not revoked']];
  return `<dialog id="details-dialog" aria-labelledby="details-title"><div class="dialog-head"><div><p class="eyebrow">Invitation details</p><h2 id="details-title">${escapeHtml(item.email)}</h2></div><button class="button compact" id="close-details" type="button" autofocus>Close</button></div><dl class="details-list">${fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value ?? 'Not available')}</dd></div>`).join('')}</dl><label class="field">Invitation ID<input class="mono" readonly value="${escapeHtml(item.id)}" aria-label="Full invitation ID"></label><button class="button" id="copy-id" type="button">Copy ID</button><p id="copy-status" class="footnote" role="status"></p><p class="footnote">This is an internal record ID. Activation links, invitation tokens and verification codes are not available in the console. This page does not send or change invitations.</p></dialog>`;
}
