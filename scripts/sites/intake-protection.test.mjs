import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { TrialStore } from '../../apps/public-intake/cloudflare/store.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalSites } from './local.mjs';
import { intakeChallenge, verifyIntake } from '../../apps/public-intake/cloudflare/intake-protection.mjs';
import { notifyRequestVolume } from '../../apps/public-intake/src/request-alerts.mjs';
import intake from '../../apps/public-intake/cloudflare/intake-only.mjs';
import { validateRequest } from '../../apps/public-intake/src/validate-request.mjs';

const env = { INTAKE_PROTECTION: '1', PUBLIC_INTAKE_ORIGIN: 'https://access.example.invalid',
  INTAKE_LIMITER_KEY: Buffer.alloc(32, 7).toString('base64url'), INTAKE_CONTACT_KEY: Buffer.alloc(32, 9).toString('base64url'),
  TURNSTILE_SITE_KEY: 'synthetic-site-key', TURNSTILE_SECRET_KEY: 'synthetic-secret-key-only', INTAKE_WAIT_MS: '15000', INTAKE_COOKIE_COOLDOWN_MS: '60000' };
const baseRequest = (cookie, ip = '192.0.2.5') => new Request(env.PUBLIC_INTAKE_ORIGIN + '/api/waitlist', { headers: { 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}) } });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), '127v-intake-abuse-')); const local = await createLocalSites({ directory });
  t.after(async () => { await local.close(); await rm(directory, { recursive: true, force: true }); }); return local.database;
}
async function challenge(now, cookie) {
  const result = await intakeChallenge(env, baseRequest(cookie), now);
  return { request: baseRequest(result.cookie.split(';')[0]), input: { challenge: result.body.challenge, turnstileToken: 'synthetic-provider-token' }, id: result.body.challengeId, cookie: result.cookie };
}
const accepted = c => async (url, options) => {
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(JSON.parse(options.body).response, 'synthetic-provider-token');
  return Response.json({ success: true, hostname: 'access.example.invalid', action: 'access-request', cdata: c.id });
};

test('actual protected intake Worker accepts one verified delayed named request and rejects replay without real provider calls', async t => {
  let challengeId, providerCalls = 0;
  const mf = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../../apps/public-intake/cloudflare/intake-only.mjs', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }], compatibilityDate: '2026-07-01',
    bindings: { ...env, INTAKE_WAIT_MS: '1000' }, d1Databases: ['DB'], outboundService: async request => {
      assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify'); providerCalls++;
      return Response.json({ success: true, hostname: 'access.example.invalid', action: 'access-request', cdata: challengeId });
    } });
  t.after(() => mf.dispose()); const db = await mf.getD1Database('DB');
  for (const migration of ['0001_trials.sql', '0006_intake_protection.sql']) {
    const source = await readFile(new URL('../../apps/public-intake/cloudflare/migrations/' + migration, import.meta.url), 'utf8');
    for (const sql of source.split(';').map(v => v.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  const get = await mf.dispatchFetch(env.PUBLIC_INTAKE_ORIGIN + '/api/waitlist', { headers: { 'cf-connecting-ip': '192.0.2.5' } });
  const c = await get.json(); challengeId = c.challengeId;
  assert.ok(!JSON.stringify(c).includes('volumeThreshold'));
  const body = { email: 'person@example.invalid', contactName: 'A chosen name', organization: '', plan: 'personal', requestedSeats: 1, consent: true, website: '', challenge: c.challenge, turnstileToken: 'synthetic-provider-token' };
  const post = () => mf.dispatchFetch(env.PUBLIC_INTAKE_ORIGIN + '/api/waitlist', { method: 'POST', headers: {
    Origin: env.PUBLIC_INTAKE_ORIGIN, Cookie: get.headers.get('set-cookie').split(';')[0], 'cf-connecting-ip': '192.0.2.5', 'Content-Type': 'application/json'
  }, body: JSON.stringify(body) });
  assert.equal((await (await post()).json()).error, 'please_wait'); assert.equal(providerCalls, 0);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const response = await post();
  assert.equal(response.status, 202, `${await response.text()}; provider calls: ${providerCalls}`); assert.equal((await post()).status, 403);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_requests').first()).n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM intake_activity').first()).n, 1);
  const contactKey = await crypto.subtle.importKey('raw', Buffer.alloc(32, 9), 'AES-GCM', false, ['decrypt']);
  const [row] = await new TrialStore(db, contactKey, null).list(); assert.equal(row.contact.contactName, 'A chosen name');
});

test('signed browser cookie, server wait, IP binding and challenge expiry cannot be bypassed', async t => {
  const db = await fixture(t), now = Date.now(), c = await challenge(now);
  assert.match(c.cookie, /HttpOnly; Secure; SameSite=Strict/);
  const forbidden = async () => { throw Error('Provider must not be contacted'); };
  const check = (request, input, at) => verifyIntake(env, request, input, db, { now: at, fetchImpl: forbidden });
  assert.equal(await check(c.request, c.input, now + 14999), 'please_wait');
  assert.equal(await check(baseRequest(), c.input, now + 16000), 'verification_required');
  assert.equal(await check(baseRequest(c.cookie, '192.0.2.6'), c.input, now + 16000), 'verification_required');
  assert.equal(await check(c.request, { ...c.input, challenge: c.input.challenge + 'x' }, now + 16000), 'verification_required');
  assert.equal(await check(c.request, c.input, now + 31 * 60000), 'verification_required');
  assert.equal(await check(c.request, { ...c.input, turnstileToken: '' }, now + 16000), 'verification_required');
});

