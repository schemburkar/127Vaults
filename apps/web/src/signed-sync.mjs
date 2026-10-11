const encoder = new TextEncoder();
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const un = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const cursor = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw Error('INVALID_SYNC_HISTORY'); };

// Server history is used as the causal base of the next signed write. Verify
// it before trusting that base, including histories read from the local replica.
export async function verifySyncHistory(history, { tenantId, vaultId, knownKeys = {}, ownDeviceId, ownPrivateKey, epoch }) {
  if (!history || !Array.isArray(history.operations) || !cursor(history.cursor) || history.hasMore === true
    || history.cursor !== history.operations.length) invalid();
  const heads = new Map(), keys = new Map(), seen = new Set();
  for (const [index, row] of history.operations.entries()) {
    const operation = row.operation;
    if (row.cursor !== index + 1 || !operation || operation.protocolVersion !== 1
      || operation.tenantId !== tenantId || operation.vaultId !== vaultId || !uuid(operation.deviceId)
      || !Number.isSafeInteger(operation.epoch) || operation.epoch < 1 || (epoch && operation.epoch > epoch)
      || !cursor(operation.causalBase) || operation.causalBase >= row.cursor
      || !['item.create', 'item.update', 'item.delete', 'conflict.resolve'].includes(operation.kind)
      || !uuid(operation.itemId) || !hash(operation.opId) || !hash(operation.payloadHash)
      || operation.previousDeviceOpId !== (heads.get(operation.deviceId) || null) || seen.has(operation.opId)) invalid();
    const publicRaw = history.devicePublicKeys?.[operation.deviceId];
    if (knownKeys[operation.deviceId] && publicRaw && knownKeys[operation.deviceId] !== publicRaw) throw Error('SYNC_DEVICE_KEY_CHANGED');
    const body = Object.fromEntries(['protocolVersion', 'tenantId', 'vaultId', 'deviceId', 'epoch', 'causalBase', 'previousDeviceOpId', 'kind', 'itemId', 'payloadHash'].map(key => [key, operation[key]]));
    if (operation.clientTime !== undefined) { if (typeof operation.clientTime !== 'string') invalid(); body.clientTime = operation.clientTime; }
    if (await digest(encoder.encode(canonical(body))) !== operation.opId) invalid();
    const message = encoder.encode(canonical({ ...body, opId: operation.opId }));
    try {
      const signature = un(operation.signature);
      if (signature.length !== 64) invalid();
      if (!publicRaw && operation.deviceId === ownDeviceId && ownPrivateKey) {
        // Older identities and newly created offline vaults may have no public
        // key in history yet. Ed25519 is deterministic: the persisted signing
        // key authenticates its own projected operations without exporting it.
        const proof = new Uint8Array(await crypto.subtle.sign('Ed25519', ownPrivateKey, message));
        if (proof.some((byte, offset) => byte !== signature[offset])) invalid();
        heads.set(operation.deviceId, operation.opId); seen.add(operation.opId); continue;
      }
      if (!publicRaw) throw Error('SYNC_DEVICE_KEY_CHANGED');
      let key = keys.get(operation.deviceId);
      if (!key) {
        const raw = un(publicRaw); if (raw.length !== 32) invalid();
        key = await crypto.subtle.importKey('raw', raw, 'Ed25519', false, ['verify']); keys.set(operation.deviceId, key);
      }
      if (signature.length !== 64 || !await crypto.subtle.verify('Ed25519', key, signature, message)) invalid();
      // Pin this device's returned public key to the actual stored private key,
      // including identities created before public keys were persisted.
      if (operation.deviceId === ownDeviceId && ownPrivateKey) {
        const proof = await crypto.subtle.sign('Ed25519', ownPrivateKey, message);
        if (!await crypto.subtle.verify('Ed25519', key, proof, message)) throw Error('SYNC_DEVICE_KEY_CHANGED');
      }
    } catch (error) {
      if (error.message === 'SYNC_DEVICE_KEY_CHANGED') throw error;
      invalid();
    }
    heads.set(operation.deviceId, operation.opId); seen.add(operation.opId);
  }
  return history;
}

