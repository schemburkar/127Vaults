// Only encrypted protocol records enter this database. Auth cookies, passwords,
// decrypted indices/bodies, and account secrets must never be passed here.
export const isInstalledApp = () => globalThis.matchMedia?.('(display-mode: standalone)').matches === true || globalThis.navigator?.standalone === true;
export const networkUnavailable = error => ['SERVER_UNREACHABLE', 'SERVER_TIMEOUT'].includes(error.message);
const copy = value => structuredClone(value);
const uuid = bytes => {
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const bytes = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const recordRevision = (text, offset) => uuid(bytes(text).slice(offset, offset + 16));
const keyFor = path => path.split('?')[0];
const itemPath = /^\/api\/v1\/vaults\/([0-9a-f-]+)\/items(?:\/([0-9a-f-]+))?$/;
export const replicaRead = path => path === '/api/v1/vaults' || path === '/api/v1/vault-settings' || itemPath.test(keyFor(path)) || /^\/api\/v1\/vaults\/[0-9a-f-]+\/operations\?/.test(path);
export function collapseQueue(queue) {
  const output = [], positions = new Map();
  for (const original of queue) {
    const entry = copy(original), match = entry.path.match(itemPath);
    const key = match ? `${match[1]}:${entry.body.signedOperation.itemId}` : entry.path === '/api/v1/vault-settings' ? entry.path : entry.id;
    if (!positions.has(key)) { positions.set(key, output.length); output.push(entry); continue; }
    const position = positions.get(key), first = output[position];
    entry.baseline = first.baseline;
    entry.path = first.path; entry.method = first.method;
    if (match && first.method === 'POST') entry.body.itemId = first.body.itemId;
    output[position] = entry;
  }
  return output;
}

export class IndexedReplicaStore {
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('127vaults-pwa', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('replicas');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('LOCAL_STORAGE_BLOCKED'));
    });
  }
  async read(key) {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('replicas', 'readonly');
        const request = tx.objectStore('replicas').get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || Error('LOCAL_STORAGE_FAILED'));
      });
    } finally { db.close(); }
  }
  async write(key, value) {
    const db = await this.open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('replicas', 'readwrite');
        tx.objectStore('replicas').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error || Error('LOCAL_STORAGE_FAILED'));
      });
    } finally { db.close(); }
  }
}

