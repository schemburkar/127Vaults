import init, { ExperimentalEcf1Core } from '/wasm/vaults_browser_fixture.js';

let core;
let root;
let vault;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function lockCore() {
  try { core?.lock(); } finally {
    root?.free(); vault?.free(); core?.free();
    root = undefined; vault = undefined; core = undefined;
  }
}
function randomUuid() {
  const value = crypto.getRandomValues(new Uint8Array(16));
  value[6] = (value[6] & 0x0f) | 0x40; value[8] = (value[8] & 0x3f) | 0x80;
  return value;
}
function itemTemplate(ids) {
  const value = new Uint8Array(77); value[0] = 3;
  value.set(ids.tenant, 1); value.set(ids.vault, 33); value.set(ids.item, 49);
  value.set([0, 0, 0, 1], 65); value[76] = 1;
  return value;
}
function rootTemplate(ids) {
  const value = new Uint8Array(77); value[0] = 1;
  value.set(ids.tenant, 1); value.set(ids.account, 17);
  value.set([0, 0, 0, 1], 65); value[76] = 1;
  return value;
}
function vaultTemplate(ids) {
  const value = new Uint8Array(77); value[0] = 2;
  value.set(ids.tenant, 1); value.set(ids.account, 17); value.set(ids.vault, 33); value.set(ids.vault, 49);
  value.set([0, 0, 0, 1], 65); value[76] = 1;
  return value;
}
function bytes(value) {
  if (!Array.isArray(value) || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('INVALID_INPUT');
  return Uint8Array.from(value);
}
function secret(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('INVALID_INPUT');
  return Uint8Array.from(hex.match(/../g), value => Number.parseInt(value, 16));
}
function publicEnvelope(value) { return { context: Array.from(value.context()), envelope: Array.from(value.envelope()) }; }
function encodeItem(item) {
  const plain = encoder.encode(JSON.stringify(item));
  if (plain.length === 0) throw new Error('INVALID_INPUT');
  return plain;
}
function decodeItem(plain) {
  try { return JSON.parse(decoder.decode(plain)); } catch { throw new Error('INVALID_INPUT'); }
  finally { plain.fill(0); }
}
function loadCore(Core, record, password, accountSecret) {
  lockCore(); core = new Core();
  const rootRecord = record.root; const vaultRecord = record.vault;
  root = core.unwrap_root(bytes(rootRecord.envelope), bytes(rootRecord.context), encoder.encode(password), secret(accountSecret));
  vault = core.unwrap_vault(root, bytes(vaultRecord.envelope), bytes(vaultRecord.context));
}

function uuid(seed) {
  const value = new Uint8Array(16).fill(seed);
  value[6] = 0x40; value[8] = 0x80;
  return value;
}
function template(purpose) {
  const value = new Uint8Array(77); value[0] = purpose; value.set(uuid(1), 1);
  if (purpose === 1) value.set(uuid(2), 17);
  if (purpose === 2) { value.set(uuid(2), 17); value.set(uuid(3), 33); value.set(uuid(3), 49); }
  if (purpose === 3 || purpose === 4) { value.set(uuid(3), 33); value.set(uuid(4), 49); }
  value.set([0, 0, 0, 1], 65); value[76] = 1;
  return value;
}
function expectCode(action, code) {
  try { action(); } catch (error) { if (error.message === code) return; throw error; }
  throw new Error('INTERNAL_ERROR');
}
async function smoke() {
  const root = core.create_root(template(1), encoder.encode('disposable password'), new Uint8Array(32).fill(9));
  const vault = core.create_vault(root, template(2));
  const made = core.encrypt_item(vault, template(3), encoder.encode('fictitious secret'));
  const envelope = made.envelope(); const context = made.context();
  if (decoder.decode(core.decrypt_item(vault, envelope, context)) !== 'fictitious secret') throw new Error('INTERNAL_ERROR');
  const tampered = envelope.slice(); tampered[tampered.length - 1] ^= 1;
  expectCode(() => core.decrypt_item(vault, tampered, context), 'AUTHENTICATION_FAILED');
  const trailing = new Uint8Array(envelope.length + 1); trailing.set(envelope);
  expectCode(() => core.decrypt_item(vault, trailing, context), 'INVALID_INPUT');
  expectCode(() => core.decrypt_item(vault, new Uint8Array(1), context), 'INVALID_INPUT');
  const unsupported = envelope.slice(); unsupported[0] ^= 1;
  expectCode(() => core.decrypt_item(vault, unsupported, context), 'UNSUPPORTED_FORMAT');
  const wrong = context.slice(); wrong[64] ^= 1;
  expectCode(() => core.decrypt_item(vault, envelope, wrong), 'CONTEXT_MISMATCH');
  expectCode(() => core.encrypt_item(vault, template(4), new Uint8Array(65_537)), 'LIMIT_EXCEEDED');
  expectCode(() => core.encrypt_item(vault, template(3), new Uint8Array()), 'LIMIT_EXCEEDED');
  core.lock();
  expectCode(() => core.decrypt_item(vault, envelope, context), 'INVALID_HANDLE');
  return ['round-trip', 'tamper', 'malformed', 'unsupported', 'context', 'limits', 'lock'];
}

self.onmessage = async ({ data }) => {
  try {
    await init();
    if (data.operation === 'stall') return;
    let value;
    if (data.operation === 'smoke') {
      if (!core) core = new ExperimentalEcf1Core();
      value = await smoke(); lockCore();
    } else if (data.operation === 'create') {
      lockCore(); core = new ExperimentalEcf1Core();
      const ids = { tenant: randomUuid(), account: randomUuid(), vault: randomUuid(), item: randomUuid() };
      root = core.create_root(rootTemplate(ids), encoder.encode(data.payload.password), secret(data.payload.accountSecret));
      vault = core.create_vault(root, vaultTemplate(ids));
      const plain = encodeItem(data.payload.item);
      let made;
      try { made = core.encrypt_item(vault, itemTemplate(ids), plain); } finally { plain.fill(0); }
      value = { record: { format: 'ECF1', revision: 1, ids: Object.fromEntries(Object.entries(ids).map(([key, val]) => [key, Array.from(val)])), root: publicEnvelope(root), vault: publicEnvelope(vault), item: publicEnvelope(made) }, item: data.payload.item };
      made.free();
    } else if (data.operation === 'unlock') {
      loadCore(ExperimentalEcf1Core, data.payload.record, data.payload.password, data.payload.accountSecret);
      value = { item: decodeItem(core.decrypt_item(vault, bytes(data.payload.record.item.envelope), bytes(data.payload.record.item.context))) };
    } else if (data.operation === 'save') {
      if (!core || !vault) throw new Error('INVALID_HANDLE');
      const ids = Object.fromEntries(Object.entries(data.payload.record.ids).map(([key, val]) => [key, bytes(val)]));
      const plain = encodeItem(data.payload.item);
      let made;
      try { made = core.encrypt_item(vault, itemTemplate(ids), plain); } finally { plain.fill(0); }
      value = { record: { ...data.payload.record, revision: data.payload.record.revision + 1, item: publicEnvelope(made) }, item: data.payload.item };
      made.free();
    } else if (data.operation === 'lock') {
      lockCore(); value = true;
    } else throw new Error('INVALID_INPUT');
    self.postMessage({ id: data.id, ok: true, value });
  } catch (error) {
    if (data.operation !== 'save') lockCore();
    self.postMessage({ id: data.id, ok: false, error: /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR' });
  }
};
