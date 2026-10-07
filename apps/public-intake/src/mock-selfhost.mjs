// Explicitly disposable checkout simulator. No payment or verified customer identity is created.
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { issueSelfHostedLicense } from '../../../scripts/ops/issue-self-hosted-license.mjs';
import { issueLicenseRevocation } from '../../../scripts/ops/issue-license-revocation.mjs';
import { createDurableLimit } from './durable-limit.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const basePath = id => `/api/selfhost/mock/orders/${id}`;
const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const bad = (res, status = 400) => json(res, status, { error: status === 401 ? 'access_required' : status === 404 ? 'not_found' : 'invalid_request' });

async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 2048) throw Error('too_large');
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid_request');
  return parsed;
}

export function seal(record, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  return JSON.stringify({ version: 1, nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') });
}
export function unseal(source, key) {
  const value = JSON.parse(source);
  if (value.version !== 1) throw Error('invalid_record');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

export async function pruneMockOrders({ dataDir, key, now = new Date() }) {
  let removed = 0;
  for (const name of await readdir(dataDir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
    const path = join(dataDir, name);
    const record = unseal(await readFile(path, 'utf8'), key);
    const licenseExpiry = record.license
      ? JSON.parse(Buffer.from(JSON.parse(record.license).payload, 'base64url').toString('utf8')).expiresAt : null;
    const until = licenseExpiry ? Date.parse(licenseExpiry) + 90 * 86400000
      : Date.parse(record.createdAt) + 30 * 86400000;
    if (Number.isFinite(until) && now.getTime() >= until) { await unlink(path); removed++; }
  }
  return removed;
}

export function createMockSelfHostHandler({ origin, key, dataDir, bundleFile, issuerPrivateKey,
  issuerKeyId = 'mock', mailer, now = () => new Date() }) {
  if (!origin?.startsWith('https://') || key?.length !== 32 || !dataDir || !bundleFile || !issuerPrivateKey
    || typeof mailer?.sendCode !== 'function') {
    throw Error('Mock self-host configuration is incomplete.');
  }
  const issuerPublicKey = createPublicKey(createPrivateKey(issuerPrivateKey)).export({ type: 'spki', format: 'pem' });
  const pending = new Map();
  const allow = createDurableLimit({ directory: join(dataDir, 'request-limits'), now: () => now().getTime() });
  const pathFor = id => join(dataDir, `${id}.json`);
  async function read(id) { return unseal(await readFile(pathFor(id), 'utf8'), key); }
  async function save(id, record, create = false) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    if (create) { await writeFile(pathFor(id), seal(record, key), { flag: 'wx', mode: 0o600 }); return; }
    const temporary = join(dataDir, `${id}.${randomUUID()}.tmp`);
    await writeFile(temporary, seal(record, key), { flag: 'wx', mode: 0o600 });
    await rename(temporary, pathFor(id));
  }
  async function serialized(id, work) {
    const previous = pending.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    pending.set(id, next);
    try { return await next; } finally { if (pending.get(id) === next) pending.delete(id); }
  }
  const handle = async (req, res) => {
    const path = new URL(req.url, origin).pathname;
    if (path === '/api/selfhost/mock') {
      if (req.method !== 'GET') return bad(res);
      const file = await stat(bundleFile).catch(() => null);
      return json(res, 200, { open: Boolean(file?.isFile()), payment: 'simulation', release: 'supervised-test' });
    }
    if (!path.startsWith('/api/selfhost/mock/')) return false;
    if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json')) return bad(res, 403);
    if (path === '/api/selfhost/mock/orders' && req.method === 'POST') {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      if (Object.keys(input).sort().join(',') !== 'consent,email,organization,plan,website'
        || !['personal', 'commercial'].includes(input.plan) || input.consent !== true
        || typeof input.email !== 'string' || !email.test(input.email.trim())
        || typeof input.organization !== 'string' || input.organization.length > 120
        || input.website !== '') return bad(res);
      if (!await allow('mock-order-email', input.email.trim().toLowerCase(), 3, 3600000)
        || !await allow('mock-order-address', req.socket.remoteAddress ?? 'unknown', 30, 3600000)) {
        return json(res, 429, { error: 'rate_limited' });
      }
      const id = randomUUID();
      const accessToken = randomBytes(32).toString('base64url');
      const verificationCode = String(randomInt(1000000)).padStart(6, '0');
      const record = { id, email: input.email.trim().toLowerCase(), organization: input.organization.trim(),
        plan: input.plan, tokenHash: sha(accessToken), state: 'pending_email_verification', createdAt: now().toISOString(),
        verificationHash: sha(`${accessToken}:${verificationCode}`), verificationExpiresAt: now().getTime() + 600000,
        verificationAttempts: 0, commitmentYears: null, requestedUsers: null,
        installationId: null, license: null };
      try {
        await save(id, record, true);
        await mailer.sendCode({ to: record.email, code: verificationCode, expiresMinutes: 10 });
      } catch {
        await unlink(pathFor(id)).catch(() => {});
        return json(res, 503, { error: 'email_unavailable' });
      }
      return json(res, 201, { orderId: id, accessToken, state: record.state });
    }
    const match = /^\/api\/selfhost\/mock\/orders\/([^/]+)(?:\/(verify|pay|bundle|bundle-ticket|license|public-keys|recover|recover-complete|renew|replace|revocation|erase))?$/.exec(path);
    if (!match || !uuid.test(match[1])) return bad(res, 404);
    const [, id, action] = match;
    if ((action === 'recover' || action === 'recover-complete') && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      let latest;
      try { latest = await read(id); } catch { return bad(res, 404); }
      if (action === 'recover') {
        if (Object.keys(input).join(',') !== 'email' || typeof input.email !== 'string' || !email.test(input.email.trim())) return bad(res);
        if (input.email.trim().toLowerCase() !== latest.email) return json(res, 202, { sent: true });
        const at = now().getTime();
        if (at - (latest.recoveryWindowAt ?? 0) >= 3600000) { latest.recoveryWindowAt = at; latest.recoveryCount = 0; }
        if (latest.recoveryCount >= 3 || !await allow('mock-recovery-address', req.socket.remoteAddress ?? 'unknown', 12, 3600000)) {
          return json(res, 429, { error: 'rate_limited' });
        }
        latest.recoveryCount++;
        const recoveryCode = String(randomInt(1000000)).padStart(6, '0');
        latest.recoveryHash = sha(`${id}:${recoveryCode}:${key.toString('base64url')}`);
        latest.recoveryExpiresAt = at + 600000;
        latest.recoveryAttempts = 0;
        await save(id, latest);
        await mailer.sendCode({ to: latest.email, code: recoveryCode, expiresMinutes: 10 });
        return json(res, 202, { sent: true });
      }
      if (Object.keys(input).sort().join(',') !== 'code,email' || typeof input.email !== 'string'
        || !/^\d{6}$/.test(input.code) || input.email.trim().toLowerCase() !== latest.email) return bad(res);
      if (!latest.recoveryHash || now().getTime() >= latest.recoveryExpiresAt || latest.recoveryAttempts >= 5) return bad(res, 403);
      latest.recoveryAttempts++;
      const actual = Buffer.from(sha(`${id}:${input.code}:${key.toString('base64url')}`), 'hex');
      const expected = Buffer.from(latest.recoveryHash, 'hex');
      if (!timingSafeEqual(actual, expected)) { await save(id, latest); return bad(res, 403); }
      const accessToken = randomBytes(32).toString('base64url');
      latest.tokenHash = sha(accessToken);
      delete latest.recoveryHash;
      delete latest.recoveryExpiresAt;
      delete latest.recoveryAttempts;
      await save(id, latest);
      return json(res, 200, { accessToken });
    });
    let record;
    try { record = await read(id); } catch { return bad(res, 404); }
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const ticket = String(req.headers.cookie ?? '').split(';').map(part => part.trim())
      .find(part => part.startsWith('__Secure-127v-mock-bundle='))?.split('=')[1];
    const [expiry, tag] = String(ticket ?? '').split('.');
    const expectedTag = /^\d{13}$/.test(expiry ?? '')
      ? createHmac('sha256', key).update(`${id}:${record.tokenHash}:${expiry}`).digest('base64url') : '';
    const ticketValid = action === 'bundle' && req.method === 'GET' && Number(expiry) > now().getTime()
      && /^[A-Za-z0-9_-]{43}$/.test(tag ?? '') && timingSafeEqual(Buffer.from(tag), Buffer.from(expectedTag));
    if (!ticketValid && (!token || sha(token) !== record.tokenHash)) return bad(res, 401);
    if (action === 'erase' && req.method === 'POST') return serialized(id, async () => {
      const latest = await read(id);
      if (latest.state === 'pending_email_verification') return bad(res, 403);
      await unlink(pathFor(id));
      return json(res, 200, { erased: true, installedLicenseUnaffected: Boolean(latest.license) });
    });
    if (!action && req.method === 'GET') return json(res, 200, { orderId: id, plan: record.plan,
      email: record.email, state: record.state, installationId: record.installationId,
      commitmentYears: record.commitmentYears, requestedUsers: record.requestedUsers,
      hasRevocation: Boolean(record.revocation) });
    if (action === 'verify' && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      if (Object.keys(input).join(',') !== 'code' || !/^\d{6}$/.test(input.code)) return bad(res);
      const latest = await read(id);
      if (latest.state !== 'pending_email_verification') return bad(res, 409);
      if (latest.verificationAttempts >= 5 || now().getTime() >= latest.verificationExpiresAt) return bad(res, 403);
      latest.verificationAttempts++;
      const actual = Buffer.from(sha(`${token}:${input.code}`), 'hex');
      const expected = Buffer.from(latest.verificationHash, 'hex');
      if (timingSafeEqual(actual, expected)) {
        latest.state = 'pending_mock_payment';
        delete latest.verificationHash;
        delete latest.verificationExpiresAt;
      }
      await save(id, latest);
      return json(res, actual.equals(expected) ? 200 : 403, { verified: actual.equals(expected) });
    });
    if (action === 'pay' && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      const latest = await read(id);
      if (latest.state === 'pending_email_verification') return bad(res, 403);
      if (latest.state === 'pending_mock_payment') {
        if (Object.keys(input).sort().join(',') !== 'commitmentYears,requestedUsers,termsAcknowledged'
          || input.termsAcknowledged !== true
          || (latest.plan === 'personal' && input.commitmentYears !== 1)
          || (latest.plan === 'commercial' && ![5, 10].includes(input.commitmentYears))
          || !Number.isSafeInteger(input.requestedUsers)
          || input.requestedUsers < 1 || input.requestedUsers > 1000
          || (latest.plan === 'personal' && input.requestedUsers !== 5)) return bad(res);
        latest.commitmentYears = input.commitmentYears;
        latest.requestedUsers = input.requestedUsers;
        latest.state = 'mock_paid';
        await save(id, latest);
      }
      json(res, 200, { state: latest.state, simulated: true });
    });
    if (record.state === 'pending_email_verification' || record.state === 'pending_mock_payment') return bad(res, 403);
    if (action === 'bundle-ticket' && req.method === 'POST') {
      const until = String(now().getTime() + 60000);
      const signature = createHmac('sha256', key).update(`${id}:${record.tokenHash}:${until}`).digest('base64url');
      res.writeHead(204, { 'Set-Cookie': `__Secure-127v-mock-bundle=${until}.${signature}; Secure; HttpOnly; SameSite=Strict; Path=${basePath(id)}/bundle; Max-Age=60`,
        'Cache-Control': 'no-store' });
      return res.end();
    }
    if (action === 'bundle' && req.method === 'GET') {
      try {
        const file = await stat(bundleFile);
        if (!file.isFile()) throw Error('not_file');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size,
          'Content-Disposition': 'attachment; filename="127vaults-supervised-test-bundle.tar"', 'Cache-Control': 'no-store' });
        createReadStream(bundleFile).on('error', () => res.destroy()).pipe(res);
      } catch { json(res, 503, { error: 'bundle_unavailable' }); }
      return;
    }
    if (action === 'license' && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      if (Object.keys(input).join(',') !== 'installationId' || !uuid.test(input.installationId)) return bad(res);
      const latest = await read(id);
      if (latest.installationId && latest.installationId !== input.installationId) return bad(res, 409);
      if (!latest.license) {
        const at = now();
        const expires = new Date(at.getTime());
        expires.setUTCFullYear(expires.getUTCFullYear() + 1);
        latest.license = issueSelfHostedLicense({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
          installationId: input.installationId, plan: latest.plan, majorVersion: latest.plan === 'personal' ? 1 : null,
          maxActiveUsers: latest.requestedUsers, sequence: 1, expiresAt: expires.toISOString(), now: at }).license;
        latest.installationId = input.installationId;
        latest.state = 'license_issued';
        await save(id, latest);
      }
      json(res, 200, { license: JSON.parse(latest.license), installationId: latest.installationId });
    });
    if (action === 'license' && req.method === 'GET') {
      if (!record.license) return bad(res, 404);
      return json(res, 200, { license: JSON.parse(record.license), installationId: record.installationId });
    }
    if (action === 'renew' && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      if (Object.keys(input).sort().join(',') !== 'requestId,simulatedCheckoutAcknowledged'
        || !uuid.test(input.requestId) || input.simulatedCheckoutAcknowledged !== true) return bad(res);
      const latest = await read(id);
      if (!latest.license || !latest.installationId) return bad(res, 409);
      if (latest.lastRenewalRequestId === input.requestId) {
        return json(res, 200, { license: JSON.parse(latest.license), installationId: latest.installationId, simulated: true });
      }
      const previous = JSON.parse(Buffer.from(JSON.parse(latest.license).payload, 'base64url').toString('utf8'));
      const at = now();
      const expires = new Date(Math.max(at.getTime(), Date.parse(previous.expiresAt)));
      expires.setUTCFullYear(expires.getUTCFullYear() + 1);
      latest.license = issueSelfHostedLicense({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
        installationId: latest.installationId, plan: latest.plan, majorVersion: latest.plan === 'personal' ? 1 : null,
        maxActiveUsers: latest.requestedUsers, sequence: previous.sequence + 1,
        expiresAt: expires.toISOString(), now: at }).license;
      latest.lastRenewalRequestId = input.requestId;
      latest.renewedAt = at.toISOString();
      await save(id, latest);
      return json(res, 200, { license: JSON.parse(latest.license), installationId: latest.installationId, simulated: true });
    });
    if (action === 'replace' && req.method === 'POST') return serialized(id, async () => {
      let input;
      try { input = await body(req); } catch { return bad(res); }
      if (Object.keys(input).sort().join(',') !== 'installationId,requestId,simulatedReplacementAcknowledged'
        || !uuid.test(input.installationId) || !uuid.test(input.requestId)
        || input.simulatedReplacementAcknowledged !== true) return bad(res);
      const latest = await read(id);
      if (!latest.license || !latest.installationId) return bad(res, 409);
      if (latest.lastReplacementRequestId === input.requestId) {
        return json(res, 200, { license: JSON.parse(latest.license), installationId: latest.installationId,
          previousInstallationId: latest.previousInstallationId, simulated: true });
      }
      if (latest.installationId === input.installationId) return bad(res, 409);
      const previous = JSON.parse(Buffer.from(JSON.parse(latest.license).payload, 'base64url').toString('utf8'));
      const at = now();
      latest.revocation = issueLicenseRevocation({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
        installationId: latest.installationId, licenseId: previous.licenseId, revokedAt: 'now', now: at });
      latest.previousInstallationId = latest.installationId;
      latest.installationId = input.installationId;
      latest.license = issueSelfHostedLicense({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
        installationId: input.installationId, plan: latest.plan, majorVersion: latest.plan === 'personal' ? 1 : null,
        maxActiveUsers: latest.requestedUsers, sequence: 1, expiresAt: previous.expiresAt, now: at }).license;
      latest.lastReplacementRequestId = input.requestId;
      await save(id, latest);
      return json(res, 200, { license: JSON.parse(latest.license), installationId: latest.installationId,
        previousInstallationId: latest.previousInstallationId, simulated: true });
    });
    if (action === 'revocation' && req.method === 'GET') {
      if (!record.revocation) return bad(res, 404);
      return json(res, 200, { revocation: JSON.parse(record.revocation), installationId: record.previousInstallationId });
    }
    if (action === 'public-keys' && req.method === 'GET') return json(res, 200, { [issuerKeyId]: issuerPublicKey });
    bad(res, 404);
  };
  return async (req, res) => {
    try { return await handle(req, res); }
    catch {
      if (!res.headersSent) json(res, 503, { error: 'unavailable' });
      else res.destroy();
    }
  };
}
