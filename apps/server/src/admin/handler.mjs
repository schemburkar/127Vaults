import { requestSource } from '../relay-ingress.mjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './credentials.mjs';
import { directoryInput, DirectoryInputError, readDirectory } from './directory.mjs';
import { AdminManagementError } from './management.mjs';
import { parseJsonObject, readRequestBody, HttpBoundaryError } from '../http-boundary.mjs';
import { readSeatUsage } from '../license-seats.mjs';

const assets = new Map([
  ['/admin', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/', ['../../admin/index.html', 'text/html; charset=utf-8']],
  ['/admin/app.js', ['../../admin/app.js', 'text/javascript; charset=utf-8']],
  ['/admin/style.css', ['../../admin/style.css', 'text/css; charset=utf-8']],
  ['/admin/directory.js', ['../../admin/directory.js', 'text/javascript; charset=utf-8']],
  ['/admin/api.js', ['../../admin/api.js', 'text/javascript; charset=utf-8']],
  ['/admin/management.js', ['../../admin/management.js', 'text/javascript; charset=utf-8']],
]);
const cookieName = '__Host-127v-admin';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
export function createAdminHandler({ pool, operators, origin, localOnly = true, schemaVersion, management = null, loadEntitlement,
  backupStatus = () => ({ state: 'unknown', detail: 'No backup status integration is configured.' }), now = () => Date.now() }) {
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
      const source = requestSource(req);
      const record = attempts.get(source) ?? { count: 0, until: 0 };
      if (record.until > now()) { json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(Math.ceil((record.until - now()) / 1000)) }); return true; }
      let input;
      try { input = parseJsonObject(req, await readRequestBody(req, 2048)); }
      catch (error) {
        if (!req.destroyed && !res.destroyed) json(res, error instanceof HttpBoundaryError ? error.status : 400, { error: 'invalid_request' });
        return true;
      }
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
      json(res, 200, { username: operator.username, role: operator.role, csrf, expiresAt: new Date(now() + 30 * 60_000).toISOString(), managementEnabled: Boolean(management) }, { 'Set-Cookie': `${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800` });
      return true;
    }
    const active = session(req);
    if (!active) { json(res, 401, { error: 'admin_auth_required' }); return true; }
    if (path === '/api/admin/session' && req.method === 'GET') { json(res, 200, { username: active.username, role: active.role, csrf: active.csrf, expiresAt: new Date(active.expires).toISOString(), managementEnabled: Boolean(management) }); return true; }
    if (path === '/api/admin/session' && req.method === 'DELETE') {
      const a = Buffer.from(String(req.headers['x-127v-admin-csrf'] ?? ''));
      const b = Buffer.from(active.csrf);
      if (req.headers.origin !== origin || a.length !== b.length || !timingSafeEqual(a, b)) { json(res, 403, { error: 'forbidden' }); return true; }
      const token = String(req.headers.cookie).split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`)).slice(cookieName.length + 1);
      sessions.delete(digest(token));
      json(res, 200, { signedOut: true }, { 'Set-Cookie': `${cookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); return true;
    }
    if (path === '/api/admin/actions' && req.method === 'POST' && management) {
      const operator = byName.get(active.username);
      let value;
      try {
        const a = Buffer.from(String(req.headers['x-127v-admin-csrf'] ?? '')), b = Buffer.from(active.csrf);
        if (req.headers.origin !== origin || a.length !== b.length || !timingSafeEqual(a, b)) throw new AdminManagementError('forbidden', 403);
        value = parseJsonObject(req, await readRequestBody(req, 8192));
        const source = requestSource(req), record = attempts.get(source) ?? { count: 0, until: 0 };
        if (record.until > now()) throw new AdminManagementError('rate_limited', 429);
        if (!verifyPassword(operator, value.password)) {
          record.count++; record.until = now() + Math.min(60000, record.count * 5000); attempts.set(source, record);
          throw new AdminManagementError('fresh_auth_required', 403);
        }
        attempts.delete(source);
        const { password, ...input } = value;
        json(res, 200, await management.execute(operator, input));
      } catch (error) {
        if (!value || ['forbidden', 'fresh_auth_required', 'rate_limited'].includes(error.code)) await management.denied(operator, value?.action, value?.targetId).catch(() => {});
        const safe = error instanceof AdminManagementError || error instanceof HttpBoundaryError;
        json(res, safe ? error.status : 503, { error: safe ? error.code : 'admin_unavailable' });
      }
      return true;
    }
    if (req.method !== 'GET') { json(res, 405, { error: 'read_only' }); return true; }
    try {
      if (path === '/api/admin/overview') {
        const checkedAt = new Date(now());
        let license = null;
        if (loadEntitlement) {
          try {
            const { rows } = await pool.query('SELECT id FROM vaults.installation WHERE singleton=true');
            const installation = rows[0]?.id;
            if (installation) {
              const [status, usage] = await Promise.all([loadEntitlement(installation, checkedAt), readSeatUsage(pool, installation, checkedAt)]);
              license = { mode: status.mode, plan: status.plan, maxActiveUsers: status.maxActiveUsers, ...usage };
            }
          } catch { /* The health overview remains available when license status cannot be read. */ }
        }
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
        json(res, 200, { status: 'online', checkedAt: checkedAt.toISOString(), schemaVersion: Number(version.rows[0]?.version), expectedSchemaVersion: schemaVersion, users: counts.rows[0], activeDevices: deviceCounts?.devices ?? 0, license,
          devices: { rotationRequired: deviceCounts?.rotation_required ?? 0, stale: deviceCounts?.stale ?? 0, unknownProtection: deviceCounts?.unknown_protection ?? 0 },
          invitations: { pending: invitations.rows[0]?.pending_invitations ?? 0, expired: invitations.rows[0]?.expired_invitations ?? 0 }, backup: backupStatus() }); return true;
      }
      if (['/api/admin/users', '/api/admin/devices', '/api/admin/invitations'].includes(path)) {
        const kind = path.split('/').at(-1);
        json(res, 200, await readDirectory(pool, kind, directoryInput(url.searchParams, kind))); return true;
      }
      if (management && path === '/api/admin/audit') {
        const rows = (await pool.query('SELECT id,actor_id,action,target_id,outcome,created_at FROM vaults.admin_control_audit ORDER BY created_at DESC,id DESC LIMIT 100')).rows;
        json(res, 200, { events: rows.map(row => ({ id: row.id, actor: row.actor_id, action: row.action, targetId: row.target_id, outcome: row.outcome, createdAt: row.created_at.toISOString() })) }); return true;
      }
      if (management && path === '/api/admin/ownership') {
        if (active.role !== 'owner') { json(res, 403, { error: 'forbidden' }); return true; }
        const rows = (await pool.query(`SELECT g.id,g.recipient_id,a.username,g.expires_at FROM vaults.ownership_grants g
          JOIN vaults.accounts a ON a.tenant_id=g.tenant_id AND a.id=g.recipient_id WHERE g.cancelled_at IS NULL AND g.accepted_at IS NULL AND g.expires_at>now() ORDER BY g.created_at LIMIT 100`)).rows;
        json(res, 200, { grants: rows.map(row => ({ grantId: row.id, accountId: row.recipient_id, username: row.username, expiresAt: row.expires_at.toISOString() })) }); return true;
      }
      json(res, 404, { error: 'not_found' });
    } catch (error) { json(res, error instanceof DirectoryInputError ? 400 : 503, { error: error instanceof DirectoryInputError ? 'invalid_directory_query' : 'admin_data_unavailable' }); }
    return true;
  };
}
