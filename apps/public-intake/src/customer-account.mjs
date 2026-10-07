// Experimental public customer identity. It never stores a vault credential.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDurableLimit, withFileLock } from './durable-limit.mjs';
import { seal, unseal } from './mock-selfhost.mjs';

const emailPattern = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const reply = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
};
async function input(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 2048) throw Error('too_large');
  }
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error('invalid_body');
  return parsed;
}

export function createCustomerAccountHandler({ origin, key, dataDir, orderDir, orderKey, mailer, now = () => new Date() }) {
  if (!origin?.startsWith('https://') || key?.length !== 32 || orderKey?.length !== 32
    || !dataDir || !orderDir || typeof mailer?.sendCode !== 'function') throw Error('Customer account configuration is incomplete.');
  const allow = createDurableLimit({ directory: join(dataDir, 'request-limits'), now: () => now().getTime() });
  const pathFor = email => join(dataDir, `${hash(email)}.json`);
  const queues = new Map();
  async function serialized(email, work) {
    const prior = queues.get(email) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    queues.set(email, next);
    try { return await next; } finally { if (queues.get(email) === next) queues.delete(email); }
  }
  async function read(email) {
    const source = await readFile(pathFor(email), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    return source ? unseal(source, key) : null;
  }
  async function save(email, record) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporary = join(dataDir, `${hash(email)}.${randomUUID()}.tmp`);
    await writeFile(temporary, seal(record, key), { flag: 'wx', mode: 0o600 });
    await rename(temporary, pathFor(email));
  }
  async function ordersFor(email, erase = false) {
    const orders = [];
    for (const name of await readdir(orderDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const path = join(orderDir, name);
      const order = unseal(await readFile(path, 'utf8'), orderKey);
      if (order.email !== email) continue;
      if (erase) await withFileLock(join(orderDir, `${order.id}.lock`), () => unlink(path));
      orders.push({ orderId: order.id, plan: order.plan, state: order.state,
        installationId: order.installationId, createdAt: order.createdAt });
    }
    return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return async (req, res) => {
    try {
      const path = new URL(req.url, origin).pathname;
      if (!path.startsWith('/api/customer/')) return false;
      if (req.method !== 'GET' && (req.headers.origin !== origin
        || req.headers['content-type']?.split(';')[0] !== 'application/json')) {
        return reply(res, 403, { error: 'forbidden' });
      }
      if (path === '/api/customer/start' && req.method === 'POST') {
        const body = await input(req);
        const email = String(body.email ?? '').trim().toLowerCase();
        if (Object.keys(body).sort().join(',') !== 'consent,email' || !emailPattern.test(email)
          || body.consent !== true) return reply(res, 400, { error: 'invalid_request' });
        if (!await allow('customer-email', email, 3, 3600000)
          || !await allow('customer-address', req.socket.remoteAddress ?? 'unknown', 20, 3600000)) {
          return reply(res, 429, { error: 'rate_limited' });
        }
        return serialized(email, async () => {
          const code = String(randomInt(1000000)).padStart(6, '0');
          const record = await read(email) ?? { email, createdAt: now().toISOString(), consentVersion: 'test-v1' };
          record.codeHash = hash(`${email}:${code}:${key.toString('base64url')}`);
          record.codeExpiresAt = now().getTime() + 600000;
          record.codeAttempts = 0;
          await save(email, record);
          await mailer.sendCode({ to: email, code, expiresMinutes: 10 });
          return reply(res, 202, { sent: true });
        });
      }
      if (path === '/api/customer/complete' && req.method === 'POST') {
        const body = await input(req);
        const email = String(body.email ?? '').trim().toLowerCase();
        if (Object.keys(body).sort().join(',') !== 'code,email' || !emailPattern.test(email)
          || !/^\d{6}$/.test(body.code)) return reply(res, 400, { error: 'invalid_request' });
        return serialized(email, async () => {
          const record = await read(email);
          if (!record?.codeHash || now().getTime() >= record.codeExpiresAt || record.codeAttempts >= 5) {
            return reply(res, 403, { error: 'invalid_code' });
          }
          record.codeAttempts++;
          const actual = Buffer.from(hash(`${email}:${body.code}:${key.toString('base64url')}`), 'hex');
          const expected = Buffer.from(record.codeHash, 'hex');
          if (!timingSafeEqual(actual, expected)) {
            await save(email, record);
            return reply(res, 403, { error: 'invalid_code' });
          }
          const token = randomBytes(32).toString('base64url');
          record.sessionHash = hash(token);
          record.sessionExpiresAt = now().getTime() + 12 * 3600000;
          record.verifiedAt = now().toISOString();
          delete record.codeHash;
          delete record.codeExpiresAt;
          delete record.codeAttempts;
          await save(email, record);
          return reply(res, 200, { email }, { 'Set-Cookie': `__Host-127v-customer=${email}.${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
        });
      }
      const cookie = String(req.headers.cookie ?? '').split(';').map(part => part.trim())
        .find(part => part.startsWith('__Host-127v-customer='))?.slice('__Host-127v-customer='.length);
      const separator = cookie?.lastIndexOf('.') ?? -1;
      const email = cookie?.slice(0, separator);
      const token = cookie?.slice(separator + 1);
      if (!emailPattern.test(email ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) {
        return reply(res, 401, { error: 'access_required' });
      }
      const record = await read(email);
      if (!record?.sessionHash || now().getTime() >= record.sessionExpiresAt
        || !timingSafeEqual(Buffer.from(record.sessionHash, 'hex'), Buffer.from(hash(token), 'hex'))) {
        return reply(res, 401, { error: 'access_required' });
      }
      if (path === '/api/customer/me' && req.method === 'GET') {
        return reply(res, 200, { email, createdAt: record.createdAt, verifiedAt: record.verifiedAt,
          orders: await ordersFor(email) });
      }
      if (path === '/api/customer/open-order' && req.method === 'POST') {
        const body = await input(req);
        if (Object.keys(body).join(',') !== 'orderId' || !/^[0-9a-f-]{36}$/i.test(body.orderId)) {
          return reply(res, 400, { error: 'invalid_request' });
        }
        return withFileLock(join(orderDir, `${body.orderId}.lock`), async () => {
          const orderPath = join(orderDir, `${body.orderId}.json`);
          const order = unseal(await readFile(orderPath, 'utf8'), orderKey);
          if (order.email !== email || order.id !== body.orderId) return reply(res, 404, { error: 'not_found' });
          const accessToken = randomBytes(32).toString('base64url');
          order.tokenHash = hash(accessToken);
          const temporary = join(orderDir, `${body.orderId}.${randomUUID()}.tmp`);
          await writeFile(temporary, seal(order, orderKey), { flag: 'wx', mode: 0o600 });
          await rename(temporary, orderPath);
          return reply(res, 200, { orderId: body.orderId, accessToken });
        });
      }
      if (path === '/api/customer/logout' && req.method === 'POST') return serialized(email, async () => {
        const latest = await read(email);
        delete latest.sessionHash;
        delete latest.sessionExpiresAt;
        await save(email, latest);
        return reply(res, 200, { signedOut: true }, { 'Set-Cookie': '__Host-127v-customer=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      });
      if (path === '/api/customer/erase' && req.method === 'POST') return serialized(email, async () => {
        const body = await input(req);
        if (Object.keys(body).join(',') !== 'confirm' || body.confirm !== 'ERASE') {
          return reply(res, 400, { error: 'invalid_request' });
        }
        const orders = await ordersFor(email, true);
        await unlink(pathFor(email));
        return reply(res, 200, { erased: true, installedLicensesUnaffected: true, ordersRemoved: orders.length },
          { 'Set-Cookie': '__Host-127v-customer=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      });
      return reply(res, 404, { error: 'not_found' });
    } catch {
      if (!res.headersSent) reply(res, 503, { error: 'unavailable' });
      else res.destroy();
    }
  };
}

export async function pruneCustomerAccounts({ dataDir, key, now = new Date() }) {
  let removed = 0;
  for (const name of await readdir(dataDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const path = join(dataDir, name);
    const account = unseal(await readFile(path, 'utf8'), key);
    const last = Date.parse(account.verifiedAt ?? account.createdAt);
    const retention = account.verifiedAt ? 365 * 86400000 : 86400000;
    if (Number.isFinite(last) && now.getTime() - last >= retention) { await unlink(path); removed++; }
  }
  return removed;
}
