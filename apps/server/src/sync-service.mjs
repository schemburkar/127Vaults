import { GENESIS_HASH, SyncProtocolError, checkpointHash, createSignedCheckpoint, nextOperationHead, verifySignedOperation } from "../../../packages/sync/src/index.mjs";

export class InMemorySignedSyncService {
  #vaults = new Map();
  constructor({ checkpointPrivateKey }) { this.checkpointPrivateKey = checkpointPrivateKey; }
  registerVault({ tenantId, vaultId, epoch = 1, devices }) {
    const key = `${tenantId}/${vaultId}`; if (this.#vaults.has(key)) throw new SyncProtocolError("vault_exists");
    this.#vaults.set(key, { tenantId, vaultId, epoch, devices: new Map(devices.map((d) => [d.deviceId, d.publicKey])), operations: [], ids: new Set(), deviceHeads: new Map(), operationHead: GENESIS_HASH, checkpoint: null });
  }
  append(operation) {
    const vault = this.#vaults.get(`${operation.tenantId}/${operation.vaultId}`); if (!vault) throw new SyncProtocolError("wrong_vault");
    const publicKey = vault.devices.get(operation.deviceId); if (!publicKey) throw new SyncProtocolError("wrong_device");
    verifySignedOperation(operation, { publicKey, tenantId: vault.tenantId, vaultId: vault.vaultId, deviceId: operation.deviceId, epoch: vault.epoch });
    if (vault.ids.has(operation.opId)) return { accepted: false, duplicate: true, cursor: vault.operations.find((x) => x.operation.opId === operation.opId).cursor };
    if (operation.causalBase > vault.operations.length) throw new SyncProtocolError("causal_base_ahead");
    const prior = vault.deviceHeads.get(operation.deviceId) ?? null;
    if (operation.previousDeviceOpId !== prior) throw new SyncProtocolError(prior === null ? "replay_or_missing_predecessor" : "device_fork");
    const cursor = vault.operations.length + 1; vault.operationHead = nextOperationHead(vault.operationHead, operation);
    vault.operations.push({ cursor, operation }); vault.ids.add(operation.opId); vault.deviceHeads.set(operation.deviceId, operation.opId);
    return { accepted: true, duplicate: false, cursor };
  }
  fetch({ tenantId, vaultId, cursor = 0, limit = 100 }) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new SyncProtocolError("invalid_cursor");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new SyncProtocolError("invalid_limit");
    const vault = this.#vaults.get(`${tenantId}/${vaultId}`); if (!vault) throw new SyncProtocolError("wrong_vault");
    const operations = vault.operations.slice(cursor, cursor + limit);
    return { operations, cursor: operations.at(-1)?.cursor ?? cursor, hasMore: cursor + operations.length < vault.operations.length };
  }
  checkpoint({ tenantId, vaultId }) {
    const vault = this.#vaults.get(`${tenantId}/${vaultId}`); if (!vault) throw new SyncProtocolError("wrong_vault");
    const checkpoint = createSignedCheckpoint({ tenantId, vaultId, epoch: vault.epoch, cursor: vault.operations.length, previousCheckpointHash: vault.checkpoint ? checkpointHash(vault.checkpoint) : GENESIS_HASH, operationHeadHash: vault.operationHead }, this.checkpointPrivateKey);
    vault.checkpoint = checkpoint; return checkpoint;
  }
}
