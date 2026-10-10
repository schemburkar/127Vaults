export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const date = value => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not available';
};
export const label = value => ({ rotation_required: 'Rotation required', unknown: 'Unknown', current: 'Current', pending: 'Pending', active: 'Active', revoked: 'Revoked', replaced: 'Replaced', expired: 'Expired', redeemed: 'Redeemed', stale: 'Stale', platform: 'Platform', software: 'Software', hardware: 'Hardware', owner: 'Owner', admin: 'Admin', user: 'User', online: 'Online' })[value] ?? String(value ?? 'Unknown');
export function badge(value) {
  const tone = ['active', 'owner', 'online', 'current', 'hardware', 'platform', 'redeemed'].includes(value) ? 'good' : ['unknown', 'pending', 'rotation_required', 'stale', 'expired'].includes(value) ? 'warn' : '';
  return `<span class="pill ${tone}">${escapeHtml(label(value))}</span>`;
}
export function newDirectory() {
  return { data: null, error: '', loading: false, checkedAt: null, request: 0, controller: null, filters: { q: '', status: '', role: '', protection: '', pageSize: 25, accountId: '' }, page: 1, accountName: '' };
}
export function directoryQuery(kind, directory) {
  const params = new URLSearchParams({ page: String(directory.page), pageSize: String(directory.filters.pageSize) });
  for (const key of kind === 'users' ? ['q', 'status', 'role'] : kind === 'devices' ? ['q', 'status', 'protection', 'accountId'] : ['q', 'status']) {
    if (directory.filters[key]) params.set(key, directory.filters[key]);
  }
  return params.toString();
}
const options = (values, selected) => values.map(([value, text]) => `<option value="${value}" ${String(selected) === value ? 'selected' : ''}>${text}</option>`).join('');
export function directoryView(kind, directory) {
  if (kind === 'invitations') return invitationsView(directory);
  const isUsers = kind === 'users';
  const { data, filters, loading, error } = directory;
  const items = data?.[kind] ?? [];
  const disabled = loading ? 'disabled' : '';
  const filtered = Boolean(filters.q || filters.status || (isUsers ? filters.role : filters.protection || filters.accountId));
  const summary = data ? data.total ? `Showing ${(data.page - 1) * data.pageSize + 1}–${(data.page - 1) * data.pageSize + items.length} of ${data.total} ${filtered ? 'matching ' : ''}${kind}` : `0 ${filtered ? 'matching ' : ''}${kind}` : 'No results loaded';
  return `<p class="muted">${isUsers ? 'Find accounts and inspect their active devices.' : 'Inspect device status and protection across server accounts.'} This directory is read only.</p>
    <section class="panel directory" aria-labelledby="directory-title">
      <div class="panel-head"><h2 id="directory-title">${isUsers ? 'Account directory' : 'Device inventory'}</h2><span class="pill">Read only</span></div>
      ${!isUsers && filters.accountId ? `<div class="account-scope"><span>Devices for <strong>${escapeHtml(directory.accountName || filters.accountId)}</strong></span><button class="button compact" type="button" id="clear-account">All accounts</button></div>` : ''}
      <form id="directory-filters" class="filters" role="search" aria-label="Search ${kind}">
        <label class="field search-field">Search ${kind}<input id="directory-search" name="q" type="search" maxlength="120" value="${escapeHtml(filters.q)}" placeholder="${isUsers ? 'Name, username, email or account ID' : 'Device ID, username or account name'}" ${disabled}></label>
        <label class="field">Status<select name="status" aria-label="Status" ${disabled}>${options([['', 'All statuses'], ...((isUsers ? ['active', 'pending'] : ['active', 'pending', 'revoked', 'replaced']).map(value => [value, label(value)]))], filters.status)}</select></label>
        <label class="field">${isUsers ? 'Role' : 'Protection'}<select name="${isUsers ? 'role' : 'protection'}" aria-label="${isUsers ? 'Role' : 'Protection'}" ${disabled}>${options([['', isUsers ? 'All roles' : 'All protection'], ...(isUsers ? ['owner', 'user'] : ['unknown', 'software', 'platform', 'hardware']).map(value => [value, label(value)])], isUsers ? filters.role : filters.protection)}</select></label>
        <div class="filter-actions"><button class="button primary" type="submit" ${disabled}>Search</button><button class="button" type="button" id="clear-filters" ${disabled || !filtered ? 'disabled' : ''}>Clear</button></div>
      </form>
      <div class="results-bar"><p id="directory-summary" class="muted" role="status" tabindex="-1">${loading ? 'Loading ' + kind + '…' : escapeHtml(summary)}</p><label class="page-size">Rows per page<select id="page-size" aria-label="Rows per page" ${disabled}>${options([['25', '25'], ['50', '50'], ['100', '100']], filters.pageSize)}</select></label></div>
      ${error ? `<div class="notice error" role="alert"><p>${escapeHtml(error)}</p>${data ? '<p>These are the last loaded results; they may be out of date.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}
      <div class="table-wrap" tabindex="0" role="region" aria-label="${isUsers ? 'Account' : 'Device'} results" aria-busy="${loading}">
        <table><caption class="sr-only">${escapeHtml(summary)}. Ordered by most recently added.</caption><thead><tr>${(isUsers ? ['Account', 'Server role', 'Status', 'Active devices', 'Created', 'Details'] : ['Device', 'Account', 'Status', 'Protection', 'Added', 'Details']).map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>
        ${items.map((item, index) => isUsers ? `<tr><td data-label="Account" class="identity-cell"><span class="name">${escapeHtml(item.displayName || item.username)}</span><span class="sub">${escapeHtml(item.username)}</span><span class="sub">${escapeHtml(item.email)}</span></td><td data-label="Server role">${badge(item.role)}</td><td data-label="Status">${badge(item.status)}<span class="sub">Email ${item.emailVerified ? 'verified' : 'unverified'}</span></td><td data-label="Active devices"><button type="button" class="text-button" data-account="${index}" ${disabled} aria-label="View devices for ${escapeHtml(item.username)}">${escapeHtml(item.deviceCount)} active <span aria-hidden="true">↗</span></button></td><td data-label="Created">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button type="button" class="button compact" data-details="${index}" ${disabled} aria-label="View account details for ${escapeHtml(item.username)}">View</button></td></tr>`
          : `<tr><td data-label="Device" class="identity-cell"><span class="name mono" title="${escapeHtml(item.id)}">${escapeHtml(item.id.slice(0, 8))}…</span><span class="sub">Credentials: ${escapeHtml(label(item.credentialState))}</span></td><td data-label="Account"><span class="name">${escapeHtml(item.displayName || item.username)}</span><span class="sub">${escapeHtml(item.username)}</span></td><td data-label="Status">${badge(item.status)}</td><td data-label="Protection">${badge(item.protection)}</td><td data-label="Added">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button type="button" class="button compact" data-details="${index}" ${disabled} aria-label="View device details for ${escapeHtml(item.id)}">View</button></td></tr>`).join('')}
        ${!items.length ? `<tr><td colspan="6"><div class="empty-state"><h3>${loading ? 'Loading ' + kind + '…' : error ? 'Results are unavailable' : filtered ? 'No matching ' + kind : isUsers ? 'No accounts yet' : 'No devices yet'}</h3><p>${loading ? 'Fetching the latest directory from your server.' : error ? 'Try again when your server is reachable.' : filtered ? 'Try a different search or clear the filters.' : isUsers ? 'Accounts appear after vault-account enrollment.' : 'Enrolled devices will appear here.'}</p></div></td></tr>` : ''}
        </tbody></table>
      </div>
      ${data ? `<div class="pagination" aria-label="${kind} pagination"><span class="muted">Page ${data.page} of ${data.pageCount}</span><div><button class="button" type="button" id="previous-page" ${loading || !data.hasPrevious ? 'disabled' : ''}>Previous</button><button class="button" type="button" id="next-page" ${loading || !data.hasNext ? 'disabled' : ''}>Next</button></div></div><p class="footnote">Last loaded ${escapeHtml(date(directory.checkedAt))}. Newest records first.</p>` : ''}
    </section>`;
}

export function detailsView(kind, item) {
  if (kind === 'invitations') return invitationDetails(item);
  const isUsers = kind === 'users';
  const fields = isUsers
    ? [['Display name', item.displayName], ['Username', item.username], ['Email', item.email], ['Email verification', item.emailVerified ? 'Verified' : 'Unverified'], ['Server role', label(item.role)], ['Account status', label(item.status)], ['Active devices', item.deviceCount], ['Created', date(item.createdAt)]]
    : [['Account', item.displayName || item.username], ['Username', item.username], ['Account ID', item.accountId], ['Device status', label(item.status)], ['Credential state', label(item.credentialState)], ['Protection', label(item.protection)], ['Added', date(item.createdAt)], ['Revoked / replaced', date(item.revokedAt)]];
  return `<dialog id="details-dialog" aria-labelledby="details-title"><div class="dialog-head"><div><p class="eyebrow">${isUsers ? 'Account' : 'Device'} details</p><h2 id="details-title">${escapeHtml(isUsers ? item.displayName || item.username : 'Device ' + item.id.slice(0, 8))}</h2></div><button class="button compact" id="close-details" type="button" autofocus>Close</button></div><dl class="details-list">${fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value ?? 'Not available')}</dd></div>`).join('')}</dl><label class="field">${isUsers ? 'Account' : 'Device'} ID<input class="mono" readonly value="${escapeHtml(item.id)}" aria-label="Full ${isUsers ? 'account' : 'device'} ID"></label><button class="button" id="copy-id" type="button">Copy ID</button><p id="copy-status" class="footnote" role="status"></p>${isUsers ? '<button class="button primary" id="details-devices" type="button">View devices</button>' : '<p class="footnote">Protection is reported metadata; unknown means it has not been classified. Revocation and device reports are not available in this console.</p>'}</dialog>`;
}

function invitationsView(directory) {
  const { data, filters, loading, error } = directory;
  const items = data?.invitations ?? [];
  const disabled = loading ? 'disabled' : '';
  const filtered = Boolean(filters.q || filters.status);
  const summary = data ? data.total ? `Showing ${(data.page - 1) * data.pageSize + 1}–${(data.page - 1) * data.pageSize + items.length} of ${data.total} ${filtered ? 'matching ' : ''}invitation recipients` : `0 ${filtered ? 'matching ' : ''}invitation recipients` : 'No results loaded';
  return `<p class="muted">Track enrollment invitations without exposing activation links or tokens. Each row is one recipient; an invitation may cover several recipients.</p>
    <section class="panel directory" aria-labelledby="directory-title"><div class="panel-head"><h2 id="directory-title">Invitation recipients</h2><span class="pill">Read only</span></div>
      <form id="directory-filters" class="filters" role="search" aria-label="Search invitations"><label class="field search-field">Search invitations<input id="directory-search" name="q" type="search" maxlength="120" value="${escapeHtml(filters.q)}" placeholder="Recipient email, inviter or invitation ID" ${disabled}></label><label class="field">Status<select name="status" aria-label="Status" ${disabled}>${options([['', 'All statuses'], ...['pending', 'expired', 'revoked', 'redeemed'].map(value => [value, label(value)])], filters.status)}</select></label><div class="filter-actions"><button class="button primary" type="submit" ${disabled}>Search</button><button class="button" type="button" id="clear-filters" ${loading || !filtered ? 'disabled' : ''}>Clear</button></div></form>
      <div class="results-bar"><p id="directory-summary" class="muted" role="status" tabindex="-1">${loading ? 'Loading invitations…' : escapeHtml(summary)}</p><label class="page-size">Rows per page<select id="page-size" aria-label="Rows per page" ${disabled}>${options([['25', '25'], ['50', '50'], ['100', '100']], filters.pageSize)}</select></label></div>
      ${error ? `<div class="notice error" role="alert"><p>${escapeHtml(error)}</p>${data ? '<p>These are the last loaded results; they may be out of date.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}
      <div class="table-wrap" tabindex="0" role="region" aria-label="Invitation results" aria-busy="${loading}"><table><caption class="sr-only">${escapeHtml(summary)}. Newest invitations first.</caption><thead><tr>${['Recipient', 'Status', 'Invited by', 'Expires', 'Created', 'Details'].map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>${items.map((item, index) => `<tr><td data-label="Recipient" class="identity-cell"><span class="name">${escapeHtml(item.email)}</span><span class="sub mono">${escapeHtml(item.id.slice(0, 8))}…</span></td><td data-label="Status">${badge(item.status)}</td><td data-label="Invited by">${escapeHtml(item.createdBy)}</td><td data-label="Expires">${escapeHtml(date(item.expiresAt))}</td><td data-label="Created">${escapeHtml(date(item.createdAt))}</td><td data-label="Details" class="actions-cell"><button class="button compact" type="button" data-details="${index}" ${disabled} aria-label="View invitation details for ${escapeHtml(item.email)}">View</button></td></tr>`).join('')}${!items.length ? `<tr><td colspan="6"><div class="empty-state"><h3>${loading ? 'Loading invitations…' : error ? 'Results are unavailable' : filtered ? 'No matching invitations' : 'No invitations yet'}</h3><p>${loading ? 'Fetching invitation recipients from your server.' : error ? 'Try again when your server is reachable.' : filtered ? 'Try a different search or clear the filters.' : 'Recipients appear after invitations are created through the owner onboarding workflow.'}</p></div></td></tr>` : ''}</tbody></table></div>
      ${data ? `<div class="pagination" aria-label="invitations pagination"><span class="muted">Page ${data.page} of ${data.pageCount}</span><div><button class="button" type="button" id="previous-page" ${loading || !data.hasPrevious ? 'disabled' : ''}>Previous</button><button class="button" type="button" id="next-page" ${loading || !data.hasNext ? 'disabled' : ''}>Next</button></div></div><p class="footnote">Last loaded ${escapeHtml(date(directory.checkedAt))}. Refresh to update expiration status.</p>` : ''}
      <p class="footnote">Pending means the recipient has not redeemed a currently valid invitation. Redeemed recipients stay redeemed when the remaining invitation expires or is revoked. Invitation creation, resend and revocation remain in the owner workflow.</p>
    </section>`;
}

function invitationDetails(item) {
  const fields = [['Recipient email', item.email], ['Status', label(item.status)], ['Invited by', item.createdBy], ['Created', date(item.createdAt)], ['Expires', date(item.expiresAt)], ['Redeemed', date(item.redeemedAt)], ['Revoked', date(item.revokedAt)]];
  return `<dialog id="details-dialog" aria-labelledby="details-title"><div class="dialog-head"><div><p class="eyebrow">Invitation details</p><h2 id="details-title">${escapeHtml(item.email)}</h2></div><button class="button compact" id="close-details" type="button" autofocus>Close</button></div><dl class="details-list">${fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value ?? 'Not available')}</dd></div>`).join('')}</dl><label class="field">Invitation ID<input class="mono" readonly value="${escapeHtml(item.id)}" aria-label="Full invitation ID"></label><button class="button" id="copy-id" type="button">Copy ID</button><p id="copy-status" class="footnote" role="status"></p><p class="footnote">This is an internal record ID. Activation links, invitation tokens and verification codes are not available in the console. This page does not send or change invitations.</p></dialog>`;
}
