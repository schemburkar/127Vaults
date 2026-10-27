import { readFile, rename, writeFile } from 'node:fs/promises';

const ROLLBACK_TOLERANCE_MS = 2 * 60_000;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

// A durable high-water mark of actual wall-clock observations. A backward clock
// step fails access closed until the wall clock catches up. VM elapsed-time
// counters can drift or jump across suspend/resume; never persist their projected
// future time as an observation of the wall clock. The host can
// still tamper with its own state; this is an operational guard, not a trusted clock.
export class LicenseClock {
  constructor(path, { wallNow = () => Date.now() } = {}) {
    if (!path) throw Error('License clock path is required.');
    this.path = path;
    this.wallNow = wallNow;
    this.pending = Promise.resolve();
    this.initialized = false;
  }
  observe() {
    const next = this.pending.catch(() => {}).then(() => this.#observe());
    this.pending = next;
    return next;
  }
  async #observe() {
    const wall = this.wallNow();
    if (!validTime(wall)) throw Error('license_clock_unavailable');
    if (!this.initialized) {
      let source;
      try { source = await readFile(this.path, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw Error('license_clock_unavailable'); }
      if (source !== undefined) {
        let record;
        try { record = JSON.parse(source); } catch { throw Error('license_clock_unavailable'); }
        if (!record || Object.keys(record).join(',') !== 'version,lastObservedMs'
          || record.version !== 1 || !validTime(record.lastObservedMs)) throw Error('license_clock_unavailable');
        this.highWater = record.lastObservedMs;
        this.persistedHighWater = record.lastObservedMs;
      } else {
        this.highWater = wall;
        this.persistedHighWater = 0;
      }
      this.initialized = true;
    }
    const floor = this.highWater;
    const rollbackDetected = wall + ROLLBACK_TOLERANCE_MS < floor;
    const effective = Math.max(wall, floor);
    if (!validTime(Math.floor(effective))) throw Error('license_clock_unavailable');
    this.highWater = Math.ceil(effective);
    if (this.persistedHighWater === 0 || this.highWater - this.persistedHighWater >= 60_000) {
      const nextPath = `${this.path}.next`;
      await writeFile(nextPath, JSON.stringify({ version: 1, lastObservedMs: this.highWater }) + '\n',
        { flag: 'w', mode: 0o600 });
      await rename(nextPath, this.path);
      this.persistedHighWater = this.highWater;
    }
    return { now: new Date(effective), clockState: rollbackDetected ? 'rollback_detected' : 'trusted' };
  }
}
