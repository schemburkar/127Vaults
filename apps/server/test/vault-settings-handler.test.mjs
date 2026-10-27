import test from 'node:test';
import assert from 'node:assert/strict';
import { PgVaultSettingsStore, validateSettingsEnvelope } from '../src/vault-settings-handler.mjs';

const tenantId = '10000000-0000-4000-8000-000000000001';
const accountId = '20000000-0000-4000-8000-000000000001';
const revision = '30000000-0000-4000-8000-000000000001';
const auth = { tenantId, accountId, credentialEpoch: 1 };
const raw = uuid => Buffer.from(uuid.replaceAll('-', ''), 'hex');
function envelope() {
  const value = Buffer.alloc(174);
  value.write('127VEXP\0', 0, 'binary');
  value.writeUInt16BE(1, 8);
  value[10] = 1; value[11] = 5;
  raw(tenantId).copy(value, 12);
  raw(accountId).copy(value, 28);
  raw(revision).copy(value, 76);
  value.writeUInt32BE(1, 92);
  value.writeBigUInt64BE(1n, 96);
  value.writeUInt32BE(17, 153);
  return value;
}
test('opaque settings envelope is scoped to the authenticated account and epoch', () => {
  const value = envelope();
  assert.doesNotThrow(() => validateSettingsEnvelope(value, auth, revision));
  assert.throws(() => validateSettingsEnvelope(value, { ...auth, accountId: tenantId }, revision));
  assert.throws(() => validateSettingsEnvelope(value, { ...auth, credentialEpoch: 2 }, revision));
  const wrongPurpose = Buffer.from(value); wrongPurpose[11] = 3;
  assert.throws(() => validateSettingsEnvelope(wrongPurpose, auth, revision));
});

test('settings CAS preserves the old record on stale base and accepts identical retry', async () => {
  const value = envelope();
  const queries = [];
  let stored = { revision, envelope: value };
  const client = {
    async query(sql) {
      queries.push(sql);
      if(sql.includes('write_principal'))return {rows:[{}],rowCount:1};
      if (sql.startsWith('SELECT revision,envelope')) return { rows: [stored] };
      return { rowCount: 1 };
    },
    release() {},
  };
  const store = new PgVaultSettingsStore({ connect: async () => client });
  assert.deepEqual(await store.put(auth, { baseRevision: null, revision, envelope: value }), { revision, duplicate: true });
  assert.equal(queries.includes('COMMIT'), true);
  queries.length = 0;
  await assert.rejects(store.put(auth, { baseRevision: null, revision: tenantId, envelope: value }), { code: 'BASE_CHANGED' });
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(stored.revision, revision);
});