export async function verifyLatestPayload(history, catalogue, index, body) {
  const last = history.operations.at(-1)?.operation;
  if (!last || last.kind === 'item.delete') return;
  const chunks = [catalogue, index, body].map(un), framed = new Uint8Array(chunks.reduce((size, chunk) => size + 4 + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { new DataView(framed.buffer).setUint32(offset, chunk.length); offset += 4; framed.set(chunk, offset); offset += chunk.length; }
  if (await digest(framed) !== last.payloadHash) throw Error('SYNC_PAYLOAD_MISMATCH');
}
export async function verifyQueuedOperation(entry, { tenantId, deviceId, privateKey }) {
  const operation = entry.body?.signedOperation;
  const path = entry.path.match(/^\/api\/v1\/vaults\/([0-9a-f-]+)\/items(?:\/([0-9a-f-]+))?$/);
  if (!path || !operation || operation.tenantId !== tenantId || operation.deviceId !== deviceId
    || operation.vaultId !== path[1] || operation.itemId !== (path[2] || entry.body.itemId)
    || operation.kind !== (entry.method === 'POST' ? 'item.create' : 'item.update')) invalid();
  const body = Object.fromEntries(['protocolVersion', 'tenantId', 'vaultId', 'deviceId', 'epoch', 'causalBase', 'previousDeviceOpId', 'kind', 'itemId', 'payloadHash'].map(key => [key, operation[key]]));
  if (operation.clientTime !== undefined) body.clientTime = operation.clientTime;
  if (await digest(encoder.encode(canonical(body))) !== operation.opId) invalid();
  const proof = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonical({ ...body, opId: operation.opId }))));
  const signature = un(operation.signature);
  if (signature.length !== proof.length || proof.some((byte, index) => byte !== signature[index])) invalid();
  await verifyLatestPayload({ operations: [{ operation }] }, entry.body.catalogue, entry.body.index, entry.body.body);
}

export const checkpointHash = checkpoint => digest(encoder.encode(canonical(checkpoint)));
export async function verifyCheckpoints(checkpoints, history, { tenantId, vaultId, publicKey, previous = null, pinnedKey = null }) {
  if (!publicKey || (pinnedKey && pinnedKey !== publicKey)) throw Error('SYNC_CHECKPOINT_KEY_CHANGED');
  let key;
  try { const raw = un(publicKey); if (raw.length !== 32) throw Error(); key = await crypto.subtle.importKey('raw', raw, 'Ed25519', false, ['verify']); }
  catch { throw Error('INVALID_SYNC_CHECKPOINT'); }
  const heads = ['0'.repeat(64)];
  for (const { operation } of history.operations) heads.push(await digest(encoder.encode(canonical({ previousHead: heads.at(-1), opId: operation.opId, signature: operation.signature }))));
  let prior = previous;
  for (const checkpoint of checkpoints) {
    const { signature, ...body } = checkpoint;
    if (checkpoint.protocolVersion !== 1 || checkpoint.tenantId !== tenantId || checkpoint.vaultId !== vaultId
      || !Number.isSafeInteger(checkpoint.epoch) || checkpoint.epoch < 1 || !cursor(checkpoint.cursor)
      || checkpoint.cursor > history.cursor || (prior && checkpoint.cursor < prior.cursor)
      || !hash(checkpoint.operationHeadHash) || checkpoint.operationHeadHash !== heads[checkpoint.cursor]
      || checkpoint.previousCheckpointHash !== (prior ? await checkpointHash(prior) : '0'.repeat(64))) throw Error('INVALID_SYNC_CHECKPOINT');
    try { const bytes = un(signature); if (bytes.length !== 64 || !await crypto.subtle.verify('Ed25519', key, bytes, encoder.encode(canonical(body)))) throw Error(); }
    catch { throw Error('INVALID_SYNC_CHECKPOINT'); }
    prior = checkpoint;
  }
  return prior;
}
