import { createHash, sign, verify } from "node:crypto";

export const SYNC_PROTOCOL_VERSION = 1;
export const GENESIS_HASH = "0".repeat(64);
export class SyncProtocolError extends Error { constructor(code, message = code) { super(message); this.name = "SyncProtocolError"; this.code = code; } }

export function assertSyncCursor(cursor) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new TypeError("sync cursor must be a non-negative safe integer");
  }
  return cursor;
}

function plainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new TypeError("canonical numbers must be safe integers"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!plainObject(value)) throw new TypeError("canonical value must contain only JSON data");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
export function canonicalBytes(value) { return Buffer.from(canonicalJson(value), "utf8"); }
export function sha256Hex(value) { return createHash("sha256").update(value).digest("hex"); }
function assertHex(value, bytes, field) { if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) throw new SyncProtocolError("malformed_operation", `${field} must be ${bytes}-byte lowercase hex`); }
function operationBody(operation) {
  const body = { protocolVersion: operation.protocolVersion, tenantId: operation.tenantId, vaultId: operation.vaultId, deviceId: operation.deviceId, epoch: operation.epoch, causalBase: operation.causalBase, previousDeviceOpId: operation.previousDeviceOpId, kind: operation.kind, itemId: operation.itemId, payloadHash: operation.payloadHash };
  if (operation.clientTime !== undefined) body.clientTime = operation.clientTime;
  return body;
}
export function deriveOperationId(operation) { return sha256Hex(canonicalBytes(operationBody(operation))); }
export function createSignedOperation(body, privateKey) {
  const normalized = operationBody({ protocolVersion: SYNC_PROTOCOL_VERSION, previousDeviceOpId: null, itemId: null, ...body });
  const opId = deriveOperationId(normalized);
  return { ...normalized, opId, signature: sign(null, canonicalBytes({ ...normalized, opId }), privateKey).toString("base64url") };
}
export function verifySignedOperation(operation, expected) {
  if (!plainObject(operation) || operation.protocolVersion !== SYNC_PROTOCOL_VERSION) throw new SyncProtocolError("unsupported_version");
  if (operation.tenantId !== expected.tenantId) throw new SyncProtocolError("wrong_tenant");
  if (operation.vaultId !== expected.vaultId) throw new SyncProtocolError("wrong_vault");
  if (operation.deviceId !== expected.deviceId) throw new SyncProtocolError("wrong_device");
  if (operation.epoch !== expected.epoch) throw new SyncProtocolError("wrong_epoch");
  assertSyncCursor(operation.causalBase); assertHex(operation.payloadHash, 32, "payloadHash"); assertHex(operation.opId, 32, "opId");
  if (!["item.create", "item.update", "item.delete", "conflict.resolve"].includes(operation.kind)) throw new SyncProtocolError("unsupported_operation");
  if (deriveOperationId(operation) !== operation.opId) throw new SyncProtocolError("unstable_operation_id");
  const signature = Buffer.from(operation.signature ?? "", "base64url");
  if (signature.length !== 64 || !verify(null, canonicalBytes({ ...operationBody(operation), opId: operation.opId }), expected.publicKey, signature)) throw new SyncProtocolError("invalid_signature");
  return operation;
}
function checkpointBody(c) { return { protocolVersion: c.protocolVersion, tenantId: c.tenantId, vaultId: c.vaultId, epoch: c.epoch, cursor: c.cursor, previousCheckpointHash: c.previousCheckpointHash, operationHeadHash: c.operationHeadHash }; }
export function checkpointHash(checkpoint) { return sha256Hex(canonicalBytes({ ...checkpointBody(checkpoint), signature: checkpoint.signature })); }
export function createSignedCheckpoint(body, privateKey) { const normalized = checkpointBody({ protocolVersion: SYNC_PROTOCOL_VERSION, ...body }); return { ...normalized, signature: sign(null, canonicalBytes(normalized), privateKey).toString("base64url") }; }
export function verifyCheckpoint(checkpoint, expected) {
  if (!plainObject(checkpoint) || checkpoint.protocolVersion !== SYNC_PROTOCOL_VERSION) throw new SyncProtocolError("unsupported_version");
  if (checkpoint.tenantId !== expected.tenantId) throw new SyncProtocolError("wrong_tenant");
  if (checkpoint.vaultId !== expected.vaultId) throw new SyncProtocolError("wrong_vault");
  if (checkpoint.epoch !== expected.epoch) throw new SyncProtocolError("wrong_epoch");
  assertSyncCursor(checkpoint.cursor); assertHex(checkpoint.previousCheckpointHash, 32, "previousCheckpointHash"); assertHex(checkpoint.operationHeadHash, 32, "operationHeadHash");
  const previousHash = expected.previousCheckpoint ? checkpointHash(expected.previousCheckpoint) : GENESIS_HASH;
  if (checkpoint.previousCheckpointHash !== previousHash) throw new SyncProtocolError("checkpoint_fork");
  if (expected.previousCheckpoint && checkpoint.cursor < expected.previousCheckpoint.cursor) throw new SyncProtocolError("checkpoint_rollback");
  const signature = Buffer.from(checkpoint.signature ?? "", "base64url");
  if (signature.length !== 64 || !verify(null, canonicalBytes(checkpointBody(checkpoint)), expected.publicKey, signature)) throw new SyncProtocolError("invalid_signature");
  return checkpoint;
}
export function nextOperationHead(previousHead, operation) { assertHex(previousHead, 32, "previousHead"); return sha256Hex(canonicalBytes({ previousHead, opId: operation.opId, signature: operation.signature })); }