export class PwaReplica {
  constructor({ store = new IndexedReplicaStore(), scope, changed = () => {} }) {
    this.store = store; this.scope = scope; this.changed = changed;
    this.state = null; this.local = false; this.serial = Promise.resolve();
  }
  async load() {
    this.state = await this.store.read(this.scope) || { version: 1, records: {}, queue: [], snapshotAt: null, unlock: null };
    if (this.state.version !== 1) throw Error('LOCAL_REPLICA_VERSION');
    this.changed(this);
    return this;
  }
  get pending() { return this.state?.queue.length || 0; }
  async exclusive(task) {
    const run = async () => {
      // Reload under the origin-wide lock so two installed windows cannot fork
      // the same device's queue or overwrite a committed local save.
      this.state = await this.store.read(this.scope) || this.state;
      return task();
    };
    const next = this.serial.then(() => globalThis.navigator?.locks
      ? navigator.locks.request(`127vaults:${this.scope}`, run) : run());
    this.serial = next.catch(() => {});
    return next;
  }
  async commit(next) {
    await this.store.write(this.scope, next);
    this.state = next;
    this.changed(this);
  }
  async saveUnlock(unlock) {
    return this.exclusive(() => this.commit({ ...this.state, unlock: copy(unlock) }));
  }
  async snapshot(records) {
    return this.exclusive(async () => {
      if (this.pending) throw Error('PENDING_LOCAL_CHANGES');
      for (const [path, history] of Object.entries(this.state.records)) {
        if (!path.endsWith('/operations') || !records[path]) continue;
        const next = records[path];
        if (next.cursor < history.cursor) throw Error('SYNC_ROLLBACK');
        const known = new Map(next.operations.map(row => [row.operation.opId, row.operation.signature]));
        if (history.operations.some(row => !known.has(row.operation.opId) || known.get(row.operation.opId) !== row.operation.signature)) throw Error('SYNC_FORK');
      }
      await this.commit({ ...this.state, records: copy(records), snapshotAt: Date.now() });
    });
  }
  read(path) {
    const value = this.state.records[keyFor(path)];
    if (value === undefined) throw Error('OFFLINE_DATA_UNAVAILABLE');
    return copy(value);
  }
  async enqueue(path, method, body) {
    return this.exclusive(async () => {
      const next = copy(this.state);
      const match = path.match(itemPath);
      const listPath = match && `/api/v1/vaults/${match[1]}/items`;
      const previous = match?.[2] && next.records[listPath]?.indices.find(row => row.itemId === match[2]);
      const baseline = match ? { catalogue: next.records[listPath]?.catalogue, index: previous?.envelope || null, body: next.records[`${listPath}/${match[2]}`]?.envelope || null }
        : path === '/api/v1/vault-settings' ? copy(next.records[path]) : null;
      const entry = { id: crypto.randomUUID(), path, method, body: copy(body), baseline, createdAt: Date.now() };
      this.project(next.records, entry);
      next.queue.push(entry);
      await this.commit(next); // A successful save means the IDB transaction committed.
      this.local = true;
      return { queued: true };
    });
  }
  project(records, { path, method, body }) {
    if (path === '/api/v1/vault-settings' && method === 'PUT') {
      if (records[path]?.revision !== body.baseRevision) throw Error('BASE_CHANGED');
      records[path] = { revision: body.revision, envelope: body.envelope }; return;
    }
    if (path === '/api/v1/vaults' && method === 'POST') {
      const directory = records[path];
      if (!directory || recordRevision(directory.directory, 36) !== body.baseDirectoryRevision) throw Error('BASE_CHANGED');
      const vaultId = uuid(bytes(body.vaultEnvelope).slice(44, 60));
      directory.directory = body.directory;
      directory.vaultEnvelopes.push({ vaultId, envelope: body.vaultEnvelope, retired: false });
      records[`${path}/${vaultId}/items`] = { catalogue: body.catalogue, indices: [] };
      records[`${path}/${vaultId}/operations`] = { cursor: 0, operations: [] };
      return;
    }
    const match = path.match(itemPath);
    if (!match || !['POST', 'PUT'].includes(method)) throw Error('ONLINE_REQUIRED');
    const [, vaultId, existingId] = match;
    const itemId = existingId || body.itemId, listPath = `/api/v1/vaults/${vaultId}/items`;
    const listed = records[listPath];
    if (!listed || recordRevision(listed.catalogue, 44) !== body.baseCatalogueRevision) throw Error('BASE_CHANGED');
    listed.catalogue = body.catalogue;
    const previous = listed.indices.find(row => row.itemId === itemId);
    listed.indices = listed.indices.filter(row => row.itemId !== itemId);
    listed.indices.push({ itemId, envelope: body.index, createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now() });
    records[`${listPath}/${itemId}`] = { envelope: body.body };
    const operations = records[`/api/v1/vaults/${vaultId}/operations`];
    if (!operations || !body.signedOperation) throw Error('OFFLINE_DATA_UNAVAILABLE');
    operations.cursor++;
    operations.operations.push({ operation: copy(body.signedOperation) });
  }
  async flush(send) {
    return this.exclusive(async () => {
      while (this.pending) {
        const entry = this.state.queue[0];
        try { await send(entry.path, { method: entry.method, body: entry.body }); }
        catch (error) { error.pendingEntry = copy(entry); throw error; }
        // Preserve exact request IDs and signatures until acceptance. A lost
        // response or crash is safely retried using server idempotency.
        const next = copy(this.state); next.queue.shift(); await this.commit(next);
      }
      this.local = false;
    });
  }
  async replaceQueue(records, entries, expectedQueue) {
    return this.exclusive(async () => {
      if (expectedQueue && JSON.stringify(this.state.queue) !== JSON.stringify(expectedQueue)) throw Error('LOCAL_QUEUE_CHANGED');
      const next = { ...copy(this.state), records: copy(records), queue: [] };
      for (const entry of entries) { this.project(next.records, entry); next.queue.push(copy(entry)); }
      await this.commit(next);
    });
  }
}
