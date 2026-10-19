import test from 'node:test';
import assert from 'node:assert/strict';
import { installerPolicy, versionParts } from '../cloudflare/installer.mjs';

test('installer floor compares numeric versions and rejects malformed versions', () => {
  assert.equal(installerPolicy('0.1.0'), true);
  assert.equal(installerPolicy('0.10.0', '0.9.0'), true);
  assert.equal(installerPolicy('0.9.9', '0.10.0'), false);
  assert.equal(installerPolicy('1.0.0', '0.10.0'), true);
  for (const value of [null, '', '0.01.0', '1.0', '1.0.0-dev', '1.0.65536', '99999999999999999.0.0']) {
    assert.equal(versionParts(value), null);
    assert.equal(installerPolicy(value), false);
  }
  assert.throws(() => installerPolicy('0.1.0', 'bad'));
});
