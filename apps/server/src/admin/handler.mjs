import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './credentials.mjs';
import { directoryInput, DirectoryInputError, readDirectory } from './directory.mjs';

const assets = new Map([
  ['/admin', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/app.js', ['../../admin/app.js', 'text/javascript; charset=utf-8']],
  ['/admin/style.css', ['../../admin/style.css', 'text/css; charset=utf-8']],
  ['/admin/directory.js', ['../../admin/directory.js', 'text/javascript; charset=utf-8']],
  ['/admin/api.js', ['../../admin/api.js', 'text/javascript; charset=utf-8']],
]);
const cookieName = '__Host-127v-admin';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
export function createAdminHandler({ pool, operators, origin, localOnly = true, schemaVersion, backupStatus = () => ({ state: 'unknown', detail: 'No backup status integration is configured.' }), now = () => Date.now() }) {
  const sessions = new Map();
  const attempts = new Map();
  const byName = new Map(operators.map(operator => [operator.username, operator]));
  function session(req) {
    const matches = String(req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const item = sessions.get(digest(token));
    if (!item) return null;
    if (item.expires <= now()) { sessions.delete(digest(token)); return null; }
    return item;
  }
  return async function handle(req, res) {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (!path.startsWith('/admin') && !path.startsWith('/api/admin/')) return false;
    if (!localOnly) { json(res, 403, { error: 'local_only' }); return true; }
    if (assets.has(path)) {
      if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'method_not_allowed' }); return true; }
      try {
        const [location, type] = assets.get(path);
        const bytes = await readFile(fileURLToPath(new URL(location, import.meta.url)));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { json(res, 503, { error: 'admin_assets_unavailable' }); }
      return true;
    }
    if (operators.length === 0) { json(res, 503, { error: 'admin_not_configured' }); return true; }
    if (path === '/api/admin/session' && req.method === 'POST') {
      if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json') { json(res, 403, { error: 'forbidden' }); return true; }
      const source = req.socket.remoteAddress;
      const record = attempts.get(source) ?? { count: 0, until: 0 };
      if (record.until > now()) { json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(Math.ceil((record.until - now()) / 1000)) }); return true; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2048) { json(res, 413, { error: 'too_large' }); return true; } }
      let input;
      try { input = JSON.parse(body); } catch { json(res, 400, { error: 'invalid_request' }); return true; }
      const operator = byName.get(input?.username);
      if (!verifyPassword(operator, input?.password)) {
        record.count += 1;
        record.until = now() + Math.min(60_000, record.count * 5_000);
        attempts.set(source, record);
        json(res, 401, { error: 'invalid_credentials' }, { 'Retry-After': String(Math.ceil((record.until - now()) / 1000)) }); return true;
      }
      attempts.delete(source);
      for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
      const token = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      sessions.set(digest(token), { username: operator.username, role: operator.role, csrf, expires: now() + 30 * 60_000 });
      json(res, 200, { username: operator.username, role: operator.role, csrf, expiresAt: new Date(now() + 30 * 60_000).toISOString() }, { 'Set-Cookie': `${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800` });
      return true;
    }
    const active = session(req);
    if (!active) { json(res, 401, { error: 'admin_auth_required' }); return true; }
    if (path === '/api/admin/session' && req.method === 'GET') { json(res, 200, { username: active.username, role: active.role, csrf: active.csrf, expiresAt: new Date(active.expires).toISOString() }); return true; }
    if (path === '/api/admin/session' && req.method === 'DELETE') {
      const a = Buffer.from(String(req.headers['x-127v-admin-csrf'] ?? ''));
      const b = Buffer.from(active.csrf);
      if (req.headers.origin !== origin || a.length !== b.length || !timingSafeEqual(a, b)) { json(res, 403, { error: 'forbidden' }); return true; }
      const token = String(req.headers.cookie).split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`)).slice(cookieName.length + 1);
      sessions.delete(digest(token));
      json(res, 200, { signedOut: true }, { 'Set-Cookie': `${cookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); return true;
    }
    if (req.method !== 'GET') { json(res, 405, { error: 'read_only' }); return true; }
    try {
      if (path === '/api/admin/overview') {
        const version = await pool.query('SELECT version FROM vaults.schema_version WHERE singleton=true');
        const counts = await pool.query("SELECT count(*)::int AS users, count(*) FILTER (WHERE enrollment_state='active')::int AS active_users FROM vaults.accounts");
        const devices = await pool.query(`SELECT count(*)::int AS devices,
          count(*) FILTER (WHERE credential_state='rotation_required')::int AS rotation_required,
          count(*) FILTER (WHERE credential_state='stale')::int AS stale,
          count(*) FILTER (WHERE protection_class='unknown')::int AS unknown_protection
          FROM vaults.devices WHERE lifecycle_status='active'`);
        const invitations = await pool.query(`SELECT count(*) FILTER (WHERE r.expires_at>now())::int AS pending_invitations,
          count(*) FILTER (WHERE r.expires_at<=now())::int AS expired_invitations
          FROM vaults.invitation_records r JOIN vaults.invitation_emails e ON e.tenant_id=r.tenant_id AND e.id=r.id
          WHERE r.revoked_at IS NULL AND e.redeemed_at IS NULL`);
        const deviceCounts = devices.rows[0];
        json(res, 200, { status: 'online', checkedAt: new Date(now()).toISOString(), schemaVersion: Number(version.rows[0]?.version), expectedSchemaVersion: schemaVersion, users: counts.rows[0], activeDevices: deviceCounts?.devices ?? 0,
          devices: { rotationRequired: deviceCounts?.rotation_required ?? 0, stale: deviceCounts?.stale ?? 0, unknownProtection: deviceCounts?.unknown_protection ?? 0 },
          invitations: { pending: invitations.rows[0]?.pending_invitations ?? 0, expired: invitations.rows[0]?.expired_invitations ?? 0 }, backup: backupStatus() }); return true;
      }
      if (['/api/admin/users', '/api/admin/devices', '/api/admin/invitations'].includes(path)) {
        const kind = path.split('/').at(-1);
        json(res, 200, await readDirectory(pool, kind, directoryInput(url.searchParams, kind))); return true;
      }
      json(res, 404, { error: 'not_found' });
    } catch (error) { json(res, error instanceof DirectoryInputError ? 400 : 503, { error: error instanceof DirectoryInputError ? 'invalid_directory_query' : 'admin_data_unavailable' }); }
    return true;
  };
}
