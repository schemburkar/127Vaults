import test from 'node:test';
import assert from 'node:assert/strict';
import { licenseBackupPath } from './identity-backup.mjs';
test('identity backups retain license rollback records without permitting path traversal', () => {
  for (const name of ['runtime/licenses/1.json','runtime/licenses/2.keys.json','runtime/licenses/highest-sequence',
    'runtime/licenses/12345678-1234-1234-1234-123456789abc.revocation.json']) assert.equal(licenseBackupPath(name),true);
  for (const name of ['runtime/licenses/../../secret','runtime/licenses/.install-lock','runtime/licenses/0.json','output/arbitrary']) assert.equal(licenseBackupPath(name),false);
});
