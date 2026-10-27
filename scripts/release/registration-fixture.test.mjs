import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRegistrationBaseline, registrationFixtureRequest } from './registration-fixture.mjs';
test('only known older upgrade fixtures use legacy registration fields', () => {
  assert.equal(legacyRegistrationBaseline('C:/releases/127vaults-server-0.1.16-linux-amd64.tar.gz'), true);
  assert.equal(legacyRegistrationBaseline('/releases/127vaults-server-0.1.17-linux-amd64.tar.gz'), false);
  assert.equal(legacyRegistrationBaseline('/releases/127vaults-server-1.0.0-linux-amd64.tar.gz'), false);
  assert.equal(legacyRegistrationBaseline(), false);
  assert.throws(() => legacyRegistrationBaseline('unknown.tar.gz'));
  const input = { accountId:'account', deviceId:'device', request:'request', token:'authorization', email:null };
  assert.deepEqual(registrationFixtureRequest(input), input);
  assert.deepEqual(registrationFixtureRequest(input,true), { accountId:'account',deviceId:'device',request:'request' });
});
