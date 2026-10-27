import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedPrincipalSession } from './principal-fixture.mjs';
import { schemaSql } from '../src/schema.mjs';
import { PgVaultRemovalStore, parseRemoval, parseRestore } from '../src/vault-removal-handler.mjs';

const url = process.env.VAULTS_TEST_DATABASE_URL;
const rawId = id => Buffer.from(id.replaceAll('-', ''), 'hex');
function catalogue(vault, revision, items) {
  const b = Buffer.alloc(110 + items.length * 136);
  b.write('PVM1'); rawId(randomUUID()).copy(b, 4); rawId(vault).copy(b, 20);
  b.writeBigUInt64BE(1n, 36); rawId(revision).copy(b, 44); b.writeUInt16BE(items.length, 76);
  items.forEach((item, index) => rawId(item).copy(b, 78 + index * 136));
  return b;
}
const zero32 = Buffer.alloc(32);

test('PostgreSQL archive, restore, and complete move retain all encrypted item rows', { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const tenant = randomUUID(), account = randomUUID(), device = randomUUID();
  const source = randomUUID(), destination = randomUUID(), sourceItem = randomUUID(), destinationItem = randomUUID();
  const sourceRevision = randomUUID(), destinationRevision = randomUUID();
  try {
    await pool.query(schemaSql);
    await pool.query('INSERT INTO vaults.installation(id) VALUES($1)', [tenant]);
    await pool.query("INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state) VALUES($1,$2,'FixtureOwner','Fixture Owner','fixture@example.invalid','owner','active')", [tenant, account]);
    await pool.query('INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)', [tenant, account, device, zero32]);
    await pool.query('INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$4)',[tenant,account,Buffer.alloc(192),Buffer.alloc(93)]);
    for (const [vault, revision, items] of [[source, sourceRevision, [sourceItem]], [destination, destinationRevision, [destinationItem]]]) {
      await pool.query('INSERT INTO vaults.private_vaults(tenant_id,id,account_id,epoch,vault_envelope_revision,vault_envelope,catalogue_revision,catalogue) VALUES($1,$2,$3,1,$4,$5,$6,$7)', [tenant, vault, account, randomUUID(), Buffer.alloc(205), revision, catalogue(vault, revision, items)]);
      await pool.query('INSERT INTO vaults.sync_vault_state(tenant_id,vault_id,epoch,operation_head_hash,latest_checkpoint_hash,latest_checkpoint_sequence,next_cursor) VALUES($1,$2,1,$3,$3,1,$4)', [tenant, vault, zero32, vault === destination ? 2 : 1]);
      await pool.query('INSERT INTO vaults.sync_checkpoints(tenant_id,vault_id,checkpoint_sequence,protocol_version,epoch,cursor,previous_checkpoint_hash,operation_head_hash,checkpoint_hash,server_signature) VALUES($1,$2,1,1,1,$3,$4,$4,$4,$5)', [tenant, vault, vault === destination ? 1 : 0, zero32, Buffer.alloc(64)]);
    }
    for (const [vault, item] of [[source, sourceItem], [destination, destinationItem]]) await pool.query('INSERT INTO vaults.private_items(tenant_id,vault_id,item_id,logical_revision,index_revision,body_revision,index_envelope,body_envelope) VALUES($1,$2,$3,$4,$4,$4,$5,$5)', [tenant, vault, item, randomUUID(), Buffer.alloc(174)]);
    await pool.query("INSERT INTO vaults.sync_operations(tenant_id,vault_id,cursor,protocol_version,operation_id,device_id,epoch,causal_base,kind,item_id,payload_hash,signature) VALUES($1,$2,1,1,$3,$4,1,0,'item.create',$5,$6,$7)", [tenant, destination, zero32, device, destinationItem, zero32, Buffer.alloc(64)]);
    const auth = { tenantId: tenant, accountId: account, deviceId:device, credentialEpoch:1 };
    await seedPrincipalSession(pool,auth);
    const store = new PgVaultRemovalStore(pool);
    const settings = () => ({ baseRevision: null, revision: randomUUID(), envelope: Buffer.alloc(174).toString('base64url') });
    const incomplete = parseRemoval({ requestId: randomUUID(), choice: 'move', destinationVaultId: destination, sourceCatalogueRevision: sourceRevision, destinationCatalogueRevision: destinationRevision, itemMappings: [], settings: settings() });
    await assert.rejects(store.remove(auth, source, incomplete, `/api/v1/vaults/${source}/removal`, Buffer.from('incomplete')), { code: 'MOVE_INCOMPLETE' });
    const staleSettings = parseRemoval({ requestId: randomUUID(), choice: 'move', destinationVaultId: destination, sourceCatalogueRevision: sourceRevision, destinationCatalogueRevision: destinationRevision,
      itemMappings: [{ sourceItemId: sourceItem, destinationItemId: destinationItem }], settings: { baseRevision: randomUUID(), revision: randomUUID(), envelope: Buffer.alloc(174).toString('base64url') } });
    await assert.rejects(store.remove(auth, source, staleSettings, `/api/v1/vaults/${source}/removal`, Buffer.from('stale')), { code: 'BASE_CHANGED' });
    assert.equal((await pool.query('SELECT retired_at FROM vaults.private_vaults WHERE tenant_id=$1 AND id=$2', [tenant, source])).rows[0].retired_at, null);
    const archive = parseRemoval({ requestId: randomUUID(), choice: 'archive', destinationVaultId: null, sourceCatalogueRevision: sourceRevision, destinationCatalogueRevision: null, itemMappings: [], settings: settings() });
    const archiveRaw = Buffer.from('archive');
    assert.equal((await store.remove(auth, source, archive, `/api/v1/vaults/${source}/removal`, archiveRaw)).recoverable, true);
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM vaults.private_items WHERE tenant_id=$1 AND vault_id=$2', [tenant, source])).rows[0].n), 1);
    assert.equal((await store.restore(auth, source, parseRestore({ requestId: randomUUID(), sourceCatalogueRevision: sourceRevision }), `/api/v1/vaults/${source}/restore`, Buffer.from('restore'))).restored, true);
    const move = parseRemoval({ requestId: randomUUID(), choice: 'move', destinationVaultId: destination, sourceCatalogueRevision: sourceRevision, destinationCatalogueRevision: destinationRevision,
      itemMappings: [{ sourceItemId: sourceItem, destinationItemId: destinationItem }], settings: { baseRevision: archive.settings.revision, revision: randomUUID(), envelope: Buffer.alloc(174).toString('base64url') } });
    const moveRaw = Buffer.from('move');
    const result = await store.remove(auth, source, move, `/api/v1/vaults/${source}/removal`, moveRaw);
    assert.equal(result.choice, 'move');
    assert.deepEqual(await store.remove(auth, source, move, `/api/v1/vaults/${source}/removal`, moveRaw), result);
    const rows = (await pool.query('SELECT vault_id,count(*)::int AS count FROM vaults.private_items WHERE tenant_id=$1 GROUP BY vault_id', [tenant])).rows;
    assert.deepEqual(rows.map(row => row.count).sort(), [1, 1]);
    assert.equal((await pool.query('SELECT retirement_choice FROM vaults.private_vaults WHERE tenant_id=$1 AND id=$2', [tenant, source])).rows[0].retirement_choice, 'move');
  } finally { await pool.end(); }
});
