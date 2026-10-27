import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseRemoval, parseRestore, PgVaultRemovalStore } from '../src/vault-removal-handler.mjs';

const ids = () => ({ source: randomUUID(), destination: randomUUID(), sourceItem: randomUUID(), destinationItem: randomUUID(), sourceRevision: randomUUID(), destinationRevision: randomUUID(), requestId: randomUUID() });
const choice = x => ({ requestId: x.requestId, choice: 'archive', destinationVaultId: null, sourceCatalogueRevision: x.sourceRevision, destinationCatalogueRevision: null, itemMappings: [],
  settings: { baseRevision: null, revision: randomUUID(), envelope: Buffer.from('test').toString('base64url') } });
const bytes = id => Buffer.from(id.replaceAll('-', ''), 'hex');
function catalogue(vault, revision, items = []) {
  const b = Buffer.alloc(110 + items.length * 136);
  b.write('PVM1'); bytes(randomUUID()).copy(b, 4); bytes(vault).copy(b, 20); b.writeBigUInt64BE(1n, 36);
  bytes(revision).copy(b, 44); b.writeUInt16BE(items.length, 76);
  items.forEach((item, index) => bytes(item).copy(b, 78 + index * 136));
  return b;
}
function database(x, sourceItems = []) {
  const calls = [];
  const source = { id: x.source, catalogue: catalogue(x.source, x.sourceRevision, sourceItems), catalogue_revision: x.sourceRevision, retired_at: null };
  const destination = { id: x.destination, catalogue: catalogue(x.destination, x.destinationRevision, [x.destinationItem]), catalogue_revision: x.destinationRevision, retired_at: null };
  const connection = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT 1 FROM vaults.authentication_credentials')) return {rowCount:1};
    if (sql.startsWith('SELECT fingerprint,response')) return { rows: [] };
    if (sql.startsWith('SELECT id,catalogue')) return { rows: params[2].length === 2 ? [source, destination] : [source] };
    if (sql.startsWith('SELECT item_id FROM vaults.sync_operations')) return { rows: [{ item_id: x.destinationItem }] };
    if (sql.startsWith('SELECT revision FROM vaults.private_account_settings')) return { rows: [] };
    if (sql.startsWith('SELECT vault_id,next_cursor')) return { rows: params[1].map(vault_id => ({ vault_id, next_cursor: 1, latest_checkpoint_sequence: 1 })) };
    if (sql.startsWith('SELECT cursor FROM vaults.sync_checkpoints')) return { rows: [{ cursor: 0 }] };
    return { rows: [] };
  }, release() {} };
  return { calls, pool: { async connect() { return connection; } } };
}

test('removal requires one explicit disposition and rejects ambiguous mappings', () => {
  const x = ids();
  assert.equal(parseRemoval(choice(x)).choice, 'archive');
  assert.throws(() => parseRemoval({ ...choice(x), destinationVaultId: x.destination }));
  assert.throws(() => parseRemoval({ ...choice(x), choice: 'delete' }));
  assert.throws(() => parseRemoval({ ...choice(x), choice: 'move', destinationVaultId: x.destination, destinationCatalogueRevision: x.destinationRevision,
    itemMappings: [{ sourceItemId: x.sourceItem, destinationItemId: x.destinationItem }, { sourceItemId: x.sourceItem, destinationItemId: randomUUID() }] }));
});

test('archive retires the vault while retaining its item rows', async () => {
  const x = ids(), db = database(x, [x.sourceItem]);
  const result = await new PgVaultRemovalStore(db.pool).remove({ tenantId: randomUUID(), accountId: randomUUID() }, x.source, choice(x), `/api/v1/vaults/${x.source}/removal`, Buffer.from('{}'));
  assert.equal(result.itemCount, 1);
  assert.equal(result.recoverable, true);
  assert.ok(db.calls.some(row => row.sql.startsWith('UPDATE vaults.private_vaults SET retired_at')));
  assert.ok(db.calls.some(row => row.sql.startsWith('INSERT INTO vaults.private_account_settings')));
  assert.equal(db.calls.some(row => /DELETE FROM vaults\.private_items/.test(row.sql)), false);
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('move rejects incomplete coverage and rolls back before retiring source', async () => {
  const x = ids(), db = database(x, [x.sourceItem]);
  const move = parseRemoval({ ...choice(x), choice: 'move', destinationVaultId: x.destination, destinationCatalogueRevision: x.destinationRevision });
  await assert.rejects(new PgVaultRemovalStore(db.pool).remove({ tenantId: randomUUID(), accountId: randomUUID() }, x.source, move, `/api/v1/vaults/${x.source}/removal`, Buffer.from('{}')), { code: 'MOVE_INCOMPLETE' });
  assert.equal(db.calls.some(row => row.sql.startsWith('UPDATE vaults.private_vaults SET retired_at')), false);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('move with complete copied items records mapping and retires the source atomically', async () => {
  const x = ids(), db = database(x, [x.sourceItem]);
  const move = parseRemoval({ ...choice(x), choice: 'move', destinationVaultId: x.destination, destinationCatalogueRevision: x.destinationRevision,
    itemMappings: [{ sourceItemId: x.sourceItem, destinationItemId: x.destinationItem }] });
  const result = await new PgVaultRemovalStore(db.pool).remove({ tenantId: randomUUID(), accountId: randomUUID() }, x.source, move, `/api/v1/vaults/${x.source}/removal`, Buffer.from('{}'));
  assert.equal(result.choice, 'move');
  assert.ok(db.calls.some(row => row.sql.startsWith('INSERT INTO vaults.private_vault_move_items')));
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('restore only accepts an archived vault and preserves its ciphertext', async () => {
  const x = ids(), calls = [];
  const connection = { async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT fingerprint,response')) return { rows: [] };
    if (sql.startsWith('SELECT catalogue_revision,retirement_choice')) return { rows: [{ catalogue_revision: x.sourceRevision, retirement_choice: 'archive' }] };
    return { rows: [] };
  }, release() {} };
  const store = new PgVaultRemovalStore({ async connect() { return connection; } });
  const request = parseRestore({ requestId: x.requestId, sourceCatalogueRevision: x.sourceRevision });
  const result = await store.restore({ tenantId: randomUUID(), accountId: randomUUID() }, x.source, request, `/api/v1/vaults/${x.source}/restore`, Buffer.from('{}'));
  assert.equal(result.restored, true);
  assert.ok(calls.some(sql => sql.startsWith('UPDATE vaults.private_vaults SET retired_at=NULL')));
  assert.equal(calls.some(sql => sql.includes('DELETE FROM')), false);
  assert.equal(calls.at(-1), 'COMMIT');
});
