import { AuthError, AUTH_COOKIE, requireUnsafeRequest } from './auth-policy.mjs';
import { HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from './http-boundary.mjs';
import { VaultError, bytes, uuid } from './private-vault.mjs';

const id = b => [b.subarray(0,4),b.subarray(4,6),b.subarray(6,8),b.subarray(8,10),b.subarray(10,16)].map(x => x.toString('hex')).join('-');
const cookie = req => {
  const token = String(req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token ?? '') ? token : null;
};

// Lock before the settings row (including its absence). Rotation locks this
// credential row exclusively, so an already-authenticated old request cannot
// install a previous-epoch settings envelope after rotation commits.
export async function lockSettingsCredentialEpoch(client,auth) {
  const valid=await client.query('SELECT 1 FROM vaults.authentication_credentials WHERE tenant_id=$1 AND account_id=$2 AND credential_epoch=$3 FOR SHARE',[auth.tenantId,auth.accountId,auth.credentialEpoch]);
  if(valid.rowCount!==1)throw new VaultError(401,'AUTHENTICATION_REQUIRED');
}

export function validateSettingsEnvelope(envelope, auth, revision) {
  if (envelope.length < 174 || envelope.length > 16557 || envelope.subarray(0,8).toString('binary') !== '127VEXP\0'
      || envelope.readUInt16BE(8) !== 1 || envelope[10] !== 1 || envelope[11] !== 5
      || id(envelope.subarray(12,28)) !== auth.tenantId || id(envelope.subarray(28,44)) !== auth.accountId
      || !envelope.subarray(44,76).every(x => x === 0) || id(envelope.subarray(76,92)) !== revision
      || envelope.readUInt32BE(92) !== 1 || Number(envelope.readBigUInt64BE(96)) !== auth.credentialEpoch
      || !envelope.subarray(104,120).every(x => x === 0) || !envelope.subarray(120,129).every(x => x === 0)
      || envelope.readUInt32BE(153) !== envelope.length - 157) throw new VaultError();
}

export class PgVaultSettingsStore {
  constructor(pool) { this.pool = pool; }
  async get(auth) {
    const row = (await this.pool.query('SELECT revision,envelope FROM vaults.private_account_settings WHERE tenant_id=$1 AND account_id=$2', [auth.tenantId,auth.accountId])).rows[0];
    return row ? { revision: row.revision, envelope: Buffer.from(row.envelope).toString('base64url') } : { revision: null, envelope: null };
  }
  async put(auth, { baseRevision, revision, envelope }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await lockSettingsCredentialEpoch(client,auth);
      const row = (await client.query('SELECT revision,envelope FROM vaults.private_account_settings WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE', [auth.tenantId,auth.accountId])).rows[0];
      if (row?.revision === revision && Buffer.from(row.envelope).equals(envelope)) {
        await client.query('COMMIT');
        return { revision, duplicate: true };
      }
      if ((row?.revision ?? null) !== baseRevision || revision === baseRevision) throw new VaultError(409,'BASE_CHANGED');
      if (row) await client.query('UPDATE vaults.private_account_settings SET revision=$3,envelope=$4,updated_at=now() WHERE tenant_id=$1 AND account_id=$2', [auth.tenantId,auth.accountId,revision,envelope]);
      else {
        const inserted = await client.query('INSERT INTO vaults.private_account_settings(tenant_id,account_id,revision,envelope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [auth.tenantId,auth.accountId,revision,envelope]);
        if (inserted.rowCount !== 1) throw new VaultError(409,'BASE_CHANGED');
      }
      await client.query('COMMIT');
      return { revision, duplicate: false };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
}

export function createVaultSettingsHandler(store, authenticate, origin) {
  return async (req, res) => {
    if (new URL(req.url, origin).pathname !== '/api/v1/vault-settings') return false;
    try {
      const token = cookie(req);
      if (!token) throw new AuthError();
      const auth = await authenticate(token);
      if (req.method === 'GET') { writeJson(res, 200, await store.get(auth)); return true; }
      if (req.method !== 'PUT') { writeError(res, 405, 'method_not_allowed'); return true; }
      requireUnsafeRequest(req, origin, req.headers['x-127v-csrf'], auth.csrf);
      const value = parseJsonObject(req, await readRequestBody(req, 24 * 1024), ['baseRevision','revision','envelope']);
      const revision = uuid(value.revision);
      const baseRevision = value.baseRevision === null ? null : uuid(value.baseRevision);
      const envelope = bytes(value.envelope, 16557);
      validateSettingsEnvelope(envelope, auth, revision);
      writeJson(res, 200, await store.put(auth, { baseRevision, revision, envelope }));
    } catch (error) {
      const status = error instanceof AuthError || error instanceof VaultError || error instanceof HttpBoundaryError ? error.status : 503;
      writeError(res, status, error instanceof VaultError || error instanceof HttpBoundaryError ? error.code : status === 401 ? 'authentication_required' : 'unavailable');
    }
    return true;
  };
}
