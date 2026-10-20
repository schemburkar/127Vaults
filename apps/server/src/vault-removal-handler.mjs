import { createHash } from 'node:crypto';
import { AuthError, AUTH_COOKIE, requireUnsafeRequest } from './auth-policy.mjs';
import { HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from './http-boundary.mjs';
import { VaultError, bytes, catalogue, exact, uuid } from './private-vault.mjs';
import { validateSettingsEnvelope } from './vault-settings-handler.mjs';

const cookie = req => {
  const value = String(req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null;
};
const fingerprint = (path, raw) => createHash('sha256').update('POST\0').update(path).update('\0').update(raw).digest();
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const receiptFingerprint = (path, raw) => fingerprint(path, raw);

export function parseRestore(value) {
  exact(value, ['requestId', 'sourceCatalogueRevision']);
  return { requestId: uuid(value.requestId), sourceCatalogueRevision: uuid(value.sourceCatalogueRevision) };
}

export function parseRemoval(value) {
  exact(value, ['requestId', 'choice', 'destinationVaultId', 'sourceCatalogueRevision', 'destinationCatalogueRevision', 'itemMappings', 'settings']);
  const requestId = uuid(value.requestId);
  const sourceCatalogueRevision = uuid(value.sourceCatalogueRevision);
  exact(value.settings, ['baseRevision', 'revision', 'envelope']);
  const settings = { baseRevision: value.settings.baseRevision === null ? null : uuid(value.settings.baseRevision),
    revision: uuid(value.settings.revision), envelope: bytes(value.settings.envelope, 16557) };
  if (settings.revision === settings.baseRevision) throw new VaultError();
  if (!Array.isArray(value.itemMappings) || value.itemMappings.length > 100) throw new VaultError();
  if (value.choice === 'archive') {
    if (value.destinationVaultId !== null || value.destinationCatalogueRevision !== null || value.itemMappings.length) throw new VaultError();
    return { requestId, choice: 'archive', destinationVaultId: null, sourceCatalogueRevision, destinationCatalogueRevision: null, itemMappings: [], settings };
  }
  if (value.choice !== 'move') throw new VaultError();
  const destinationVaultId = uuid(value.destinationVaultId);
  const destinationCatalogueRevision = uuid(value.destinationCatalogueRevision);
  const sources = new Set(), destinations = new Set();
  const itemMappings = value.itemMappings.map(row => {
    exact(row, ['sourceItemId', 'destinationItemId']);
    const sourceItemId = uuid(row.sourceItemId), destinationItemId = uuid(row.destinationItemId);
    if (sources.has(sourceItemId) || destinations.has(destinationItemId)) throw new VaultError();
    sources.add(sourceItemId); destinations.add(destinationItemId);
    return { sourceItemId, destinationItemId };
  });
  return { requestId, choice: 'move', destinationVaultId, sourceCatalogueRevision, destinationCatalogueRevision, itemMappings, settings };
}

export class PgVaultRemovalStore {
  constructor(pool) { this.pool = pool; }
  async remove(auth, sourceVaultId, choice, path, raw) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const fp = fingerprint(path, raw);
      const previous = (await client.query('SELECT fingerprint,response FROM vaults.private_vault_removal_receipts WHERE tenant_id=$1 AND account_id=$2 AND request_id=$3 FOR UPDATE', [auth.tenantId, auth.accountId, choice.requestId])).rows[0];
      if (previous) {
        if (!same(previous.fingerprint, fp)) throw new VaultError(409, 'REQUEST_ID_REUSED');
        await client.query('COMMIT'); return previous.response;
      }
      if (choice.choice === 'move' && sourceVaultId === choice.destinationVaultId) throw new VaultError();
      const ids = choice.destinationVaultId ? [sourceVaultId, choice.destinationVaultId] : [sourceVaultId];
      const rows = (await client.query('SELECT id,catalogue,catalogue_revision,retired_at FROM vaults.private_vaults WHERE tenant_id=$1 AND account_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE', [auth.tenantId, auth.accountId, ids])).rows;
      if (rows.length !== ids.length) throw new VaultError(404, 'NOT_FOUND');
      const source = rows.find(row => row.id === sourceVaultId);
      const destination = rows.find(row => row.id === choice.destinationVaultId);
      if (source.retired_at || destination?.retired_at) throw new VaultError(409, 'VAULT_RETIRED');
      if (source.catalogue_revision !== choice.sourceCatalogueRevision || (destination && destination.catalogue_revision !== choice.destinationCatalogueRevision)) throw new VaultError(409, 'BASE_CHANGED');
      const sourceItems = catalogue(source.catalogue).entries.map(row => row.item);
      if (choice.choice === 'move') {
        if (choice.itemMappings.length !== sourceItems.length || !sourceItems.every(id => choice.itemMappings.some(row => row.sourceItemId === id))) throw new VaultError(409, 'MOVE_INCOMPLETE');
        const destinationItems = new Set(catalogue(destination.catalogue).entries.map(row => row.item));
        if (!choice.itemMappings.every(row => destinationItems.has(row.destinationItemId))) throw new VaultError(409, 'MOVE_INCOMPLETE');
        const created = (await client.query("SELECT item_id FROM vaults.sync_operations WHERE tenant_id=$1 AND vault_id=$2 AND kind='item.create' AND item_id=ANY($3::uuid[])", [auth.tenantId, choice.destinationVaultId, choice.itemMappings.map(row => row.destinationItemId)])).rows;
        if (created.length !== choice.itemMappings.length) throw new VaultError(409, 'MOVE_INCOMPLETE');
      }
      const states = (await client.query('SELECT vault_id,next_cursor,latest_checkpoint_sequence FROM vaults.sync_vault_state WHERE tenant_id=$1 AND vault_id=ANY($2::uuid[]) ORDER BY vault_id FOR UPDATE', [auth.tenantId, ids])).rows;
      if (states.length !== ids.length) throw new VaultError(409, 'SYNC_NOT_SETTLED');
      for (const state of states) {
        const checkpoint = (await client.query('SELECT cursor FROM vaults.sync_checkpoints WHERE tenant_id=$1 AND vault_id=$2 AND checkpoint_sequence=$3', [auth.tenantId, state.vault_id, state.latest_checkpoint_sequence])).rows[0];
        if (!checkpoint || Number(checkpoint.cursor) !== Number(state.next_cursor) - 1) throw new VaultError(409, 'SYNC_NOT_SETTLED');
      }
      const settingsRow = (await client.query('SELECT revision FROM vaults.private_account_settings WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE', [auth.tenantId, auth.accountId])).rows[0];
      if ((settingsRow?.revision ?? null) !== choice.settings.baseRevision) throw new VaultError(409, 'BASE_CHANGED');
      for (const row of choice.itemMappings) await client.query('INSERT INTO vaults.private_vault_move_items(tenant_id,source_vault_id,source_item_id,destination_vault_id,destination_item_id) VALUES($1,$2,$3,$4,$5)', [auth.tenantId, sourceVaultId, row.sourceItemId, choice.destinationVaultId, row.destinationItemId]);
      await client.query('UPDATE vaults.private_vaults SET retired_at=now(),retirement_choice=$3,retirement_destination=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2', [auth.tenantId, sourceVaultId, choice.choice, choice.destinationVaultId]);
      if (settingsRow) await client.query('UPDATE vaults.private_account_settings SET revision=$3,envelope=$4,updated_at=now() WHERE tenant_id=$1 AND account_id=$2', [auth.tenantId, auth.accountId, choice.settings.revision, choice.settings.envelope]);
      else await client.query('INSERT INTO vaults.private_account_settings(tenant_id,account_id,revision,envelope) VALUES($1,$2,$3,$4)', [auth.tenantId, auth.accountId, choice.settings.revision, choice.settings.envelope]);
      const response = { requestId: choice.requestId, vaultId: sourceVaultId, choice: choice.choice, destinationVaultId: choice.destinationVaultId, itemCount: sourceItems.length, recoverable: true };
      await client.query('INSERT INTO vaults.private_vault_removal_receipts(tenant_id,account_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5)', [auth.tenantId, auth.accountId, choice.requestId, fp, response]);
      await client.query('COMMIT'); return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof VaultError) throw error;
      throw new VaultError(503, 'UNAVAILABLE');
    } finally { client.release(); }
  }
  async restore(auth, vaultId, request, path, raw) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const fp = receiptFingerprint(path, raw);
      const previous = (await client.query('SELECT fingerprint,response FROM vaults.private_vault_removal_receipts WHERE tenant_id=$1 AND account_id=$2 AND request_id=$3 FOR UPDATE', [auth.tenantId, auth.accountId, request.requestId])).rows[0];
      if (previous) {
        if (!same(previous.fingerprint, fp)) throw new VaultError(409, 'REQUEST_ID_REUSED');
        await client.query('COMMIT'); return previous.response;
      }
      const vault = (await client.query('SELECT catalogue_revision,retirement_choice FROM vaults.private_vaults WHERE tenant_id=$1 AND account_id=$2 AND id=$3 FOR UPDATE', [auth.tenantId, auth.accountId, vaultId])).rows[0];
      if (!vault) throw new VaultError(404, 'NOT_FOUND');
      if (vault.retirement_choice !== 'archive') throw new VaultError(409, 'RESTORE_UNAVAILABLE');
      if (vault.catalogue_revision !== request.sourceCatalogueRevision) throw new VaultError(409, 'BASE_CHANGED');
      await client.query('UPDATE vaults.private_vaults SET retired_at=NULL,retirement_choice=NULL,retirement_destination=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2', [auth.tenantId, vaultId]);
      const response = { requestId: request.requestId, vaultId, restored: true };
      await client.query('INSERT INTO vaults.private_vault_removal_receipts(tenant_id,account_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5)', [auth.tenantId, auth.accountId, request.requestId, fp, response]);
      await client.query('COMMIT'); return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof VaultError) throw error;
      throw new VaultError(503, 'UNAVAILABLE');
    } finally { client.release(); }
  }
}

