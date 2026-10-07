import { createServer } from 'node:http';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSelfHostHandler, pruneMockOrders } from './mock-selfhost.mjs';
import { createDurableLimit, pruneDurableLimits } from './durable-limit.mjs';
import { createCustomerAccountHandler, pruneCustomerAccounts } from './customer-account.mjs';
import { SmtpMailer } from '../../server/src/smtp.mjs';

const plans = new Set(['personal', 'commercial', 'cloud', 'undecided']);
const emailPattern = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['consent', 'email', 'organization', 'plan', 'website', 'requestedSeats'].includes(key))
    || ['consent', 'email', 'organization', 'plan', 'website'].some(key => !Object.hasOwn(value, key))) return null;
  const email = String(value.email ?? '').trim().toLowerCase();
  const organization = String(value.organization ?? '').trim();
  if (typeof value.email !== 'string' || !emailPattern.test(email) || email.length > 254
    || typeof value.organization !== 'string' || organization.length > 120
    || typeof value.website !== 'string' || value.website.length > 200
    || !plans.has(value.plan) || value.consent !== true
    || (value.plan === 'cloud' && (!Number.isSafeInteger(value.requestedSeats) || value.requestedSeats < 1 || value.requestedSeats > 1000))
    || (value.plan !== 'cloud' && value.requestedSeats !== undefined && value.requestedSeats !== null)) return null;
  return { email, organization, plan: value.plan, requestedSeats: value.plan === 'cloud' ? value.requestedSeats : null,
    trapped: value.website !== '' };
}

export function encryptRequest(request, key, now = new Date()) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('intake key must be 32 bytes');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = Buffer.from(JSON.stringify({ email: request.email, organization: request.organization,
    plan: request.plan, requestedSeats: request.requestedSeats, receivedAt: now.toISOString() }));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({ version: 1, nonce: nonce.toString('base64url'),
    ciphertext: encrypted.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') }) + '\n';
}

export function createIntakeHandler({ origin, key, dataFile, now = () => Date.now() }) {
  if (!origin?.startsWith('https://') || !dataFile || key?.length !== 32) throw new Error('intake configuration is incomplete');
  const allow = createDurableLimit({ directory: resolve(dirname(dataFile), 'request-limits'), now });
  return async (req, res) => {
    if (req.url !== '/api/waitlist') { reply(res, 404, { error: 'not_found' }); return; }
    if (req.method === 'GET') { reply(res, 200, { open: true }); return; }
    if (req.method !== 'POST') { reply(res, 405, { error: 'method_not_allowed' }); return; }
    if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      reply(res, 403, { error: 'forbidden' }); return;
    }
    const address = req.socket.remoteAddress ?? 'unknown';
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 2048) { reply(res, 413, { error: 'too_large' }); return; }
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { reply(res, 400, { error: 'invalid_request' }); return; }
      const input = validateRequest(parsed);
      if (!input) { reply(res, 400, { error: 'invalid_request' }); return; }
      if (!await allow('waitlist-address', address, 60, 3600000)
        || !await allow('waitlist-email', input.email, 3, 3600000)) {
        reply(res, 429, { error: 'rate_limited' }); return;
      }
      if (!input.trapped) {
        const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
        const file = await open(dataFile, flags, 0o600);
        try {
          if (!(await file.stat()).isFile()) throw new Error('invalid target');
          await file.writeFile(encryptRequest(input, key));
          await file.sync();
        } finally { await file.close(); }
      }
      reply(res, 202, { received: true });
    } catch { reply(res, 503, { error: 'unavailable' }); }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const env = process.env;
  const key = Buffer.from((await readFile(env.PUBLIC_INTAKE_KEY_FILE, 'utf8')).trim(), 'hex');
  const waitlist = createIntakeHandler({ origin: env.PUBLIC_INTAKE_ORIGIN, key, dataFile: env.PUBLIC_INTAKE_DATA_FILE });
  const limitDirs = [resolve(dirname(env.PUBLIC_INTAKE_DATA_FILE), 'request-limits')];
  let mock;
  let customer;
  if (env.PUBLIC_MOCK_SELFHOST === '1') {
    const smtpPassword = (await readFile(env.PUBLIC_MOCK_SMTP_PASSWORD_FILE, 'utf8')).trim();
    const mailer = new SmtpMailer({ host: env.PUBLIC_MOCK_SMTP_HOST,
      port: Number(env.PUBLIC_MOCK_SMTP_PORT ?? 465), username: env.PUBLIC_MOCK_SMTP_USERNAME,
      password: smtpPassword, from: env.PUBLIC_MOCK_SMTP_FROM, installationLabel: '127Vaults signup' });
    const mockKey = createHash('sha256').update(key).update('mock-selfhost-v1').digest();
    mock = createMockSelfHostHandler({ origin: env.PUBLIC_INTAKE_ORIGIN,
      key: mockKey,
      dataDir: env.PUBLIC_MOCK_SELFHOST_DATA_DIR, bundleFile: env.PUBLIC_MOCK_SELFHOST_BUNDLE_FILE,
      issuerPrivateKey: await readFile(env.PUBLIC_MOCK_SELFHOST_ISSUER_KEY_FILE, 'utf8'), mailer });
    const customerDir = env.PUBLIC_CUSTOMER_DATA_DIR ?? join(env.PUBLIC_MOCK_SELFHOST_DATA_DIR, 'customers');
    const customerKey = createHash('sha256').update(key).update('customer-account-v1').digest();
    customer = createCustomerAccountHandler({ origin: env.PUBLIC_INTAKE_ORIGIN,
      key: customerKey,
      dataDir: customerDir, orderDir: env.PUBLIC_MOCK_SELFHOST_DATA_DIR, orderKey: mockKey, mailer });
    limitDirs.push(resolve(env.PUBLIC_MOCK_SELFHOST_DATA_DIR, 'request-limits'));
    limitDirs.push(resolve(customerDir, 'request-limits'));
    const prune = () => pruneMockOrders({ dataDir: env.PUBLIC_MOCK_SELFHOST_DATA_DIR, key: mockKey })
      .catch(error => process.stderr.write(`Mock order retention failed: ${error.message}\n`));
    await prune();
    setInterval(prune, 86400000).unref();
    const pruneCustomers = () => pruneCustomerAccounts({ dataDir: customerDir, key: customerKey })
      .catch(error => process.stderr.write(`Customer account retention failed: ${error.message}\n`));
    await pruneCustomers();
    setInterval(pruneCustomers, 86400000).unref();
  }
  const pruneLimits = () => Promise.all(limitDirs.map(directory => pruneDurableLimits(directory)))
    .catch(error => process.stderr.write(`Request-limit retention failed: ${error.message}\n`));
  await pruneLimits();
  setInterval(pruneLimits, 86400000).unref();
  createServer((req, res) => {
    if (req.url?.startsWith('/api/customer/')) {
      if (customer) Promise.resolve(customer(req, res)).catch(() => reply(res, 503, { error: 'unavailable' }));
      else reply(res, 404, { error: 'not_found' });
    } else if (req.url?.startsWith('/api/selfhost/mock')) {
      if (mock) Promise.resolve(mock(req, res)).catch(() => reply(res, 503, { error: 'unavailable' }));
      else reply(res, 404, { error: 'not_found' });
    } else waitlist(req, res);
  }).listen(Number(env.PUBLIC_INTAKE_PORT ?? 3101), '127.0.0.1');
}
