import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDirectory, directoryQuery, directoryView, detailsView, date, reviewQueue } from '../admin/directory.js';

test('directory requests carry only the active directory filters', () => {
  const directory = newDirectory();
  directory.page = 3;
  directory.filters = { q: 'Alice & Bob', status: 'active', role: 'user', protection: 'software', accountId: 'account', pageSize: 50 };
  const users = new URLSearchParams(directoryQuery('users', directory));
  assert.deepEqual(Object.fromEntries(users), { page: '3', pageSize: '50', sort: 'newest', q: 'Alice & Bob', status: 'active', role: 'user' });
  const devices = new URLSearchParams(directoryQuery('devices', directory));
  assert.equal(devices.get('accountId'), 'account');
  assert.equal(devices.has('role'), false);
});

test('review queue links to specific recipient and active device states, with unknown counts explicit', () => {
  const view = reviewQueue({ invitations: { pending: 2, expired: 3 }, devices: { rotationRequired: 4, stale: 1, unknownProtection: 5 }, backup: { state: 'unknown' } });
  assert.match(view, /data-inspect="invitations" data-status="expired"/);
  assert.match(view, /data-inspect="devices" data-status="active" data-credential="rotation_required"/);
  assert.match(view, /data-protection="unknown"/);
  assert.match(view, /Backup freshness/);
  assert.match(reviewQueue({}), /Review counts unavailable/);
  const none = reviewQueue({ invitations: { pending: 0, expired: 0 }, devices: { rotationRequired: 0, stale: 0, unknownProtection: 0 }, backup: { state: 'current' } });
  assert.match(none, /No invitation or device follow-ups/);
});

test('directory and detail templates escape search, account and device metadata', () => {
  const hostile = '\"><img src=x onerror=alert(1)> & <script>alert(1)</script>';
  const directory = newDirectory();
  directory.filters.q = hostile;
  directory.error = hostile;
  directory.data = { users: [{ id: hostile, username: hostile, displayName: hostile, email: hostile, status: hostile, role: hostile, deviceCount: 0 }], total: 1, page: 1, pageSize: 25, pageCount: 1 };
  const html = directoryView('users', directory);
  assert.doesNotMatch(html, /<img|<script|aria-label="View account details for "><|value=""><img/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /Email unverified/);
  const details = detailsView('devices', { id: hostile, accountId: hostile, username: hostile, displayName: hostile, status: hostile, protection: hostile });
  assert.doesNotMatch(details, /<img|<script/i);
  assert.match(details, /&lt;img/);
});

test('empty, loading, outage and unfiltered directories have distinct guidance', () => {
  const directory = newDirectory();
  directory.loading = true;
  assert.match(directoryView('users', directory), /Loading users…/);
  directory.loading = false;
  directory.data = { users: [], total: 0, page: 1, pageSize: 25, pageCount: 1 };
  assert.match(directoryView('users', directory), /No accounts yet/);
  directory.filters.q = 'none';
  assert.match(directoryView('users', directory), /No matching users/);
  directory.error = 'Cannot reach the server.';
  assert.match(directoryView('users', directory), /last loaded results/);
  directory.data = null;
  assert.match(directoryView('users', directory), /Results are unavailable/);
});

test('details expose full identifiers and revocation metadata without invalid dates', () => {
  assert.equal(date('not-a-date'), 'Not available');
  assert.equal(date(null), 'Not available');
  const html = detailsView('devices', { id: 'full-device-id', accountId: 'full-account-id', username: 'alice', status: 'revoked', protection: 'unknown', credentialState: 'rotation_required', revokedAt: '2026-10-10T00:00:00Z' });
  assert.match(html, /value="full-device-id"/);
  assert.match(html, /full-account-id/);
  assert.match(html, /Rotation required/);
  assert.match(html, /Revoked \/ replaced/);
  assert.match(html, /unknown means it has not been classified/);
});

test('invitations show recipient states and safe full record IDs', () => {
  const directory = newDirectory();
  const item = { id: 'record-id', email: '\"><img src=x>', createdBy: '<owner>', status: 'expired' };
  directory.data = { invitations: [item], total: 1, page: 1, pageSize: 25, pageCount: 1 };
  const view = directoryView('invitations', directory);
  assert.match(view, /1 invitation recipient/);
  assert.match(view, /Expired/);
  assert.match(view, /an invitation may cover several recipients/);
  assert.doesNotMatch(view, /<img|<owner>/);
  const details = detailsView('invitations', item);
  assert.match(details, /Full invitation ID/);
  assert.match(details, /value="record-id"/);
  assert.doesNotMatch(details, /<img|<owner>|details-devices/);
});