test('Turnstile hostname, action, challenge binding and provider errors fail closed; parallel replay sends no duplicate request', async t => {
  const db = await fixture(t), now = Date.now(), c = await challenge(now);
  for (const change of [{ success: false }, { hostname: 'wrong.example.invalid' }, { action: 'wrong' }, { cdata: 'wrong' }]) {
    assert.equal(await verifyIntake(env, c.request, c.input, db, { now: now + 16000, fetchImpl: async () => Response.json({ success: true, hostname: 'access.example.invalid', action: 'access-request', cdata: c.id, ...change }) }), 'verification_required');
  }
  assert.equal(await verifyIntake(env, c.request, c.input, db, { now: now + 16000, fetchImpl: async () => { throw Error('Synthetic outage'); } }), 'verification_unavailable');
  const results = await Promise.all(Array.from({ length: 3 }, () => verifyIntake(env, c.request, c.input, db, { now: now + 16000, fetchImpl: accepted(c) })));
  assert.equal(results.filter(v => v === null).length, 1);
  assert.equal(results.filter(v => v === 'verification_required').length, 2);
  const next = await challenge(now + 17000, c.cookie);
  assert.equal(await verifyIntake(env, next.request, next.input, db, { now: now + 33000, fetchImpl: accepted(next) }), 'rate_limited');
});

test('protected intake requires a name and cookie; personal names are retained without requiring a specific name format', async t => {
  const db = await fixture(t);
  const input = { email: 'person@example.invalid', plan: 'personal', organization: '', website: '', requestedSeats: 1, consent: true };
  const post = body => intake.fetch(new Request(env.PUBLIC_INTAKE_ORIGIN + '/api/waitlist', { method: 'POST', headers: { Origin: env.PUBLIC_INTAKE_ORIGIN, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.5' }, body: JSON.stringify(body) }), { ...env, DB: db });
  assert.equal((await (await post(input)).json()).error, 'name_required');
  assert.equal((await (await post({ ...input, contactName: 'Name' })).json()).error, 'verification_required');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_requests').first()).n, 0);
  for (const name of ['A', 'First Last', 'A chosen name']) assert.equal(validateRequest({ ...input, contactName: name }).contactName, name);
  const get = await intake.fetch(baseRequest(), { ...env, DB: db }); const body = await get.json();
  assert.equal(body.protected, true); assert.equal(body.waitMs, 15000);
  assert.ok(!JSON.stringify(body).includes('volume')); assert.ok(!JSON.stringify(body).includes(env.TURNSTILE_SECRET_KEY));
});

test('private rolling volume alert counts distinct addresses and claims one Cloudflare send even concurrently or after uncertain delivery', async t => {
  const db = await fixture(t), now = Date.now(); let sends = 0;
  const settings = { INTAKE_PROTECTION: '1', INTAKE_VOLUME_THRESHOLD: '3', INTAKE_VOLUME_WINDOW_MS: '14400000',
    PUBLIC_SITE_ORIGIN: 'https://access.example.invalid', ADMIN_ORIGIN: 'https://admin.example.invalid',
    REQUEST_ALERT_TO: 'operator@example.invalid', REQUEST_ALERT_FROM: 'requests@access.example.invalid', REQUEST_ALERTS: { send: async message => {
      sends++; assert.equal(message.to, 'operator@example.invalid'); assert.match(message.text, /may be interest.*attempted abuse/); assert.match(message.text, /https:\/\/admin.example.invalid\/access-admin/); return { messageId: 'synthetic-only' };
    } } };
  const add = (id, email, received = now) => db.prepare('INSERT INTO intake_activity VALUES (?, ?, ?)').bind(id, email, received).run();
  await add('old', 'old', now - 14400001); await add('one', 'same'); await add('two', 'same'); await add('three', 'different');
  await notifyRequestVolume(settings, { db }, now); assert.equal(sends, 0);
  await add('four', 'third');
  await Promise.all(Array.from({ length: 4 }, () => notifyRequestVolume(settings, { db }, now)));
  assert.equal(sends, 1);
  await notifyRequestVolume(settings, { db }, now + 1000); assert.equal(sends, 1);
  await db.prepare('DELETE FROM intake_volume_alerts').run();
  settings.REQUEST_ALERTS.send = async () => { sends++; throw Error('Synthetic ambiguous failure'); };
  await notifyRequestVolume(settings, { db }, now); await notifyRequestVolume(settings, { db }, now + 1000);
  assert.equal(sends, 2); assert.equal((await db.prepare('SELECT state FROM intake_volume_alerts').first()).state, 'unconfirmed');
  const later = now + 14400001;
  await notifyRequestVolume(settings, { db }, later); assert.equal(sends, 2, 'Old requests leave the rolling window');
  await add('later-one', 'next-a', later); await add('later-two', 'next-b', later); await add('later-three', 'next-c', later);
  await notifyRequestVolume(settings, { db }, later); assert.equal(sends, 3, 'Fresh volume can alert after the cooldown');
});
