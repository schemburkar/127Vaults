import { Miniflare } from 'miniflare';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rmdir, realpath, appendFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageSite, repository } from './assets.mjs';
import { protectedDirectory } from '../cloudflare/config.mjs';
import { validIntakeOrigin, isLoopbackHostname } from '../../apps/public-intake/src/intake-origin.mjs';
import { encryptionKey, seal } from '../../apps/public-intake/cloudflare/crypto.mjs';

export const defaultOrigins = { public: 'http://localhost:12951', admin: 'http://admin.localhost:12952', customer: 'http://manage.localhost:12953' };
export function validateOrigins(origins) {
  if (Object.keys(origins).sort().join(',') !== 'admin,customer,public'
    || Object.values(origins).some(origin => !validIntakeOrigin(origin, true)
      || new URL(origin).protocol !== 'http:' || !isLoopbackHostname(new URL(origin).hostname))
    || new Set(Object.values(origins)).size !== 3
    || new Set(Object.values(origins).map(origin => new URL(origin).port)).size !== 3
    || new Set(Object.values(origins).map(origin => new URL(origin).hostname)).size !== 3) throw Error('Use three distinct loopback origins and three separate hostnames.');
  return origins;
}
export function validatePreviewDirectory(directory) {
  const root = resolve(repository), target = resolve(directory), rel = relative(root, target), ancestor = relative(target, root);
  const inside = !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
  const isAncestor = !isAbsolute(ancestor) && ancestor !== '..' && !ancestor.startsWith('..' + sep);
  if (target === parse(target).root || isAncestor || (inside && ![`.tools${sep}`, `.cloudflare-deploy${sep}`].some(prefix => rel.startsWith(prefix)))) {
    throw Error('Use a dedicated preview directory outside the repository or beneath its ignored .tools directory.');
  }
  return target;
}
async function ensureFile(path, make) {
  try { await writeFile(path, make(), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return (await readFile(path, 'utf8')).trim();
}
async function intakeKeys(hex) {
  const material = await crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), 'HKDF', false, ['deriveBits']);
  const derive = async purpose => Buffer.from(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode('127Vaults Cloudflare v1'), info: new TextEncoder().encode(purpose) }, material, 256)).toString('base64url');
  return { INTAKE_CONTACT_KEY: await derive('contacts'), INTAKE_LIMITER_KEY: await derive('request-limits') };
}
async function localAssetService(site) {
  // Each local site gets its own immutable file map. No directory fallback or cross-site asset lookup.
  const files = new Map(await Promise.all(site.files.map(async name => [name, await readFile(join(site.directory, name))])));
  const types = { html: 'text/html; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', json: 'application/json' };
  return request => {
    const url = new URL(request.url), path = url.pathname;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      ...(site.surface === 'public' ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }) };
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers });
    if (!/^\/[a-zA-Z0-9._-]*$/.test(path)) return new Response(null, { status: 404, headers });
    const name = path === '/' ? 'index.html' : path.slice(1);
    const file = files.has(name) ? name : files.has(`${name}.html`) ? `${name}.html` : null;
    if (!file) return new Response(null, { status: 404, headers });
    if (path.endsWith('.html')) { url.pathname = file === 'index.html' ? '/' : path.slice(0, -5); return new Response(null, { status: 307, headers: { ...headers, Location: url.href } }); }
    return new Response(request.method === 'HEAD' ? null : files.get(file), { headers: { ...headers, 'Content-Type': types[file.split('.').at(-1)] ?? 'application/octet-stream' } });
  };
}
export async function createLocalSites({ directory = join(repository, '.tools', 'site-preview'), origins = defaultOrigins } = {}) {
  origins = validateOrigins(origins); directory = validatePreviewDirectory(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = validatePreviewDirectory(await realpath(directory));
  await protectedDirectory(directory);
  const lock = join(directory, '.preview-lock');
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw Error('This preview directory is already in use. Stop its previous preview before recovery; existing data was preserved.'); throw error; }
  let mf, stopped = false; const servers = [];
  const close = async () => {
    if (stopped) return; stopped = true;
    await Promise.all(servers.map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
    try { await mf?.dispose(); } finally { await rmdir(lock); }
  };
  try {
    const intakeKey = await ensureFile(join(directory, 'intake-key'), () => randomBytes(32).toString('hex'));
    const operatorToken = await ensureFile(join(directory, 'operator-token'), () => randomBytes(32).toString('base64url'));
    const privateKey = await ensureFile(join(directory, 'issuer.pem'), () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    if (!/^[a-f0-9]{64}$/.test(intakeKey) || !/^[A-Za-z0-9_-]{43}$/.test(operatorToken)) throw Error('Invalid local preview credentials; no identity was reset.');
    const build = join(directory, 'assets', crypto.randomUUID()); await mkdir(build, { recursive: true });
    const sites = {};
    for (const surface of ['public', 'admin', 'customer']) sites[surface] = await stageSite(surface, join(build, surface), { publicOrigin: origins.public });
    const archive = '127Vaults local site preview sample. This is not an installable server package.\n';
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const catalogue = { schemaVersion: 1, sourceRevision: '0'.repeat(40),
      issuerPublicKeys: { trial: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) },
      artifacts: [{ id: 'server', filename: 'local-preview-server.tar', label: 'Sample server package for local preview only',
        objectKey: 'releases/local/server.tar', etag: createHash('md5').update(archive).digest('hex'), sha256, sizeBytes: Buffer.byteLength(archive) }] };
    const catalogueSource = JSON.stringify(catalogue);
    const base = { modules: true, modulesRoot: repository, modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
      compatibilityDate: '2026-07-01', outboundService: () => new Response('External services are disabled in local preview.', { status: 503 }) };
    const assetServices = {};
    for (const surface of ['public', 'admin', 'customer']) assetServices[surface] = await localAssetService(sites[surface]);
    const control = { LOCAL_SITE_PREVIEW: '1', INTAKE_KEY: intakeKey, OPERATOR_TOKEN: operatorToken,
      CUSTOMER_PORTAL_ENABLED: '1',
      CUSTOMER_ORIGIN: origins.customer, ADMIN_ORIGIN: origins.admin,
      TRIAL_ISSUER_KEY_ID: 'trial', TRIAL_ISSUER_PRIVATE_KEY: privateKey, TRIAL_CATALOGUE_KEY: 'releases/local/catalogue.json',
      TRIAL_CATALOGUE_SHA256: createHash('sha256').update(catalogueSource).digest('hex'), TRIAL_SOURCE_REVISION: catalogue.sourceRevision, DODO_ENABLED: '0' };
    const db = { DB: '127vaults-local-sites' }, r2 = { ARTIFACTS: '127vaults-local-packages' };
    const mailKey = await encryptionKey(intakeKey, 'local-customer-mail');
    const mailService = async request => {
      const message = await request.json(), id = crypto.randomUUID();
      await appendFile(join(directory, 'customer-mail.jsonl'), JSON.stringify({ id,
        envelope: await seal({ ...message, at: new Date().toISOString(), simulated: true }, mailKey, `local-mail:${id}`) }) + '\n', { mode: 0o600 });
      return new Response('{}');
    };
    mf = new Miniflare({ host: '127.0.0.1', port: 0, d1Persist: join(directory, 'state', 'd1'), r2Persist: join(directory, 'state', 'r2'),
      workers: [
        { ...base, name: 'public', routes: [`${new URL(origins.public).hostname}/*`], scriptPath: join(repository, 'apps/public-intake/cloudflare/public-site.mjs'),
          bindings: { PUBLIC_INTAKE_ORIGIN: origins.public }, serviceBindings: { INTAKE: 'intake', ASSETS: assetServices.public } },
        { ...base, name: 'intake', scriptPath: join(repository, 'apps/public-intake/cloudflare/intake-only.mjs'),
          bindings: { PUBLIC_INTAKE_ORIGIN: origins.public, ...await intakeKeys(intakeKey) }, d1Databases: db },
        ...['admin', 'customer'].map(surface => ({ ...base, name: surface, routes: [`${new URL(origins[surface]).hostname}/*`],
          scriptPath: join(repository, 'apps/public-intake/cloudflare/worker.mjs'), bindings: { ...control, SITE_SURFACE: surface, PUBLIC_INTAKE_ORIGIN: origins[surface] },
          d1Databases: db, r2Buckets: r2, serviceBindings: { ASSETS: assetServices[surface], ...(surface === 'customer' ? { CUSTOMER_MAIL: mailService } : {}) } })),
      ] });
    const database = await mf.getD1Database('DB', 'admin');
    await database.prepare('CREATE TABLE IF NOT EXISTS local_site_migrations (name TEXT PRIMARY KEY)').run();
    for (const name of ['0001_trials.sql', '0002_billing.sql', '0003_customer_portal.sql']) {
      if (await database.prepare('SELECT name FROM local_site_migrations WHERE name = ?').bind(name).first()) continue;
      const sql = await readFile(join(repository, 'apps/public-intake/cloudflare/migrations', name), 'utf8');
      await database.batch([...sql.split(';').map(v => v.trim()).filter(Boolean).map(v => database.prepare(v)),
        database.prepare('INSERT INTO local_site_migrations (name) VALUES (?)').bind(name)]);
    }
    const bucket = await mf.getR2Bucket('ARTIFACTS', 'admin');
    await bucket.put('releases/local/server.tar', archive, { customMetadata: { sha256 } });
    await bucket.put(control.TRIAL_CATALOGUE_KEY, catalogueSource);
    const workers = {};
    for (const surface of ['public', 'admin', 'customer']) workers[surface] = await mf.getWorker(surface);
    const request = (surface, path, init) => workers[surface].fetch(new URL(path, origins[surface]), init);
    async function listen() {
      for (const surface of ['public', 'admin', 'customer']) {
        const expected = new URL(origins[surface]);
        if (expected.protocol !== 'http:') throw Error('The local listener requires loopback HTTP.');
        const server = createServer(async (req, res) => {
          try {
            if (req.headers.host !== expected.host) { res.writeHead(403); res.end(); return; }
            if (!req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
            const headers = new Headers(req.headers);
            headers.delete('host'); headers.set('cf-connecting-ip', req.socket.remoteAddress ?? '127.0.0.1');
            const response = await workers[surface].fetch(new URL(req.url, expected).href, { method: req.method, headers: Object.fromEntries(headers),
              ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(response.body), res); else res.end();
          } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
        });
        servers.push(server);
        await new Promise((done, reject) => { server.once('error', reject); server.listen(Number(expected.port), '127.0.0.1', done); });
      }
    }
    return { origins, directory, request, listen, close, operatorToken, database, sites };
  } catch (error) { await close(); throw error; }
}

export async function runLocalSites(args = process.argv.slice(2)) {
  let local;
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--work', '--port', '--admin-port', '--customer-port'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw Error('Use [--work PRIVATE-DIRECTORY] [--port 12951] [--admin-port 12952] [--customer-port 12953].');
      options[args[i]] = args[i + 1];
    }
    const origins = { ...defaultOrigins };
    for (const [flag, surface] of [['--port', 'public'], ['--admin-port', 'admin'], ['--customer-port', 'customer']]) if (options[flag]) {
      const port = Number(options[flag]); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port.');
      const url = new URL(origins[surface]); url.port = String(port); origins[surface] = url.origin;
    }
    local = await createLocalSites({ directory: options['--work'], origins }); await local.listen();
    console.log(`Public website: ${origins.public}/get-started\n127Vaults Admin: ${origins.admin}/\nCustomer portal: ${origins.customer}/\nOperator key file: ${join(local.directory, 'operator-token')}\nLocal sign-in email preview: pnpm sites:mail --work "${local.directory}"\nLocal sample data/packages only. Dodo and outbound email are disabled. Ctrl+C stops all three sites and preserves their local data.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { local.close().then(() => process.exit(0), () => process.exit(1)); });
    return local;
  } catch (error) { await local?.close(); console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runLocalSites();
