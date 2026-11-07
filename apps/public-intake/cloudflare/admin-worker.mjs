import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { notifyAccessRequest } from './worker.mjs';
import { handleCloudAdmin } from './cloud-admin.mjs';

// Only the internal intake service receives this binding; it cannot call arbitrary admin APIs.
export class AccessRequestAlerts extends WorkerEntrypoint {
  async notify(id) { await notifyAccessRequest(this.env, id); }
}
export default { ...worker, fetch(request, env, ctx) {
  if (new URL(request.url).pathname.startsWith('/cloud-tenants/api/')) return handleCloudAdmin(request, env);
  return worker.fetch(request, env, ctx);
} };
