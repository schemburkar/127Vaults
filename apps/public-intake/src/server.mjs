import { createServer } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const recent = new Map();
  const recentEmails = new Map();
  return async (req, res) => {
    if (req.url !== '/api/waitlist') { reply(res, 404, { error: 'not_found' }); return; }
    if (req.method === 'GET') { reply(res, 200, { open: true }); return; }
    if (req.method !== 'POST') { reply(res, 405, { error: 'method_not_allowed' }); return; }
    if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      reply(res, 403, { error: 'forbidden' }); return;
    }
    const address = req.socket.remoteAddress ?? 'unknown';
    const hits = (recent.get(address) ?? []).filter(at => now() - at < 60 * 60 * 1000);
    if (hits.length >= 60) { reply(res, 429, { error: 'rate_limited' }); return; }
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
      const emailHits = (recentEmails.get(input.email) ?? []).filter(at => now() - at < 60 * 60 * 1000);
      if (emailHits.length >= 3) { reply(res, 429, { error: 'rate_limited' }); return; }
      recent.set(address, [...hits, now()]);
      recentEmails.set(input.email, [...emailHits, now()]);
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
  const handler = createIntakeHandler({ origin: env.PUBLIC_INTAKE_ORIGIN, key, dataFile: env.PUBLIC_INTAKE_DATA_FILE });
  createServer(handler).listen(Number(env.PUBLIC_INTAKE_PORT ?? 3101), '127.0.0.1');
}
