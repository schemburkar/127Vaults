import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceStatus } from '../src/source-status.mjs';

test('offline source reports verified snapshot age without implying live freshness', () => {
  const rendered = sourceStatus({ localUnlocked: true, online: false, sync: { lastVerifiedSyncAt: 1_700_000_000 } }, 'en-US');
  assert.match(rendered, /Offline snapshot; data may be stale/);
  assert.match(rendered, /Last verified sync:/);
});

test('legacy replicas report unknown sync time', () => {
  assert.match(sourceStatus({ active: true, online: false, sync: { lastVerifiedSyncAt: null } }), /unknown/);
  assert.match(sourceStatus({ active: false, localUnlocked: false }), /locked/);
});

test('online agent state does not claim the server is reachable', () => {
  assert.match(sourceStatus({ active: true, online: true, sync: { lastVerifiedSyncAt: null } }), /connection not rechecked/);
});
