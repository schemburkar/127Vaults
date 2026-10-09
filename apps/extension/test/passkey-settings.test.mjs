import test from 'node:test';
import assert from 'node:assert/strict';
import { enableAllPasskeys, disableAllPasskeys, passkeysEnabled, PASSKEY_MATCH, restorePasskeyScripts } from '../src/passkey-settings.mjs';

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

test('restores enabled provider after reload without prompting for permission', async () => {
  let scripts = [], installs = 0;
  const api = {
    storage: { local: { async get() { return { passkeysAllSites: true }; } } },
    permissions: { async contains() { return true; } },
    scripting: { async getRegisteredContentScripts() { return scripts; }, async unregisterContentScripts() { scripts = []; }, async registerContentScripts(value) { scripts = value; installs++; } },
  };
  assert.equal(await restorePasskeyScripts(api), true);
  assert.equal(installs, 1);
  assert.equal(await restorePasskeyScripts(api), true);
  assert.equal(installs, 1);
  api.permissions.contains = async () => false;
  assert.equal(await restorePasskeyScripts(api), false);
  assert.equal(installs, 1);
});

test('Windows enables and restores the extension provider while native rollout is disabled', async () => {
  let scripts = [], settings = {}, requested = false;
  const api = { runtime: { async getPlatformInfo() { return { os: 'win' }; } },
    permissions: { async request() { requested = true; return true; }, async contains() { return true; } },
    storage: { local: { async set(value) { settings = value; }, async get() { return settings; } } },
    scripting: { async getRegisteredContentScripts() { return scripts; }, async unregisterContentScripts() { scripts = []; }, async registerContentScripts(value) { scripts = value; } },
  };
  await enableAllPasskeys(api);
  assert.equal(requested, true);
  assert.equal(settings.passkeysAllSites, true);
  assert.equal(scripts.length, 2);
  scripts = [];
  assert.equal(await restorePasskeyScripts(api), true);
  assert.equal(scripts.length, 2);
  assert.equal(settings.passkeysAllSites, true);
});