export function createVaultRemovalHandler(store, authenticate, origin) {
  return async (req, res) => {
    const url = new URL(req.url, origin);
    const match = url.pathname.match(/^\/api\/v1\/vaults\/([0-9a-f-]+)\/(removal|restore)$/);
    if (!match) return false;
    try {
      if (req.method !== 'POST' || url.search) throw new VaultError(405, 'METHOD_NOT_ALLOWED');
      const token = cookie(req); if (!token) throw new AuthError();
      const auth = await authenticate(token);
      requireUnsafeRequest(req, origin, req.headers['x-127v-csrf'], auth.csrf);
      const raw = await readRequestBody(req, 16 * 1024);
      const value = parseJsonObject(req, raw);
      if (match[2] === 'restore') writeJson(res, 200, await store.restore(auth, uuid(match[1]), parseRestore(value), url.pathname, raw));
      else {
        const choice = parseRemoval(value);
        validateSettingsEnvelope(choice.settings.envelope, auth, choice.settings.revision);
        writeJson(res, 200, await store.remove(auth, uuid(match[1]), choice, url.pathname, raw));
      }
    } catch (error) {
      const status = error instanceof AuthError ? 401 : error instanceof VaultError || error instanceof HttpBoundaryError ? error.status : 503;
      writeError(res, status, error instanceof VaultError || error instanceof HttpBoundaryError ? error.code : status === 401 ? 'authentication_required' : 'unavailable');
    }
    return true;
  };
}
