import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedBackupSchema } from './server-data.mjs';

test('backup tooling recognizes the current self-hosted schema', () => {
  for (const version of ['1', '2', '3', '4', '5', '6', '7', '8']) assert.equal(supportedBackupSchema(version), true);
  for (const version of ['0', '9', '6 extra', 'schema-6']) assert.equal(supportedBackupSchema(version), false);
});
