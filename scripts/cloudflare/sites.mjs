import { join } from 'node:path';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { stageSite } from '../sites/assets.mjs';
import { workerDirectory, wranglerConfig, saveJson } from './config.mjs';
import { configureAccess, accessHeaders } from './access.mjs';
import { cloudflareApi } from './api.mjs';

export const siteOrder = ['customer', 'admin', 'intake', 'public'];
export function siteConfig(config, state, surface, assets) {
  if (!siteOrder.includes(surface)) throw Error('Unknown deployment surface');
  const base = wranglerConfig(config, state, assets);
  const name = surface === 'public' ? config.workerName : `${config.workerName}-${surface}`;
  const origin = surface === 'admin' ? config.sites.adminOrigin : surface === 'customer' ? config.sites.customerOrigin : config.origin;
  const common = { ...base, name, routes: surface === 'intake' ? [] : [{ pattern: new URL(origin).hostname, custom_domain: true }],
    main: join(workerDirectory, surface === 'public' ? 'public-site.mjs' : surface === 'intake' ? 'intake-only.mjs' : surface === 'admin' ? 'admin-worker.mjs' : 'worker.mjs'),
    vars: { ...base.vars, PUBLIC_INTAKE_ORIGIN: origin, PUBLIC_SITE_ORIGIN: config.origin,
      CUSTOMER_ORIGIN: config.sites.customerOrigin, ADMIN_ORIGIN: config.sites.adminOrigin }, triggers: { crons: [] } };
  if (surface === 'public') {
    delete common.d1_databases; delete common.r2_buckets; delete common.send_email;
    common.vars = { PUBLIC_INTAKE_ORIGIN: config.origin, CUSTOMER_ORIGIN: config.sites.customerOrigin };
    common.services = [{ binding: 'INTAKE', service: `${config.workerName}-intake` }];
    common.assets.run_worker_first = true;
  } else if (surface === 'intake') {
    delete common.assets; delete common.r2_buckets; delete common.send_email;
    common.services = [{ binding: 'ALERTS', service: `${config.workerName}-admin`, entrypoint: 'AccessRequestAlerts' }];
    common.vars = { PUBLIC_INTAKE_ORIGIN: config.origin, ADMIN_ORIGIN: config.sites.adminOrigin,
      ...(config.intakeProtection ? { INTAKE_PROTECTION: '1', TURNSTILE_SITE_KEY: config.intakeProtection.siteKey,
        INTAKE_WAIT_MS: String(config.intakeProtection.waitMs), INTAKE_COOKIE_COOLDOWN_MS: String(config.intakeProtection.cookieCooldownMs) } : {}),
      ...(config.requestAlertTo ? { REQUEST_ALERT_TO: config.requestAlertTo, REQUEST_ALERT_FROM: config.requestAlertFrom } : {}) };
  } else {
    common.vars.SITE_SURFACE = surface;
    common.vars.CUSTOMER_PORTAL_ENABLED = '1';
    common.vars.CUSTOMER_EMAIL_STORAGE = '1';
    common.vars.CUSTOMER_EMAIL_LOGIN = '1';
    common.vars.CUSTOMER_MANUAL_MAIL = (config.customerEmail ? config.customerEmail.enabled : config.sites.emailLogin) ? '0' : '1';
    if (config.customerEmail) Object.assign(common.vars, {
      CUSTOMER_EMAIL_PROVIDER: 'resend', CUSTOMER_EMAIL_MODE: config.customerEmail.enabled ? 'production' : 'disabled',
      CUSTOMER_EMAIL_FROM: config.customerEmail.from, CUSTOMER_EMAIL_DAILY_LIMIT: String(config.customerEmail.dailyLimit ?? 90),
      CUSTOMER_EMAIL_MONTHLY_LIMIT: String(config.customerEmail.monthlyLimit ?? 2800),
    });
    if (surface === 'admin') common.triggers.crons = base.triggers.crons;
    if (surface === 'admin') {
      common.assets.run_worker_first = [...base.assets.run_worker_first, '/cloud-tenants/api/*'];
      if (config.cloudAdmin) Object.assign(common.vars, {
        CLOUD_ADMIN_ACCESS_ISSUER: config.cloudAdmin.accessIssuer, CLOUD_ADMIN_ACCESS_AUDIENCE: config.cloudAdmin.accessAudience,
        CLOUD_ADMIN_OPERATORS: config.cloudAdmin.operators.join(','), CLOUD_MANAGEMENT_ORIGIN: config.cloudAdmin.managementOrigin
      });
    }
    if (surface === 'admin' && config.intakeProtection) Object.assign(common.vars, {
      INTAKE_PROTECTION: '1', INTAKE_VOLUME_THRESHOLD: String(config.intakeProtection.volumeThreshold),
      INTAKE_VOLUME_WINDOW_MS: String(config.intakeProtection.volumeWindowMs),
    });
    if (surface === 'customer') delete common.send_email;
  }
  return common;
}
export async function siteSecrets(surface, secrets) {
  if (surface === 'public') return {};
  if (surface === 'intake') {
    const key = await crypto.subtle.importKey('raw', Buffer.from(secrets.INTAKE_KEY, 'hex'), 'HKDF', false, ['deriveBits']);
    const derive = async purpose => Buffer.from(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('127Vaults Cloudflare v1'), info: new TextEncoder().encode(purpose) }, key, 256)).toString('base64url');
    return { INTAKE_CONTACT_KEY: await derive('contacts'), INTAKE_LIMITER_KEY: await derive('request-limits'),
      ...(secrets.TURNSTILE_SECRET_KEY ? { TURNSTILE_SECRET_KEY: secrets.TURNSTILE_SECRET_KEY } : {}) };
  }
  return Object.fromEntries(Object.entries(secrets).filter(([name]) => name !== 'TURNSTILE_SECRET_KEY' &&
    (surface === 'admin' || (name !== 'OPERATOR_TOKEN' && !name.startsWith('CLOUD_MANAGEMENT_')))));
}
export async function renderSites(config, state) {
  const root = await mkdtemp(join(config.stateDirectory, 'sites-')), files = {};
  for (const surface of siteOrder) {
    const assets = join(root, surface);
    if (surface !== 'intake') await stageSite(surface, assets, { publicOrigin: config.origin });
    files[surface] = join(root, `${surface}.json`);
    await saveJson(files[surface], siteConfig(config, state, surface, assets));
  }
  return files;
}
export async function deploySites(config, state, secrets, run, { dryRun = false, access = configureAccess, api } = {}) {
  const files = await renderSites(config, state);
  if (!dryRun) await access(config, state);
  for (const surface of siteOrder) {
    const secretFile = join(config.stateDirectory, `.worker-secrets-${crypto.randomUUID()}.json`);
    try {
      if (!dryRun) await writeFile(secretFile, JSON.stringify(await siteSecrets(surface, secrets)), { flag: 'wx', mode: 0o600 });
      await run(['deploy', '--config', files[surface], ...(dryRun ? ['--dry-run', '--outdir', join(config.stateDirectory, 'bundles', surface)] : ['--secrets-file', secretFile])], config);
    } finally { if (!dryRun) await unlink(secretFile); }
  }
  if (!dryRun) {
    // Cloudflare retains omitted secrets. Remove the former combined Worker's credentials after cutover.
    api ??= await cloudflareApi(config);
    const path = `/accounts/${config.accountId}/workers/scripts/${config.workerName}/secrets`;
    for (const secret of await api(path)) await api(`${path}/${encodeURIComponent(secret.name)}`, { method: 'DELETE' });
    if ((await api(path)).length) throw Error('Public Worker still has secrets');
    state.sites = { origins: { public: config.origin, admin: config.sites.adminOrigin, customer: config.sites.customerOrigin }, deployedAt: new Date().toISOString() };
    await saveJson(join(config.stateDirectory, 'state.json'), state);
  }
  return files;
}
export async function verifySites(config, state, catalogue, secrets, { fetchImpl = fetch, access = configureAccess } = {}) {
  const accessReceipt = await access(config, state, { verifyOnly: true });
  const automation = await accessHeaders(config);
  const checks = [];
  const check = async (origin, path, expected, headers = {}) => {
    const response = await fetchImpl(origin + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!(Array.isArray(expected) ? expected : [expected]).includes(response.status)) throw Error(`Site check failed: ${origin}${path} (${response.status})`);
    checks.push({ origin, path, status: response.status }); return response;
  };
  for (const origin of [config.origin, config.sites.customerOrigin]) await check(origin, '/', 200);
  const waitlist = await check(config.origin, '/api/waitlist', 200);
  const intake = await waitlist.json();
  if (!intake.open || waitlist.headers.get('cache-control') !== 'no-store') throw Error('Intake is not ready');
  if (config.intakeProtection) {
    if (!intake.protected || intake.siteKey !== config.intakeProtection.siteKey || intake.waitMs !== config.intakeProtection.waitMs
      || !intake.challenge || !intake.challengeId || !/__Host-access-browser=.*; Path=\/;.*HttpOnly; Secure; SameSite=Strict/.test(waitlist.headers.get('set-cookie') ?? '')) throw Error('Protected intake readiness differs');
    const form = await check(config.origin, '/get-started', 200);
    const csp = form.headers.get('content-security-policy') ?? '';
    if (!csp.includes("script-src 'self' https://challenges.cloudflare.com") || !csp.includes('frame-src https://challenges.cloudflare.com')
      || !(await form.text()).includes('name="contactName"')) throw Error('Protected request form is not ready');
  }
  for (const path of ['/api/access-admin/requests', '/api/customer/me', '/api/trials/' + 'a'.repeat(64) + '/installer', '/access-admin', '/portal', '/access-admin.mjs', '/trial.mjs']) await check(config.origin, path, 404);
  for (const path of ['/api/access-admin/requests', '/access-admin', '/access-admin.mjs', '/api/waitlist']) await check(config.sites.customerOrigin, path, 404);
  const gate = await check(config.sites.adminOrigin, '/', config.sites.adminAccess === false ? 200 : [302, 401, 403]);
  if (gate.status === 302 && !new URL(gate.headers.get('location')).hostname.endsWith('.cloudflareaccess.com')) throw Error('Admin did not redirect to Access');
  await check(config.sites.adminOrigin, '/api/access-admin/requests', 401, automation);
  const admin = { ...automation, Authorization: `Bearer ${secrets.OPERATOR_TOKEN}` };
  const ready = await (await check(config.sites.adminOrigin, '/api/access-admin/readiness', 200, admin)).json();
  if (!ready.ready || ready.sourceRevision !== catalogue.sourceRevision || ready.artifacts !== catalogue.artifacts.length) throw Error('Separated catalogue readiness differs');
  for (const path of ['/api/customer/me', '/api/waitlist', '/portal', '/portal.mjs']) await check(config.sites.adminOrigin, path, 404, automation);
  for (const origin of [config.origin, config.sites.customerOrigin]) await check(origin, '/build-pages.mjs', 404);
  const receipt = { passed: true, checkedAt: new Date().toISOString(), access: accessReceipt, checks, catalogueSource: catalogue.sourceRevision };
  await saveJson(join(config.stateDirectory, 'site-verification.json'), receipt);
  return receipt;
}
