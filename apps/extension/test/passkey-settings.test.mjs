import test from 'node:test';
import assert from 'node:assert/strict';
import { enableAllPasskeys, disableAllPasskeys, passkeysEnabled, PASSKEY_MATCH } from '../src/passkey-settings.mjs';

test('all-sites mode authorizes HTTPS origins while retaining legacy site grants', () => {
  assert(passkeysEnabled({ passkeysAllSites: true }, 'https://unseen.example.test:8443'));
  assert.equal(passkeysEnabled({ passkeysAllSites: true }, 'http://example.test'), false);
  assert.equal(passkeysEnabled({ passkeysAllSites: true }, 'https://example.test/path'), false);
  assert.equal(passkeysEnabled({}, 'https://example.test'), false);
  assert(passkeysEnabled({ passkeyOrigins: ['https://example.test'] }, 'https://example.test'));
  assert.equal(passkeysEnabled({ passkeyOrigins: ['https://example.test'] }, 'https://other.test'), false);
});
test('one permission installs global scripts and migrates only provider registrations', async () => {
  let registered, removed, setting;
  const api = {
    permissions: { async request(value) { assert.deepEqual(value, { origins: [PASSKEY_MATCH] }); return true; } },
    scripting: {
      async getRegisteredContentScripts() { return [{ id: 'passkey-page-old' }, { id: 'passkey-bridge-old' }, { id: 'unrelated-script' }]; },
      async unregisterContentScripts(value) { removed = value.ids; },
      async registerContentScripts(value) { registered = value; },
    },
    storage: { local: { async set(value) { setting = value; } } },
  };
  await enableAllPasskeys(api);
  assert.deepEqual(removed, ['passkey-page-old', 'passkey-bridge-old']);
  assert.deepEqual(registered.map(script => script.matches), [[PASSKEY_MATCH], [PASSKEY_MATCH]]);
  assert(registered.every(script => script.runAt === 'document_start' && !script.allFrames));
  assert.deepEqual(setting, { passkeysAllSites: true, passkeyOrigins: [] });
  await disableAllPasskeys(api);
  assert.deepEqual(setting, { passkeysAllSites: false, passkeyOrigins: [] });
});
test('denied permission and registration failure never activate all-sites mode', async () => {
  let wrote = false, installed = false;
  const api = { permissions: { async request() { return false; } }, scripting: { async getRegisteredContentScripts() { return []; }, async registerContentScripts() { installed = true; throw Error('registration failed'); } }, storage: { local: { async set() { wrote = true; } } } };
  await assert.rejects(enableAllPasskeys(api), /not granted/);
  assert.equal(installed, false); assert.equal(wrote, false);
  api.permissions.request = async () => true;
  await assert.rejects(enableAllPasskeys(api), /registration failed/);
  assert.equal(wrote, false);
});
