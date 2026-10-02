import { createPublicKey } from 'node:crypto';
import { GENESIS_HASH, SyncProtocolError, checkpointHash, createSignedCheckpoint, nextOperationHead, verifySignedOperation } from '../../../packages/sync/src/index.mjs';

const hex = value => Buffer.from(value, 'hex');
const rawEd25519 = value => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(value)]), format: 'der', type: 'spki' });
const safe = (value, code = 'invalid_cursor') => { const n=Number(value); if(!Number.isSafeInteger(n)||n<0)throw new SyncProtocolError(code);return n; };
const iso = value => value == null ? undefined : new Date(value).toISOString();

export class PgSignedSyncStore {
  constructor(pool, checkpointPrivateKey) { if(!pool||!checkpointPrivateKey)throw new Error('PostgreSQL pool and checkpoint signing key are required.');this.pool=pool;this.checkpointPrivateKey=checkpointPrivateKey; }
  async #tx(fn){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='5s'");const out=await fn(c);await c.query('COMMIT');return out}catch(error){await c.query('ROLLBACK').catch(()=>{});if(error instanceof SyncProtocolError)throw error;throw new SyncProtocolError('unavailable')}finally{c.release();}}
  async #authorized(c,auth,vaultId,lock=false){
    const row=(await c.query(`SELECT s.epoch,s.next_cursor,s.operation_head_hash,s.latest_checkpoint_sequence,s.latest_checkpoint_hash,s.state,v.retired_at,d.signing_public_key,d.credential_epoch
      FROM vaults.sync_vault_state s JOIN vaults.private_vaults v ON(v.tenant_id=s.tenant_id AND v.id=s.vault_id)
      JOIN vaults.devices d ON(d.tenant_id=v.tenant_id AND d.account_id=v.account_id AND d.id=$4)
      WHERE s.tenant_id=$1 AND s.vault_id=$2 AND v.account_id=$3 AND d.lifecycle_status='active'${lock?' FOR UPDATE OF s':''}`,
      [auth.tenantId,vaultId,auth.accountId,auth.deviceId])).rows[0];
    if(!row)throw new SyncProtocolError('not_found');
    if(row.state!=='healthy')throw new SyncProtocolError('vault_frozen');
    if(Number(row.credential_epoch)!==auth.credentialEpoch)throw new SyncProtocolError('stale_credential');
    return row;
  }
  async append(auth,operation){return this.#tx(c=>this.appendInTransaction(c,auth,operation));}
  async appendInTransaction(c,auth,operation){
    const state=await this.#authorized(c,auth,operation.vaultId,true);
    if(state.retired_at)throw new SyncProtocolError('vault_frozen');
    if(operation.tenantId!==auth.tenantId||operation.deviceId!==auth.deviceId)throw new SyncProtocolError('forbidden');
    verifySignedOperation(operation,{tenantId:auth.tenantId,vaultId:operation.vaultId,deviceId:auth.deviceId,epoch:Number(state.epoch),publicKey:rawEd25519(state.signing_public_key)});
    const duplicate=(await c.query('SELECT cursor,signature FROM vaults.sync_operations WHERE tenant_id=$1 AND vault_id=$2 AND operation_id=$3',[auth.tenantId,operation.vaultId,hex(operation.opId)])).rows[0];
    if(duplicate){if(!Buffer.from(duplicate.signature).equals(Buffer.from(operation.signature,'base64url')))throw new SyncProtocolError('operation_id_reused');return {accepted:false,duplicate:true,cursor:safe(duplicate.cursor)};}
    const cursor=safe(state.next_cursor,'cursor_exhausted'),headCursor=cursor-1;
    if(operation.causalBase>headCursor)throw new SyncProtocolError('causal_base_ahead');
    const deviceHead=(await c.query('SELECT last_operation_id FROM vaults.sync_device_heads WHERE tenant_id=$1 AND vault_id=$2 AND device_id=$3',[auth.tenantId,operation.vaultId,auth.deviceId])).rows[0];
    const expected=deviceHead?Buffer.from(deviceHead.last_operation_id).toString('hex'):null;
    if(operation.previousDeviceOpId!==expected)throw new SyncProtocolError('device_fork');
    const newHead=nextOperationHead(Buffer.from(state.operation_head_hash).toString('hex'),operation);
    await c.query(`INSERT INTO vaults.sync_operations(tenant_id,vault_id,cursor,protocol_version,operation_id,device_id,epoch,causal_base,predecessor_operation_id,kind,item_id,payload_hash,client_time,signature)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[auth.tenantId,operation.vaultId,cursor,operation.protocolVersion,hex(operation.opId),auth.deviceId,operation.epoch,operation.causalBase,operation.previousDeviceOpId&&hex(operation.previousDeviceOpId),operation.kind,operation.itemId,hex(operation.payloadHash),operation.clientTime??null,Buffer.from(operation.signature,'base64url')]);
    await c.query(`INSERT INTO vaults.sync_device_heads(tenant_id,vault_id,device_id,last_operation_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,vault_id,device_id) DO UPDATE SET last_operation_id=EXCLUDED.last_operation_id`,[auth.tenantId,operation.vaultId,auth.deviceId,hex(operation.opId)]);
    await c.query('UPDATE vaults.sync_vault_state SET next_cursor=$3,operation_head_hash=$4 WHERE tenant_id=$1 AND vault_id=$2',[auth.tenantId,operation.vaultId,cursor+1,hex(newHead)]);
    return {accepted:true,duplicate:false,cursor};
  }
  async fetch(auth,{vaultId,cursor=0,limit=100}){
    cursor=safe(cursor);if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new SyncProtocolError('invalid_limit');
    await this.#authorized(this.pool,auth,vaultId);
    const rows=(await this.pool.query(`SELECT o.cursor,o.protocol_version,o.operation_id,o.device_id,o.epoch,o.causal_base,o.predecessor_operation_id,o.kind,o.item_id,o.payload_hash,o.client_time,o.signature,d.signing_public_key
      FROM vaults.sync_operations o JOIN vaults.devices d ON(d.tenant_id=o.tenant_id AND d.id=o.device_id) WHERE o.tenant_id=$1 AND o.vault_id=$2 AND o.cursor>$3 ORDER BY o.cursor LIMIT $4`,[auth.tenantId,vaultId,cursor,limit+1])).rows;
    const hasMore=rows.length>limit;if(hasMore)rows.pop();
    const operations=rows.map(r=>({cursor:safe(r.cursor),operation:{protocolVersion:Number(r.protocol_version),tenantId:auth.tenantId,vaultId,deviceId:r.device_id,epoch:Number(r.epoch),causalBase:safe(r.causal_base),previousDeviceOpId:r.predecessor_operation_id?Buffer.from(r.predecessor_operation_id).toString('hex'):null,kind:r.kind,itemId:r.item_id,payloadHash:Buffer.from(r.payload_hash).toString('hex'),...(r.client_time?{clientTime:iso(r.client_time)}:{}),opId:Buffer.from(r.operation_id).toString('hex'),signature:Buffer.from(r.signature).toString('base64url')}}));
    const devicePublicKeys=Object.fromEntries(rows.map(r=>[r.device_id,Buffer.from(r.signing_public_key).toString('base64url')]));
    return {operations,cursor:operations.at(-1)?.cursor??cursor,hasMore,devicePublicKeys};
  }
  async latestCheckpoint(auth,vaultId){await this.#authorized(this.pool,auth,vaultId);const r=(await this.pool.query('SELECT * FROM vaults.sync_checkpoints WHERE tenant_id=$1 AND vault_id=$2 ORDER BY checkpoint_sequence DESC LIMIT 1',[auth.tenantId,vaultId])).rows[0];return r?this.#checkpoint(r):null;}
  async createCheckpoint(auth,vaultId){return this.#tx(async c=>{const s=await this.#authorized(c,auth,vaultId,true),cursor=safe(s.next_cursor)-1,priorSequence=safe(s.latest_checkpoint_sequence,'checkpoint_exhausted');if(priorSequence===Number.MAX_SAFE_INTEGER)throw new SyncProtocolError('checkpoint_exhausted');const checkpoint=createSignedCheckpoint({tenantId:auth.tenantId,vaultId,epoch:Number(s.epoch),cursor,previousCheckpointHash:Buffer.from(s.latest_checkpoint_hash).toString('hex'),operationHeadHash:Buffer.from(s.operation_head_hash).toString('hex')},this.checkpointPrivateKey);const hash=checkpointHash(checkpoint),sequence=priorSequence+1;await c.query(`INSERT INTO vaults.sync_checkpoints(tenant_id,vault_id,checkpoint_sequence,protocol_version,epoch,cursor,previous_checkpoint_hash,operation_head_hash,checkpoint_hash,server_signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[auth.tenantId,vaultId,sequence,checkpoint.protocolVersion,checkpoint.epoch,checkpoint.cursor,hex(checkpoint.previousCheckpointHash),hex(checkpoint.operationHeadHash),hex(hash),Buffer.from(checkpoint.signature,'base64url')]);await c.query('UPDATE vaults.sync_vault_state SET latest_checkpoint_sequence=$3,latest_checkpoint_hash=$4 WHERE tenant_id=$1 AND vault_id=$2',[auth.tenantId,vaultId,sequence,hex(hash)]);return checkpoint;});}
  #checkpoint(r){return {protocolVersion:Number(r.protocol_version),tenantId:r.tenant_id,vaultId:r.vault_id,epoch:Number(r.epoch),cursor:safe(r.cursor),previousCheckpointHash:Buffer.from(r.previous_checkpoint_hash).toString('hex'),operationHeadHash:Buffer.from(r.operation_head_hash).toString('hex'),signature:Buffer.from(r.server_signature).toString('base64url')};}
}
