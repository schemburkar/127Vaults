// Disposable ECF1 worker boundary. No persistence, accounts, or stable API.
export const ECF1_DEADLINE_MS = 30_000;

export class Ecf1WorkerClient {
  #worker;
  #pending = null;
  #next = 1;
  #disposed = false;

  constructor() { this.#replace(); }

  #replace() {
    if (this.#disposed) return;
    const worker = new Worker('/fixture/ecf1-worker.mjs', { type: 'module', name: '127vaults-ecf1-disposable' });
    this.#worker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== this.#worker) return;
      if (!this.#pending || data.id !== this.#pending.id) return;
      const { resolve, reject, timer } = this.#pending;
      this.#pending = null;
      clearTimeout(timer);
      data.ok ? resolve(data.value) : reject(new Error(data.error));
    };
    worker.onerror = () => {
      if (worker === this.#worker) this.#fail('INTERNAL_ERROR');
    };
  }

  #fail(code) {
    if (!this.#pending) return;
    const { reject, timer } = this.#pending;
    this.#pending = null;
    clearTimeout(timer);
    reject(new Error(code));
  }

  request(operation, payload = {}) {
    if (this.#disposed) return Promise.reject(new Error('CANCELLED'));
    if (this.#pending) return Promise.reject(new Error('BUSY'));
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending || this.#pending.id !== id) return;
        this.#worker.terminate();
        this.#pending = null;
        reject(new Error('CANCELLED'));
        this.#replace();
      }, ECF1_DEADLINE_MS);
      this.#pending = { id, resolve, reject, timer };
      this.#worker.postMessage({ id, operation, payload });
    });
  }

  lock() {
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
    this.#fail('CANCELLED');
    this.#replace();
  }

  dispose() {
    this.#disposed = true;
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
    this.#fail('CANCELLED');
  }
}
