import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './credentials.mjs';

const assets = new Map([
  ['/admin', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/app.js', ['../../admin/app.js', 'text/javascript; charset=utf-8']],
  ['/admin/style.css', ['../../admin/style.css', 'text/css; charset=utf-8']],
]);
const cookieName = '__Host-127v-admin';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
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
    if (!item || item.expires <= now()) return null;
    return item;
  }
  return async function handle(req, res) {
    const path = new URL(req.url, origin).pathname;
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
      if (record.until > now()) { json(res, 429, { error: 'rate_limited' }); return true; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2048) { json(res, 413, { error: 'too_large' }); return true; } }
      let input;
      try { input = JSON.parse(body); } catch { json(res, 400, { error: 'invalid_request' }); return true; }
      const operator = byName.get(input?.username);
      if (!verifyPassword(operator, input?.password)) {
        record.count += 1;
        record.until = now() + Math.min(60_000, record.count * 5_000);
        attempts.set(source, record);
        json(res, 401, { error: 'invalid_credentials' }); return true;
      }
      attempts.delete(source);
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
        const devices = await pool.query("SELECT count(*)::int AS devices FROM vaults.devices WHERE lifecycle_status='active'");
        json(res, 200, { status: 'online', checkedAt: new Date(now()).toISOString(), schemaVersion: Number(version.rows[0]?.version), expectedSchemaVersion: schemaVersion, users: counts.rows[0], activeDevices: devices.rows[0]?.devices ?? 0, backup: backupStatus() }); return true;
      }
      if (path === '/api/admin/users') {
        const rows = await pool.query(`SELECT a.id,a.username,a.display_name,a.email,a.server_role,a.enrollment_state,a.email_verified,a.created_at,
          count(d.id)::int AS device_count FROM vaults.accounts a LEFT JOIN vaults.devices d ON d.tenant_id=a.tenant_id AND d.account_id=a.id AND d.lifecycle_status='active'
          GROUP BY a.tenant_id,a.id ORDER BY a.created_at DESC,a.id LIMIT 100`);
        json(res, 200, { users: rows.rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, role: r.server_role, status: r.enrollment_state, emailVerified: r.email_verified, createdAt: r.created_at, deviceCount: r.device_count })), limited: rows.rowCount === 100 }); return true;
      }
      if (path === '/api/admin/devices') {
        const rows = await pool.query(`SELECT d.id,d.account_id,a.username,d.lifecycle_status,d.protection_class,d.credential_state,d.created_at,d.revoked_at
          FROM vaults.devices d JOIN vaults.accounts a ON a.tenant_id=d.tenant_id AND a.id=d.account_id ORDER BY d.created_at DESC,d.id LIMIT 100`);
        json(res, 200, { devices: rows.rows.map(r => ({ id: r.id, accountId: r.account_id, username: r.username, status: r.lifecycle_status, protection: r.protection_class, credentialState: r.credential_state, createdAt: r.created_at, revokedAt: r.revoked_at })), limited: rows.rowCount === 100 }); return true;
      }
      json(res, 404, { error: 'not_found' });
    } catch { json(res, 503, { error: 'admin_data_unavailable' }); }
    return true;
  };
}
