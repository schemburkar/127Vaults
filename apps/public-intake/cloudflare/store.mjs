import { limitIdentity, seal, unseal } from './crypto.mjs';

export class Conflict extends Error {}
export class TrialStore {
  #database;

  operatorSessions() {
    return {
      add: (nonce, expires) => this.db.prepare('INSERT INTO operator_sessions (nonce, expires_at) VALUES (?, ?)').bind(nonce, expires).run(),
      has: async (nonce, now) => Boolean(await this.#database.withSession('first-primary')
        .prepare('SELECT 1 FROM operator_sessions WHERE nonce = ? AND expires_at > ?').bind(nonce, now).first()),
      remove: nonce => this.db.prepare('DELETE FROM operator_sessions WHERE nonce = ?').bind(nonce).run(),
    };
  }

  constructor(db, contactKey, trialKey, now = () => Date.now(), limiterKey) {
    this.#database = db;
    // Authorization decisions must read current primary state, even if read replication is enabled later.
    this.db = db.withSession('first-primary');
    this.contactKey = contactKey; this.trialKey = trialKey; this.now = now; this.limiterKey = limiterKey;
  }
  async decode(row) {
    if (!row) return null;
    return { id: row.id, version: row.version, receivedAt: row.received_at,
      contact: row.contact ? await unseal(row.contact, this.contactKey, `contact:${row.id}`) : null,
      trial: row.trial ? await unseal(row.trial, this.trialKey, `trial:${row.id}`) : null };
  }
  async get(id) {
    return this.decode(await this.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first());
  }
  async list() {
    const { results } = await this.db.prepare('SELECT * FROM access_requests WHERE contact IS NOT NULL ORDER BY received_at, id').all();
    return Promise.all(results.map(row => this.decode(row)));
  }
  async insert(id, contact) {
    await this.db.prepare('INSERT INTO access_requests (id, received_at, contact) VALUES (?, ?, ?)')
      .bind(id, this.now(), await seal(contact, this.contactKey, `contact:${id}`)).run();
  }
  async insertOrder(id, contact, order) {
    await this.db.prepare('INSERT INTO access_requests (id, received_at, contact, trial) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, this.now(), await seal(contact, this.contactKey, `contact:${id}`), await seal(order, this.trialKey, `trial:${id}`)).run();
  }
  async save(row, trial, erase = false) {
    const encrypted = await seal(trial, this.trialKey, `trial:${row.id}`);
    const statement = erase
      ? this.db.prepare('UPDATE access_requests SET trial = ?, contact = NULL, version = version + 1 WHERE id = ? AND version = ?')
      : this.db.prepare('UPDATE access_requests SET trial = ?, version = version + 1 WHERE id = ? AND version = ?');
    const result = await statement.bind(encrypted, row.id, row.version).run();
    if (result.meta.changes !== 1) throw new Conflict('state_changed');
    row.version++; row.trial = trial; if (erase) row.contact = null;
  }
  async allow(scope, value, maximum, period) {
    const at = this.now(), window = Math.floor(at / period);
    const key = await limitIdentity(this.limiterKey, `${scope}:${value}`);
    const result = await this.db.prepare(`INSERT INTO request_limits (key, window, hits, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET window = excluded.window,
        hits = CASE WHEN request_limits.window = excluded.window THEN request_limits.hits + 1 ELSE 1 END,
        expires_at = excluded.expires_at
      WHERE request_limits.window != excluded.window OR request_limits.hits < ? RETURNING hits`)
      .bind(key, window, (window + 1) * period, maximum).first();
    return Boolean(result);
  }
  async expiredContacts(limit = 100, afterId = '') {
    const { results } = await this.db.prepare('SELECT * FROM access_requests WHERE contact IS NOT NULL AND received_at <= ? AND id > ? ORDER BY id LIMIT ?')
      .bind(this.now() - 90 * 86400000, afterId, limit).all();
    return Promise.all(results.map(row => this.decode(row)));
  }
  async pruneLimits() {
    await this.db.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(this.now()).run();
  }
}
