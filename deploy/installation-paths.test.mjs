import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installationPrivateDirectory } from './test-install.mjs';

test('restored installations use the persisted identity directory on later commands', () => {
  const restored = resolve('fixture-restored-identity');
  const configuration = `VAULTS_TLS_DIR=${restored}\r\n`;
  assert.equal(installationPrivateDirectory(['start'],configuration),restored);
  assert.equal(installationPrivateDirectory(['license','--private-dir',restored],configuration),restored);
  assert.throws(() => installationPrivateDirectory(['start','--private-dir',resolve('wrong-identity')],configuration),/does not match/);
  assert.equal(installationPrivateDirectory(['init','--restore-identity',restored]),restored);
});
