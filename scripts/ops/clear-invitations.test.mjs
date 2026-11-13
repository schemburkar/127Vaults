import test from 'node:test';
import assert from 'node:assert/strict';
import { clearInvitations } from './clear-invitations.mjs';
test('cleanup targets only exact email and previews without writes', async () => {
  let rows = [{ id: 'a'.repeat(64), email: 'me@example.com' }, { id: 'b'.repeat(64), email: 'other@example.com' }];
  const calls = [];
  const api = async (path, body) => { if (body === undefined) return { requests: rows }; calls.push(path); rows = rows.filter(r => !path.includes(r.id)); return {}; };
  assert.equal((await clearInvitations(api, 'ME@example.com')).matched, 1);
  assert.equal(calls.length, 0);
  assert.equal((await clearInvitations(api, 'me@example.com', true)).remaining, 0);
  assert.deepEqual(calls, ['/api/access-admin/requests/' + 'a'.repeat(64) + '/erase']);
  assert.equal(rows[0].email, 'other@example.com');
});
test('cleanup preserves billing without attempting erase', async () => {
  let writes = 0;
  const result = await clearInvitations(async (path, body) => { if (body) writes++; return { requests: [{ id: 'b'.repeat(64), email: 'me@example.com', billingStatus: 'active' }] }; }, 'me@example.com', true);
  assert.equal(writes, 0); assert.equal(result.preservedBilling.length, 1);
});
