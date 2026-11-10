import { encryptionKey, hash, equal, token, seal, unseal, limitIdentity } from './crypto.mjs';
import { rawBody, reject, paidPersonalAccess, personalBuyerAllowed, convertibleInstallation } from './dodo.mjs';
import { createCloudflareTrialMailer } from '../src/cloudflare-email.mjs';
import { productionRecipient } from '../src/resend-email.mjs';
import { resendCustomerEmailEnabled, sendCustomerEmail } from './customer-email.mjs';

const cookieName = '__Host-127v-portal', lifetime = 12 * 3600000;
const normalize = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
const validEmail = email => /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email);
const idPattern = /^[a-f0-9]{64}$/;
const cookie = (value, seconds = lifetime / 1000) => `${cookieName}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const personalOffered = env => env.DODO_ENABLED === '1' && JSON.parse(env.DODO_PLANS ?? '{}')['personal-annual']?.plan === 'personal';
async function body(request, fields) {
  let value; try { value = JSON.parse(await rawBody(request, 2048)); } catch { reject(400, 'invalid_request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(v => !fields.includes(v))) reject(400, 'invalid_request');
  return value;
}
const portalKey = env => encryptionKey(env.INTAKE_KEY, 'customer-portal');
const identity = (request, value) => hash(`${new URL(request.url).origin}\0${value}`);
async function cloudCustomerTenants(env, email) {
  if (!env.CLOUD_CUSTOMER_DIRECTORY_ORIGIN) return { tenants: [], unavailable: false };
  if (!/^[a-f0-9]{64}$/.test(env.CLOUD_CUSTOMER_DIRECTORY_TOKEN ?? '')) return { tenants: [], unavailable: true };
  try {
    const response = await fetch(`${env.CLOUD_CUSTOMER_DIRECTORY_ORIGIN}/internal/cloud/v1/customer-tenants`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CLOUD_CUSTOMER_DIRECTORY_TOKEN}` },
      body: JSON.stringify({ email })
    });
    if (!response.ok) throw Error('cloud_directory_unavailable');
    const { tenants } = await response.json();
    if (!Array.isArray(tenants)) throw Error('cloud_directory_unavailable');
    return { tenants, unavailable: false };
  } catch {
    return { tenants: [], unavailable: true };
  }
}
export async function customerPrincipal(request, env, store, now) {
  if (env.CUSTOMER_PORTAL_ENABLED !== '1') return null;
  const value = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value ?? '')) return null;
  const id = await identity(request, value);
  const row = await store.db.prepare('SELECT principal, expires_at FROM customer_sessions WHERE id = ? AND expires_at > ?').bind(id, now).first();
  return row ? { ...await unseal(row.principal, await portalKey(env), `customer-session:${id}`), sessionExpiresAt: row.expires_at } : null;
}
export async function customerCanAccess(request, env, store, row, now, capability = 'installation') {
  if (!row?.contact || row.trial?.state !== 'approved') return false;
  const principal = await customerPrincipal(request, env, store, now);
  if (capability === 'billing' && principal?.installationOnly) return false;
  if (principal?.kind === 'email') return principal.email === normalize(row.contact.email);
  return principal?.kind === 'invitation' && principal.requestId === row.id && await equal(principal.invitationHash, row.trial.tokenHash);
}
export async function customerInstallerGrant(row, value, now) {
  return Boolean(value && row?.trial?.portalInstallerUntil > now && row.trial.portalInstallerParent === row.trial.tokenHash
    && await equal(await hash(value), row.trial.portalInstallerHash));
}
async function createSession(request, env, store, principal, now, expiresAt = now + lifetime) {
  const value = token(), id = await identity(request, value);
  await store.db.prepare('INSERT INTO customer_sessions (id, principal, expires_at) VALUES (?, ?, ?)')
    .bind(id, await seal(principal, await portalKey(env), `customer-session:${id}`), expiresAt).run();
  return cookie(value, Math.max(1, Math.floor((expiresAt - now) / 1000)));
}
async function deliver(env, message, store, challengeId, now, requestId, internal) {
  if (env.CUSTOMER_MANUAL_MAIL === '1' || internal) {
    await store.db.prepare('INSERT INTO customer_manual_mail (id, payload, expires_at) VALUES (?, ?, ?)')
      .bind(challengeId, await seal(message, await portalKey(env), `manual-customer-mail:${challengeId}`), now + 600000).run();
    return;
  }
  if (env.LOCAL_SITE_PREVIEW === '1' && env.CUSTOMER_MAIL) {
    const response = await env.CUSTOMER_MAIL.fetch('https://local.invalid/customer-code', { method: 'POST', body: JSON.stringify(message) });
    if (!response.ok) throw Error('local_mail_unavailable');
    return;
  }
  if (env.CUSTOMER_EMAIL_PROVIDER === 'resend') {
    const result = await sendCustomerEmail(env, store, { requestId, event: challengeId, purpose: 'sign-in', message, expiresAt: now + 600000 }, { now });
    if (result.state !== 'queued') throw Error('mail_unavailable');
    return;
  }
  const mailer = createCloudflareTrialMailer({ accountId: env.CF_ACCOUNT_ID, apiToken: env.TRIAL_EMAIL_API_TOKEN, from: env.TRIAL_EMAIL_FROM });
  const result = await mailer.sendInvitation(message);
  if (!['accepted', 'queued'].includes(result.state)) throw Error('mail_unavailable');
}
export async function handleCustomerPortal(request, env, store, now) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/customer/')) return null;
  if (env.CUSTOMER_PORTAL_ENABLED !== '1') reject(404, 'not_found');
  if (!['GET', 'POST'].includes(request.method)) reject(405, 'method_not_allowed');
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!await store.allow('portal-ip', ip, 120, 3600000)) reject(429, 'rate_limited');
  if (path === '/api/customer/start' && request.method === 'POST') {
    if (env.CUSTOMER_EMAIL_LOGIN === '0') return json(503, { error: 'email_sign_in_unavailable' });
    const input = await body(request, ['email']), email = normalize(input.email);
    if (!validEmail(email)) reject(400, 'invalid_request');
    if (!await store.allow('portal-start-ip', ip, 20, 3600000) || !await store.allow('portal-start-email', email, 3, 3600000)) reject(429, 'rate_limited');
    const challengeId = token();
    const rows = await store.list();
    const owned = rows.filter(row => row.contact?.plan !== 'support' && normalize(row.contact?.email) === email);
    let customer = owned.find(row => row.trial?.kind !== 'development') ?? owned[0];
    const buying = personalOffered(env);
    if (!customer && buying && (env.LOCAL_SITE_PREVIEW === '1' ||
      (env.DODO_MODE === 'live_mode' && resendCustomerEmailEnabled(env) && productionRecipient(email)))) {
      const id = await hash(await limitIdentity(store.limiterKey, `personal-signup:${email}`));
      await store.insertOrder(id, { email, plan: 'personal', name: email }, { kind: 'personal-signup', state: 'signup' });
      customer = await store.get(id);
    }
    const cloudPilot = !customer && env.CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN === '1' &&
      (await cloudCustomerTenants(env, email)).tenants.length > 0;
    if (customer || cloudPilot) {
      const internal = cloudPilot || (env.CUSTOMER_EMAIL_PROVIDER === 'resend' && (customer.trial?.kind === 'development' || !productionRecipient(email)));
      let random; do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= 4294000000);
      const code = String(random % 1000000).padStart(6, '0');
      const codeHash = await limitIdentity(store.limiterKey, `portal-code:${challengeId}:${code}`);
      await store.db.prepare('INSERT INTO customer_challenges (id, payload, expires_at) VALUES (?, ?, ?)')
        .bind(challengeId, await seal({ email, codeHash }, await portalKey(env), `customer-challenge:${challengeId}`), now + 600000).run();
      try { await deliver(env, { to: email, subject: 'Your 127Vaults customer portal sign-in code',
        text: `Your customer portal sign-in code is ${code}. It expires in 10 minutes and can be used once.\n\nOpen ${env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN}/ and enter the code in the browser where you requested it.\n\nThis signs you into customer billing and downloads. It does not sign you into a vault. If you did not request it, ignore this email.` }, store, challengeId, now, customer?.id, internal); }
      catch { await store.db.prepare('DELETE FROM customer_challenges WHERE id = ?').bind(challengeId).run(); }
    }
    return json(202, { challengeId, message: env.CUSTOMER_MANUAL_MAIL === '1'
      ? 'If this email is eligible, your operator can provide a sign-in code through manual delivery.'
      : env.CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN === '1'
      ? 'If this email is eligible, check your inbox or contact your operator for a sign-in code.'
      : buying ? 'Check your inbox for your sign-in code.' : 'If this email has an access request or invitation, a sign-in code will be sent.' });
  }
  if (path === '/api/customer/complete' && request.method === 'POST') {
    const input = await body(request, ['challengeId', 'code']);
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId ?? '') || !/^\d{6}$/.test(input.code ?? '')) reject(403, 'invalid_code');
    if (!await store.allow('portal-verify-ip', ip, 30, 3600000)) reject(429, 'rate_limited');
    const row = await store.db.prepare('UPDATE customer_challenges SET attempts = attempts + 1 WHERE id = ? AND expires_at > ? AND attempts < 5 RETURNING payload, attempts')
      .bind(input.challengeId, now).first();
    if (!row) reject(403, 'invalid_code');
    const payload = await unseal(row.payload, await portalKey(env), `customer-challenge:${input.challengeId}`);
    if (!await equal(payload.codeHash, await limitIdentity(store.limiterKey, `portal-code:${input.challengeId}:${input.code}`))) reject(403, 'invalid_code');
    const consumed = await store.db.prepare('DELETE FROM customer_challenges WHERE id = ? AND attempts = ? RETURNING id').bind(input.challengeId, row.attempts).first();
    if (!consumed) reject(403, 'invalid_code');
    return json(200, { signedIn: true }, { 'Set-Cookie': await createSession(request, env, store, { kind: 'email', email: payload.email }, now) });
  }
  if (path === '/api/customer/invitation' && request.method === 'POST') {
    const input = await body(request, ['requestId', 'token']);
    if (!idPattern.test(input.requestId ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(input.token ?? '')) reject(401, 'access_required');
    const row = await store.get(input.requestId);
    const installer = await customerInstallerGrant(row, input.token, now);
    if (!row?.contact || row.trial?.state !== 'approved' || (!installer && (Date.parse(row.trial.linkExpiresAt) <= now
      || !await equal(await hash(input.token), row.trial.tokenHash)))) reject(401, 'access_required');
    const existing = await customerPrincipal(request, env, store, now);
    if (existing?.kind === 'email' && existing.email === normalize(row.contact.email)) return json(200, { signedIn: true, requestId: row.id });
    return json(200, { signedIn: true, requestId: row.id }, { 'Set-Cookie': await createSession(request, env, store,
      { kind: 'invitation', requestId: row.id, invitationHash: row.trial.tokenHash, installationOnly: installer }, now, Math.min(now + lifetime, installer ? row.trial.portalInstallerUntil : Date.parse(row.trial.linkExpiresAt))) });
  }
  const principal = await customerPrincipal(request, env, store, now);
  if (!principal) reject(401, 'access_required');
  if (path === '/api/customer/installer-link' && request.method === 'POST') {
    const input = await body(request, ['requestId']);
    if (!idPattern.test(input.requestId ?? '')) reject(400, 'invalid_request');
    const row = await store.get(input.requestId);
    if (!await customerCanAccess(request, env, store, row, now)) reject(404, 'not_found');
    if (row.trial.kind === 'personal-purchase' && !paidPersonalAccess(row.trial, now)) reject(403, 'payment_required');
    const value = token(), expiresAt = Math.min(now + 3600000, principal.kind === 'invitation' ? principal.sessionExpiresAt : Infinity);
    await store.save(row, { ...row.trial, portalInstallerHash: await hash(value), portalInstallerUntil: expiresAt, portalInstallerParent: row.trial.tokenHash });
    return json(200, { link: `${env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN}/trial?open=1#${row.id}.${value}`, expiresAt: new Date(expiresAt).toISOString() });
  }
  if (path === '/api/customer/me' && request.method === 'GET') {
    const rows = await store.list();
    const requests = [];
    const conversionPlan = env.DODO_MODE === 'live_mode' && personalOffered(env) && principal.kind === 'email'
      ? JSON.parse(env.DODO_PLANS)['personal-annual'] : null;
    for (const row of rows) {
      if (row.contact?.plan === 'support' || row.trial?.kind === 'personal-signup') continue;
      const owned = principal.kind === 'email' ? normalize(row.contact?.email) === principal.email
        : row.id === principal.requestId && row.trial?.state === 'approved' && await equal(principal.invitationHash, row.trial.tokenHash);
      if (!owned) continue;
      const personalPurchase = row.trial?.kind === 'personal-purchase';
      const paid = paidPersonalAccess(row.trial, now);
      requests.push({ id: row.id, plan: personalPurchase ? 'personal' : row.trial?.billing?.planSlug ?? row.contact.plan,
        state: row.trial?.convertedPurchaseId ? 'converted' : personalPurchase && !paid ? 'purchase_pending' : row.trial?.state ?? 'requested',
        convertible: convertibleInstallation(row.trial, conversionPlan), conversion: Boolean(row.trial?.conversionSourceId),
        kind: row.trial?.kind ?? (row.trial?.state === 'approved' ? 'trial' : null),
        billingMode: row.trial?.billing?.mode ?? null, createdAt: new Date(row.receivedAt).toISOString(),
        checkoutStartedAt: row.trial?.billing?.checkoutStartedAt ?? null,
        installationId: row.trial?.installationId ?? null, expiresAt: row.trial?.expiresAt ?? null,
        billingStatus: row.trial?.billing?.status ?? null, paidThrough: row.trial?.billing?.paidThrough ?? null,
        cancelAtPeriodEnd: Boolean(row.trial?.billing?.cancelAtPeriodEnd), maxUsers: row.trial?.maxUsers ?? null });
    }
    const cloud = principal.kind === 'email' ? await cloudCustomerTenants(env, principal.email) : { tenants: [], unavailable: false };
    return json(200, { scope: principal.installationOnly ? 'installer' : principal.kind, email: principal.kind === 'email' ? principal.email : null,
      purchaseMode: personalOffered(env) && personalBuyerAllowed(env, principal.email) ? env.DODO_MODE : null,
      canBuyPersonal: principal.kind === 'email' && personalBuyerAllowed(env, principal.email) && personalOffered(env)
        && !requests.some(row => row.plan === 'personal' && row.billingStatus),
      requests, cloudTenants: cloud.tenants, cloudUnavailable: cloud.unavailable });
  }
  if (path === '/api/customer/logout' && request.method === 'POST') {
    await body(request, []);
    const value = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    await store.db.prepare('DELETE FROM customer_sessions WHERE id = ?').bind(await identity(request, value)).run();
    return json(200, { signedOut: true }, { 'Set-Cookie': cookie('', 0) });
  }
  reject(404, 'not_found');
}
export async function manualCustomerMail(env, store, now) {
  if (env.CUSTOMER_MANUAL_MAIL !== '1' && env.CUSTOMER_EMAIL_PROVIDER !== 'resend' &&
      env.CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN !== '1') return { messages: [] };
  const { results } = await store.db.prepare(`SELECT m.id, m.payload, m.expires_at FROM customer_manual_mail m
    JOIN customer_challenges c ON c.id = m.id WHERE m.expires_at > ? AND c.expires_at > ? AND c.attempts < 5
    ORDER BY m.expires_at LIMIT 50`).bind(now, now).all();
  return { messages: await Promise.all(results.map(async row => ({ id: row.id,
    ...await unseal(row.payload, await portalKey(env), `manual-customer-mail:${row.id}`), expiresAt: new Date(row.expires_at).toISOString() }))) };
}
export async function pruneCustomerPortal(store, now, manual = false) {
  await store.db.batch([store.db.prepare('DELETE FROM customer_challenges WHERE expires_at <= ?').bind(now),
    store.db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').bind(now)]);
  if (manual) await store.db.prepare('DELETE FROM customer_manual_mail WHERE expires_at <= ? OR id NOT IN (SELECT id FROM customer_challenges)').bind(now).run();
}
