import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { notifyAccessRequest } from './worker.mjs';

// Only the internal intake service receives this binding; it cannot call arbitrary admin APIs.
export class AccessRequestAlerts extends WorkerEntrypoint {
  async notify(id) { await notifyAccessRequest(this.env, id); }
}
export default worker;
