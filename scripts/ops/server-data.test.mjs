import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedBackupSchema, waitForPostgres } from './server-data.mjs';

test('backup tooling recognizes the current self-hosted schema', () => {
  for (const version of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) assert.equal(supportedBackupSchema(version), true);
  for (const version of ['0', '10', '6 extra', 'schema-6']) assert.equal(supportedBackupSchema(version), false);
});

test('restore cannot accept the temporary socket-only bootstrap server', async () => {
  let bootstrap = true, waits = 0;
  const run = async (_engine, args) => {
    if (bootstrap && args.includes('127.0.0.1')) throw Error('final TCP server is not ready');
    // A socket-only probe incorrectly succeeds throughout bootstrap.
    return 'accepting connections';
  };
  await waitForPostgres('podman', 'disposable', run, async () => { if (++waits === 3) bootstrap = false; });
  assert.equal(waits, 3);
});

test('unavailable restore target fails closed after bounded readiness attempts', async () => {
  let attempts = 0;
  await assert.rejects(waitForPostgres('podman', 'disposable', async () => { attempts++; throw Error('unavailable'); }, async () => {}), /did not become ready/);
  assert.equal(attempts, 30);
});
