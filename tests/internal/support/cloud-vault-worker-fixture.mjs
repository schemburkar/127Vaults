import { createServer } from 'node:https';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { cloudPublicOrigin } from '../../../apps/server/internal-cloud/tenant-url.mjs';
import { containRequestErrors, readRequestBody } from '../../../apps/server/src/http-boundary.mjs';
import { repository } from '../../../scripts/sites/assets.mjs';

export function localCloudVaultWorker({ tls, databaseUrl, tokenKey, checkpointPrivateKey, mailer }) {
  const build = join(repository, 'apps/server/wasm-auth');
  const bundle = join(build, 'worker-bundle');
  const mf = new Miniflare({
    modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true },
      { type: 'CompiledWasm', include: ['**/*.wasm'] }],
    compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    hyperdrives: { VAULT_DB: databaseUrl },
    bindings: {
      CLOUD_TOKEN_KEY: tokenKey.toString('base64url'),
      CLOUD_CHECKPOINT_SEED: checkpointPrivateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64url')
    },
    assets: { directory: join(build, 'worker-assets'), binding: 'ASSETS',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
      assetConfig: { html_handling: 'none', not_found_handling: 'none' } },
    serviceBindings: { INVITATION_MAIL: async request => {
      await mailer.sendCode(await request.json());
      return new Response(null, { status: 204 });
    } }
  });
  const dispatch = (url, options) => mf.dispatchFetch(url, options);
  const server = createServer(tls, containRequestErrors(async (req, res) => {
    const response = await dispatch(new URL(req.url, cloudPublicOrigin), {
      method: req.method, headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequestBody(req, 2 * 1024 * 1024)
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }, error => console.error('Local Cloud Worker proxy error', error.code ?? error.message)));
  return { server, dispatch, dispose: () => mf.dispose() };
}
