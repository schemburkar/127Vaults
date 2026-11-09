import { createPrivateKey, createPublicKey } from 'node:crypto';
import { isIP } from 'node:net';
import pg from 'pg';
import { initSync, ExperimentalOpaqueBridge } from '../../web/wasm/vaults_browser_fixture.js';
import opaqueModule from '../../web/wasm/vaults_browser_fixture_bg.wasm';
import { schemaChecksum, overlayChecksum } from '../wasm-auth/worker-manifest.mjs';
import { HttpBoundaryError, writeError } from '../src/http-boundary.mjs';
import { setVerifiedRequestSource } from '../src/relay-ingress.mjs';
import { createCloudRouting } from './routing.mjs';
import { createCloudLanding } from './landing.mjs';
import { cloudPublicOrigin, splitCloudTenantRoute } from './tenant-url.mjs';
import { createCloudWebAssets } from './web-assets.mjs';
import { createInternalCloudEnrollmentHandlers, createInternalCloudTenantHandlers } from './tenant-handlers.mjs';

function boundaryRequest(request) {
  const url = new URL(request.url);
  // The Worker URL carries the edge authority. Forwarded host headers are
  // never used for tenant selection or discovery.
  if (url.origin !== cloudPublicOrigin || url.username || url.password) {
    throw new HttpBoundaryError(404, 'not_found');
  }
  if (request.headers.has('origin') && request.headers.get('origin') !== cloudPublicOrigin) {
    throw new HttpBoundaryError(403, 'forbidden');
  }
  const path = url.pathname + url.search;
  if (url.pathname.startsWith('/t/') && !splitCloudTenantRoute(path)) throw new HttpBoundaryError(404, 'not_found');
  const req = {
    url: path, method: request.method, headers: Object.fromEntries(request.headers),
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      let done = false;
      try {
        while (!done) {
          const chunk = await reader.read();
          done = chunk.done;
          if (!done) yield chunk.value;
        }
      } finally {
        if (!done) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  };
  const ip = request.headers.get('cf-connecting-ip');
  if (request.cf && !request.headers.has('cf-worker') && ip && isIP(ip)) setVerifiedRequestSource(req, ip);
  return req;
}

function responseAdapter() {
  let status, headers, body;
  return {
    writeHead(code, fields) { status = code; headers = fields; },
    end(value) { body = value; },
    response() { return new Response(body, { status, headers }); }
  };
}

function keyBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error('Invalid Cloud Worker secret.');
  const key = Buffer.from(value, 'base64url');
  if (key.toString('base64url') !== value) throw Error('Invalid Cloud Worker secret.');
  return key;
}

function invitationMailer(binding) {
  if (!binding) return undefined;
  return { async sendCode(message) {
    const response = await binding.fetch('https://invitation-mail.internal/code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message)
    });
    if (!response.ok) throw Error('Cloud invitation mail unavailable.');
    await response.body?.cancel();
  } };
}

export default {
  async fetch(request, env) {
    const res = responseAdapter();
    let pool;
    try {
      const req = boundaryRequest(request);
      const readAsset = async path => {
        const asset = await env.ASSETS.fetch(new URL('/' + path, cloudPublicOrigin));
        if (!asset.ok) throw new HttpBoundaryError(asset.status === 404 ? 404 : 503, 'asset_unavailable');
        return Buffer.from(await asset.arrayBuffer());
      };
      const serveLanding = createCloudLanding(readAsset), webAssets = createCloudWebAssets(readAsset);
      if (['/', '/landing.css'].includes(req.url)) {
        await serveLanding(req, res);
      } else if (req.url.startsWith('/app/') || req.url.startsWith('/wasm/') ||
          req.url.startsWith('/icons/') || ['/brand-mark.svg', '/wordmark.svg'].includes(req.url)) {
        const asset = webAssets.match(req);
        if (!asset) throw new HttpBoundaryError(404, 'not_found');
        await webAssets.serve(req, res, asset);
      } else {
        if (req.url !== '/healthz' && !splitCloudTenantRoute(req.url)) throw new HttpBoundaryError(404, 'not_found');
        if (!env.VAULT_DB?.connectionString) throw Error('Cloud Worker database binding is required.');
        pool = new pg.Pool({ connectionString: env.VAULT_DB.connectionString, max: 1,
          connectionTimeoutMillis: 3000, query_timeout: 5000 });
        pool.on('error', () => console.error('Cloud Worker database connection failed.'));
        const tokenKey = keyBytes(env.CLOUD_TOKEN_KEY), seed = keyBytes(env.CLOUD_CHECKPOINT_SEED);
        const encoded = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
        const checkpointPrivateKey = createPrivateKey({ key: encoded, format: 'der', type: 'pkcs8' });
        seed.fill(0);
        encoded.fill(0);
        const checkpointPublicKey = createPublicKey(checkpointPrivateKey)
          .export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
        initSync({ module: opaqueModule });
        const bridge = ExperimentalOpaqueBridge;
        const dispatch = await createCloudRouting({
          pool, region: 'global', schemaChecksum, overlayChecksum, webAssets, serveLanding, verifyRequest() {},
          handle: createInternalCloudTenantHandlers({ bridge, tokenKey, checkpointPrivateKey, checkpointPublicKey,
            mailer: invitationMailer(env.INVITATION_MAIL) }),
          handleEnrollment: createInternalCloudEnrollmentHandlers({ bridge, tokenKey })
        });
        await dispatch(req, res);
      }
    } catch (error) {
      if (error instanceof HttpBoundaryError) writeError(res, error.status, error.code);
      else {
        console.error('Cloud Worker request failed.');
        writeError(res, 503, 'unavailable');
      }
    } finally {
      if (pool) await pool.end();
    }
    return res.response();
  }
};
